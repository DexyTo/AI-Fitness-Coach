import type { WorkoutRecord, TrainingGoal } from './workout.js';
import { validGoal } from './workout.js';
import { isWorkoutRecord } from './historyValidation.js';

export interface ProgramStep { id: string; exercise: WorkoutRecord['exercise']; goal: TrainingGoal; transitionSeconds: number }
export interface ProgramPlan {
  schemaVersion: 1; id: string; version: number; origin: 'catalog' | 'personal'; ownerId: string | null;
  title: string; description: string; steps: ProgramStep[];
}
export interface ProgramSnapshot { kind: 'program'; program: ProgramPlan; mode: 'camera' | 'demo'; conditions: string }
export interface ProgramRecord {
  schemaVersion: 2; kind: 'program'; id: string; date: string; mode: 'camera' | 'demo'; conditions: string;
  program: ProgramPlan; ended: 'completed' | 'interrupted'; duration: number; steps: WorkoutRecord[];
}
export type HistoryRecord = WorkoutRecord | ProgramRecord;
export const isProgram = (record: HistoryRecord): record is ProgramRecord => record.schemaVersion === 2;
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = Object.keys(a), y = Object.keys(b);
  return x.length === y.length && x.every(k => Object.hasOwn(b,k) && same((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));
};
export function validPlan(plan: ProgramPlan) {
  return plan.schemaVersion === 1 && ['catalog','personal'].includes(plan.origin) &&
    typeof plan.id === 'string' && plan.id.length > 0 && plan.id.length <= 128 &&
    Number.isInteger(plan.version) && plan.version >= 1 &&
    typeof plan.title === 'string' && plan.title.trim().length > 0 && plan.title.length <= 100 &&
    typeof plan.description === 'string' && plan.description.length <= 1000 &&
    (plan.origin === 'catalog' ? plan.ownerId === null : typeof plan.ownerId === 'string') &&
    Array.isArray(plan.steps) && plan.steps.length >= 1 && plan.steps.length <= 12 &&
    new Set(plan.steps.map(s => s.id)).size === plan.steps.length && plan.steps.every(s =>
      typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 64 && ['squat','pushup'].includes(s.exercise) &&
      validGoal(s.goal) && Number.isInteger(s.transitionSeconds) && s.transitionSeconds >= 0 && s.transitionSeconds <= 3600);
}
export const stepCompleted = (record: WorkoutRecord) => record.sets.length === record.goal.sets && record.sets.every(s => s.ended === 'completed');
export function validProgramRecord(record: ProgramRecord) {
  try {
    if (record.schemaVersion !== 2 || record.kind !== 'program' || !validPlan(record.program) ||
      typeof record.id !== 'string' || !record.id || record.id.length > 100 ||
      !Number.isFinite(Date.parse(record.date)) || !['camera','demo'].includes(record.mode) ||
      typeof record.conditions !== 'string' || record.conditions.length > 200 ||
      !Number.isFinite(record.duration) || record.duration < 0 || record.duration > 604800 ||
      !['completed','interrupted'].includes(record.ended) || !Array.isArray(record.steps) || record.steps.length > record.program.steps.length) return false;
    let duration = 0, attempts = 0, previousDate = Date.parse(record.date);
    for (const [index,child] of record.steps.entries()) {
      const step = record.program.steps[index];
      if (!isWorkoutRecord(child) || child.id !== `${record.id}:${index}` || child.exercise !== step.exercise ||
        child.mode !== record.mode || child.conditions !== record.conditions || !same(child.goal,step.goal) ||
        Date.parse(child.date) < previousDate || Date.parse(child.date) + child.duration * 1000 > Date.parse(record.date) + record.duration * 1000 + 1000 ||
        (index < record.steps.length - 1 && !stepCompleted(child)) ||
        child.sets.some(s => s.observation.sampledMs > s.durationMs + 1) ||
        child.sets.reduce((n,s) => n+s.durationMs,0) > child.duration*1000+1) return false;
      previousDate = Date.parse(child.date) + child.duration * 1000;
      duration += child.duration;
      attempts += child.sets.reduce((n,s) => n+s.result.attempts.length,0);
    }
    return duration <= record.duration + .001 && attempts <= 5000 &&
      (record.ended !== 'completed' || (record.steps.length === record.program.steps.length && record.steps.every(stepCompleted)));
  } catch { return false; }
}
