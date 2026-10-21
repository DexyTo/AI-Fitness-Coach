import type { ProgramPlan } from '../../shared/program';
import { programCover } from './catalog';

const descriptions = {
  bodyweight: 'Кроссовки, полотенце и коврик для тренировки без веса',
  floor: 'Коврик и полотенце для тренировки на полу',
  dumbbells: 'Пара гантелей для силовой тренировки',
  holds: 'Таймер и коврик для программы удержаний',
};

export function ProgramVisual({ plan }: { plan?: Pick<ProgramPlan, 'steps'> }) {
  const cover = plan ? programCover(plan) : 'bodyweight';
  return <span className={`program-visual program-visual-${cover}`}>
    <img src={`/images/program-${cover}.webp`} alt={descriptions[cover]} loading='lazy' />
  </span>;
}
