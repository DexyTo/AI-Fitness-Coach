-- Separate immutable membership preserves existing users and INSERT contracts.
CREATE TABLE demo_users (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  dataset TEXT NOT NULL
);
CREATE TRIGGER demo_users_no_update BEFORE UPDATE ON demo_users BEGIN SELECT RAISE(ABORT,'Immutable demo membership'); END;
CREATE TRIGGER demo_users_no_delete BEFORE DELETE ON demo_users BEGIN SELECT RAISE(ABORT,'Immutable demo membership'); END;
CREATE TABLE demo_seed_batches (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE INDEX reward_ledger_ranking ON reward_ledger(currency,event_at,user_id);
