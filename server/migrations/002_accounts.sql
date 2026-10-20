CREATE TABLE users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT 'sprout' CHECK (avatar IN ('sprout','bolt','sun','mountain')),
  created_at TEXT NOT NULL
);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE workout_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, request_id),
  UNIQUE(id, user_id)
);
CREATE TABLE workout_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  run_id TEXT UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('training','historical_import')),
  source_version INTEGER NOT NULL,
  original_id TEXT,
  record_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY(run_id, user_id) REFERENCES workout_runs(id, user_id),
  UNIQUE(user_id, source, original_id),
  CHECK ((source = 'training' AND run_id IS NOT NULL AND original_id IS NULL)
    OR (source = 'historical_import' AND run_id IS NULL AND original_id IS NOT NULL))
);
CREATE INDEX workout_results_owner ON workout_results(user_id, created_at);
