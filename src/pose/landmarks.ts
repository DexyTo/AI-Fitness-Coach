import type {
  PoseLandmarks,
  PosePoint,
  LegacyExercise,
  FeedbackCode,
  CriterionResults,
  ObservationQuality,
  ObservationReason,
  UnavailableSourceReason,
} from '../exercises/types';
import { calculateAngle, distance, trunkLean } from './geometry';
import { exerciseVariants, tracking } from '../exercises/config';


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
    Number.isFinite(p.visibility) &&
    (p.visibility ?? 0) >= tracking.visibility &&
    (p.presence === undefined || Number.isFinite(p.presence)) &&
    (p.presence ?? 1) >= tracking.presence &&
    p.x >= tracking.frameMargin &&
    p.x <= 1 - tracking.frameMargin &&
    p.y >= tracking.frameMargin &&
    p.y <= 1 - tracking.frameMargin
  );
}

export type BodySide = 'left' | 'right';

// A 2D projection heuristic, NOT a measurement of body orientation. Occluded far-side
// joints are normal in profile: return unknown, never demand that they become visible.
export function sideView(points: PoseLandmarks, aspect: number): 'side' | 'unsuitable' | 'unknown' {
  if (![11, 12, 23, 24].every(i => visible(points[i])) || !Number.isFinite(aspect) || aspect <= 0) return 'unknown';
  const torso = (distance(points[11], points[23], aspect) + distance(points[12], points[24], aspect)) / 2;
  if (torso < tracking.minTorsoHeight) return 'unknown';
  const widths = [distance(points[11], points[12], aspect), distance(points[23], points[24], aspect)].map(w => w / torso);
  if (widths.every(w => w <= tracking.sideWidthRatio)) return 'side';
  if (widths.every(w => w >= tracking.frontWidthRatio)) return 'unsuitable';
  return 'unknown';
}

export function criterionPoints(exercise: LegacyExercise, side: BodySide): Partial<Record<FeedbackCode, number[]>> {
  const offset = side === 'left' ? 0 : 1;
  const motion = (exercise === 'squat' ? [23, 25, 27] : [11, 13, 15]).map(i => i + offset);
  return {
    depth: motion,
    extension: motion,
    [exercise === 'squat' ? 'lean' : 'line']: (exercise === 'squat' ? [11, 23] : [11, 23, 27]).map(i => i + offset),
  };
}

// Each criterion uses one anatomical side. Never substitute an isolated opposite ankle.
export function observePose(points: PoseLandmarks, exercise: LegacyExercise, aspect: number, preferredSide: BodySide | null, sourceReason?: UnavailableSourceReason) {
  const evaluate = (side: BodySide) => {
    const requirements = criterionPoints(exercise, side);
    const criteria: CriterionResults = {};
    const reasons: ObservationReason[] = [];
    let rawAngle: number | null = null;
    for (const [key, indices] of Object.entries(requirements)) {
      const code = key as FeedbackCode;
      const missing = indices.filter(i => !visible(points[i]));
      let value = NaN;
      if (!missing.length && Number.isFinite(aspect) && aspect > 0) {
        value = code === 'lean'
          ? (distance(points[indices[0]], points[indices[1]], aspect) > 1e-4
              ? trunkLean(points[indices[0]], points[indices[1]], aspect) : NaN)
          : calculateAngle(points[indices[0]], points[indices[1]], points[indices[2]], aspect);
      }
      const reason: ObservationReason | null = !points.length
        ? { code: sourceReason ?? 'no_pose', criterion: code }
        : missing.length ? { code: 'missing_points', criterion: code, landmarks: missing }
        : !Number.isFinite(value) ? { code: 'invalid_geometry', criterion: code } : null;
      if (reason) reasons.push(reason);
      const motion = code === 'depth' || code === 'extension';
      if (motion && !reason) rawAngle = value;
      criteria[code] = {
        status: reason || motion ? 'unassessed'
          : (code === 'lean' ? value > exerciseVariants.squat.trunkLean : Math.abs(180 - value) > exerciseVariants.pushup.bodyLineDeviation) ? 'deviation' : 'passed',
        observedFrames: reason ? 0 : 1,
        reasons: reason ? [reason] : motion ? [{ code: 'movement_pending', criterion: code }] : [],
      };
    }
    const observation: ObservationQuality = {
      status: rawAngle === null ? 'unavailable' : reasons.length ? 'partial' : 'ready',
      side: points.length ? side : null,
      reasons,
    };
    const confidence = [...new Set(Object.values(requirements).flat())]
      .reduce((sum, i) => sum + (visible(points[i]) ? Math.min(points[i].visibility ?? 1, points[i].presence ?? 1) : 0), 0);
    return { observation, criteria, rawAngle, confidence };
  };
  if (preferredSide) return evaluate(preferredSide);
  const candidates = [evaluate('left'), evaluate('right')];
  const rank = { ready: 2, partial: 1, unavailable: 0 };
  return candidates.sort((a, b) => rank[b.observation.status] - rank[a.observation.status] || b.confidence - a.confidence)[0];
}
