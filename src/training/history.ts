import { criterionLabels, endReasonLabels, outcomeLabels, type ExerciseResult, type FeedbackCode } from '../exercises/types';
import { combineResults, SCHEMA_VERSION, validGoal, type WorkoutRecord } from './session';

export const HISTORY_KEY = 'playfit.workouts.v1';
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface HistoryState { records: WorkoutRecord[]; error: string | null; raw: string | null }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): v is number => number(v) && Number.isInteger(v);
const text = (v: unknown): v is string => typeof v === 'string';
const oneOf = (v: unknown, values: readonly string[]) => text(v) && values.includes(v);
const reasons = ['no_pose', 'missing_points', 'invalid_geometry', 'tracking_gap', 'timeline_reset', 'session_paused', 'movement_pending', 'unsuitable_view', 'view_unknown', 'source_unavailable', 'detector_error'];
const codes = Object.keys(criterionLabels);
function reason(v: unknown): boolean {
  return object(v) && oneOf(v.code, reasons) && (v.criterion === undefined || oneOf(v.criterion, codes)) &&
    (v.landmarks === undefined || (Array.isArray(v.landmarks) && v.landmarks.every(n => integer(n) && n <= 32)));
}
function result(v: unknown, exercise: unknown): v is ExerciseResult {
  if (!object(v) || !['reps', 'incomplete', 'unassessed', 'withoutFindings', 'withErrors'].every(k => integer(v[k])) ||
      !object(v.errors) || !Object.entries(v.errors).every(([k, n]) => codes.includes(k) && integer(n)) || !Array.isArray(v.attempts)) return false;
  if (!v.attempts.every((a, index) => object(a) && a.id === index + 1 && number(a.startedAt) && number(a.endedAt) && a.endedAt >= a.startedAt &&
      oneOf(a.outcome, Object.keys(outcomeLabels)) && oneOf(a.endReason, Object.keys(endReasonLabels)) && typeof a.motionComplete === 'boolean' &&
      number(a.minAngle) && a.minAngle <= 180 && Array.isArray(a.remarks) && a.remarks.every(c => oneOf(c, codes)) && new Set(a.remarks).size === a.remarks.length &&
      Array.isArray(a.reasons) && a.reasons.every(reason) && object(a.criteria) && Object.keys(a.criteria).length > 0 &&
      Object.entries(a.criteria).every(([c, check]) => codes.includes(c) && object(check) && oneOf(check.status, ['passed', 'deviation', 'unassessed']) &&
        integer(check.observedFrames) && Array.isArray(check.reasons) && check.reasons.every(reason)))) return false;
  const attempts = v.attempts as ExerciseResult['attempts'];
  const required = ['depth', 'extension', exercise === 'squat' ? 'lean' : 'line'] as FeedbackCode[];
  if (!attempts.every(a => required.every(c => a.criteria[c]) && Object.keys(a.criteria).length === required.length &&
    a.remarks.every(c => a.criteria[c]?.status === 'deviation') && required.every(c => a.criteria[c]!.status !== 'deviation' || a.remarks.includes(c)) &&
    (a.outcome !== 'complete' || (a.motionComplete && required.every(c => a.criteria[c]!.status !== 'unassessed'))))) return false;
  if (v.reps !== attempts.filter(a => a.outcome === 'complete').length || v.incomplete !== attempts.filter(a => a.outcome === 'incomplete').length ||
      v.unassessed !== attempts.filter(a => a.outcome === 'insufficient_data').length || v.withErrors !== attempts.filter(a => a.remarks.length).length ||
      v.withoutFindings !== attempts.filter(a => a.outcome === 'complete' && !a.remarks.length).length) return false;
  const errors = v.errors;
  return codes.every(c => (errors[c] ?? 0) === attempts.filter(a => a.remarks.includes(c as FeedbackCode)).length);
}
function record(v: unknown): v is WorkoutRecord {
  if (!object(v) || v.schemaVersion !== SCHEMA_VERSION || !text(v.id) || !v.id || !text(v.date) || !Number.isFinite(Date.parse(v.date)) ||
      !oneOf(v.exercise, ['squat', 'pushup']) || !oneOf(v.mode, ['camera', 'demo', 'video']) || !number(v.duration) || !text(v.conditions) ||
      !object(v.goal) || !validGoal(v.goal as unknown as WorkoutRecord['goal']) || !object(v.metadata) || !Array.isArray(v.sets) || !v.sets.length || v.sets.length > (v.goal.sets as number)) return false;
  const m = v.metadata;
  if (m.source !== undefined && (!object(m.source) || !integer(m.source.width) || !integer(m.source.height) || !text(m.source.delegate) ||
    !object(m.source.settings) || !Object.values(m.source.settings).every(v => text(v) || number(v)))) return false;
  if (!['rulesVersion', 'analysisVersion', 'coachingVersion', 'detector', 'sampling'].every(k => text(m[k]) && !!m[k]) ||
      !object(m.variant) || !text(m.variant.id) || !number(m.variant.lowerAngle) || !number(m.variant.upperAngle) ||
      (m.variant.trunkLean !== undefined && !number(m.variant.trunkLean)) || (m.variant.bodyLineDeviation !== undefined && !number(m.variant.bodyLineDeviation)) ||
      !object(m.tracking) || !Object.keys(m.tracking).length || !Object.values(m.tracking).every(number)) return false;
  return v.sets.every((s, index) => object(s) && s.number === index + 1 && oneOf(s.ended, ['completed', 'interrupted']) && number(s.durationMs) &&
    object(s.observation) && ['readyMs', 'partialMs', 'unavailableMs', 'sampledMs'].every(k => number(s.observation && (s.observation as Record<string, unknown>)[k])) &&
    typeof s.observation.sideViewConfirmed === 'boolean' &&
    Math.abs((s.observation.readyMs as number) + (s.observation.partialMs as number) + (s.observation.unavailableMs as number) - (s.observation.sampledMs as number)) < 0.01 && result(s.result, v.exercise));
}
export function parseHistory(raw: string): WorkoutRecord[] {
  const data: unknown = JSON.parse(raw);
  if (!object(data) || data.schemaVersion !== SCHEMA_VERSION) throw new Error('Версия истории не поддерживается. Исходные данные сохранены; экспортируйте их перед очисткой.');
  if (!Array.isArray(data.records) || !data.records.every(record) || new Set(data.records.map(r => r.id)).size !== data.records.length)
    throw new Error('История повреждена. Исходные данные сохранены; экспортируйте их перед очисткой.');
  return data.records;
}
export class HistoryStore {
  constructor(private storage: () => StoragePort = () => window.localStorage) {}
  load(): HistoryState {
    let raw: string | null = null;
    try {
      raw = this.storage().getItem(HISTORY_KEY);
      return { records: raw === null ? [] : parseHistory(raw), error: null, raw };
    } catch (error) {
      return { records: [], raw, error: raw === null ? 'Локальное хранилище недоступно. Тренировка продолжится; сохраните результат в JSON.' :
        (error instanceof SyntaxError ? 'История повреждена. Исходные данные сохранены; доступен экспорт.' : String(error instanceof Error ? error.message : error)) };
    }
  }
  private change(update: (records: WorkoutRecord[]) => WorkoutRecord[]) {
    const state = this.load();
    if (state.error) return state.error;
    try {
      const records = update(state.records);
      // Validate before touching storage. A failed write leaves the previous value intact.
      const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION, records });
      parseHistory(raw);
      this.storage().setItem(HISTORY_KEY, raw);
      return null;
    } catch { return 'Не удалось сохранить историю: хранилище недоступно или заполнено. Предыдущая история сохранена. Экспортируйте текущий результат в JSON.'; }
  }
  save(record: WorkoutRecord) { return this.change(records => records.some(r => r.id === record.id) ? records : [...records, record]); }
  remove(id: string) { return this.change(records => records.filter(r => r.id !== id)); }
  clear() {
    try { this.storage().removeItem(HISTORY_KEY); return null; }
    catch { return 'Не удалось очистить историю: хранилище недоступно.'; }
  }
}
function stable(value: unknown): string {
  return JSON.stringify(value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(stable(v))])) : value);
}
export function comparisonKey(r: WorkoutRecord) {
  // Unknown capture conditions cannot be presumed comparable.
  return stable({ exercise: r.exercise, mode: r.mode, conditions: r.conditions || r.id, metadata: r.metadata,
    goal: r.goal, viewConfirmed: r.sets.map(s => s.observation.sideViewConfirmed) });
}
export function comparableHistory(records: WorkoutRecord[], selected: WorkoutRecord) {
  if (selected.mode === 'demo') return [];
  return records.filter(r => r.mode !== 'demo' && comparisonKey(r) === comparisonKey(selected)).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}
export function metrics(record: WorkoutRecord) {
  const result = combineResults(record.sets.map(s => s.result));
  const criteria = Object.fromEntries(codes.map(code => {
    const assessed = result.attempts.filter(a => a.criteria[code as FeedbackCode] && a.criteria[code as FeedbackCode]!.status !== 'unassessed');
    return [code, { denominator: assessed.length, deviations: assessed.filter(a => a.criteria[code as FeedbackCode]!.status === 'deviation').length }];
  })) as Record<FeedbackCode, { denominator: number; deviations: number }>;
  return { result, criteria, completedSets: record.sets.filter(s => s.ended === 'completed').length,
    targetSets: record.sets.filter(s => s.result.reps >= record.goal.reps).length };
}
export function downloadJson(value: unknown, name: string, raw = false) {
  const url = URL.createObjectURL(new Blob([raw ? String(value) : JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
