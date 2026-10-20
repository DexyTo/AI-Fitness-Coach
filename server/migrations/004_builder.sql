ALTER TABLE programs ADD COLUMN archived_at TEXT;
CREATE INDEX programs_owner_active ON programs(owner_id, archived_at);
CREATE TABLE program_versions (
  program_id TEXT NOT NULL REFERENCES programs(id),
  version INTEGER NOT NULL CHECK(version >= 1),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(program_id, version)
);
INSERT INTO program_versions
SELECT p.id, p.version, json_object(
  'schemaVersion',1,'id',p.id,'version',p.version,'origin',p.origin,'ownerId',p.owner_id,
  'title',p.title,'description',p.description,'steps',json((
    SELECT json_group_array(json(step)) FROM (
      SELECT json_object('id',s.id,'exercise',s.exercise,'goal',json_object(
        'sets',s.sets,'reps',s.reps,'restSeconds',s.rest_seconds),
        'transitionSeconds',s.transition_seconds) AS step
      FROM program_steps s WHERE s.program_id=p.id ORDER BY s.position
    )
  ))), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM programs p;
CREATE TRIGGER program_versions_no_update BEFORE UPDATE ON program_versions
BEGIN SELECT RAISE(ABORT, 'Immutable program version'); END;
CREATE TRIGGER program_versions_no_delete BEFORE DELETE ON program_versions
BEGIN SELECT RAISE(ABORT, 'Immutable program version'); END;
CREATE TABLE program_favorites (
  user_id TEXT NOT NULL REFERENCES users(id),
  program_id TEXT NOT NULL REFERENCES programs(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, program_id)
);
