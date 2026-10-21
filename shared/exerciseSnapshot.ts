import { exerciseRegistry, MULTI_RULES_VERSION, optionsFor } from '../src/exercises/registry.js';
import type { ExerciseType } from '../src/exercises/types.js';
import type { TrainingGoal } from './workout.js';
export const exerciseSnapshot = (exercise:ExerciseType,goal:TrainingGoal) => ({id:exercise,version:MULTI_RULES_VERSION,unit:exerciseRegistry[exercise].unit,options:optionsFor(exercise,goal.options),thresholds:structuredClone(exerciseRegistry[exercise].thresholds)});
