-- PostgreSQL / Neon. Independent migration ledger; SQLite sources remain unchanged.
ALTER TABLE programs ADD COLUMN archived_at TEXT;
CREATE INDEX programs_owner_active ON programs(owner_id, archived_at);
CREATE TABLE program_versions (
  program_id TEXT NOT NULL REFERENCES programs(id),
  version INTEGER NOT NULL CHECK(version >= 1),
  snapshot_json TEXT NOT NULL CHECK(jsonb_typeof(snapshot_json::jsonb)='object'),
  created_at TEXT NOT NULL,
  PRIMARY KEY(program_id, version)
);
CREATE FUNCTION playfit_program_snapshot(program_id TEXT) RETURNS TEXT LANGUAGE SQL STABLE AS $$
 SELECT jsonb_build_object('schemaVersion',1,'id',p.id,'version',p.version,'origin',p.origin,'ownerId',p.owner_id,
 'title',p.title,'description',p.description,'steps',COALESCE((SELECT jsonb_agg(jsonb_build_object(
 'id',s.id,'exercise',s.exercise,'goal',jsonb_build_object('sets',s.sets,'reps',s.reps,'restSeconds',s.rest_seconds),
 'transitionSeconds',s.transition_seconds) ORDER BY s.position) FROM program_steps s WHERE s.program_id=p.id),'[]'::jsonb))::text
 FROM programs p WHERE p.id=program_id
$$;
INSERT INTO program_versions SELECT p.id,p.version,playfit_program_snapshot(p.id),to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM programs p;
CREATE FUNCTION guard_program_versions_no_update() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable program version';
END;
$$;
CREATE TRIGGER program_versions_no_update BEFORE UPDATE ON program_versions FOR EACH ROW EXECUTE FUNCTION guard_program_versions_no_update();
CREATE FUNCTION guard_program_versions_no_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable program version';
END;
$$;
CREATE TRIGGER program_versions_no_delete BEFORE DELETE ON program_versions FOR EACH ROW EXECUTE FUNCTION guard_program_versions_no_delete();
CREATE TABLE program_favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  program_id TEXT NOT NULL REFERENCES programs(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, program_id)
);
