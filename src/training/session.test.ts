import { describe, expect, it } from 'vitest';
import { demoPose } from '../pose/demo';
import { combineResults, TrainingController, validGoal, type TrainingGoal } from './session';
import type { ExerciseType } from '../exercises/types';

function harness(exercise: ExerciseType = 'squat', goal: TrainingGoal = { sets: 2, reps: 1, restSeconds: 2 }) {
  const controller = new TrainingController(exercise, 'camera', goal, 'side-room-A', 0, '2026-10-20T10:00:00Z', 'test-id');
  let now = 0;
  const feed = (source: number, duration = 90) => controller.sample(demoPose(exercise, source), now += duration, 1.6, now);
  const cycle = () => { for (let t = 0; t < 3600; t += 90) feed(t); };
  return { controller, feed, cycle, time: () => now, wait: (ms: number) => { now += ms; controller.advance(now); } };
}
describe('training session transitions (synthetic landmarks)', () => {
  for (const exercise of ['squat', 'pushup'] as const) {
    it(`completes two ${exercise} sets with rest and an explicit prepared restart`, () => {
      const h = harness(exercise);
      h.cycle();
      expect(h.controller.phase).toBe('rest');
      expect(h.controller.sets[0].result.reps).toBe(1);
      const saved = structuredClone(h.controller.sets);
      h.cycle(); // Accidental exercise during rest and next must have no effect.
      expect(h.controller.sets).toEqual(saved);
      expect(h.controller.phase).toBe('next');
      h.controller.resume(h.time());
      expect(h.controller.phase).toBe('preparing');
      h.cycle();
      expect(h.controller.phase).toBe('completed');
      const record = h.controller.finish(h.time(), h.time());
      expect(record.sets.map(s => s.ended)).toEqual(['completed', 'completed']);
      expect(combineResults(record.sets.map(s => s.result)).reps).toBe(2);
      expect(h.controller.finish(h.time() + 5000, h.time() + 5000)).toEqual(record);
    });
    it(`closes a pending ${exercise} once on pause and ignores movement until a fresh top`, () => {
      const h = harness(exercise, { sets: 1, reps: 10, restSeconds: 0 });
      for (let t = 0; t < 1800; t += 90) h.feed(t);
      expect(h.controller.analyzer.snapshot().result.attempts).toHaveLength(0);
      h.controller.pause(h.time());
      h.controller.pause(h.time());
      const paused = h.controller.analyzer.snapshot();
      expect(paused.result.attempts).toHaveLength(1);
      expect(paused.result.attempts[0].outcome).toBe('insufficient_data');
      expect(paused.result.attempts[0].endReason).toBe('session_paused');
      h.cycle();
      expect(h.controller.analyzer.snapshot()).toEqual(paused);
      h.wait(9000);
      h.controller.resume(h.time());
      for (let t = 1800; t < 2900; t += 90) h.feed(t);
      expect(h.controller.analyzer.snapshot().result.attempts).toHaveLength(1);
      h.cycle();
      const result = h.controller.finish(h.time(), h.time());
      expect(result.sets[0].result.reps).toBe(1);
      expect(result.sets[0].result.unassessed).toBe(1);
    });
  }
  it('preserves a complete rep across pause without counting its return again', () => {
    const h = harness('squat', { sets: 1, reps: 10, restSeconds: 0 });
    h.cycle(); h.controller.pause(h.time()); h.wait(500); h.controller.resume(h.time());
    for (let i = 0; i < 20; i++) h.feed(0);
    expect(h.controller.analyzer.snapshot().result.reps).toBe(1);
    h.cycle();
    expect(h.controller.finish(h.time(), h.time()).sets[0].result.reps).toBe(2);
  });
  it('requires readiness at start; no attempt from an initial ascent', () => {
    const h = harness();
    for (let t = 1800; t < 3400; t += 90) h.feed(t);
    expect(h.controller.analyzer.snapshot().result.attempts).toHaveLength(0);
    expect(h.controller.phase).toBe('preparing');
  });
  it('rest cannot be bypassed and zero rest still needs explicit next-set action', () => {
    const h = harness(); h.cycle(); h.controller.resume(h.time());
    expect(h.controller.phase).toBe('rest');
    h.wait(2000); expect(h.controller.phase).toBe('next');
    const zero = harness('squat', { sets: 2, reps: 1, restSeconds: 0 }); zero.cycle();
    expect(zero.controller.phase).toBe('next');
  });
  it('finishing during rest does not invent another set', () => {
    const h = harness(); h.cycle();
    expect(h.controller.finish(h.time(), h.time()).sets).toHaveLength(1);
  });
  it('manual set closure retains a pending attempt, and early finish marks interruption', () => {
    const h = harness('squat', { sets: 2, reps: 10, restSeconds: 0 });
    for (let t = 0; t < 1800; t += 90) h.feed(t);
    h.controller.endSet(h.time(), h.time());
    expect(h.controller.sets[0].result.attempts).toHaveLength(1);
    h.controller.endSet(h.time(), h.time());
    expect(h.controller.sets).toHaveLength(1);
    h.controller.resume(h.time()); h.cycle();
    const record = h.controller.finish(h.time(), h.time());
    expect(record.sets[1].ended).toBe('interrupted');
    expect(record.sets[1].result.reps).toBe(1);
  });
  it('accounts for observation gaps but excludes paused/rest time from its denominator', () => {
    const h = harness('squat', { sets: 1, reps: 10, restSeconds: 0 });
    for (let i = 0; i < 10; i++) h.feed(0);
    h.feed(0, 1500);
    h.controller.pause(h.time()); h.wait(30000); h.controller.resume(h.time());
    h.feed(0);
    const record = h.controller.finish(h.time(), h.time());
    const o = record.sets[0].observation;
    expect(o.sampledMs).toBe(2310);
    expect(o.unavailableMs).toBe(1250);
    expect(o.readyMs + o.partialMs + o.unavailableMs).toBe(o.sampledMs);
    expect(record.duration * 1000).toBeGreaterThan(o.sampledMs + 30000);
  });
  it('keeps metadata and independent finished snapshots without videos or coordinate streams', () => {
    const h = harness(); h.cycle(); const r = h.controller.finish(h.time(), h.time());
    expect(r.schemaVersion).toBe(1); expect(r.metadata.rulesVersion).toBe('provisional-side-v1');
    expect(r.metadata.variant.lowerAngle).toBe(102); expect(r.metadata.tracking.maxGapMs).toBe(700);
    expect(JSON.stringify(r)).not.toMatch(/landmarks|videoUrl/);
    r.sets[0].result.reps = 999;
    expect(h.controller.finish(h.time(), h.time()).sets[0].result.reps).toBe(1);
  });
  it('rejects invalid goals and does not supply personal training norms', () => {
    for (const goal of [{ sets: 0, reps: 2, restSeconds: 2 }, { sets: 1, reps: NaN, restSeconds: 0 }, { sets: 2, reps: 1.5, restSeconds: 0 }, { sets: 2, reps: 1, restSeconds: -1 }]) {
      expect(validGoal(goal)).toBe(false);
      expect(() => harness('squat', goal)).toThrow();
    }
  });
});
