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
