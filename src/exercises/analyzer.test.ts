import { describe, it, expect } from 'vitest';
import { createAnalyzer } from './analyzer';
import { demoPose } from '../pose/demo';
import { calculateAngle } from '../pose/geometry';
import type { ExerciseType, PoseLandmarks } from './types';


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
        analyzer.snapshot().result.withoutFindings +
          analyzer.snapshot().result.withErrors,
      ).toBe(3);
    });
  }
});

// Synthetic, controlled 2D geometry. These tests do not validate MediaPipe on video.
function poseAtAngle(exercise: ExerciseType, angle: number): PoseLandmarks {
  const points = demoPose(exercise, 0);
  const radians = angle * Math.PI / 180;
  for (const offset of [0, 1]) {
    const pivot = { x: 0.45 + offset * 0.03, y: 0.58, visibility: 1, presence: 1 };
    const proximal = { ...pivot, x: pivot.x + Math.sin(radians) * 0.22 / 1.6, y: pivot.y + Math.cos(radians) * 0.22 };
    const distal = { ...pivot, y: 0.83 };
    if (exercise === 'squat') {
      points[23 + offset] = proximal;
      points[25 + offset] = pivot;
      points[27 + offset] = distal;
      points[11 + offset] = { ...proximal, y: proximal.y - 0.21 };
    } else {
      points[11 + offset] = proximal;
      points[13 + offset] = pivot;
      points[15 + offset] = distal;
      points[27 + offset] = { ...pivot, x: 0.85 + offset * 0.03, y: 0.83 };
      points[23 + offset] = { ...pivot, x: (proximal.x + points[27 + offset].x) / 2, y: (proximal.y + 0.83) / 2 };
    }
  }
  return points;
}
function sequence(exercise: ExerciseType = 'squat') {
  const analyzer = createAnalyzer(exercise);
  let time = 0;
  const feed = (angle: number, frames = 4, change?: (p: PoseLandmarks) => void) => {
    for (let i = 0; i < frames; i++) {
      const p = poseAtAngle(exercise, angle);
      change?.(p);
      analyzer.analyze(p, time += 90, 1.6);
    }
    return analyzer.snapshot();
  };
  const path = (angles: number[], change?: (p: PoseLandmarks) => void) => {
    angles.forEach(a => feed(a, 4, change));
    return analyzer.snapshot();
  };
  const lose = (frames: number) => {
    for (let i = 0; i < frames; i++) analyzer.analyze([], time += 90, 1.6);
    return analyzer.snapshot();
  };
  return { analyzer, feed, path, lose, finish: () => analyzer.finish(time + 1) };
}
const fullCycle = [180, 160, 140, 120, 100, 80, 80, 100, 120, 140, 160, 180];

describe('observation quality and attempts', () => {
  it('records shallow attempts after a complete squat instead of dropping them', () => {
    const s = sequence();
    s.path(fullCycle);
    s.path([180, 160, 140, 125, 140, 160, 180]);
    s.path([180, 160, 140, 130, 145, 165, 180]);
    const { result } = s.finish();
    expect(result.reps).toBe(1);
    expect(result.incomplete).toBe(2);
    expect(result.withErrors).toBe(2);
    expect(result.errors.depth).toBe(2);
    expect(result.attempts.map(a => a.outcome)).toEqual(['complete', 'incomplete', 'incomplete']);
    expect(result.attempts[1].criteria.depth?.status).toBe('deviation');
  });
  it('does not turn a pushup with missing ankles into a positive result', () => {
    const s = sequence('pushup');
    const state = s.path(fullCycle, p => { p[27].visibility = 0; p[28].visibility = 0; });
    expect(state.observation.status).toBe('partial');
    expect(state.angle).toBeNull();
    expect(state.feedback).toEqual([]);
    expect(state.result.reps).toBe(0);
    expect(state.result.withoutFindings).toBe(0);
    expect(state.result.unassessed).toBe(1);
    const attempt = state.result.attempts[0];
    expect(attempt.motionComplete).toBe(false);
    expect(attempt.criteria.depth?.observedFrames).toBeGreaterThan(0);
    expect(attempt.criteria.line?.status).toBe('unassessed');
    expect(attempt.reasons).toContainEqual({ code: 'missing_points', criterion: 'line', landmarks: [27] });
  });
  it('retains very shallow departures from the observed top after a complete repetition', () => {
    const s = sequence();
    s.path(fullCycle);
    s.path([180, 165, 155, 165, 180]);
    const result = s.finish().result;
    expect(result.reps).toBe(1);
    expect(result.incomplete).toBe(1);
    expect(result.errors.depth).toBe(1);
  });
  it('ignores small oscillations at the top', () => {
    const s = sequence();
    s.path([180, 175, 180, 174, 180, 176, 180]);
    expect(s.finish().result.attempts).toEqual([]);
  });
  it('does not borrow a visible opposite ankle during a pushup', () => {
    const s = sequence('pushup');
    s.path([180, 160, 140, 120]);
    const paused = s.feed(100, 1, p => { p[27].visibility = 0; p[28].x = 0.1; });
    expect(paused.observation.side).toBe('left');
    expect(paused.observation.status).toBe('partial');
    const state = s.path([100, 80, 100, 120, 140, 160, 180], p => {
      p[27].visibility = 0;
      p[28].x = 0.1;
    });
    expect(state.result.reps).toBe(0);
    expect(state.result.unassessed).toBe(1);
    expect(state.result.attempts[0].criteria.line?.status).toBe('unassessed');
  });
  it('preserves observed depth but marks a briefly missing body-line check unassessed', () => {
    const s = sequence('pushup');
    s.path([180, 160, 140, 100, 80]);
    s.feed(80, 1, p => { p[27].visibility = 0; });
    const state = s.path([80, 100, 120, 140, 160, 180]);
    const attempt = state.result.attempts[0];
    expect(attempt.outcome).toBe('insufficient_data');
    expect(attempt.motionComplete).toBe(true);
    expect(attempt.criteria.depth?.status).toBe('passed');
    expect(attempt.criteria.line?.status).toBe('unassessed');
  });
  it('can select a complete, independently valid opposite chain before movement starts', () => {
    const s = sequence('pushup');
    const state = s.path(fullCycle, p => { p[27].visibility = 0; });
    expect(state.observation.side).toBe('right');
    expect(state.result.reps).toBe(1);
    expect(state.result.unassessed).toBe(0);
  });
  it('removes stale angle and hints immediately on pose loss and does not glue a long gap', () => {
    const s = sequence();
    s.path([180, 160, 140, 100, 80], p => { p[11].x += 0.2; });
    expect(s.analyzer.snapshot().feedback.some(f => f.code === 'lean')).toBe(true);
    const lost = s.lose(1);
    expect(lost.observation.status).toBe('unavailable');
    expect(lost.angle).toBeNull();
    expect(lost.feedback).toEqual([]);
    s.lose(15);
    const recovered = s.path([80, 100, 140, 180]);
    expect(recovered.result.reps).toBe(0);
    expect(recovered.result.unassessed).toBe(1);
    expect(recovered.result.attempts[0].remarks).toContain('lean');
    expect(recovered.result.attempts[0].endReason).toBe('tracking_gap');
    s.path(fullCycle);
    expect(s.finish().result.reps).toBe(1);
  });
  it('retains missing coverage after a short loss even when motion later completes', () => {
    const s = sequence();
    s.path([180, 160, 140, 100, 80]);
    s.lose(1);
    const state = s.path([80, 100, 140, 160, 180]);
    expect(state.result.unassessed).toBe(1);
    expect(state.result.reps).toBe(0);
    expect(state.result.attempts[0].motionComplete).toBe(true);
  });
  it('handles a cadence gap even without explicit empty frames', () => {
    const s = sequence();
    s.path([180, 140, 100, 80]);
    s.analyzer.analyze(poseAtAngle('squat', 180), 10000, 1.6);
    const result = s.analyzer.finish(10001).result;
    expect(result.reps).toBe(0);
    expect(result.unassessed).toBe(1);
  });
  it('flushes an unfinished ascent exactly once with an extension remark', () => {
    const s = sequence();
    s.path([180, 160, 140, 100, 80, 100, 120, 135]);
    const first = s.finish();
    const second = s.finish();
    expect(first.result.incomplete).toBe(1);
    expect(first.result.errors.extension).toBe(1);
    expect(first.result.attempts[0].criteria.depth?.status).toBe('passed');
    expect(first.result.attempts[0].endReason).toBe('session_finished');
    expect(second.result).toEqual(first.result);
  });
  it('records a fresh attempt when descent resumes before extension', () => {
    const s = sequence();
    s.path([180, 140, 100, 80, 100, 120, 140, 120, 100, 80, 100, 140, 160, 180]);
    const result = s.finish().result;
    expect(result.incomplete).toBe(1);
    expect(result.reps).toBe(1);
    expect(result.attempts[0].remarks).toContain('extension');
    expect(result.attempts[0].endReason).toBe('reversed_before_top');
  });
  it('does not create attempts for idle frames or the initial ascent from a low pose', () => {
    const s = sequence();
    s.path([80, 100, 120, 140, 160, 180]);
    s.feed(180, 100);
    s.lose(100);
    expect(s.finish().result.attempts).toEqual([]);
  });
  it('requires shoulders for squat lean, but preserves available knee observations', () => {
    const s = sequence();
    s.path([180, 160, 140, 100, 80]);
    s.feed(80, 1, p => { p[11].presence = 0; p[12].presence = 0; });
    const state = s.path([80, 100, 120, 140, 160, 180]);
    expect(state.result.unassessed).toBe(1);
    expect(state.result.attempts[0].criteria.depth?.status).toBe('passed');
    expect(state.result.attempts[0].criteria.lean?.status).toBe('unassessed');
  });
  it('splits a long mandatory-point loss even while arm geometry remains available', () => {
    const s = sequence('pushup');
    s.path([180, 160, 140, 100, 80]);
    s.feed(80, 12, p => { p[27].visibility = 0; p[28].visibility = 0; });
    const recovered = s.path([80, 100, 120, 140, 160, 180]);
    expect(recovered.result.reps).toBe(0);
    expect(recovered.result.unassessed).toBe(1);
    expect(recovered.result.attempts[0].endReason).toBe('tracking_gap');
    expect(recovered.result.attempts[0].criteria.depth?.status).toBe('passed');
  });
  it('rejects degenerate geometry instead of passing a criterion', () => {
    const s = sequence('pushup');
    const state = s.feed(180, 1, p => { p[23] = { ...p[11] }; p[24] = { ...p[12] }; });
    expect(state.observation.status).toBe('partial');
    expect(state.criteria.line?.status).toBe('unassessed');
    expect(state.observation.reasons.some(r => r.code === 'invalid_geometry')).toBe(true);
  });
  it('resets on video timeline changes without counting the recovery ascent', () => {
    const s = sequence();
    s.path([180, 140, 100, 80]);
    s.analyzer.interrupt(1500, 'timeline_reset');
    s.path([80, 100, 140, 180]);
    expect(s.finish().result.reps).toBe(0);
    expect(s.finish().result.attempts[0].endReason).toBe('timeline_reset');
  });
  it('returns independent snapshots and clears all state on reset', () => {
    const s = sequence();
    const snapshot = s.path(fullCycle);
    snapshot.result.attempts[0].criteria.depth!.status = 'unassessed';
    expect(s.analyzer.snapshot().result.attempts[0].criteria.depth?.status).toBe('passed');
    s.analyzer.reset();
    expect(s.analyzer.snapshot().result.attempts).toEqual([]);
    s.path(fullCycle);
    expect(s.finish().result.reps).toBe(1);
  });
  for (const exercise of ['squat', 'pushup'] as const) {
    it(`retains an unfinished descent in ${exercise} without duplicating it`, () => {
      const s = sequence(exercise);
      s.path([180, 160, 140, 125]);
      s.feed(125, 30);
      const first = s.finish();
      expect(first.result.reps).toBe(0);
      expect(first.result.incomplete).toBe(1);
      expect(first.result.attempts[0].remarks).toEqual(expect.arrayContaining(['depth', 'extension']));
      expect(s.finish().result).toEqual(first.result);
    });
  }
  it('does not equate unknown landmark confidence with good quality', () => {
    const s = sequence('pushup');
    const state = s.path(fullCycle, p => { p[27].visibility = undefined; p[28].visibility = undefined; });
    expect(state.result.reps).toBe(0);
    expect(state.result.unassessed).toBe(1);
  });
  it('requires a visible wrist for pushup motion despite many other visible joints', () => {
    const s = sequence('pushup');
    s.path([180, 160, 140, 100]);
    const state = s.feed(80, 1, p => { p[15].visibility = 0; });
    expect(state.observation.status).toBe('unavailable');
    expect(state.criteria.line?.status).toBe('passed');
    expect(state.criteria.depth?.status).toBe('unassessed');
    expect(state.observation.reasons).toContainEqual({ code: 'missing_points', criterion: 'depth', landmarks: [15] });
    expect(state.angle).toBeNull();
    expect(state.feedback).toEqual([]);
    expect(s.finish().result.unassessed).toBe(1);
  });
  it('distinguishes a stalled source and processing failure from no person detected', () => {
    const s = sequence();
    s.path([180, 160, 140]);
    const stalled = s.analyzer.analyze([], 1500, 1.6, 'source_unavailable');
    expect(stalled.observation.reasons[0].code).toBe('source_unavailable');
    expect(stalled.angle).toBeNull();
    expect(stalled.feedback).toEqual([]);
    const failed = s.analyzer.analyze([], 1590, 1.6, 'detector_error');
    expect(failed.observation.reasons[0].code).toBe('detector_error');
  });
  it('retains a proven shallow reversal when tracking is later lost', () => {
    const s = sequence();
    s.path([180, 160, 140, 125, 135, 145]);
    s.lose(12);
    const attempt = s.finish().result.attempts[0];
    expect(attempt.outcome).toBe('insufficient_data');
    expect(attempt.criteria.depth?.status).toBe('deviation');
    expect(attempt.remarks).toContain('depth');
  });
  it('marks missing coverage if the session ends after a silent frame gap', () => {
    const s = sequence();
    s.path([180, 160, 140, 100, 80]);
    const result = s.analyzer.finish(10000).result;
    expect(result.unassessed).toBe(1);
    expect(result.incomplete).toBe(0);
    expect(result.attempts[0].reasons).toContainEqual({ code: 'tracking_gap' });
  });
});
