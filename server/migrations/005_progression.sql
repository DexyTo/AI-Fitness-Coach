-- NULL deliberately preserves the provenance of every pre-progression run.
ALTER TABLE workout_runs ADD COLUMN reward_rules_version TEXT;
CREATE TABLE progression_events (
  result_id TEXT PRIMARY KEY REFERENCES workout_results(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('awarded','daily_limit','demo','video','incomplete','legacy')),
  eligible INTEGER NOT NULL CHECK (eligible IN (0,1)),
  reps INTEGER NOT NULL CHECK (reps >= 0),
  exercises_json TEXT NOT NULL,
  event_at TEXT NOT NULL,
  project_day TEXT NOT NULL,
  rules_version TEXT NOT NULL
);
CREATE INDEX progression_events_owner ON progression_events(user_id, project_day);
CREATE TABLE reward_ledger (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  currency TEXT NOT NULL CHECK (currency IN ('xp','competition_points')),
  source_type TEXT NOT NULL CHECK (source_type IN ('workout','challenge','duel')),
  source_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  event_at TEXT NOT NULL,
  project_day TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  UNIQUE(user_id, currency, source_type, source_id)
);
CREATE INDEX reward_ledger_day ON reward_ledger(user_id, currency, project_day);
CREATE TABLE user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id),
  achievement_id TEXT NOT NULL,
  result_id TEXT NOT NULL REFERENCES progression_events(result_id),
  earned_at TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  PRIMARY KEY(user_id, achievement_id)
);
CREATE TRIGGER reward_ledger_no_update BEFORE UPDATE ON reward_ledger BEGIN SELECT RAISE(ABORT,'Immutable reward'); END;
CREATE TRIGGER reward_ledger_no_delete BEFORE DELETE ON reward_ledger BEGIN SELECT RAISE(ABORT,'Immutable reward'); END;
CREATE TRIGGER progression_events_no_update BEFORE UPDATE ON progression_events BEGIN SELECT RAISE(ABORT,'Immutable event'); END;
CREATE TRIGGER progression_events_no_delete BEFORE DELETE ON progression_events BEGIN SELECT RAISE(ABORT,'Immutable event'); END;
CREATE TRIGGER user_achievements_no_update BEFORE UPDATE ON user_achievements BEGIN SELECT RAISE(ABORT,'Immutable achievement'); END;
CREATE TRIGGER user_achievements_no_delete BEFORE DELETE ON user_achievements BEGIN SELECT RAISE(ABORT,'Immutable achievement'); END;
