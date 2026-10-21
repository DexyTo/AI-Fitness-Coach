import type { ExerciseType } from '../exercises/types';
import type { CSSProperties } from 'react';
import { labels } from '../exercises/types';

export const muscleGroups: Record<ExerciseType, string> = {
  squat: 'Ноги · Ягодицы', pushup: 'Грудь · Руки · Корпус', reverse_lunge: 'Ноги · Ягодицы',
  forearm_plank: 'Корпус', glute_bridge: 'Ягодицы · Ноги', wall_sit: 'Ноги',
  overhead_press: 'Плечи · Руки', front_hold: 'Плечи · Корпус', side_bend: 'Корпус', lateral_raise: 'Плечи · Руки',
};
export function ExerciseVisual({ exercise, className = '' }: { exercise: ExerciseType; className?: string }) {
  const photo = `/images/${exercise}.webp`;
  return <span className={`exercise-visual visual-${exercise} exercise-photo ${className}`} style={{ '--exercise-photo': `url("${photo}")` } as CSSProperties}>
    <img src={photo} alt={labels[exercise]} loading='lazy' />
  </span>;
}
