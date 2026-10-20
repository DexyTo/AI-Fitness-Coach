// Only structured summaries are accepted: no video or landmark streams.
const text = { type: 'string', maxLength: 300 };
const count = { type: 'integer', minimum: 0, maximum: 1_000_000 };
const time = { type: 'number', minimum: 0, maximum: 1e12 };
const durationMs = { type: 'number', minimum: 0, maximum: 604_800_000 };
const enumeration = (values: string[]) => ({ type: 'string', enum: values });
export const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const array = (items: unknown, maxItems = 5000) => ({ type: 'array', items, maxItems });
const code = enumeration(['depth','extension','lean','line']);
const reason = obj({ code: enumeration(['no_pose','missing_points','invalid_geometry','tracking_gap','timeline_reset','session_paused','movement_pending','unsuitable_view','view_unknown','source_unavailable','detector_error']), criterion: code, landmarks: array({ type: 'integer', minimum: 0, maximum: 32 }, 33) }, ['code']);
const criterion = obj({ status: enumeration(['passed','deviation','unassessed']), observedFrames: count, reasons: array(reason, 100) });
const attempt = obj({ id: count, startedAt: time, endedAt: time, outcome: enumeration(['complete','incomplete','insufficient_data']), endReason: enumeration(['returned_to_top','reversed_before_top','tracking_gap','timeline_reset','session_paused','session_finished']), motionComplete: { type: 'boolean' }, minAngle: { type: 'number', minimum: 0, maximum: 180 }, criteria: obj({ depth: criterion, extension: criterion, lean: criterion, line: criterion }, ['depth','extension']), remarks: { ...array(code, 4), uniqueItems: true }, reasons: array(reason, 100) });
export const goalSchema = obj({ sets: { type: 'integer', minimum: 1, maximum: 100 }, reps: { type: 'integer', minimum: 1, maximum: 1000 }, restSeconds: { type: 'integer', minimum: 0, maximum: 3600 } });
export const snapshotSchema = obj({ exercise: enumeration(['squat','pushup']), mode: enumeration(['camera','video','demo']), goal: goalSchema, conditions: { type: 'string', maxLength: 200 } });
export const workoutSchema = obj({ schemaVersion: { const: 1 }, id: { type: 'string', minLength: 1, maxLength: 128 }, date: { type: 'string', minLength: 1, maxLength: 40 }, exercise: enumeration(['squat','pushup']), mode: enumeration(['camera','video','demo']), goal: goalSchema, conditions: { type: 'string', maxLength: 200 }, duration: { type: 'number', minimum: 0, maximum: 604800 },
  metadata: obj({ rulesVersion: text, analysisVersion: text, coachingVersion: text, detector: text, sampling: text,
    variant: obj({ id: text, lowerAngle: time, upperAngle: time, trunkLean: time, bodyLineDeviation: time }, ['id','lowerAngle','upperAngle']),
    tracking: { type: 'object', minProperties: 1, maxProperties: 100, additionalProperties: time },
    source: obj({ width: count, height: count, delegate: text, settings: { type: 'object', maxProperties: 30, additionalProperties: { anyOf: [text, time] } } })
  }, ['rulesVersion','analysisVersion','coachingVersion','detector','sampling','variant','tracking']),
  sets: { ...array(obj({ number: count, ended: enumeration(['completed','interrupted']), durationMs, observation: obj({ readyMs: durationMs, partialMs: durationMs, unavailableMs: durationMs, sampledMs: durationMs, sideViewConfirmed: { type: 'boolean' } }),
    result: obj({ reps: count, incomplete: count, unassessed: count, withoutFindings: count, withErrors: count, errors: obj({ depth: count, extension: count, lean: count, line: count }, []), attempts: array(attempt) }) }), 100), minItems: 1 }
});
export const importSchema = obj({ schemaVersion: { const: 1 }, source: { const: 'playfit.workouts.v1' }, records: { ...array(workoutSchema, 20), minItems: 1 } });
