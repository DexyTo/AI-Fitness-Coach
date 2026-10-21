import { exerciseIds } from '../src/exercises/types.js';
import { exerciseRegistry, isHold, isLegacy } from '../src/exercises/registry.js';
import { criterionLabels, endReasonLabels, outcomeLabels, type ExerciseResult, type FeedbackCode } from '../src/exercises/types.js';
import { validExerciseGoal, type WorkoutRecord } from './workout.js';
const SCHEMA_VERSION = 1;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): v is number => number(v) && Number.isInteger(v);
const text = (v: unknown): v is string => typeof v === 'string';
const oneOf = (v: unknown, values: readonly string[]) => text(v) && values.includes(v);
const reasons = ['no_pose', 'missing_points', 'invalid_geometry', 'tracking_gap', 'timeline_reset', 'session_paused', 'movement_pending', 'unsuitable_view', 'view_unknown', 'source_unavailable', 'detector_error'];
const codes = Object.keys(criterionLabels);
function validHoldResult(v: Record<string, unknown>): boolean {
  if(v.kind!=='hold'||!object(v.hold)||!['creditedMs','longestMs','deviationMs','unassessedMs'].every(k=>number((v.hold as Record<string,unknown>)[k]))||!Array.isArray(v.hold.intervals)||v.hold.intervals.length>5000||v.sides!==undefined)return false;
  if(['reps','incomplete','unassessed','withoutFindings','withErrors'].some(k=>v[k]!==0)||(v.attempts as unknown[]).length||Object.keys(v.errors as object).length)return false;
  const sums={credited:0,deviation:0,unassessed:0};let longest=0,continuous=0,previous=-1;
  for(const i of v.hold.intervals) {
    if(!object(i)||!number(i.startedAt)||!number(i.endedAt)||i.endedAt<=i.startedAt||i.startedAt<previous||!oneOf(i.status,['credited','deviation','unassessed'])||!Array.isArray(i.reasons)||!i.reasons.every(reason)||!object(i.criteria))return false;
    if(!Object.entries(i.criteria).every(([c,k])=>codes.includes(c)&&object(k)&&oneOf(k.status,['passed','deviation','unassessed'])&&integer(k.observedFrames)&&Array.isArray(k.reasons)&&k.reasons.every(reason)))return false;
    if(i.status==='credited'&&(i.reasons.length||codes.some(c=>!object((i.criteria as Record<string,unknown>)[c])||((i.criteria as Record<string,Record<string,unknown>>)[c]).status!=='passed')))return false;
    if(i.status==='deviation'&&!Object.values(i.criteria).some(c=>object(c)&&c.status==='deviation'))return false;
    if(i.status==='unassessed'&&!i.reasons.length)return false;
    const dt=i.endedAt-i.startedAt;const status=i.status as keyof typeof sums;sums[status]+=dt;
    continuous=status==='credited'?(i.startedAt===previous?continuous:0)+dt:0;longest=Math.max(longest,continuous);previous=i.endedAt;
  }
  return Math.abs(sums.credited-(v.hold.creditedMs as number))<.01&&Math.abs(sums.deviation-(v.hold.deviationMs as number))<.01&&Math.abs(sums.unassessed-(v.hold.unassessedMs as number))<.01&&Math.abs(longest-(v.hold.longestMs as number))<.01;
}
function reason(v: unknown): boolean {
  return object(v) && oneOf(v.code, reasons) && (v.criterion === undefined || oneOf(v.criterion, codes)) &&
    (v.landmarks === undefined || (Array.isArray(v.landmarks) && v.landmarks.every(n => integer(n) && n <= 32)));
}
function result(v: unknown, exercise: WorkoutRecord['exercise']): v is ExerciseResult {
  if (!object(v) || !['reps', 'incomplete', 'unassessed', 'withoutFindings', 'withErrors'].every(k => integer(v[k])) ||
      !object(v.errors) || !Object.entries(v.errors).every(([k, n]) => codes.includes(k) && integer(n)) || !Array.isArray(v.attempts)) return false;
  if (isHold(exercise)) return validHoldResult(v);
  if (v.hold !== undefined || (!isLegacy(exercise) && v.kind !== 'repetitions') || (v.kind!==undefined&&v.kind!=='repetitions')) return false;
  if (!v.attempts.every((a, index) => object(a) && a.id === index + 1 && number(a.startedAt) && number(a.endedAt) && a.endedAt >= a.startedAt &&
      oneOf(a.outcome, Object.keys(outcomeLabels)) && oneOf(a.endReason, Object.keys(endReasonLabels)) && typeof a.motionComplete === 'boolean' &&
      number(a.minAngle) && a.minAngle <= 180 && Array.isArray(a.remarks) && a.remarks.every(c => oneOf(c, codes)) && new Set(a.remarks).size === a.remarks.length &&
      Array.isArray(a.reasons) && a.reasons.every(reason) && object(a.criteria) && Object.keys(a.criteria).length > 0 &&
      Object.entries(a.criteria).every(([c, check]) => codes.includes(c) && object(check) && oneOf(check.status, ['passed', 'deviation', 'unassessed']) &&
        integer(check.observedFrames) && Array.isArray(check.reasons) && check.reasons.every(reason)))) return false;
  const attempts = v.attempts as ExerciseResult['attempts'];
  if(!isLegacy(exercise)&&!attempts.every(a=>
    (a.measurements===undefined||(object(a.measurements)&&Object.values(a.measurements).every(n=>typeof n==='number'&&Number.isFinite(n)))) &&
    (a.outcome!=='complete'||(!a.reasons.length&&a.criteria.depth?.status==='passed'&&a.criteria.extension?.status==='passed'&&Object.values(a.criteria).every(c=>c.reasons.length===0))) &&
    (a.outcome!=='incomplete'||(!a.motionComplete&&!a.reasons.length&&Object.values(a.criteria).every(c=>c.status!=='unassessed'))) &&
    (a.outcome!=='insufficient_data'||a.reasons.length>0||Object.values(a.criteria).some(c=>c.status==='unassessed'||c.reasons.length>0))))return false;
  const required = (isLegacy(exercise) ? ['depth', 'extension', exercise === 'squat' ? 'lean' : 'line'] : ['depth','extension','lean','line']) as FeedbackCode[];
  if (!attempts.every(a => required.every(c => a.criteria[c]) && Object.keys(a.criteria).length === required.length &&
    a.remarks.every(c => a.criteria[c]?.status === 'deviation') && required.every(c => a.criteria[c]!.status !== 'deviation' || a.remarks.includes(c)) &&
    (a.outcome !== 'complete' || (a.motionComplete && required.every(c => a.criteria[c]!.status !== 'unassessed'))))) return false;
  if (v.reps !== attempts.filter(a => a.outcome === 'complete').length || v.incomplete !== attempts.filter(a => a.outcome === 'incomplete').length ||
      v.unassessed !== attempts.filter(a => a.outcome === 'insufficient_data').length || v.withErrors !== attempts.filter(a => a.remarks.length).length ||
      v.withoutFindings !== attempts.filter(a => a.outcome === 'complete' && !a.remarks.length).length) return false;
  if (['reverse_lunge','side_bend'].includes(exercise)) {
    if (!object(v.sides) || !['left','right'].every(side=>integer((v.sides as Record<string,unknown>)[side]) && (v.sides as Record<string,unknown>)[side] === attempts.filter(a=>a.side===side&&a.outcome==='complete').length) || attempts.some(a=>a.side!=='left'&&a.side!=='right')) return false;
  } else if(v.sides !== undefined) return false;
  const errors = v.errors;
  return codes.every(c => (errors[c] ?? 0) === attempts.filter(a => a.remarks.includes(c as FeedbackCode)).length);
}
export function isWorkoutRecord(v: unknown): v is WorkoutRecord {
  if (!object(v) || ![1,3].includes(v.schemaVersion as number) || !text(v.id) || !v.id || !text(v.date) || !Number.isFinite(Date.parse(v.date)) ||
      !oneOf(v.exercise, exerciseIds) || !oneOf(v.mode, ['camera', 'demo', 'video']) || !number(v.duration) || !text(v.conditions) ||
      !object(v.goal) || !validExerciseGoal(v.exercise as WorkoutRecord['exercise'], v.goal as unknown as WorkoutRecord['goal']) || !object(v.metadata) || !Array.isArray(v.sets) || !v.sets.length || v.sets.length > (v.goal.sets as number)) return false;
  const exercise=v.exercise as WorkoutRecord['exercise'];
  if (v.schemaVersion === 1 && !isLegacy(exercise)) return false;
  const m = v.metadata;
  if (!isLegacy(exercise)) {
    const snap=m.exerciseSnapshot;
    if(v.schemaVersion!==3 || !object(snap) || snap.id!==exercise || !text(snap.version) || !snap.version || m.rulesVersion!==snap.version || snap.unit!==exerciseRegistry[exercise].unit || !object(snap.options) || !object(v.goal.options) || ['variant','side','facing','weightKg'].some(k=>(snap.options as Record<string,unknown>)[k]!==(v.goal as Record<string,Record<string,unknown>>).options[k]) || !object(snap.thresholds) || !Object.keys(snap.thresholds).length || !Object.values(snap.thresholds).every(number))return false;
  }
  if (m.source !== undefined && (!object(m.source) || !integer(m.source.width) || !integer(m.source.height) || !text(m.source.delegate) ||
    !object(m.source.settings) || !Object.values(m.source.settings).every(v => text(v) || number(v)))) return false;
  if (!['rulesVersion', 'analysisVersion', 'coachingVersion', 'detector', 'sampling'].every(k => text(m[k]) && !!m[k]) ||
      !object(m.variant) || !text(m.variant.id) || !number(m.variant.lowerAngle) || !number(m.variant.upperAngle) ||
      (m.variant.trunkLean !== undefined && !number(m.variant.trunkLean)) || (m.variant.bodyLineDeviation !== undefined && !number(m.variant.bodyLineDeviation)) ||
      !object(m.tracking) || !Object.keys(m.tracking).length || !Object.values(m.tracking).every(number)) return false;
  return v.sets.every((s, index) => object(s) && s.number === index + 1 && oneOf(s.ended, ['completed', 'interrupted']) && number(s.durationMs) &&
    object(s.observation) && ['readyMs', 'partialMs', 'unavailableMs', 'sampledMs'].every(k => number(s.observation && (s.observation as Record<string, unknown>)[k])) &&
    typeof s.observation.sideViewConfirmed === 'boolean' &&
    Math.abs((s.observation.readyMs as number) + (s.observation.partialMs as number) + (s.observation.unavailableMs as number) - (s.observation.sampledMs as number)) < 0.01 && result(s.result, exercise) && (!isHold(exercise) || (object(s.result) && object(s.result.hold) && (s.result.hold.creditedMs as number)+(s.result.hold.deviationMs as number)+(s.result.hold.unassessedMs as number)<= (s.durationMs as number)+1)));
}
export function parseHistory(raw: string): WorkoutRecord[] {
  const data: unknown = JSON.parse(raw);
  if (!object(data) || data.schemaVersion !== SCHEMA_VERSION) throw new Error('Версия истории не поддерживается. Исходные данные сохранены; экспортируйте их перед очисткой.');
  if (!Array.isArray(data.records) || !data.records.every(isWorkoutRecord) || new Set(data.records.map(r => r.id)).size !== data.records.length)
    throw new Error('История повреждена. Исходные данные сохранены; экспортируйте их перед очисткой.');
  return data.records;
}
