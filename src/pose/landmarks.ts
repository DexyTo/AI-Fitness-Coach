import type {
  PoseLandmarks,
  PosePoint,
  ExerciseType,
} from '../exercises/types';


export const L = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

export const edges: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];

export function visible(p?: PosePoint): p is PosePoint {
  return (
    !!p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    (p.visibility ?? 1) >= 0.55 &&
    (p.presence ?? 1) >= 0.5 &&
    p.x >= 0.02 &&
    p.x <= 0.98 &&
    p.y >= 0.02 &&
    p.y <= 0.98
  );
}

export function goodSide(
  points: PoseLandmarks,
  exercise: ExerciseType,
): [number, number, number, number] | null {
  const sides: [number, number, number, number][] =
    exercise === 'squat'
      ? [
          [11, 23, 25, 27],
          [12, 24, 26, 28],
        ]
      : [
          [11, 13, 15, 23],
          [12, 14, 16, 24],
        ];
  const valid = sides.filter((side) => side.every((i) => visible(points[i])));
  if (!valid.length) return null;
  return valid.sort(
    (a, b) =>
      b.reduce((s, i) => s + (points[i].visibility ?? 1), 0) -
      a.reduce((s, i) => s + (points[i].visibility ?? 1), 0),
  )[0];
}

export function fullBodyInFrame(points: PoseLandmarks): boolean {
  return (
    ([11, 12, 23, 24, 25, 26, 27, 28] as number[]).filter((i) =>
      visible(points[i]),
    ).length >= 6 && ([27, 28] as number[]).some((i) => visible(points[i]))
  );
}
