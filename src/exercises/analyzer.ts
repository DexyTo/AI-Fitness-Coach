import { calculateAngle, smooth, trunkLean } from '../pose/geometry';
import { goodSide, L, visible } from '../pose/landmarks';
import type {
  ExerciseAnalyzer,
  ExerciseAnalysisResult,
  ExerciseFeedback,
  ExerciseResult,
  ExerciseType,
  FeedbackCode,
  PoseLandmarks,
  ExerciseState,
} from './types';
import { feedbackText } from './types';


const blank = (): ExerciseResult => ({
  reps: 0,
  correct: 0,
  withErrors: 0,
  scoreSum: 0,
  errors: {},
});

export class MovementAnalyzer implements ExerciseAnalyzer {
  private phase: ExerciseState = 'Готов';
  private angle: number | null = null;
  private previousAngle: number | null = null;
  private lastTimestamp = 0;
  private bottomSince = 0;
  private lastHintAt = 0;
  private recentHint: ExerciseFeedback | null = null;
  private minAngle = 180;
  private faults = new Set<FeedbackCode>();
  private result = blank();
  private feedback: ExerciseFeedback[] = [];
  constructor(private readonly exercise: ExerciseType) {}
  reset() {
    this.phase = 'Готов';
    this.angle = null;
    this.previousAngle = null;
    this.lastTimestamp = 0;
    this.bottomSince = 0;
    this.lastHintAt = 0;
    this.recentHint = null;
    this.minAngle = 180;
    this.faults.clear();
    this.feedback = [];
    this.result = blank();
  }
  snapshot(): ExerciseAnalysisResult {
    const score = this.result.reps
      ? Math.round(this.result.scoreSum / this.result.reps)
      : 100;
    return {
      state: this.phase,
      angle: this.angle === null ? null : Math.round(this.angle),
      score,
      feedback: [...this.feedback],
      result: { ...this.result, errors: { ...this.result.errors } },
    };
  }
  analyze(
    points: PoseLandmarks,
    timestamp: number,
    aspect: number,
  ): ExerciseAnalysisResult {
    const side = goodSide(points, this.exercise);
    if (!side) return this.snapshot();
    const a = this.exercise === 'squat' ? points[side[1]] : points[side[0]];
    const b = this.exercise === 'squat' ? points[side[2]] : points[side[1]];
    const c = this.exercise === 'squat' ? points[side[3]] : points[side[2]];
    const raw = calculateAngle(a, b, c, aspect);
    if (!Number.isFinite(raw)) return this.snapshot();
    // Ignore stale cadence; camera pause or video seek must not create a false repetition.
    if (
      this.lastTimestamp &&
      (timestamp <= this.lastTimestamp || timestamp - this.lastTimestamp > 700)
    ) {
      this.angle = raw;
      this.previousAngle = null;
      this.phase = 'Готов';
      this.minAngle = 180;
      this.faults.clear();
      this.bottomSince = 0;
    }
    this.lastTimestamp = timestamp;
    this.previousAngle = this.angle;
    this.angle = smooth(this.angle, raw);
    const angle = this.angle;
    const descending =
      this.previousAngle !== null && angle < this.previousAngle - 1.3;
    const ascending =
      this.previousAngle !== null && angle > this.previousAngle + 1.3;
    const upper = this.exercise === 'squat' ? 158 : 158;
    const lower = this.exercise === 'squat' ? 102 : 98;
    const begin = this.exercise === 'squat' ? 145 : 145;
    this.feedback =
      this.recentHint && timestamp - this.lastHintAt < 2200
        ? [this.recentHint]
        : [];
    if (this.phase === 'Готов' && angle < begin && descending) {
      this.phase = 'Опускаетесь';
      this.minAngle = angle;
      this.faults.clear();
      this.bottomSince = 0;
    }
    if (
      this.phase === 'Опускаетесь' ||
      this.phase === 'Нижняя точка' ||
      this.phase === 'Поднимаетесь'
    ) {
      this.minAngle = Math.min(this.minAngle, angle);
      if (this.exercise === 'squat') {
        if (trunkLean(points[side[0]], points[side[1]], aspect) > 43)
          this.faults.add('lean');
      } else {
        const ankle =
          points[side[0] === L.leftShoulder ? L.leftAnkle : L.rightAnkle];
        if (
          visible(ankle) &&
          Math.abs(
            180 -
              calculateAngle(points[side[0]], points[side[3]], ankle, aspect),
          ) > 27
        )
          this.faults.add('line');
      }
      if (this.phase === 'Опускаетесь' && angle <= lower) {
        this.phase = 'Нижняя точка';
        this.bottomSince = timestamp;
      } else if (
        this.phase === 'Опускаетесь' &&
        ascending &&
        this.previousAngle !== null &&
        angle > this.minAngle + 12
      ) {
        this.phase = 'Поднимаетесь';
        this.faults.add('depth');
      } else if (
        this.phase === 'Нижняя точка' &&
        ascending &&
        timestamp - this.bottomSince >= 90
      )
        this.phase = 'Поднимаетесь';
      if (this.phase === 'Поднимаетесь' && angle >= upper) {
        if (this.minAngle <= lower) this.complete();
        else {
          this.recentHint = {
            code: 'depth',
            message:
              this.exercise === 'squat'
                ? feedbackText.depth
                : 'Опускайтесь ниже в отжимании.',
          };
          this.feedback = [this.recentHint];
          this.lastHintAt = timestamp;
        }
        this.phase = 'Готов';
        this.minAngle = 180;
        this.faults.clear();
      } else if (
        this.phase === 'Поднимаетесь' &&
        angle < upper - 10 &&
        timestamp - this.lastHintAt > 2500 &&
        !ascending
      ) {
        this.recentHint = {
          code: 'extension',
          message:
            this.exercise === 'squat'
              ? feedbackText.extension
              : 'Полностью выпрямите руки.',
        };
        this.feedback = [this.recentHint];
        this.lastHintAt = timestamp;
      }
      if (!this.feedback.length)
        this.feedback = [...this.faults].map((code) => ({
          code,
          message: feedbackText[code],
        }));
    }
    return this.snapshot();
  }
  private complete() {
    const codes = [...this.faults].filter((c) => c !== 'depth');
    const penalties: Record<FeedbackCode, number> = {
      depth: 25,
      lean: 18,
      extension: 12,
      line: 20,
    };
    const score = Math.max(
      0,
      100 - codes.reduce((sum, code) => sum + penalties[code], 0),
    );
    this.result.reps++;
    this.result.scoreSum += score;
    if (codes.length) {
      this.result.withErrors++;
      for (const code of codes)
        this.result.errors[code] = (this.result.errors[code] ?? 0) + 1;
    } else this.result.correct++;
  }
}
export function createAnalyzer(exercise: ExerciseType): ExerciseAnalyzer {
  return new MovementAnalyzer(exercise);
}
