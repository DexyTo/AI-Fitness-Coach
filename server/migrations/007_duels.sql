CREATE TABLE duels (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  task_json TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ends_at TEXT NOT NULL CHECK(ends_at > created_at),
  accepted_at TEXT,
  finalized_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('invited','accepted','waiting','completed','cancelled','expired')),
  UNIQUE(creator_id,request_id)
);
CREATE TABLE duel_participants (
  id TEXT PRIMARY KEY,
  duel_id TEXT NOT NULL REFERENCES duels(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  slot INTEGER NOT NULL CHECK(slot IN (1,2)),
  joined_at TEXT NOT NULL,
  UNIQUE(duel_id,user_id), UNIQUE(duel_id,slot), UNIQUE(id,user_id)
);
ALTER TABLE workout_runs ADD COLUMN duel_participant_id TEXT REFERENCES duel_participants(id);
CREATE UNIQUE INDEX duel_one_run ON workout_runs(duel_participant_id) WHERE duel_participant_id IS NOT NULL;
CREATE TABLE duel_drafts (
  participant_id TEXT PRIMARY KEY REFERENCES duel_participants(id),
  revision INTEGER NOT NULL CHECK(revision > 0),
  record_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE duel_submissions (
  participant_id TEXT PRIMARY KEY REFERENCES duel_participants(id),
  result_id TEXT NOT NULL UNIQUE REFERENCES progression_events(result_id),
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 10000),
  submitted_at TEXT NOT NULL
);
CREATE TABLE duel_events (
  duel_id TEXT NOT NULL REFERENCES duels(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  result_id TEXT REFERENCES progression_events(result_id),
  event_at TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  PRIMARY KEY(duel_id,user_id),
  FOREIGN KEY(duel_id,user_id) REFERENCES duel_participants(duel_id,user_id)
);
CREATE INDEX duel_participants_owner ON duel_participants(user_id,duel_id);
CREATE INDEX duel_events_time ON duel_events(event_at,user_id);
CREATE TRIGGER duel_snapshot BEFORE UPDATE ON duels
WHEN NEW.id IS NOT OLD.id OR NEW.creator_id IS NOT OLD.creator_id OR NEW.request_id IS NOT OLD.request_id OR NEW.request_json IS NOT OLD.request_json OR NEW.code IS NOT OLD.code OR NEW.task_json IS NOT OLD.task_json OR NEW.rules_json IS NOT OLD.rules_json OR NEW.created_at IS NOT OLD.created_at OR NEW.ends_at IS NOT OLD.ends_at OR OLD.state IN ('completed','cancelled','expired')
BEGIN SELECT RAISE(ABORT,'Immutable duel'); END;
CREATE TRIGGER duel_no_delete BEFORE DELETE ON duels BEGIN SELECT RAISE(ABORT,'Immutable duel'); END;
CREATE TRIGGER duel_participant_no_update BEFORE UPDATE ON duel_participants BEGIN SELECT RAISE(ABORT,'Immutable duel participant'); END;
CREATE TRIGGER duel_participant_no_delete BEFORE DELETE ON duel_participants BEGIN SELECT RAISE(ABORT,'Immutable duel participant'); END;
CREATE TRIGGER duel_participant_slot BEFORE INSERT ON duel_participants
WHEN NOT EXISTS(SELECT 1 FROM duels WHERE id=NEW.duel_id AND state='invited' AND ((NEW.slot=1 AND creator_id=NEW.user_id) OR (NEW.slot=2 AND creator_id<>NEW.user_id)))
BEGIN SELECT RAISE(ABORT,'Invalid duel participant'); END;
CREATE TRIGGER duel_state_transition BEFORE UPDATE ON duels
WHEN NOT ((OLD.state='invited' AND NEW.state IN ('accepted','cancelled','expired')) OR (OLD.state='accepted' AND NEW.state IN ('waiting','expired')) OR (OLD.state='waiting' AND NEW.state IN ('waiting','completed','expired')))
  OR (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS NOT OLD.accepted_at)
  OR (NEW.state IN ('accepted','waiting','completed') AND (NEW.accepted_at IS NULL OR (SELECT COUNT(*) FROM duel_participants WHERE duel_id=NEW.id)<>2))
BEGIN SELECT RAISE(ABORT,'Invalid duel transition'); END;
CREATE TRIGGER duel_submission_no_update BEFORE UPDATE ON duel_submissions BEGIN SELECT RAISE(ABORT,'Immutable duel submission'); END;
CREATE TRIGGER duel_submission_no_delete BEFORE DELETE ON duel_submissions BEGIN SELECT RAISE(ABORT,'Immutable duel submission'); END;
CREATE TRIGGER duel_event_no_update BEFORE UPDATE ON duel_events BEGIN SELECT RAISE(ABORT,'Immutable duel event'); END;
CREATE TRIGGER duel_event_no_delete BEFORE DELETE ON duel_events BEGIN SELECT RAISE(ABORT,'Immutable duel event'); END;
CREATE TRIGGER duel_run_owner BEFORE INSERT ON workout_runs
WHEN NEW.duel_participant_id IS NOT NULL AND (NEW.challenge_participation_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM duel_participants WHERE id=NEW.duel_participant_id AND user_id=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'Duel owner mismatch'); END;
CREATE TRIGGER duel_run_context BEFORE UPDATE OF duel_participant_id ON workout_runs
WHEN NEW.duel_participant_id IS NOT OLD.duel_participant_id
BEGIN SELECT RAISE(ABORT,'Immutable duel context'); END;
CREATE TRIGGER duel_draft_submitted BEFORE UPDATE ON duel_drafts
WHEN NEW.participant_id IS NOT OLD.participant_id OR EXISTS(SELECT 1 FROM duel_submissions WHERE participant_id=OLD.participant_id)
BEGIN SELECT RAISE(ABORT,'Immutable submitted draft'); END;
