import type { ProgramRecord, ProgramSnapshot } from '../shared/program.js';
import { validProgramRecord } from '../shared/program.js';
import type { WorkoutRecord } from '../shared/workout.js';

// Deliberately fabricated summaries, used only by the explicit demo seed and tests.
// They are never produced by the camera or exposed as an API reward shortcut.
export function demoRecord(id: string, date: string, snapshot: ProgramSnapshot, fraction = 1): ProgramRecord {
  const steps: WorkoutRecord[] = snapshot.program.steps.slice(0, Math.floor(snapshot.program.steps.length * fraction)).map((s, index) => ({
    schemaVersion: 1, id: `${id}:${index}`, date, exercise: s.exercise, mode: snapshot.mode, goal: s.goal, conditions: snapshot.conditions, duration: 0,
    metadata: { rulesVersion: 'educational-fixture', analysisVersion: 'fabricated', coachingVersion: 'fabricated', detector: 'none', sampling: 'none',
      variant: { id: 'fixture', lowerAngle: 90, upperAngle: 170 }, tracking: { frames: 0 } },
    sets: Array.from({ length: s.goal.sets }, (_, set) => ({ number: set + 1, ended: 'completed', durationMs: 0,
      observation: { readyMs: 0, partialMs: 0, unavailableMs: 0, sampledMs: 0, sideViewConfirmed: false },
      result: { reps: s.goal.reps??0, incomplete: 0, unassessed: 0, withoutFindings: s.goal.reps??0, withErrors: 0, errors: {},
        attempts: Array.from({ length: s.goal.reps??0 }, (_, i) => ({ id: i + 1, startedAt: 0, endedAt: 0, outcome: 'complete', endReason: 'returned_to_top', motionComplete: true, minAngle: 90, remarks: [], reasons: [],
          criteria: Object.fromEntries(['depth', 'extension', s.exercise === 'squat' ? 'lean' : 'line'].map(key => [key, { status: 'passed', observedFrames: 0, reasons: [] }])) })) } })),
  }));
  const record: ProgramRecord = { ...snapshot, schemaVersion: 2, id, date, duration: 0, ended: fraction === 1 ? 'completed' : 'interrupted', steps };
  if (!validProgramRecord(record)) throw Error('Invalid demo fixture');
  return record;
}
