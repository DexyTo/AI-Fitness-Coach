import { isProgram, type HistoryRecord } from '../../shared/program';
import { metrics } from '../training/history';

export type Period = 'week' | 'month' | 'year';
export type HistoryRange = Period | 'all';
export function inHistoryRange(date: string, range: HistoryRange, now = new Date()) {
  return range === 'all' || (Date.parse(date) >= +periodStart(range, now) && Date.parse(date) <= +now);
}
export function periodStart(period: Period, now: Date) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - 6);
  else if (period === 'month') start.setDate(start.getDate() - 29);
  else { start.setMonth(start.getMonth() - 11); start.setDate(1); }
  return start;
}
export function summarizeHistory(records: HistoryRecord[], period: Period, now = new Date()) {
  const start = periodStart(period, now);
  const sessions = records.filter(r => r.mode !== 'demo' && Date.parse(r.date) >= +start && Date.parse(r.date) <= +now);
  const selected = sessions.flatMap(r => isProgram(r) ? r.steps : [r]);
  const buckets = Array.from({ length: period === 'week' ? 7 : period === 'month' ? 30 : 12 }, (_, index) => {
    const date = new Date(start);
    if (period === 'year') date.setMonth(date.getMonth() + index); else date.setDate(date.getDate() + index);
    const key = period === 'year' ? `${date.getFullYear()}-${date.getMonth()}` : date.toDateString();
    return { key, label: date.toLocaleDateString('ru-RU', period === 'year' ? { month: 'short' } : period === 'week' ? { weekday: 'short' } : { day: 'numeric' }), workouts: 0, reps: 0, withoutFindings: 0 };
  });
  let reps = 0, withoutFindings = 0, targetSets = 0, sets = 0;
  const distribution = new Map<(typeof selected)[number]['exercise'], number>();
  selected.forEach(record => {
    const result = metrics(record), date = new Date(record.date);
    const key = period === 'year' ? `${date.getFullYear()}-${date.getMonth()}` : date.toDateString();
    const bucket = buckets.find(b => b.key === key);
    reps += result.result.reps; withoutFindings += result.result.withoutFindings;
    targetSets += result.targetSets; sets += record.goal.sets;
    distribution.set(record.exercise, (distribution.get(record.exercise) ?? 0) + 1);
    if (bucket) { bucket.reps += result.result.reps; bucket.withoutFindings += result.result.withoutFindings; }
  });
  sessions.forEach(record => {
    const date = new Date(record.date), key = period === 'year' ? `${date.getFullYear()}-${date.getMonth()}` : date.toDateString();
    const bucket = buckets.find(b => b.key === key); if (bucket) bucket.workouts++;
  });
  return { selected, workouts: sessions.length, buckets, reps, withoutFindings, targetSets, sets, distribution: [...distribution], completion: sets ? Math.round(targetSets / sets * 100) : null };
}
