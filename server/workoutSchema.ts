import { exerciseIds } from '../src/exercises/types.js';
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
const criteria = obj({ depth: criterion, extension: criterion, lean: criterion, line: criterion }, ['depth','extension']);
const options = obj({variant:enumeration(['standard','standing','seated']),side:enumeration(['left','right']),facing:enumeration(['left','right']),weightKg:{type:'number',exclusiveMinimum:0,maximum:200}},['variant','side','facing']);
const measurements={type:'object',maxProperties:30,additionalProperties:{type:'number',minimum:-1e6,maximum:1e6}};
const attempt = obj({ id: count, startedAt: time, endedAt: time, outcome: enumeration(['complete','incomplete','insufficient_data']), endReason: enumeration(['returned_to_top','reversed_before_top','tracking_gap','timeline_reset','session_paused','session_finished']), motionComplete: { type: 'boolean' }, minAngle: { type: 'number', minimum: 0, maximum: 180 }, criteria, remarks: { ...array(code, 4), uniqueItems: true }, reasons: array(reason, 100), side:enumeration(['left','right']),measurements }, ['id','startedAt','endedAt','outcome','endReason','motionComplete','minAngle','criteria','remarks','reasons']);
const baseGoal={schemaVersion:{const:2},sets:{type:'integer',minimum:1,maximum:100},restSeconds:{type:'integer',minimum:0,maximum:3600},options};
export const goalSchema={$ref:'playfit-goal#'};
export const goalSchemaDefinition={$id:'playfit-goal',anyOf:[obj({...baseGoal,unit:{const:'reps'},reps:{type:'integer',minimum:1,maximum:1000}},['sets','reps','restSeconds']),obj({...baseGoal,schemaVersion:{const:2},unit:{const:'seconds'},seconds:{type:'integer',minimum:1,maximum:3600}},['schemaVersion','sets','unit','seconds','restSeconds','options'])]};
const holdInterval=obj({startedAt:time,endedAt:time,status:enumeration(['credited','deviation','unassessed']),criteria:obj({depth:criterion,extension:criterion,lean:criterion,line:criterion},[]),reasons:array(reason,100)});
const hold=obj({creditedMs:durationMs,longestMs:durationMs,deviationMs:durationMs,unassessedMs:durationMs,intervals:array(holdInterval)});
export const snapshotSchema = obj({ exercise: enumeration([...exerciseIds]), mode: enumeration(['camera','video','demo']), goal: goalSchema, conditions: { type: 'string', maxLength: 200 } });
export const workoutSchema={$ref:'playfit-workout#'};
export const workoutSchemaDefinition = {$id:'playfit-workout',...obj({ schemaVersion: { enum: [1,3] }, id: { type: 'string', minLength: 1, maxLength: 128 }, date: { type: 'string', minLength: 1, maxLength: 40 }, exercise: enumeration([...exerciseIds]), mode: enumeration(['camera','video','demo']), goal: goalSchema, conditions: { type: 'string', maxLength: 200 }, duration: { type: 'number', minimum: 0, maximum: 604800 },
  metadata: obj({ rulesVersion: text, analysisVersion: text, coachingVersion: text, detector: text, sampling: text,
    variant: obj({ id: text, lowerAngle: time, upperAngle: time, trunkLean: time, bodyLineDeviation: time }, ['id','lowerAngle','upperAngle']),
    tracking: { type: 'object', minProperties: 1, maxProperties: 100, additionalProperties: time },
    exerciseSnapshot:obj({id:enumeration([...exerciseIds]),version:text,unit:enumeration(['reps','seconds']),options,thresholds:{type:'object',minProperties:1,maxProperties:100,additionalProperties:time}}),
    source: obj({ width: count, height: count, delegate: text, settings: { type: 'object', maxProperties: 30, additionalProperties: { anyOf: [text, time] } } })
  }, ['rulesVersion','analysisVersion','coachingVersion','detector','sampling','variant','tracking']),
  sets: { ...array(obj({ number: count, ended: enumeration(['completed','interrupted']), durationMs, observation: obj({ readyMs: durationMs, partialMs: durationMs, unavailableMs: durationMs, sampledMs: durationMs, sideViewConfirmed: { type: 'boolean' } }),
    result: obj({ reps: count, incomplete: count, unassessed: count, withoutFindings: count, withErrors: count, errors: obj({ depth: count, extension: count, lean: count, line: count }, []), attempts: array(attempt),kind:enumeration(['repetitions','hold']),hold,sides:obj({left:count,right:count}) }, ['reps','incomplete','unassessed','withoutFindings','withErrors','errors','attempts']) }), 100), minItems: 1 }
})};
export const importSchema = obj({ schemaVersion: { const: 1 }, source: { const: 'playfit.workouts.v1' }, records: { ...array(workoutSchema, 20), minItems: 1 } });
