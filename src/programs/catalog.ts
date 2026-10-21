import type { ProgramPlan } from '../../shared/program';
import { labels } from '../exercises/types';

export const programExercises = (plan: ProgramPlan) => [...new Set(plan.steps.map(step => step.exercise))];

export function matchesProgram(plan: ProgramPlan, query: string, exercise: string, steps: string) {
  const exercises = programExercises(plan);
  const text = `${plan.title} ${plan.description} ${exercises.map(id => labels[id]).join(' ')}`.toLocaleLowerCase('ru');
  return text.includes(query.trim().toLocaleLowerCase('ru')) &&
    (exercise === 'all' || (exercise === 'mixed' ? exercises.length > 1 : exercises.some(id => id === exercise))) &&
    (steps === 'all' || (steps === '3+' ? plan.steps.length >= 3 : plan.steps.length === Number(steps)));
}
