import { goalReached } from '../../shared/workout';
import { criterionLabels, type FeedbackCode } from '../exercises/types';
import { combineResults, SCHEMA_VERSION, type WorkoutRecord } from './session';

export const HISTORY_KEY = 'playfit.workouts.v1';
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface HistoryState { records: WorkoutRecord[]; error: string | null; raw: string | null }
export { parseHistory } from '../../shared/historyValidation';
import { parseHistory } from '../../shared/historyValidation';
const codes = Object.keys(criterionLabels);
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
    targetSets: record.sets.filter(s => goalReached(s.result,record.goal)).length };
}
export function downloadJson(value: unknown, name: string, raw = false) {
  const url = URL.createObjectURL(new Blob([raw ? String(value) : JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
