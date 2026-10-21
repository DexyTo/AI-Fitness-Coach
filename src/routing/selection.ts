import { exerciseIds, type ExerciseType, type InputMode } from '../exercises/types';

export interface TrainingSelection { exercise: ExerciseType; mode: InputMode }

export function readSelection(search: string): TrainingSelection {
  const params = new URLSearchParams(search);
  return {
    exercise: exerciseIds.includes(params.get('exercise') as ExerciseType) ? params.get('exercise') as ExerciseType : 'squat',
    mode: params.get('mode') === 'video' ? 'video' : params.get('mode') === 'demo' ? 'demo' : 'camera',
  };
}

export function selectionSearch(selection: TrainingSelection) {
  return `?${new URLSearchParams({ exercise: selection.exercise, mode: selection.mode }).toString()}`;
}
