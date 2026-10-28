-- PostgreSQL / Neon. Independent migration ledger; SQLite sources remain unchanged.
DROP FUNCTION playfit_program_snapshot(TEXT);
-- Rebuild the leaf table without disabling foreign keys or modifying old migrations.
CREATE TABLE program_steps_v3 (
  program_id TEXT NOT NULL REFERENCES programs(id),
  position INTEGER NOT NULL CHECK(position >= 0),
  id TEXT NOT NULL,
  exercise TEXT NOT NULL CHECK(exercise IN ('squat','pushup','reverse_lunge','forearm_plank','glute_bridge','wall_sit','overhead_press','front_hold','side_bend','lateral_raise')),
  sets INTEGER NOT NULL CHECK(sets BETWEEN 1 AND 100),
  reps INTEGER,
  rest_seconds INTEGER NOT NULL CHECK(rest_seconds BETWEEN 0 AND 3600),
  transition_seconds INTEGER NOT NULL CHECK(transition_seconds BETWEEN 0 AND 3600),
  goal_json TEXT,
  CHECK ((exercise IN ('forearm_plank','wall_sit','front_hold') AND reps IS NULL AND goal_json IS NOT NULL AND COALESCE(jsonb_typeof(goal_json::jsonb->'seconds')='number' AND (goal_json::jsonb->>'seconds') ~ '^[0-9]+$',false) AND json_extract(goal_json,'$.unit') IS NOT DISTINCT FROM 'seconds' AND CAST(json_extract(goal_json,'$.seconds') AS INTEGER) BETWEEN 1 AND 3600)
    OR (exercise NOT IN ('forearm_plank','wall_sit','front_hold') AND reps IS NOT NULL AND reps BETWEEN 1 AND 1000 AND (goal_json IS NULL OR COALESCE(json_extract(goal_json,'$.unit'),'reps')='reps'))),
  PRIMARY KEY(program_id,position), UNIQUE(program_id,id)
);
INSERT INTO program_steps_v3 (program_id,position,id,exercise,sets,reps,rest_seconds,transition_seconds)
SELECT program_id,position,id,exercise,sets,reps,rest_seconds,transition_seconds FROM program_steps;
DROP TABLE program_steps;
ALTER TABLE program_steps_v3 RENAME TO program_steps;
-- Full rules/parameters captured at begin; legacy runs stay NULL and are never backfilled.
ALTER TABLE workout_runs ADD COLUMN analysis_snapshot_json TEXT;

CREATE FUNCTION playfit_program_snapshot(program_id TEXT) RETURNS TEXT LANGUAGE SQL STABLE AS $$
 SELECT jsonb_build_object('schemaVersion',1,'id',p.id,'version',p.version,'origin',p.origin,'ownerId',p.owner_id,
 'title',p.title,'description',p.description,'steps',COALESCE((SELECT jsonb_agg(jsonb_build_object(
 'id',s.id,'exercise',s.exercise,'goal',COALESCE(to_jsonb(s)->>'goal_json','null')::jsonb,
 'transitionSeconds',s.transition_seconds) ORDER BY s.position) FROM program_steps s WHERE s.program_id=p.id),'[]'::jsonb))::text
 FROM programs p WHERE p.id=program_id
$$;
