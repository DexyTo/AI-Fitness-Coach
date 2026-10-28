-- PostgreSQL / Neon. Independent migration ledger; SQLite sources remain unchanged.
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
CREATE FUNCTION guard_duel_snapshot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id IS DISTINCT FROM OLD.id OR NEW.creator_id IS DISTINCT FROM OLD.creator_id OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.request_json IS DISTINCT FROM OLD.request_json OR NEW.code IS DISTINCT FROM OLD.code OR NEW.task_json IS DISTINCT FROM OLD.task_json OR NEW.rules_json IS DISTINCT FROM OLD.rules_json OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at OR OLD.state IN ('completed','cancelled','expired')) THEN RAISE EXCEPTION 'Immutable duel'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER duel_snapshot BEFORE UPDATE ON duels FOR EACH ROW EXECUTE FUNCTION guard_duel_snapshot();
CREATE FUNCTION guard_duel_no_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable duel';
END;
$$;
CREATE TRIGGER duel_no_delete BEFORE DELETE ON duels FOR EACH ROW EXECUTE FUNCTION guard_duel_no_delete();
CREATE FUNCTION guard_duel_participant_no_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable duel participant';
END;
$$;
CREATE TRIGGER duel_participant_no_update BEFORE UPDATE ON duel_participants FOR EACH ROW EXECUTE FUNCTION guard_duel_participant_no_update();
CREATE FUNCTION guard_duel_participant_no_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable duel participant';
END;
$$;
CREATE TRIGGER duel_participant_no_delete BEFORE DELETE ON duel_participants FOR EACH ROW EXECUTE FUNCTION guard_duel_participant_no_delete();
CREATE FUNCTION guard_duel_participant_slot() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NOT EXISTS(SELECT 1 FROM duels WHERE id=NEW.duel_id AND state='invited' AND ((NEW.slot=1 AND creator_id=NEW.user_id) OR (NEW.slot=2 AND creator_id<>NEW.user_id)))) THEN RAISE EXCEPTION 'Invalid duel participant'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER duel_participant_slot BEFORE INSERT ON duel_participants FOR EACH ROW EXECUTE FUNCTION guard_duel_participant_slot();
CREATE FUNCTION guard_duel_state_transition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NOT ((OLD.state='invited' AND NEW.state IN ('accepted','cancelled','expired')) OR (OLD.state='accepted' AND NEW.state IN ('waiting','expired')) OR (OLD.state='waiting' AND NEW.state IN ('waiting','completed','expired')))
  OR (OLD.accepted_at IS DISTINCT FROM NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at)
  OR (NEW.state IN ('accepted','waiting','completed') AND (NEW.accepted_at IS NULL OR (SELECT COUNT(*) FROM duel_participants WHERE duel_id=NEW.id)<>2))) THEN RAISE EXCEPTION 'Invalid duel transition'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER duel_state_transition BEFORE UPDATE ON duels FOR EACH ROW EXECUTE FUNCTION guard_duel_state_transition();
CREATE FUNCTION guard_duel_submission_no_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable duel submission';
END;
$$;
CREATE TRIGGER duel_submission_no_update BEFORE UPDATE ON duel_submissions FOR EACH ROW EXECUTE FUNCTION guard_duel_submission_no_update();
CREATE FUNCTION guard_duel_submission_no_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable duel submission';
END;
$$;
CREATE TRIGGER duel_submission_no_delete BEFORE DELETE ON duel_submissions FOR EACH ROW EXECUTE FUNCTION guard_duel_submission_no_delete();
CREATE FUNCTION guard_duel_event_no_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable duel event';
END;
$$;
CREATE TRIGGER duel_event_no_update BEFORE UPDATE ON duel_events FOR EACH ROW EXECUTE FUNCTION guard_duel_event_no_update();
CREATE FUNCTION guard_duel_event_no_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable duel event';
END;
$$;
CREATE TRIGGER duel_event_no_delete BEFORE DELETE ON duel_events FOR EACH ROW EXECUTE FUNCTION guard_duel_event_no_delete();
CREATE FUNCTION guard_duel_run_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.duel_participant_id IS DISTINCT FROM NULL AND (NEW.challenge_participation_id IS DISTINCT FROM NULL OR NOT EXISTS(SELECT 1 FROM duel_participants WHERE id=NEW.duel_participant_id AND user_id=NEW.user_id))) THEN RAISE EXCEPTION 'Duel owner mismatch'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER duel_run_owner BEFORE INSERT ON workout_runs FOR EACH ROW EXECUTE FUNCTION guard_duel_run_owner();
CREATE FUNCTION guard_duel_run_context() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.duel_participant_id IS DISTINCT FROM OLD.duel_participant_id) THEN RAISE EXCEPTION 'Immutable duel context'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER duel_run_context BEFORE UPDATE OF duel_participant_id ON workout_runs FOR EACH ROW EXECUTE FUNCTION guard_duel_run_context();
CREATE FUNCTION guard_duel_draft_submitted() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.participant_id IS DISTINCT FROM OLD.participant_id OR EXISTS(SELECT 1 FROM duel_submissions WHERE participant_id=OLD.participant_id)) THEN RAISE EXCEPTION 'Immutable submitted draft'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER duel_draft_submitted BEFORE UPDATE ON duel_drafts FOR EACH ROW EXECUTE FUNCTION guard_duel_draft_submitted();
