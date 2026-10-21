import type { ExerciseType } from '../exercises/types';
import type { CSSProperties } from 'react';
import { labels } from '../exercises/types';
import { exercisePose } from '../pose/exerciseDemo';
import { usesDumbbells } from '../exercises/registry';

export const muscleGroups: Record<ExerciseType, string> = {
  squat: 'Ноги · Ягодицы', pushup: 'Грудь · Руки · Корпус', reverse_lunge: 'Ноги · Ягодицы',
  forearm_plank: 'Корпус', glute_bridge: 'Ягодицы · Ноги', wall_sit: 'Ноги',
  overhead_press: 'Плечи · Руки', front_hold: 'Плечи · Корпус', side_bend: 'Корпус', lateral_raise: 'Плечи · Руки',
};
export function ExerciseVisual({ exercise, className = '' }: { exercise: ExerciseType; className?: string }) {
  const hasPhoto = ['squat', 'pushup', 'reverse_lunge', 'forearm_plank'].includes(exercise);
  const photo = `/images/${exercise}.webp`;
  return <span className={`exercise-visual visual-${exercise} ${hasPhoto ? 'exercise-photo' : ''} ${className}`} style={hasPhoto ? { '--exercise-photo': `url("${photo}")` } as CSSProperties : undefined}>
    {hasPhoto ? <img src={photo} alt={labels[exercise]} loading='lazy' /> : <ExerciseIllustration exercise={exercise} />}
  </span>;
}

function ExerciseIllustration({ exercise }: { exercise: ExerciseType }) {
  const points = exercisePose(exercise, exercise === 'side_bend' ? .8 : 1);
  const pos = (i: number) => `${points[i].x * 300},${points[i].y * 185}`;
  const lying = exercise === 'glute_bridge';
  const headX = lying ? points[11].x * 300 - 20 : (points[11].x + points[12].x) * 150;
  const headY = lying ? points[11].y * 185 + 3 : points[11].y * 185 - 21;
  return <svg className='exercise-illustration' viewBox='0 0 300 200' role='img' aria-label={`Схема: ${labels[exercise]}`}>
    <ellipse cx='150' cy='189' rx='100' ry='5' fill='#d5d8dd' opacity='.45' />
    {exercise === 'wall_sit' && <path d='M111 30v145' stroke='#c5cbd2' strokeWidth='5' />}
    {lying && <rect x='45' y='169' width='215' height='5' rx='2' fill='#c2c9cd' />}
    <g strokeLinecap='round' strokeLinejoin='round' fill='none'>
      {[1, 0].map(side => <g key={side} opacity={side ? .65 : 1}><polyline points={`${pos(23 + side)} ${pos(25 + side)} ${pos(27 + side)}`} stroke={side ? '#414954' : '#222a34'} strokeWidth='14' /><polyline points={`${pos(11 + side)} ${pos(13 + side)} ${pos(15 + side)}`} stroke='#c5a389' strokeWidth='8' /><line x1={points[27 + side].x * 300 - 1} y1={points[27 + side].y * 185 + 4} x2={points[27 + side].x * 300 + 13} y2={points[27 + side].y * 185 + 4} stroke='#fcfcfc' strokeWidth='8' /></g>)}
      <polygon points={`${pos(11)} ${pos(12)} ${pos(24)} ${pos(23)}`} stroke='#303946' strokeWidth='13' fill='#303946' />
      <circle cx={headX} cy={headY} r='12' fill='#c5a389' />
      <path d={`M${headX - 11} ${headY - 3}q-3 -18 15 -13q11 3 8 14`} stroke='#4b413d' strokeWidth='7' />
      {usesDumbbells(exercise) && [15, 16].map(i => <g key={i} stroke='#717b89' strokeWidth='4'><line x1={points[i].x * 300 - 10} x2={points[i].x * 300 + 10} y1={points[i].y * 185} y2={points[i].y * 185} /><path d={`M${points[i].x * 300 - 9} ${points[i].y * 185 - 6}v12m18 -12v12`} strokeWidth='6' /></g>)}
    </g>
  </svg>;
}
