import { describe, expect, it } from 'vitest';
import { createAnalyzer } from './analyzer';
import { CoachingController, attemptExplanation, attemptMeasurements, criterionTotals, nextTask } from './coaching';
import { demoPose } from '../pose/demo';
import type { ExerciseAnalysisResult, ExerciseResult, ExerciseType, MovementAttempt } from './types';

function active(exercise: ExerciseType = 'squat') {
  const analysis = createAnalyzer(exercise).snapshot();
  analysis.preparation = { stage: 'active', view: exercise === 'squat' ? 'side' : 'not_required', viewConfirmed: false, message: 'Подход идёт.' };
  analysis.observation = { status: 'ready', side: 'left', reasons: [] };
  analysis.state = 'Опускаетесь';
  analysis.angle = 130;
  analysis.feedback = ['depth', 'extension', exercise === 'squat' ? 'lean' : 'line'].map(code => ({ code: code as 'depth' | 'extension' | 'lean' | 'line', message: 'Устаревший совет' }));
  return analysis;
}
function deviation(exercise: ExerciseType = 'squat') {
  const points = demoPose(exercise, 0);
  if (exercise === 'squat') points[11] = { ...points[11], x: points[23].x - 0.23, y: points[23].y - 0.12 };
  else points[23] = { ...points[23], y: 0.4 };
  return points;
}
function warm(controller: CoachingController, analysis: ExerciseAnalysisResult, points = deviation(), start = 0) {
  controller.update(analysis, points, 1.6, start);
  controller.update(analysis, points, 1.6, start + 250);
  return controller.update(analysis, points, 1.6, start + 500);
}
function attempt(outcome: MovementAttempt['outcome'] = 'complete'): MovementAttempt {
  return { id: 1, startedAt: 1000, endedAt: 3400, minAngle: 95, outcome,
    endReason: 'returned_to_top', motionComplete: outcome === 'complete', remarks: [], reasons: [],
    criteria: { depth: { status: 'passed', observedFrames: 20, reasons: [] },
      extension: { status: 'passed', observedFrames: 20, reasons: [] }, lean: { status: 'passed', observedFrames: 20, reasons: [] } } };
}
function result(attempts: MovementAttempt[]): ExerciseResult {
  return { reps: 0, incomplete: 0, unassessed: 0, withoutFindings: 0, withErrors: 0, errors: {}, attempts };
}

describe('current coaching policy (synthetic landmarks)', () => {
  for (const exercise of ['squat', 'pushup'] as const) {
    it(`selects one confirmed current finding and labels the correct chain for ${exercise}`, () => {
      const cue = warm(new CoachingController(exercise), active(exercise), deviation(exercise));
      expect(cue.kind).toBe('technique');
      expect(cue.target?.points).toEqual(exercise === 'squat' ? [11, 23] : [11, 23, 27]);
      expect(cue.target?.label).toBeTruthy();
      expect(cue.message).not.toContain('Устаревший');
      expect(cue.message).not.toContain('ниже');
    });
    it(`uses the selected side only for ${exercise}`, () => {
      const a = active(exercise); a.observation.side = 'right';
      expect(warm(new CoachingController(exercise), a, deviation(exercise)).kind).toBe('phase');
    });
  }
  it('does not announce isolated deviations or a raw unconfirmed candidate', () => {
    const c = new CoachingController('squat'), a = active();
    expect(c.update(a, deviation(), 1.6, 0).kind).toBe('phase');
    expect(c.update(a, demoPose('squat', 0), 1.6, 200).kind).toBe('phase');
    a.feedback = [];
    expect(warm(c, a, deviation(), 300).kind).toBe('phase');
  });
  it('immediately invalidates stale accumulated findings when fresh geometry improves', () => {
    const c = new CoachingController('squat'), a = active();
    expect(warm(c, a).kind).toBe('technique');
    expect(c.update(a, demoPose('squat', 0), 1.6, 600).kind).toBe('phase');
    // Short relapse cannot flip the technical message back on.
    expect(warm(c, a, deviation(), 700).kind).toBe('phase');
  });
  it('acknowledges only sustained correction and expires the acknowledgement', () => {
    const c = new CoachingController('squat'), a = active();
    warm(c, a);
    let cue;
    for (let t = 600; t <= 4400; t += 100) {
      cue = c.update(a, demoPose('squat', 0), 1.6, t);
      if (t === 1300) expect(cue.kind).toBe('phase');
      if (t === 2400) expect(cue.kind).toBe('improvement');
    }
    expect(cue?.kind).toBe('phase');
  });
  it('prioritizes partial observation over technique and clears the highlight', () => {
    const c = new CoachingController('squat'), a = active(); warm(c, a);
    a.observation.status = 'partial';
    a.observation.reasons = [{ code: 'missing_points', landmarks: [27], criterion: 'depth' }];
    const cue = c.update(a, deviation(), 1.6, 600);
    expect(cue.kind).toBe('observation');
    expect(cue.message).toContain('лодыжка');
    expect(cue.message).toContain('Отойдите');
    expect(cue.target).toBeUndefined();
    a.observation.status = 'ready'; a.observation.reasons = [];
    expect(c.update(a, deviation(), 1.6, 700).kind).toBe('phase');
  });
  for (const code of ['source_unavailable', 'no_pose', 'detector_error'] as const) {
    it(`gives a recovery action for ${code}`, () => {
      const a = active(); a.state = 'Оценка приостановлена';
      a.observation = { status: 'unavailable', side: null, reasons: [{ code }] };
      const cue = new CoachingController('squat').update(a, [], 1.6, 0);
      expect(cue.kind).toBe('observation');
      expect(cue.message).toMatch(/Возобновите|Проверьте|перезапустить/);
      expect(cue.target).toBeUndefined();
    });
  }
  it('requires suitable view even with visible points', () => {
    const a = active(); a.state = 'Оценка приостановлена'; a.preparation.view = 'unsuitable';
    a.preparation.message = 'Повернитесь боком к камере.';
    expect(warm(new CoachingController('squat'), a).message).toContain('Повернитесь');
  });
  it('does not use attempt history as a live cue in preparation or at the top', () => {
    const a = active(); a.state = 'Подготовка'; a.preparation.stage = 'preparing';
    expect(warm(new CoachingController('squat'), a).message).toBe(a.preparation.message);
    a.state = 'Готов'; a.preparation.stage = 'ready';
    expect(warm(new CoachingController('squat'), a).kind).toBe('phase');
  });
  it('does not tell the user to go deeper on ascent; phase changes invalidate the old cue', () => {
    const a = active(), c = new CoachingController('squat'); warm(c, a);
    a.state = 'Поднимаетесь';
    const cue = c.update(a, deviation(), 1.6, 600);
    expect(cue.kind).toBe('phase');
    expect(cue.message).toContain('Возвращайтесь');
    expect(cue.message).not.toContain('ниже');
  });
  it('resets evidence after an attempt boundary, a stalled source, and a backwards clock', () => {
    const a = active(), c = new CoachingController('squat'); warm(c, a);
    a.result.attempts.push(attempt());
    expect(c.update(a, deviation(), 1.6, 600).kind).toBe('phase');
    expect(warm(c, a, deviation(), 700).kind).toBe('technique');
    expect(c.update(a, deviation(), 1.6, 2100).kind).toBe('phase');
    expect(c.update(a, deviation(), 1.6, 100).kind).toBe('phase');
  });
  it('does not draw a target from an unreliable point even with a stale ready snapshot', () => {
    const p = deviation(); p[11].visibility = 0;
    expect(warm(new CoachingController('squat'), active(), p).target).toBeUndefined();
  });
  it('keeps real analyzer cycles free of past depth instructions', () => {
    for (const exercise of ['squat', 'pushup'] as const) {
      const analyzer = createAnalyzer(exercise), controller = new CoachingController(exercise);
      for (let t = 0; t < 8000; t += 100) {
        const points = demoPose(exercise, t), a = analyzer.analyze(points, t + 1, 1.6);
        const cue = controller.update(a, points, 1.6, t);
        expect(cue.message).not.toMatch(/ниже|глубже/);
        if (a.preparation.stage !== 'active') expect(cue.target).toBeUndefined();
      }
      expect(analyzer.snapshot().result.reps).toBe(2);
    }
  });
});

describe('attempt review and next task', () => {
  it('separates accepted motion from a technique finding', () => {
    const a = attempt(); a.remarks = ['lean']; a.criteria.lean!.status = 'deviation';
    expect(attemptExplanation(a, 'squat')).toContain('Засчитано');
    expect(criterionTotals(result([a])).lean).toEqual({ passed: 0, deviation: 1, unassessed: 0 });
  });
  it('explains incomplete events with the exercise variant, without a depth command', () => {
    const a = attempt('incomplete'); a.criteria.depth!.status = 'deviation';
    expect(attemptExplanation(a, 'squat')).toContain('102°');
    expect(attemptExplanation(a, 'pushup')).toContain('98°');
    a.criteria.extension!.status = 'deviation';
    expect(attemptExplanation(a, 'pushup')).toContain('≥ 158°');
    expect(attemptExplanation(a, 'squat')).toContain('Не увеличивайте');
  });
  it('withholds amplitude and duration when the attempt lacks required data', () => {
    const a = attempt('insufficient_data');
    expect(attemptMeasurements(a, 'squat')).toBeNull();
    expect(attemptExplanation(a, 'squat')).toContain('не оценка техники');
    a.outcome = 'complete'; a.reasons = [{ code: 'tracking_gap' }];
    expect(attemptMeasurements(a, 'squat')).toBeNull();
  });
  it('reports only the observed joint angle and time span with sufficient data', () => {
    expect(attemptMeasurements(attempt(), 'pushup')).toEqual({ amplitude: 'Нижняя точка амплитуды: минимальный 2D-угол локтя 95°', duration: '2.4' });
  });
  it('recommends filming when data is scarce, regardless of raw error counts', () => {
    const r = result([attempt('insufficient_data'), attempt('insufficient_data'), attempt()]);
    r.errors = { lean: 99 };
    expect(nextTask(r, 'squat')).toContain('настройте съёмку');
    expect(nextTask(result([]), 'squat')).toContain('настройте съёмку');
  });
  it('selects one repeated deviation with deterministic priority', () => {
    const a = attempt('incomplete');
    a.criteria.lean!.status = a.criteria.extension!.status = a.criteria.depth!.status = 'deviation';
    const text = nextTask(result([a, structuredClone(a)]), 'squat');
    expect(text).toContain('корпуса'); expect(text).toContain('2 из 2');
    expect(text).not.toContain('глубин');
  });
  it('does not turn a single finding into a persistent diagnosis', () => {
    const a = attempt(); a.criteria.lean!.status = 'deviation';
    expect(nextTask(result([a, attempt()]), 'squat')).toContain('повторяемость');
  });
  it('does not recommend deeper motion for repeated lower-point failures', () => {
    const a = attempt('incomplete'); a.criteria.depth!.status = 'deviation';
    expect(nextTask(result([a, structuredClone(a)]), 'squat')).toContain('с тренером');
    expect(nextTask(result([a, structuredClone(a)]), 'squat')).toContain('не увеличивайте');
  });
});
