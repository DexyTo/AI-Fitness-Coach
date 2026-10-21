import { describe, expect, it } from 'vitest';
import { inHistoryRange, summarizeHistory } from './workoutAnalytics';
import { TrainingController } from '../training/session';
import { demoPose } from '../pose/demo';
import type { ProgramRecord } from '../../shared/program';

function workout(date: Date, mode: 'camera' | 'video' | 'demo' = 'camera') {
  const controller = new TrainingController('squat', mode, { sets: 1, reps: 1, restSeconds: 0 }, '', 0, date.toISOString(), `${mode}-${date.toISOString()}`);
  for (let t = 0; t < 3600; t += 90) controller.sample(demoPose('squat', t), t + 90, 1.6, t + 90);
  return controller.finish(3600, 3600);
}
describe('history chart aggregation (synthetic fixtures)', () => {
  const now = new Date(2026, 9, 21, 12);
  it('keeps source boundaries, excludes demo, old and future records, and includes video', () => {
    const start = new Date(2026, 9, 15), old = new Date(+start - 1);
    const data = summarizeHistory([workout(start), workout(now, 'video'), workout(now, 'demo'), workout(old), workout(new Date(+now + 1))], 'week', now);
    expect(data.selected).toHaveLength(2);
    expect(data.reps).toBe(2); expect(data.withoutFindings).toBe(2);
    expect(data.targetSets).toBe(2); expect(data.completion).toBe(100);
    expect(data.buckets[0].reps).toBe(1); expect(data.buckets[6].reps).toBe(1);
    expect(data.distribution).toEqual([['squat', 2]]);
  });
  it('shows absence of a denominator as missing data and preserves empty dates', () => {
    const empty = summarizeHistory([], 'month', now);
    expect(empty.completion).toBeNull(); expect(empty.buckets).toHaveLength(30);
    expect(empty.buckets.every(b => b.reps === 0 && b.workouts === 0)).toBe(true);
  });
  it('keeps old history accessible through all dates and applies date boundaries to list filters', () => {
    expect(inHistoryRange(new Date(2024, 0, 1).toISOString(), 'all', now)).toBe(true);
    expect(inHistoryRange(new Date(2026, 9, 15).toISOString(), 'week', now)).toBe(true);
    expect(inHistoryRange(new Date(2026, 9, 14, 23, 59, 59).toISOString(), 'week', now)).toBe(false);
    expect(inHistoryRange(new Date(+now + 1).toISOString(), 'month', now)).toBe(false);
  });
  it('counts one program event once while including all saved step repetitions', () => {
    const first = workout(now), second = { ...workout(now, 'video'), mode: 'camera' as const };
    const program: ProgramRecord = {
      schemaVersion: 2, kind: 'program', id: 'program', date: now.toISOString(), mode: 'camera', conditions: '', ended: 'completed', duration: 8,
      program: { schemaVersion: 1, id: 'plan', version: 1, origin: 'catalog', ownerId: null, title: 'Два шага', description: '', steps: [first, second].map((r, i) => ({ id: String(i), exercise: r.exercise, goal: r.goal, transitionSeconds: 0 })) },
      steps: [first, second],
    };
    const data = summarizeHistory([program], 'week', now);
    expect(data.workouts).toBe(1); expect(data.reps).toBe(2);
    expect(data.buckets[6].workouts).toBe(1); expect(data.buckets[6].reps).toBe(2);
    expect(data.targetSets).toBe(2); expect(data.sets).toBe(2);
  });
  it('groups twelve calendar months across a year boundary without losing the first month', () => {
    const data = summarizeHistory([workout(new Date(2025, 10, 1)), workout(new Date(2026, 0, 1)), workout(now), workout(new Date(2025, 9, 31))], 'year', now);
    expect(data.buckets).toHaveLength(12); expect(data.selected).toHaveLength(3);
    expect(data.buckets[0].workouts).toBe(1); expect(data.buckets[2].workouts).toBe(1); expect(data.buckets[11].workouts).toBe(1);
  });
});
