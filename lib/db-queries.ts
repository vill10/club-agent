// Typed query helpers — the ONLY module that knows the SQL column layout.
// better-sqlite3 is synchronous (no async/await). Prepared statements are
// created once at module scope for performance. Everything outside this file
// uses these helpers + the camelCase types from `@/types`.
//
// ── JSON storage convention (contract for task 2.x upsertCard callers) ──────
//
// runs.intent_json        = JSON.stringify(Intent)            // the full Intent object
// run_events.payload_json = JSON.stringify(RunEventPayload)   // the discriminated-union payload
//
// cards: the row carries BOTH structured JSON columns (source of truth) and
// flat scalar convenience columns. The mapping is:
//
//   contacts_json  = JSON.stringify(Contact[])         // source of truth for contacts
//   schedule_json  = JSON.stringify(CardField<string>) // full CardField for schedule
//   fields_json    = JSON.stringify(Record<fieldKey, CardField<string>>)
//                    where fieldKey ∈ {district,address,schedule,priceRange,ageRange}
//                    — SOURCE OF TRUTH for confidence + sourceSnippet of every CardField.
//
//   Scalar convenience columns (district, address, price_range, age_range, rank,
//   name, match_reason, draft_message) mirror the `.value` of the matching
//   CardField (or the raw scalar) for cheap SQL filtering/sorting. They are
//   DERIVED — never read confidence/source from them; always reconstruct
//   CardFields from fields_json.
//
//   `sources` (string[]) is derived on read from the union of every CardField's
//   sourceSnippet-origin and each Contact.source is NOT used; instead `sources`
//   is persisted explicitly inside fields_json under the reserved key
//   "__sources" to keep round-tripping faithful.

import { db } from "@/lib/db";
import type {
  Card,
  CardField,
  Contact,
  Intent,
  Run,
  RunEvent,
  RunEventKind,
  RunEventPayload,
  RunStatus,
} from "@/types";

// ── Row shapes (raw snake_case as stored) ───────────────────────────────────

interface RunRow {
  id: string;
  created_at: number;
  raw_query: string;
  intent_json: string;
  status: string;
  finished_at: number | null;
  cost_usd: number | null;
  client_ip_hash: string;
}

interface RunEventRow {
  id: number;
  run_id: string;
  ts: number;
  kind: string;
  payload_json: string;
}

interface CardRow {
  id: string;
  run_id: string;
  name: string;
  district: string | null;
  address: string | null;
  contacts_json: string | null;
  schedule_json: string | null;
  price_range: string | null;
  age_range: string | null;
  match_reason: string | null;
  draft_message: string | null;
  rank: number | null;
  fields_json: string;
}

// The CardField map stored inside fields_json, plus the reserved sources key.
type CardFieldKey = "district" | "address" | "schedule" | "priceRange" | "ageRange";
type FieldsBlob = Partial<Record<CardFieldKey, CardField<string>>> & {
  __sources?: string[];
};

// ── Prepared statements (module scope, created once) ────────────────────────

const insertRunStmt = db.prepare(`
  INSERT INTO runs (id, created_at, raw_query, intent_json, status, finished_at, cost_usd, client_ip_hash)
  VALUES (@id, @created_at, @raw_query, @intent_json, @status, @finished_at, @cost_usd, @client_ip_hash)
`);

const getRunStmt = db.prepare(`SELECT * FROM runs WHERE id = ?`);

const setRunStatusStmt = db.prepare(`
  UPDATE runs
  SET status = @status,
      finished_at = COALESCE(@finished_at, finished_at),
      cost_usd = COALESCE(@cost_usd, cost_usd)
  WHERE id = @id
`);

const insertEventStmt = db.prepare(`
  INSERT INTO run_events (run_id, ts, kind, payload_json)
  VALUES (@run_id, @ts, @kind, @payload_json)
`);

const getEventsSinceStmt = db.prepare(`
  SELECT * FROM run_events WHERE run_id = ? AND id > ? ORDER BY id ASC
`);

const getEventsStmt = db.prepare(`
  SELECT * FROM run_events WHERE run_id = ? ORDER BY id ASC
`);

const getCardsStmt = db.prepare(`
  SELECT * FROM cards WHERE run_id = ? ORDER BY rank IS NULL, rank ASC
`);

const getCardsRawStmt = db.prepare(`SELECT * FROM cards WHERE id = ?`);

// ── Row → type mappers (single source of truth for marshalling) ─────────────

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    createdAt: row.created_at,
    rawQuery: row.raw_query,
    intent: JSON.parse(row.intent_json) as Intent,
    status: row.status as RunStatus,
    finishedAt: row.finished_at,
    costUsd: row.cost_usd,
  };
}

function rowToRunEvent(row: RunEventRow): RunEvent {
  return {
    id: row.id,
    runId: row.run_id,
    ts: row.ts,
    kind: row.kind as RunEventKind,
    payload: JSON.parse(row.payload_json) as RunEventPayload,
  };
}

function rowToCard(row: CardRow): Card {
  const fields = JSON.parse(row.fields_json) as FieldsBlob;
  const contacts: Contact[] = row.contacts_json
    ? (JSON.parse(row.contacts_json) as Contact[])
    : [];

  const card: Card = {
    id: row.id,
    runId: row.run_id,
    name: row.name,
    contacts,
    sources: fields.__sources ?? [],
  };

  if (fields.district) card.district = fields.district;
  if (fields.address) card.address = fields.address;
  if (fields.priceRange) card.priceRange = fields.priceRange;
  if (fields.ageRange) card.ageRange = fields.ageRange;

  // schedule_json is the canonical store for the schedule CardField; fall back
  // to fields_json if absent.
  if (row.schedule_json) {
    card.schedule = JSON.parse(row.schedule_json) as CardField<string>;
  } else if (fields.schedule) {
    card.schedule = fields.schedule;
  }

  if (row.match_reason !== null) card.matchReason = row.match_reason;
  if (row.draft_message !== null) card.draftMessage = row.draft_message;
  if (row.rank !== null) card.rank = row.rank;

  return card;
}

// ── Public helpers ──────────────────────────────────────────────────────────

export function createRun(input: {
  id: string;
  rawQuery: string;
  intent: Intent;
  clientIpHash: string;
}): void {
  insertRunStmt.run({
    id: input.id,
    created_at: Math.floor(Date.now() / 1000),
    raw_query: input.rawQuery,
    intent_json: JSON.stringify(input.intent),
    status: "running",
    finished_at: null,
    cost_usd: null,
    client_ip_hash: input.clientIpHash,
  });
}

export function getRun(id: string): Run | null {
  const row = getRunStmt.get(id) as RunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function setRunStatus(
  id: string,
  status: RunStatus,
  finishedAt?: number,
  costUsd?: number,
): void {
  setRunStatusStmt.run({
    id,
    status,
    finished_at: finishedAt ?? null,
    cost_usd: costUsd ?? null,
  });
}

export function appendEvent(
  runId: string,
  kind: RunEventKind,
  payload: RunEventPayload,
): RunEvent {
  const ts = Math.floor(Date.now() / 1000);
  const result = insertEventStmt.run({
    run_id: runId,
    ts,
    kind,
    payload_json: JSON.stringify(payload),
  });
  return {
    id: Number(result.lastInsertRowid),
    runId,
    ts,
    kind,
    payload,
  };
}

export function getEventsSince(runId: string, afterId: number): RunEvent[] {
  const rows = getEventsSinceStmt.all(runId, afterId) as RunEventRow[];
  return rows.map(rowToRunEvent);
}

export function getEvents(runId: string): RunEvent[] {
  const rows = getEventsStmt.all(runId) as RunEventRow[];
  return rows.map(rowToRunEvent);
}

export function upsertCard(
  card: Partial<Card> & { id: string; runId: string; name: string },
): void {
  // Build the fields_json blob from whichever CardFields are present on the
  // partial. On update we merge with the existing blob so unspecified keys are
  // preserved (don't clobber confidence/sources already stored).
  const existing = getCardsRawStmt.get(card.id) as CardRow | undefined;
  const existingFields: FieldsBlob = existing
    ? (JSON.parse(existing.fields_json) as FieldsBlob)
    : {};

  const fields: FieldsBlob = { ...existingFields };
  if ("district" in card && card.district) fields.district = card.district;
  if ("address" in card && card.address) fields.address = card.address;
  if ("schedule" in card && card.schedule) fields.schedule = card.schedule;
  if ("priceRange" in card && card.priceRange) fields.priceRange = card.priceRange;
  if ("ageRange" in card && card.ageRange) fields.ageRange = card.ageRange;
  if ("sources" in card && card.sources) fields.__sources = card.sources;

  // Build the column set dynamically so an update only touches provided keys.
  // For an insert we always supply the full row (existing === undefined),
  // letting omitted-but-required columns take their natural null/default.
  const cols: Record<string, unknown> = {
    id: card.id,
    run_id: card.runId,
    name: card.name,
    fields_json: JSON.stringify(fields),
  };

  if ("district" in card) cols.district = card.district?.value ?? null;
  if ("address" in card) cols.address = card.address?.value ?? null;
  if ("priceRange" in card) cols.price_range = card.priceRange?.value ?? null;
  if ("ageRange" in card) cols.age_range = card.ageRange?.value ?? null;
  if ("schedule" in card) {
    cols.schedule_json = card.schedule ? JSON.stringify(card.schedule) : null;
  }
  if ("contacts" in card) {
    cols.contacts_json = card.contacts ? JSON.stringify(card.contacts) : null;
  }
  if ("matchReason" in card) cols.match_reason = card.matchReason ?? null;
  if ("draftMessage" in card) cols.draft_message = card.draftMessage ?? null;
  if ("rank" in card) cols.rank = card.rank ?? null;

  const keys = Object.keys(cols);
  const insertCols = keys.join(", ");
  const insertVals = keys.map((k) => `@${k}`).join(", ");
  // On conflict, only the provided (non-identity) keys get overwritten.
  const updateKeys = keys.filter((k) => k !== "id");
  const updateSet = updateKeys.map((k) => `${k} = @${k}`).join(", ");

  const sql = updateSet
    ? `INSERT INTO cards (${insertCols}) VALUES (${insertVals})
       ON CONFLICT(id) DO UPDATE SET ${updateSet}`
    : `INSERT INTO cards (${insertCols}) VALUES (${insertVals})
       ON CONFLICT(id) DO NOTHING`;

  db.prepare(sql).run(cols);
}

export function getCards(runId: string): Card[] {
  const rows = getCardsStmt.all(runId) as CardRow[];
  return rows.map(rowToCard);
}
