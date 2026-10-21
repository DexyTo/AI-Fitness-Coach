import type { ExerciseType } from '../exercises/types';
import type { ReactNode } from 'react';

type IconName = ExerciseType | 'home' | 'search' | 'bell' | 'user' | 'settings' | 'volume' | 'volume-off' | 'pause' | 'clock' | 'chevron' | 'arrow' | 'camera' | 'play' | 'video' | 'squat' | 'pushup' | 'check' | 'history' | 'shield' | 'activity' | 'star' | 'copy' | 'up' | 'down' | 'trash' | 'flag';

const paths: Partial<Record<IconName, ReactNode>> = {
  home: <><path d='m3 10 9-7 9 7v11h-6v-7H9v7H3Z'/></>,
  search: <><circle cx='10.5' cy='10.5' r='6.5'/><path d='m16 16 5 5'/></>,
  bell: <><path d='M5 17h14l-2-3V9a5 5 0 0 0-10 0v5ZM10 21h4'/></>,
  user: <><circle cx='12' cy='7' r='4'/><path d='M4 21v-2a8 8 0 0 1 16 0v2Z'/></>,
  settings: <><path d='M4 7h16M4 17h16'/><circle cx='9' cy='7' r='3' fill='var(--surface)'/><circle cx='15' cy='17' r='3' fill='var(--surface)'/></>,
  volume: <><path d='M3 9v6h4l5 4V5L7 9ZM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14'/></>,
  'volume-off': <><path d='M3 9v6h4l5 4V5L7 9Z' /><path d='m16 9 6 6m0-6-6 6' /></>,
  pause: <><rect x='6' y='5' width='4' height='14' rx='1' fill='currentColor' stroke='none' /><rect x='14' y='5' width='4' height='14' rx='1' fill='currentColor' stroke='none' /></>,
  clock: <><circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/></>,
  chevron: <path d='m9 5 7 7-7 7'/>,
  flag: <path d='M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0'/>,
  star: <path d='m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z' />,
  copy: <><rect x='8' y='8' width='13' height='13' rx='2'/><path d='M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3'/></>,
  up: <path d='M12 20V4m-6 6 6-6 6 6'/>,
  down: <path d='M12 4v16m-6-6 6 6 6-6'/>,
  trash: <><path d='M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'/></>,
  arrow: <><path d='M5 12h14M13 6l6 6-6 6' /></>,
  camera: <><rect x='3' y='6' width='13' height='12' rx='3' /><path d='m16 10 5-3v10l-5-3' /></>,
  play: <><circle cx='12' cy='12' r='9' /><path d='m10 8 6 4-6 4Z' /></>,
  video: <><rect x='4' y='3' width='16' height='18' rx='3' /><path d='m10 9 5 3-5 3Z' /></>,
  squat: <g transform='rotate(-35 12 12)'><rect x='4' y='7' width='4' height='10' rx='1' /><rect x='16' y='7' width='4' height='10' rx='1' /><path d='M8 12h8M2 10v4m20-4v4' /></g>,
  pushup: <><circle cx='4' cy='8' r='2' /><path d='m7 10 8 3 6 5M8 10l-1 7H3M15 13l-3 5h9' /></>,
  check: <path d='m5 12 4 4L19 6' />,
  history: <><path d='M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2' /></>,
  shield: <><path d='m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z' /><path d='m8 12 3 3 5-6' /></>,
  activity: <><path d='M2 12h4l3-8 6 16 3-8h4' /></>,
};

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>{paths[name] ?? <><circle cx='12' cy='4' r='2'/><path d='M12 8v6m-6-4 6 2 6-2m-6 4-4 7m4-7 4 7'/></>}</svg>;
}
