import { describe, it, expect } from 'vitest';
import { createAnalyzer } from './analyzer';
import { demoPose } from '../pose/demo';
import { calculateAngle } from '../pose/geometry';


describe('movement analysis', () => {
  it('computes a right angle', () =>
    expect(
      calculateAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }),
    ).toBeCloseTo(90));
  it('shows squat arms extending in front of the shoulders', () => {
    for (const time of [0, 1700]) {
      const pose = demoPose('squat', time);
      expect(pose[15].x).toBeGreaterThan(pose[13].x);
      expect(pose[13].x).toBeGreaterThan(pose[11].x);
    }
  });
  it('keeps pushup hands and feet on the floor with a straight body', () => {
    for (const time of [0, 1700]) {
      const pose = demoPose('pushup', time);
      expect(pose[15].y).toBeCloseTo(pose[27].y);
      expect(calculateAngle(pose[11], pose[23], pose[27], 1.6)).toBeGreaterThan(
        170,
      );
    }
  });
  for (const exercise of ['squat', 'pushup'] as const) {
    it(`counts complete ${exercise} cycles once each`, () => {
      const analyzer = createAnalyzer(exercise);
      for (let t = 100; t < 11000; t += 90)
        analyzer.analyze(demoPose(exercise, t - 100), t, 1.6);
      expect(analyzer.snapshot().result.reps).toBe(3);
      expect(
        analyzer.snapshot().result.correct +
          analyzer.snapshot().result.withErrors,
      ).toBe(3);
    });
  }
});
