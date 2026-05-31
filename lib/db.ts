import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  raw_query TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  status TEXT NOT NULL,
  finished_at INTEGER,
  cost_usd REAL,
  client_ip_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS run_events_by_run ON run_events(run_id, id);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  name TEXT NOT NULL,
  district TEXT,
  address TEXT,
  contacts_json TEXT,
  schedule_json TEXT,
  price_range TEXT,
  age_range TEXT,
  match_reason TEXT,
  draft_message TEXT,
  rank INTEGER,
  fields_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_by_run ON cards(run_id, rank);

CREATE TABLE IF NOT EXISTS budget_ledger (
  day TEXT PRIMARY KEY,
  cost_usd REAL NOT NULL DEFAULT 0,
  runs_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ip_ledger (
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  hour INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (ip_hash, day, hour)
);
`;

// Resolve the SQLite path robustly, independent of a stale `DATABASE_PATH`.
//
// Precedence:
//   1. A genuinely-custom `DATABASE_PATH` (anything other than the dev default)
//      is always honored.
//   2. Otherwise, if `/data` is writable (Railway persistent volume mounted
//      there), use `/data/club-agent.sqlite` — this survives redeploys.
//   3. Otherwise (local dev, or no volume), fall back to the ephemeral dev db.
//
// This means the bad live env value `./dev.sqlite` is treated as "not
// configured" and never overrides the persistent volume.
export function resolveDbPath(): string {
  const explicit = process.env.DATABASE_PATH?.trim();
  const isRealExplicit =
    explicit && explicit !== "./dev.sqlite" && explicit !== "dev.sqlite";
  if (isRealExplicit) return explicit!;

  // Auto-use the persistent volume if /data is writable.
  try {
    fs.mkdirSync("/data", { recursive: true }); // no-op if exists
    fs.accessSync("/data", fs.constants.W_OK);
    return "/data/club-agent.sqlite";
  } catch {
    // Fallback (local dev, or no volume): ephemeral dev db.
    return "./dev.sqlite";
  }
}

function createConnection(): Database.Database {
  // During `next build`, route modules are evaluated in parallel workers
  // (e.g. "Collecting page data using N workers"). If each worker opened the
  // real /data SQLite file — which the running service also has open in WAL
  // mode — the concurrent opens + the runtime lock produce SQLITE_BUSY and the
  // build fails. Next sets NEXT_PHASE === "phase-production-build" during the
  // build, so detect that and give every worker its own isolated in-memory DB:
  // zero file contention, schema init runs harmlessly in-memory, and the
  // force-dynamic routes never serve real data at build time anyway.
  const dbPath =
    process.env.NEXT_PHASE === "phase-production-build"
      ? ":memory:"
      : resolveDbPath();
  // Ensure the parent dir exists so a fresh /data (or any custom path) works —
  // but only for a real file path, never for the in-memory ":memory:" handle.
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const connection = new Database(dbPath);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  // Defensive: if any runtime concurrency does collide, wait up to 5s for the
  // lock to clear rather than erroring out immediately with SQLITE_BUSY.
  connection.pragma("busy_timeout = 5000");
  connection.exec(SCHEMA);
  return connection;
}

// Cache the connection on globalThis so Next.js dev hot-reload reuses a single
// handle instead of opening a new one (and re-running pragmas) on every reload.
const globalForDb = globalThis as unknown as {
  __clubAgentDb?: Database.Database;
};

// Lazily resolve the real connection. The first call opens it (running pragmas
// + schema exactly once) and memoizes it on globalThis; subsequent calls reuse
// the cached handle. Importantly, NOTHING here runs at import time — so when
// `next build` evaluates route modules in parallel workers, merely importing
// `db` never touches the WAL file (eliminating the build-time SQLITE_BUSY race).
function getConnection(): Database.Database {
  if (globalForDb.__clubAgentDb) return globalForDb.__clubAgentDb;
  const connection = createConnection();
  // Cache in every environment: in prod the module is evaluated once per worker
  // and we still want a single handle for the process lifetime; in dev it lets
  // hot-reload reuse the handle across reloads.
  globalForDb.__clubAgentDb = connection;
  return connection;
}

// Export `db` as a Proxy so every existing caller (`db.prepare(...)`,
// `db.exec(...)`, `db.transaction(...)`, etc.) keeps working unchanged. Each
// property access / call is forwarded to the lazily-opened real Database.
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop, receiver) {
    const conn = getConnection();
    const value = Reflect.get(conn, prop, receiver);
    // Bind methods to the real connection so `this` is correct when invoked
    // (better-sqlite3 methods rely on their internal `this`).
    return typeof value === "function" ? value.bind(conn) : value;
  },
  set(_target, prop, value) {
    return Reflect.set(getConnection(), prop, value);
  },
  has(_target, prop) {
    return Reflect.has(getConnection(), prop);
  },
});
