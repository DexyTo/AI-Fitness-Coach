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
  // Match the local source photos so instructional views need no crop or filler.
  const portrait = exercise === 'squat' || exercise === 'reverse_lunge';
  return <span className={`exercise-visual visual-${exercise} ${className}`} style={{ '--exercise-aspect': portrait ? '2 / 3' : '3 / 2' } as CSSProperties}>
    <img src={photo} alt={labels[exercise]} width={portrait ? 800 : 1200} height={portrait ? 1200 : 800} loading='lazy' />
  </span>;
}
