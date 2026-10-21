import { exerciseDemo } from './exerciseDemo';
import { isLegacy } from '../exercises/registry';
import type { ExerciseOptions } from '../exercises/types';
export type DemoScenario = 'normal' | 'occlusion' | 'no_pose' | 'source_gap';
export function demoObservation(type:ExerciseType,elapsedMs:number,scenario:DemoScenario='normal',options?:Partial<ExerciseOptions>): {points:PoseLandmarks;sourceReason?:'source_unavailable'} {
  const points=demoPose(type,elapsedMs,options),time=elapsedMs%9000;
  if(time>=2400&&time<4300) {
    if(scenario==='no_pose')return {points:[]};
    if(scenario==='source_gap')return {points:[],sourceReason:'source_unavailable'};
    if(scenario==='occlusion')for(const i of [11,12])points[i].visibility=0;
  }
  return {points};
}
import type {
  ExerciseType,
  PoseLandmarks,
  PosePoint,
} from '../exercises/types';

function point(x: number, y: number): PosePoint {
  return { x, y, z: 0, visibility: 1, presence: 1 };
}

// A generated sequence of landmarks. The demo is explicitly a simulation, never attributed to the ML model.
export function demoPose(type: ExerciseType, elapsedMs: number, options?:Partial<ExerciseOptions>): PoseLandmarks {
  if(!isLegacy(type))return exerciseDemo(type,elapsedMs,options);
  const t = (elapsedMs % 3600) / 3600;
  const ease = (v: number) => v * v * (3 - 2 * v);
  const depth =
    t < 0.13
      ? 0
      : t < 0.46
        ? ease((t - 0.13) / 0.33)
        : t < 0.56
          ? 1
          : t < 0.91
            ? 1 - ease((t - 0.56) / 0.35)
            : 0;
  const p: PoseLandmarks = Array.from({ length: 33 }, () => point(-1, -1));
  for (const shift of [-0.025, 0.025]) {
    const left = shift < 0;
    const [s, e, w, h, k, a] = left
      ? [11, 13, 15, 23, 25, 27]
      : [12, 14, 16, 24, 26, 28];
    if (type === 'squat') {
      p[s] = point(0.48 + shift - 0.032 * depth, 0.24 + 0.13 * depth);
      p[e] = point(0.6 + shift - 0.032 * depth, 0.29 + 0.13 * depth);
      p[w] = point(0.73 + shift - 0.032 * depth, 0.28 + 0.13 * depth);
      p[h] = point(0.49 + shift, 0.46 + 0.16 * depth);
      p[k] = point(0.51 + shift + 0.12 * depth, 0.68 + 0.04 * depth);
      p[a] = point(0.52 + shift, 0.9);
    } else {
      const shoulderX = 0.36 + shift - 0.075 * depth;
      const shoulderY = 0.45 + 0.23 * depth;
      const hipX = 0.58 + shift - 0.02 * depth;
      const ankleX = 0.85 + shift;
      const ankleY = 0.85;
      const bodyY = (x: number) =>
        shoulderY +
        ((ankleY - shoulderY) * (x - shoulderX)) / (ankleX - shoulderX);
      p[s] = point(shoulderX, shoulderY);
      p[e] = point(0.38 + shift, 0.65 + 0.03 * depth);
      p[w] = point(0.39 + shift, 0.85);
      p[h] = point(hipX, bodyY(hipX));
      p[k] = point(0.72 + shift, bodyY(0.72 + shift));
      p[a] = point(ankleX, ankleY);
    }
  }
  p[0] =
    type === 'squat'
      ? point(0.48 - 0.03 * depth, 0.15 + 0.13 * depth)
      : point(0.29 - 0.07 * depth, 0.43 + 0.23 * depth);
  return p;
}
