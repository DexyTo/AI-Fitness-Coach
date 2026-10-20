import type { ReactNode } from 'react';

type IconName = 'arrow' | 'camera' | 'play' | 'video' | 'squat' | 'pushup' | 'check' | 'history' | 'shield' | 'activity' | 'star' | 'copy' | 'up' | 'down' | 'trash' | 'flag';

const paths: Record<IconName, ReactNode> = {
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
  squat: <><circle cx='11' cy='4' r='2' /><path d='m11 8-2 6 7 2-2 5M9 14l-5 3 3 4M11 8l6 3h4' /></>,
  pushup: <><circle cx='4' cy='8' r='2' /><path d='m7 10 8 3 6 5M8 10l-1 7H3M15 13l-3 5h9' /></>,
  check: <path d='m5 12 4 4L19 6' />,
  history: <><path d='M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2' /></>,
  shield: <><path d='m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z' /><path d='m8 12 3 3 5-6' /></>,
  activity: <><path d='M2 12h4l3-8 6 16 3-8h4' /></>,
};

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>{paths[name]}</svg>;
}
