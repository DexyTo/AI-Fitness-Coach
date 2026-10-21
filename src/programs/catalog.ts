import type { ProgramPlan } from '../../shared/program';
import { labels } from '../exercises/types';
import { isHold, usesDumbbells } from '../exercises/registry';

export function programCover(plan: Pick<ProgramPlan, 'steps'>): 'holds' | 'dumbbells' | 'floor' | 'bodyweight' {
  const exercises = plan.steps.map(step => step.exercise);
  if (exercises.length && exercises.every(isHold)) return 'holds';
  if (exercises.some(usesDumbbells)) return 'dumbbells';
  if (exercises.length && exercises.every(id => ['pushup', 'forearm_plank', 'glute_bridge'].includes(id))) return 'floor';
  return 'bodyweight';
}

export const programExercises = (plan: ProgramPlan) => [...new Set(plan.steps.map(step => step.exercise))];

export function matchesProgram(plan: ProgramPlan, query: string, exercise: string, steps: string) {
  const exercises = programExercises(plan);
  const text = `${plan.title} ${plan.description} ${exercises.map(id => labels[id]).join(' ')}`.toLocaleLowerCase('ru');
  return text.includes(query.trim().toLocaleLowerCase('ru')) &&
    (exercise === 'all' || (exercise === 'mixed' ? exercises.length > 1 : exercises.some(id => id === exercise))) &&
    (steps === 'all' || (steps === '3+' ? plan.steps.length >= 3 : plan.steps.length === Number(steps)));
}
