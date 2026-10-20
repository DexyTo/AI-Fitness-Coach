import type { ExerciseResult, ExerciseType, InputMode } from '../src/exercises/types.js';
export interface TrainingGoal { sets: number; reps: number; restSeconds: number }
export function validGoal(goal: TrainingGoal) {
  return Number.isInteger(goal.sets) && goal.sets >= 1 && goal.sets <= 100 &&
    Number.isInteger(goal.reps) && goal.reps >= 1 && goal.reps <= 1000 &&
    Number.isInteger(goal.restSeconds) && goal.restSeconds >= 0 && goal.restSeconds <= 3600;
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
  schemaVersion: 1;
  id: string;
  date: string;
  exercise: ExerciseType;
  mode: InputMode;
  goal: TrainingGoal;
  conditions: string;
  duration: number;
  metadata: { rulesVersion: string; analysisVersion: string; coachingVersion: string;
    variant: { id: string; lowerAngle: number; upperAngle: number; trunkLean?: number; bodyLineDeviation?: number };
    tracking: Record<string, number>; detector: string; sampling: string; source?: SourceContext };
  sets: SetRecord[];
}
