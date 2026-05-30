import Database from "better-sqlite3";

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

function createConnection(): Database.Database {
  const path = process.env.DATABASE_PATH ?? "./dev.sqlite";
  const connection = new Database(path);
  connection.pragma("journal_mode = WAL");
  connection.pragma("foreign_keys = ON");
  connection.exec(SCHEMA);
  return connection;
}

// Cache the connection on globalThis so Next.js dev hot-reload reuses a single
// handle instead of opening a new one (and re-running pragmas) on every reload.
const globalForDb = globalThis as unknown as {
  __clubAgentDb?: Database.Database;
};

export const db: Database.Database =
  globalForDb.__clubAgentDb ?? createConnection();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__clubAgentDb = db;
}
