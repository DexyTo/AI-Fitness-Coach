import { smooth } from '../pose/geometry';
import { observePose, type BodySide } from '../pose/landmarks';
import type {
  CriterionResults, ExerciseAnalyzer, ExerciseAnalysisResult, ExerciseFeedback,
  ExerciseResult, ExerciseType, FeedbackCode, MovementAttempt, ObservationQuality,
  ObservationReason, PoseLandmarks, ExerciseState,
  UnavailableSourceReason,
} from './types';
import { feedbackMessage } from './types';

// Cadence guard, not a validated physiological threshold.
export const MAX_OBSERVATION_GAP_MS = 700;
const blank = (): ExerciseResult => ({
  reps: 0, incomplete: 0, unassessed: 0, withoutFindings: 0, withErrors: 0, errors: {}, attempts: [],
});
interface PendingAttempt {
  startedAt: number;
  minAngle: number;
  returnPeak: number;
  reachedLower: boolean;
  missingData: boolean;
  missingSince: number | null;
  criteria: CriterionResults;
  reasons: ObservationReason[];
}
function addReason(reasons: ObservationReason[], reason: ObservationReason) {
  if (!reasons.some(r => JSON.stringify(r) === JSON.stringify(reason))) reasons.push(structuredClone(reason));
}

export class MovementAnalyzer implements ExerciseAnalyzer {
  private phase: ExerciseState = 'Готов';
  private angle: number | null = null;
  private lastTimestamp: number | null = null;
  private lastMotionAt: number | null = null;
  private side: BodySide | null = null;
  private armed = false;
  private upperPeak: number | null = null;
  private pending: PendingAttempt | null = null;
  private result = blank();
  private feedback: ExerciseFeedback[] = [];
  private criteria: CriterionResults = {};
  private observation: ObservationQuality = { status: 'unavailable', side: null, reasons: [{ code: 'no_pose' }] };
  constructor(private readonly exercise: ExerciseType) {}
  reset() {
    this.resetMotion();
    this.lastTimestamp = null;
    this.lastMotionAt = null;
    this.result = blank();
    this.criteria = {};
    this.observation = { status: 'unavailable', side: null, reasons: [{ code: 'no_pose' }] };
  }
  private resetMotion() {
    this.phase = 'Готов';
    this.angle = null;
    this.side = null;
    this.armed = false;
    this.upperPeak = null;
    this.pending = null;
    this.feedback = [];
  }
  snapshot(): ExerciseAnalysisResult {
    return structuredClone({
      state: this.observation.status === 'ready' ? this.phase : 'Оценка приостановлена',
      angle: this.observation.status === 'ready' && this.angle !== null ? Math.round(this.angle) : null,
      observation: this.observation, criteria: this.criteria, feedback: this.feedback, result: this.result,
    });
  }
  finish(timestamp: number): ExerciseAnalysisResult {
    if (this.pending) {
      if ((this.lastMotionAt !== null && timestamp - this.lastMotionAt > MAX_OBSERVATION_GAP_MS) ||
          (this.pending.missingSince !== null && timestamp - this.pending.missingSince > MAX_OBSERVATION_GAP_MS)) {
        this.invalidatePending({ code: 'tracking_gap' });
      }
      this.closeAttempt('session_finished', Math.max(timestamp, this.lastTimestamp ?? timestamp));
    }
    this.resetMotion();
    this.criteria = {};
    this.observation = { status: 'unavailable', side: null, reasons: [{ code: 'movement_pending' }] };
    return this.snapshot();
  }
  interrupt(timestamp: number, reason: 'tracking_gap' | 'timeline_reset'): ExerciseAnalysisResult {
    if (this.pending) {
      this.invalidatePending({ code: reason });
      this.closeAttempt(reason, timestamp);
    }
    this.resetMotion();
    this.lastMotionAt = null;
    this.lastTimestamp = timestamp;
    this.criteria = {};
    this.observation = { status: 'unavailable', side: null, reasons: [{ code: reason }] };
    return this.snapshot();
  }
  analyze(points: PoseLandmarks, timestamp: number, aspect: number, sourceReason?: UnavailableSourceReason): ExerciseAnalysisResult {
    if (!Number.isFinite(timestamp)) return this.snapshot();
    const backwards = this.lastTimestamp !== null && timestamp <= this.lastTimestamp;
    const missingSince = this.pending?.missingSince ?? null;
    const gap = (this.lastMotionAt !== null && timestamp - this.lastMotionAt > MAX_OBSERVATION_GAP_MS) ||
      (missingSince !== null && timestamp - missingSince > MAX_OBSERVATION_GAP_MS);
    if (backwards || gap) {
      const code = backwards ? 'timeline_reset' : 'tracking_gap';
      if (this.pending) {
        this.invalidatePending({ code });
        this.closeAttempt(code, backwards ? this.lastTimestamp! : timestamp);
      }
      this.resetMotion();
      this.lastMotionAt = null;
    }
    this.lastTimestamp = timestamp;
    const frame = observePose(points, this.exercise, aspect, this.side, sourceReason);
    this.observation = frame.observation;
    this.criteria = frame.criteria;
    this.feedback = [];
    // Keep the selected anatomical chain until a cadence reset. No mid-attempt side mixing.
    if (frame.rawAngle !== null) this.side = frame.observation.side;
    if (this.pending) this.collect(frame.criteria, frame.observation.reasons, timestamp);
    if (frame.rawAngle === null) {
      this.angle = null;
      return this.snapshot();
    }
    this.lastMotionAt = timestamp;
    const previous = this.angle;
    this.angle = smooth(previous, frame.rawAngle);
    const angle = this.angle;
    const descending = previous !== null && angle < previous - 1.3;
    const ascending = previous !== null && angle > previous + 1.3;
    const lower = this.exercise === 'squat' ? 102 : 98;
    const upper = 158;
    if (!this.pending && angle >= upper) {
      this.armed = true;
      this.upperPeak = Math.max(this.upperPeak ?? angle, angle);
    }
    // A meaningful departure from the observed top also captures shallow attempts.
    // Smaller oscillations are ignored rather than counted once per frame.
    if (!this.pending && this.armed && this.upperPeak !== null && this.upperPeak - angle >= 12 && descending) {
      this.beginAttempt(timestamp, angle);
      this.collect(frame.criteria, frame.observation.reasons, timestamp);
    }
    const active = this.pending;
    if (active) {
      active.minAngle = Math.min(active.minAngle, angle);
      if (angle <= lower) active.reachedLower = true;
      if (this.phase === 'Опускаетесь' && active.reachedLower) this.phase = 'Нижняя точка';
      if ((this.phase === 'Опускаетесь' || this.phase === 'Нижняя точка') && ascending && angle > active.minAngle + 6) {
        this.phase = 'Поднимаетесь';
        active.returnPeak = angle;
        if (!active.reachedLower && !active.missingData) active.criteria.depth!.status = 'deviation';
      }
      if (this.phase === 'Поднимаетесь') {
        active.returnPeak = Math.max(active.returnPeak, angle);
        if (angle >= upper) {
          this.closeAttempt('returned_to_top', timestamp, true);
          this.armed = true;
          this.upperPeak = angle;
        } else if (descending && angle < active.returnPeak - 12) {
          this.closeAttempt('reversed_before_top', timestamp);
          this.beginAttempt(timestamp, angle);
          this.collect(frame.criteria, frame.observation.reasons, timestamp);
        }
      }
      if (this.pending) {
        this.criteria.depth!.status = this.pending.reachedLower ? 'passed' : 'unassessed';
        if (this.pending.reachedLower) this.criteria.depth!.reasons = [];
        this.criteria.extension!.status = 'unassessed';
        const codes = Object.entries(this.pending.criteria)
          .filter(([, criterion]) => criterion.status === 'deviation').map(([code]) => code as FeedbackCode);
        if (this.phase === 'Поднимаетесь' && !this.pending.reachedLower) codes.push('depth');
        if (this.phase === 'Поднимаетесь' && !ascending && angle < upper - 10) codes.push('extension');
        this.feedback = codes.map(code => ({ code, message: feedbackMessage(this.exercise, code) }));
      }
    }
    // Partial frames can identify movement boundaries with visible motion joints, but cannot
    // give technical feedback, display a live angle, or produce an assessed complete repetition.
    if (this.observation.status !== 'ready') this.feedback = [];
    return this.snapshot();
  }
  private beginAttempt(timestamp: number, angle: number) {
    this.pending = { startedAt: timestamp, minAngle: angle, returnPeak: angle, reachedLower: false, missingData: false, missingSince: null, criteria: {}, reasons: [] };
    this.phase = 'Опускаетесь';
    this.armed = false;
    this.upperPeak = null;
  }
  private invalidatePending(reason: ObservationReason) {
    const active = this.pending!;
    active.missingData = true;
    addReason(active.reasons, reason);
    for (const [code, check] of Object.entries(active.criteria)) {
      addReason(check.reasons, { ...reason, criterion: code as FeedbackCode });
      if (check.status !== 'deviation') check.status = 'unassessed';
    }
  }
  private collect(criteria: CriterionResults, reasons: ObservationReason[], timestamp: number) {
    const active = this.pending!;
    if (reasons.length) active.missingData = true;
    active.missingSince = reasons.length ? active.missingSince ?? timestamp : null;
    reasons.forEach(reason => addReason(active.reasons, reason));
    for (const [key, sample] of Object.entries(criteria)) {
      const code = key as FeedbackCode;
      const accumulated = active.criteria[code] ?? { status: 'unassessed', observedFrames: 0, reasons: [] };
      accumulated.observedFrames += sample.observedFrames;
      sample.reasons.filter(r => r.code !== 'movement_pending').forEach(r => addReason(accumulated.reasons, r));
      if (sample.status === 'deviation') accumulated.status = 'deviation';
      else if (accumulated.status !== 'deviation') accumulated.status = accumulated.reasons.length ? 'unassessed' : sample.status;
      active.criteria[code] = accumulated;
    }
  }
  private closeAttempt(endReason: MovementAttempt['endReason'], timestamp: number, returnedToTop = false) {
    const active = this.pending!;
    for (const code of ['depth', 'extension'] as const) {
      const check = active.criteria[code]!;
      const reached = code === 'depth' ? active.reachedLower : returnedToTop;
      check.status = reached ? 'passed' : check.status === 'deviation' ? 'deviation' : active.missingData ? 'unassessed' : 'deviation';
      if (check.status === 'unassessed' && !check.reasons.length) check.reasons.push({ code: 'movement_pending', criterion: code });
    }
    const remarks = (Object.entries(active.criteria).filter(([, c]) => c.status === 'deviation').map(([code]) => code)) as FeedbackCode[];
    const motionComplete = active.reachedLower && returnedToTop;
    const outcome = active.missingData || Object.values(active.criteria).some(c => c.status === 'unassessed')
      ? 'insufficient_data' : motionComplete ? 'complete' : 'incomplete';
    const attempt: MovementAttempt = {
      id: this.result.attempts.length + 1, startedAt: active.startedAt, endedAt: timestamp,
      outcome, endReason, motionComplete, minAngle: Math.round(active.minAngle),
      criteria: structuredClone(active.criteria), remarks, reasons: structuredClone(active.reasons),
    };
    this.result.attempts.push(attempt);
    this.criteria = structuredClone(attempt.criteria);
    if (outcome === 'complete') {
      this.result.reps++;
      if (!remarks.length) this.result.withoutFindings++;
    } else if (outcome === 'incomplete') this.result.incomplete++;
    else this.result.unassessed++;
    if (remarks.length) this.result.withErrors++;
    for (const code of remarks) this.result.errors[code] = (this.result.errors[code] ?? 0) + 1;
    this.feedback = remarks.map(code => ({ code, message: feedbackMessage(this.exercise, code) }));
    this.pending = null;
    this.phase = 'Готов';
  }
}
export function createAnalyzer(exercise: ExerciseType): ExerciseAnalyzer {
  return new MovementAnalyzer(exercise);
}
