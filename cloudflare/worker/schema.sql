-- pi-setup D1 schema
-- Run: wrangler d1 execute pi-setup-db --file=cloudflare/worker/schema.sql

CREATE TABLE IF NOT EXISTS machines (
  machine_id    TEXT PRIMARY KEY,
  hostname      TEXT NOT NULL,
  platform      TEXT,
  arch          TEXT,
  os_release    TEXT,
  enrolled_from TEXT,
  enrolled_at   TEXT,
  last_seen_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id   TEXT PRIMARY KEY,
  machine_id   TEXT NOT NULL,
  cwd          TEXT,
  model        TEXT,
  provider     TEXT,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  message_count INTEGER DEFAULT 0,
  FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
);

CREATE TABLE IF NOT EXISTS usage_metrics (
  id            TEXT PRIMARY KEY,
  machine_id    TEXT NOT NULL,
  session_id    TEXT,
  model         TEXT,
  provider      TEXT,
  input_tokens  INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd      REAL DEFAULT 0.0,
  recorded_at   TEXT NOT NULL,
  FOREIGN KEY (machine_id) REFERENCES machines(machine_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_machine  ON sessions(machine_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status   ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_usage_machine     ON usage_metrics(machine_id);
CREATE INDEX IF NOT EXISTS idx_usage_session     ON usage_metrics(session_id);
