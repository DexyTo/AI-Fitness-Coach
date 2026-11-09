import type { ProgramRecord, ProgramSnapshot } from '../shared/program.js';
import { validProgramRecord } from '../shared/program.js';
import type { WorkoutRecord } from '../shared/workout.js';
import { isLegacy } from '../src/exercises/registry.js';
import type { FeedbackCode } from '../src/exercises/types.js';

// Deliberately fabricated summaries, used only by the explicit demo seed and tests.
// They are never produced by the camera or exposed as an API reward shortcut.
export function demoRecord(id: string, date: string, snapshot: ProgramSnapshot, fraction = 1): ProgramRecord {
  const steps: WorkoutRecord[] = snapshot.program.steps.slice(0, Math.floor(snapshot.program.steps.length * fraction)).map((s, index) => {
    const legacy = isLegacy(s.exercise);
    const options = s.goal.options;
    const criteria = legacy ? ['depth', 'extension', s.exercise === 'squat' ? 'lean' : 'line'] : ['depth', 'extension', 'lean', 'line'];
    const side = s.exercise === 'reverse_lunge' || s.exercise === 'side_bend' ? options?.side : undefined;
    const reps = s.goal.reps ?? 0;
    const version = 'educational-fixture';
    const thresholds = { lowerAngle: 90, upperAngle: 170 };
    return {
      schemaVersion: legacy ? 1 : 3, id: `${id}:${index}`, date, exercise: s.exercise, mode: snapshot.mode,
      goal: s.goal, conditions: snapshot.conditions, duration: 0,
      metadata: {
        rulesVersion: version, analysisVersion: 'fabricated', coachingVersion: 'fabricated', detector: 'none', sampling: 'none',
        variant: { id: options?.variant ?? 'fixture', ...thresholds }, tracking: { frames: 0 },
        ...(!legacy && options && { exerciseSnapshot: { id: s.exercise, version, unit: 'reps', options, thresholds } }),
      },
      sets: Array.from({ length: s.goal.sets }, (_, set) => ({
        number: set + 1, ended: 'completed', durationMs: 0,
        observation: { readyMs: 0, partialMs: 0, unavailableMs: 0, sampledMs: 0, sideViewConfirmed: false },
        result: {
          ...(!legacy && { kind: 'repetitions' as const }),
          reps, incomplete: 0, unassessed: 0, withoutFindings: reps, withErrors: 0, errors: {},
          ...(side && { sides: { left: side === 'left' ? reps : 0, right: side === 'right' ? reps : 0 } }),
          attempts: Array.from({ length: reps }, (_, i) => ({
            id: i + 1, startedAt: 0, endedAt: 0, outcome: 'complete', endReason: 'returned_to_top',
            motionComplete: true, minAngle: 90, remarks: [], reasons: [],
            ...(side && { side }),
            criteria: Object.fromEntries(criteria.map(key => [key, { status: 'passed', observedFrames: 0, reasons: [] }])),
          })),
        },
      })),
    };
  });
  const record: ProgramRecord = { ...snapshot, schemaVersion: 2, id, date, duration: 0, ended: fraction === 1 ? 'completed' : 'interrupted', steps };
  if (!validProgramRecord(record)) throw Error('Invalid demo fixture');
  return record;
}

export function demoHistoryRecord(id: string, date: string, snapshot: ProgramSnapshot, dayNumber: number): ProgramRecord {
  const record = demoRecord(id, date, snapshot);
  const preparationMs = 8000;
  const repetitionMs = 3000 + dayNumber % 4 * 400;
  let elapsed = 0;
  for (const [index, step] of record.steps.entries()) {
    step.date = new Date(Date.parse(date) + elapsed * 1000).toISOString();
    const remark: FeedbackCode = step.exercise === 'squat' ? 'lean' : 'line';
    for (const set of step.sets) {
      const { result } = set;
      const remarkEvery = 4 + (dayNumber + index + set.number) % 5;
      for (const [i, attempt] of result.attempts.entries()) {
        attempt.startedAt = preparationMs + i * repetitionMs;
        attempt.endedAt = attempt.startedAt + repetitionMs;
        if ((i + 1) % remarkEvery === 0) {
          attempt.remarks.push(remark);
          attempt.criteria[remark] = { status: 'deviation', observedFrames: 0, reasons: [] };
        }
      }
      result.withErrors = result.attempts.filter(attempt => attempt.remarks.length > 0).length;
      result.withoutFindings = result.reps - result.withErrors;
      if (result.withErrors) result.errors[remark] = result.withErrors;
      set.durationMs = preparationMs + result.reps * repetitionMs;
    }
    step.duration = step.sets.reduce((total, set) => total + set.durationMs, 0) / 1000
      + (step.sets.length - 1) * step.goal.restSeconds;
    elapsed += step.duration + snapshot.program.steps[index].transitionSeconds;
  }
  record.duration = elapsed;
  if (!validProgramRecord(record)) throw Error('Invalid demo history fixture');
  return record;
}
