import type { ExerciseOptions, ExerciseResult, ExerciseType, InputMode } from '../src/exercises/types.js';
import { exerciseRegistry, isHold, isLegacy } from '../src/exercises/registry.js';
interface GoalBase { schemaVersion?: 2; sets: number; restSeconds: number; options?: ExerciseOptions }
export type TrainingGoal = GoalBase & ({ unit?: 'reps'; reps: number; seconds?: never } | { unit: 'seconds'; seconds: number; reps?: never });
export const goalValue = (goal: TrainingGoal): number => goal.unit === 'seconds' ? goal.seconds : goal.reps;
export const goalLabel = (goal: TrainingGoal) => `${goalValue(goal)} ${goal.unit === 'seconds' ? 'с' : 'повт.'}`;
export const withGoalValue = (goal: TrainingGoal, value: number): TrainingGoal => goal.unit === 'seconds' ? {...goal,seconds:value} : {...goal,reps:value};
export const resultValue = (result: ExerciseResult): number => result.hold ? result.hold.creditedMs / 1000 : result.reps;
export const goalReached = (result: ExerciseResult, goal: TrainingGoal) => resultValue(result) >= goalValue(goal);
export function validGoal(goal: TrainingGoal) {
  if(!goal||typeof goal!=='object'||(goal.schemaVersion!==undefined&&goal.schemaVersion!==2)||goal.options===null||(goal.options!==undefined&&typeof goal.options!=='object'))return false;
  return Number.isInteger(goal.sets) && goal.sets >= 1 && goal.sets <= 100 &&
    (goal.unit === undefined || goal.unit === 'reps' || goal.unit === 'seconds') &&
    Number.isInteger(goalValue(goal)) && goalValue(goal) >= 1 && goalValue(goal) <= (goal.unit === 'seconds' ? 3600 : 1000) &&
    (goal.unit === 'seconds' ? goal.reps === undefined : goal.seconds === undefined) &&
    Number.isInteger(goal.restSeconds) && goal.restSeconds >= 0 && goal.restSeconds <= 3600 &&
    (goal.options === undefined || (['standard','standing','seated'].includes(goal.options.variant) && ['left','right'].includes(goal.options.side) && ['left','right'].includes(goal.options.facing) && (goal.options.weightKg === undefined || (Number.isFinite(goal.options.weightKg) && goal.options.weightKg > 0 && goal.options.weightKg <= 200))));
}
export function validExerciseGoal(exercise: ExerciseType, goal: TrainingGoal) {
  return !!exerciseRegistry[exercise] && validGoal(goal) && isHold(exercise) === (goal.unit === 'seconds') &&
    (isLegacy(exercise) || (goal.schemaVersion === 2 && !!goal.options && exerciseRegistry[exercise].variants.includes(goal.options.variant)));
}
export interface ObservationSummary {
  readyMs: number; partialMs: number; unavailableMs: number; sampledMs: number;
  sideViewConfirmed: boolean;
}
export interface SetRecord {
  number: number;
  ended: 'completed' | 'interrupted';
  durationMs: number;
  observation: ObservationSummary;
  result: ExerciseResult;
}
export interface SourceContext {
  width: number; height: number; delegate: string; settings: Record<string, string | number>;
}
export interface WorkoutRecord {
  schemaVersion: 1 | 3;
  id: string;
  date: string;
  exercise: ExerciseType;
  mode: InputMode;
  goal: TrainingGoal;
  conditions: string;
  duration: number;
  metadata: { rulesVersion: string; analysisVersion: string; coachingVersion: string;
    variant: { id: string; lowerAngle: number; upperAngle: number; trunkLean?: number; bodyLineDeviation?: number };
    tracking: Record<string, number>; detector: string; sampling: string; source?: SourceContext;
    exerciseSnapshot?: { id: ExerciseType; version: string; unit: 'reps' | 'seconds'; options: ExerciseOptions; thresholds: Record<string, number> } };
  sets: SetRecord[];
}
