CREATE TABLE challenge_definitions (
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  definition_json TEXT NOT NULL,
  PRIMARY KEY(id, version)
);
CREATE TABLE challenge_participations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  challenge_id TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(user_id, challenge_id),
  UNIQUE(id, user_id),
  FOREIGN KEY(challenge_id, definition_version) REFERENCES challenge_definitions(id, version)
);
ALTER TABLE workout_runs ADD COLUMN challenge_participation_id TEXT REFERENCES challenge_participations(id);
CREATE TABLE challenge_events (
  result_id TEXT PRIMARY KEY REFERENCES progression_events(result_id),
  participation_id TEXT NOT NULL REFERENCES challenge_participations(id),
  eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
  receipt_json TEXT NOT NULL,
  event_at TEXT NOT NULL,
  UNIQUE(participation_id, result_id)
);
CREATE INDEX challenge_participations_owner ON challenge_participations(user_id);
CREATE INDEX challenge_events_participation ON challenge_events(participation_id, eligible);
CREATE TRIGGER challenge_definitions_no_update BEFORE UPDATE ON challenge_definitions BEGIN SELECT RAISE(ABORT,'Immutable challenge version'); END;
CREATE TRIGGER challenge_definitions_no_delete BEFORE DELETE ON challenge_definitions BEGIN SELECT RAISE(ABORT,'Immutable challenge version'); END;
CREATE TRIGGER challenge_participations_snapshot BEFORE UPDATE ON challenge_participations
WHEN NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.challenge_id IS NOT OLD.challenge_id OR NEW.definition_version IS NOT OLD.definition_version OR NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.joined_at IS NOT OLD.joined_at OR OLD.completed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'Immutable participation'); END;
CREATE TRIGGER challenge_participations_no_delete BEFORE DELETE ON challenge_participations BEGIN SELECT RAISE(ABORT,'Immutable participation'); END;
CREATE TRIGGER challenge_events_no_update BEFORE UPDATE ON challenge_events BEGIN SELECT RAISE(ABORT,'Immutable challenge event'); END;
CREATE TRIGGER challenge_events_no_delete BEFORE DELETE ON challenge_events BEGIN SELECT RAISE(ABORT,'Immutable challenge event'); END;
CREATE TRIGGER challenge_run_owner BEFORE INSERT ON workout_runs
WHEN NEW.challenge_participation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM challenge_participations WHERE id=NEW.challenge_participation_id AND user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT,'Challenge owner mismatch'); END;
CREATE TRIGGER challenge_run_context BEFORE UPDATE OF challenge_participation_id ON workout_runs
WHEN NEW.challenge_participation_id IS NOT OLD.challenge_participation_id
BEGIN SELECT RAISE(ABORT,'Immutable challenge context'); END;
