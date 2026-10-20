import type { ExerciseType } from './types';

export const RULES_VERSION = 'provisional-side-v1';

// Engineering parameters, in source milliseconds / degrees. These are not form rules.
export const tracking = {
  maxGapMs: 700,
  smoothingMs: 110,
  directionWindowMs: 240,
  directionSpeed: 6,
  transitionMs: 90,
  positionMs: 120,
  preparationMs: 450,
  initialPositionMs: 300,
  initialRange: 8,
  departure: 12,
  reversal: 6,
  findingMs: 300,
  visibility: 0.55,
  presence: 0.5,
  frameMargin: 0.02,
  // Projected shoulder AND hip width / torso length: deliberately has an unknown band.
  sideWidthRatio: 0.65,
  frontWidthRatio: 0.95,
  minTorsoHeight: 0.05,
} as const;

// Provisional 2D criteria. Not validated on people; never calibrated from arbitrary motion.
export const exerciseVariants = {
  squat: { id: 'bodyweight-side', lowerAngle: 102, upperAngle: 158, trunkLean: 43 },
  pushup: { id: 'pushup-side', lowerAngle: 98, upperAngle: 158, bodyLineDeviation: 27 },
} as const;

export function variant(exercise: ExerciseType) { return exerciseVariants[exercise]; }
