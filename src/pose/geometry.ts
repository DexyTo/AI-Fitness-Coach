import type { PosePoint } from '../exercises/types';
// Coordinates are normalized: multiplying x by width/height restores on-screen angles.

export function calculateAngle(
  a: PosePoint,
  b: PosePoint,
  c: PosePoint,
  aspect = 1,
): number {
  const x1 = (a.x - b.x) * aspect,
    y1 = a.y - b.y,
    x2 = (c.x - b.x) * aspect,
    y2 = c.y - b.y;
  const n = Math.hypot(x1, y1) * Math.hypot(x2, y2);
  if (n < 1e-8) return NaN;
  return (
    (Math.acos(Math.max(-1, Math.min(1, (x1 * x2 + y1 * y2) / n))) * 180) /
    Math.PI
  );
}

export function distance(a: PosePoint, b: PosePoint, aspect = 1): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

export function smooth(
  previous: number | null,
  value: number,
  weight = 0.42,
): number {
  return previous === null ? value : previous * (1 - weight) + value * weight;
}

export function trunkLean(
  shoulder: PosePoint,
  hip: PosePoint,
  aspect: number,
): number {
  return (
    (Math.atan2(
      Math.abs((shoulder.x - hip.x) * aspect),
      Math.abs(shoulder.y - hip.y),
    ) *
      180) /
    Math.PI
  );
}
