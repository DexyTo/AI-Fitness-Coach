-- PostgreSQL / Neon. Independent migration ledger; SQLite sources remain unchanged.
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
CREATE FUNCTION guard_challenge_definitions_no_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable challenge version';
END;
$$;
CREATE TRIGGER challenge_definitions_no_update BEFORE UPDATE ON challenge_definitions FOR EACH ROW EXECUTE FUNCTION guard_challenge_definitions_no_update();
CREATE FUNCTION guard_challenge_definitions_no_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable challenge version';
END;
$$;
CREATE TRIGGER challenge_definitions_no_delete BEFORE DELETE ON challenge_definitions FOR EACH ROW EXECUTE FUNCTION guard_challenge_definitions_no_delete();
CREATE FUNCTION guard_challenge_participations_snapshot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id OR NEW.definition_version IS DISTINCT FROM OLD.definition_version OR NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json OR NEW.joined_at IS DISTINCT FROM OLD.joined_at OR OLD.completed_at IS DISTINCT FROM NULL) THEN RAISE EXCEPTION 'Immutable participation'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER challenge_participations_snapshot BEFORE UPDATE ON challenge_participations FOR EACH ROW EXECUTE FUNCTION guard_challenge_participations_snapshot();
CREATE FUNCTION guard_challenge_participations_no_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable participation';
END;
$$;
CREATE TRIGGER challenge_participations_no_delete BEFORE DELETE ON challenge_participations FOR EACH ROW EXECUTE FUNCTION guard_challenge_participations_no_delete();
CREATE FUNCTION guard_challenge_events_no_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable challenge event';
END;
$$;
CREATE TRIGGER challenge_events_no_update BEFORE UPDATE ON challenge_events FOR EACH ROW EXECUTE FUNCTION guard_challenge_events_no_update();
CREATE FUNCTION guard_challenge_events_no_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable challenge event';
END;
$$;
CREATE TRIGGER challenge_events_no_delete BEFORE DELETE ON challenge_events FOR EACH ROW EXECUTE FUNCTION guard_challenge_events_no_delete();
CREATE FUNCTION guard_challenge_run_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.challenge_participation_id IS DISTINCT FROM NULL AND NOT EXISTS(SELECT 1 FROM challenge_participations WHERE id=NEW.challenge_participation_id AND user_id=NEW.user_id)) THEN RAISE EXCEPTION 'Challenge owner mismatch'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER challenge_run_owner BEFORE INSERT ON workout_runs FOR EACH ROW EXECUTE FUNCTION guard_challenge_run_owner();
CREATE FUNCTION guard_challenge_run_context() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.challenge_participation_id IS DISTINCT FROM OLD.challenge_participation_id) THEN RAISE EXCEPTION 'Immutable challenge context'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER challenge_run_context BEFORE UPDATE OF challenge_participation_id ON workout_runs FOR EACH ROW EXECUTE FUNCTION guard_challenge_run_context();
