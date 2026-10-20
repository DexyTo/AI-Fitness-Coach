import { observePose, sideView, type BodySide } from '../pose/landmarks';
import { tracking, variant } from './config';
import type {
  CriterionResults, ExerciseAnalyzer, ExerciseAnalysisResult, ExerciseFeedback,
  ExerciseResult, ExerciseType, FeedbackCode, MovementAttempt, ObservationQuality,
  ObservationReason, PoseLandmarks, ExerciseState,
  UnavailableSourceReason,
} from './types';
import { feedbackMessage, reasonText } from './types';

// Cadence guard, not a validated physiological threshold.
export const MAX_OBSERVATION_GAP_MS = tracking.maxGapMs;
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
  evidence: Partial<Record<FeedbackCode, { lastAt: number | null; deviationSince: number | null; observedMs: number }>>;
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
  private prepared = false;
  private recovering = false;
  private viewConfirmed = false;
  private view: ExerciseAnalysisResult['preparation']['view'] = 'unknown';
  private viewReason: ObservationReason | null = null;
  private usableSince: number | null = null;
  private stableTop: { since: number; min: number; max: number } | null = null;
  private unavailableSince: number | null = null;
  private samples: { at: number; angle: number }[] = [];
  private direction: 'up' | 'down' | null = null;
  private directionSince: number | null = null;
  private lowerSince: number | null = null;
  private returnSince: number | null = null;
  private lastAngleAt: number | null = null;
  private upperPeak: number | null = null;
  private pending: PendingAttempt | null = null;
  private result = blank();
  private feedback: ExerciseFeedback[] = [];
  private criteria: CriterionResults = {};
  private observation: ObservationQuality = { status: 'unavailable', side: null, reasons: [{ code: 'no_pose' }] };
  constructor(private readonly exercise: ExerciseType) { this.view = exercise === 'squat' ? 'unknown' : 'not_required'; }
  confirmSideView() { this.viewConfirmed = true; }
  reset() {
    this.resetMotion();
    this.lastTimestamp = null;
    this.lastMotionAt = null;
    this.result = blank();
    this.recovering = false;
    this.viewConfirmed = false;
    this.view = this.exercise === 'squat' ? 'unknown' : 'not_required';
    this.viewReason = null;
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
    this.viewReason = null;
    this.prepared = false;
    this.usableSince = null;
    this.stableTop = null;
    this.unavailableSince = null;
    this.clearTrend();
    this.lowerSince = null;
    this.returnSince = null;
  }
  private clearTrend() {
    this.samples = [];
    this.direction = null;
    this.directionSince = null;
    this.lastAngleAt = null;
  }
  private preparation(): ExerciseAnalysisResult['preparation'] {
    const stage = !this.usable() && (this.prepared || this.recovering)
      ? 'recovering' : this.pending ? 'active' : this.prepared ? 'ready' : this.recovering ? 'recovering' : 'preparing';
    const message = !this.usable()
      ? [...this.observation.reasons, ...(this.viewReason ? [this.viewReason] : [])].map(reasonText).filter((v, i, a) => a.indexOf(v) === i).join(' ')
      : !this.prepared ? 'Удерживайте исходную верхнюю позицию неподвижно: проверяем устойчивость наблюдения.'
      : this.pending ? 'Подход идёт. Сохраняйте положение камеры.' : 'Готово. Исходная позиция подтверждена — можно начинать движение.';
    return { stage, view: this.view, viewConfirmed: this.viewConfirmed, message };
  }
  private usable() { return this.observation.status === 'ready' && !this.viewReason; }
  snapshot(): ExerciseAnalysisResult {
    return structuredClone({
      preparation: this.preparation(),
      state: this.usable() ? this.prepared ? this.phase : 'Подготовка' : 'Оценка приостановлена',
      angle: this.usable() && this.angle !== null ? Math.round(this.angle) : null,
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
    this.recovering = true;
    this.viewConfirmed = false;
    this.criteria = {};
    this.observation = { status: 'unavailable', side: null, reasons: [{ code: 'movement_pending' }] };
    return this.snapshot();
  }
  interrupt(timestamp: number, reason: 'tracking_gap' | 'timeline_reset' | 'session_paused'): ExerciseAnalysisResult {
    if (this.pending) {
      this.invalidatePending({ code: reason });
      this.closeAttempt(reason, Math.max(timestamp, this.lastTimestamp ?? timestamp));
    }
    this.resetMotion();
    this.recovering = true;
    this.viewConfirmed = false;
    this.lastMotionAt = null;
    this.lastTimestamp = timestamp;
    this.criteria = {};
    this.observation = { status: 'unavailable', side: null, reasons: [{ code: reason }] };
    return this.snapshot();
  }
  analyze(points: PoseLandmarks, timestamp: number, aspect: number, sourceReason?: UnavailableSourceReason): ExerciseAnalysisResult {
    if (!Number.isFinite(timestamp)) return this.snapshot();
    // A stalled file can report unavailable at its frozen source timestamp.
    const backwards = this.lastTimestamp !== null && (timestamp < this.lastTimestamp ||
      (timestamp === this.lastTimestamp && !sourceReason));
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
      this.recovering = true;
      this.viewConfirmed = false;
      this.lastMotionAt = null;
    }
    this.lastTimestamp = timestamp;
    const frame = observePose(points, this.exercise, aspect, this.side, sourceReason);
    this.observation = frame.observation;
    this.criteria = frame.criteria;
    this.feedback = [];
    let releaseSide = false;
    this.view = this.exercise === 'squat' ? sideView(points, aspect) : 'not_required';
    this.viewReason = null;
    if (this.exercise === 'squat' && frame.observation.status === 'ready' &&
        (this.view === 'unsuitable' || (this.view === 'unknown' && !this.viewConfirmed))) {
      this.viewReason = { code: this.view === 'unsuitable' ? 'unsuitable_view' : 'view_unknown' };
      // Visible points do not make a projected trunk criterion assessable from any view.
      frame.criteria.lean = { status: 'unassessed', observedFrames: 0,
        reasons: [{ ...this.viewReason, criterion: 'lean' }] };
    }
    if (this.usable()) this.unavailableSince = null;
    else {
      this.unavailableSince ??= timestamp;
      this.usableSince = null;
      this.stableTop = null;
      this.lowerSince = null;
      this.returnSince = null;
      if (timestamp - this.unavailableSince > MAX_OBSERVATION_GAP_MS) {
        if (this.prepared || this.pending) {
          const paused = this.observation;
          const pausedCriteria = this.criteria;
          const pausedViewReason = this.viewReason;
          this.interrupt(timestamp, 'tracking_gap');
          this.observation = paused;
          this.criteria = pausedCriteria;
          this.viewReason = pausedViewReason;
          return this.snapshot();
        }
        // During initial setup, allow a better whole side to be selected next frame.
        this.side = null;
        releaseSide = true;
        this.unavailableSince = timestamp;
      }
    }
    // Keep the selected anatomical chain until a cadence reset. No mid-attempt side mixing.
    if (frame.rawAngle !== null && !releaseSide) this.side = frame.observation.side;
    const reasons = [...frame.observation.reasons, ...(this.viewReason ? [this.viewReason] : [])];
    if (this.pending) this.collect(frame.criteria, reasons, timestamp);
    if (frame.rawAngle === null) {
      this.angle = null;
      this.clearTrend();
      this.lowerSince = null;
      this.returnSince = null;
      return this.snapshot();
    }
    this.lastMotionAt = timestamp;
    const dt = this.lastAngleAt === null ? 0 : timestamp - this.lastAngleAt;
    this.angle = this.angle === null ? frame.rawAngle
      : this.angle + (frame.rawAngle - this.angle) * (1 - Math.exp(-dt / tracking.smoothingMs));
    this.lastAngleAt = timestamp;
    const angle = this.angle;
    this.samples.push({ at: timestamp, angle });
    while (this.samples.length > 2 && this.samples[1].at <= timestamp - tracking.directionWindowMs) this.samples.shift();
    const first = this.samples[0];
    const speed = timestamp > first.at ? (angle - first.angle) * 1000 / (timestamp - first.at) : 0;
    const direction = speed < -tracking.directionSpeed ? 'down' : speed > tracking.directionSpeed ? 'up' : null;
    if (direction !== this.direction) { this.direction = direction; this.directionSince = timestamp; }
    const confirmed = direction !== null && this.directionSince !== null && timestamp - this.directionSince >= tracking.transitionMs;
    const descending = confirmed && direction === 'down';
    const ascending = confirmed && direction === 'up';
    const { lowerAngle: lower, upperAngle: upper } = variant(this.exercise);
    // Preparation observes a fixed provisional top threshold; it never learns a user's
    // arbitrary low pose as an acceptable reference, and never creates attempts.
    if (!this.prepared) {
      const usable = this.usable();
      if (usable) this.usableSince ??= timestamp;
      else this.usableSince = null;
      if (usable && angle >= upper && frame.rawAngle >= upper) {
        this.stableTop ??= { since: timestamp, min: frame.rawAngle, max: frame.rawAngle };
        this.stableTop.min = Math.min(this.stableTop.min, frame.rawAngle);
        this.stableTop.max = Math.max(this.stableTop.max, frame.rawAngle);
        if (this.stableTop.max - this.stableTop.min > tracking.initialRange) this.stableTop = { since: timestamp, min: frame.rawAngle, max: frame.rawAngle };
        if (timestamp - this.stableTop.since >= tracking.initialPositionMs &&
            this.usableSince !== null && timestamp - this.usableSince >= tracking.preparationMs) {
          this.prepared = true;
          this.recovering = false;
          this.armed = true;
          this.upperPeak = angle;
        }
      } else this.stableTop = null;
      return this.snapshot();
    }
    if (!this.pending && angle >= upper && this.usable()) this.upperPeak = Math.max(this.upperPeak ?? angle, angle);
    // A meaningful departure from the observed top also captures shallow attempts.
    // Smaller oscillations are ignored rather than counted once per frame.
    if (!this.pending && this.armed && this.upperPeak !== null && this.upperPeak - angle >= tracking.departure && descending) {
      this.beginAttempt(timestamp, angle);
      this.collect(frame.criteria, reasons, timestamp);
    }
    const active = this.pending;
    if (active) {
      active.minAngle = Math.min(active.minAngle, angle);
      if (angle <= lower && frame.rawAngle <= lower) this.lowerSince ??= timestamp;
      else this.lowerSince = null;
      if (this.lowerSince !== null && timestamp - this.lowerSince >= tracking.positionMs) active.reachedLower = true;
      if (this.phase === 'Опускаетесь' && active.reachedLower) this.phase = 'Нижняя точка';
      if ((this.phase === 'Опускаетесь' || this.phase === 'Нижняя точка') && ascending && angle > active.minAngle + tracking.reversal) {
        this.phase = 'Поднимаетесь';
        active.returnPeak = angle;
        if (!active.reachedLower && !active.missingData) active.criteria.depth!.status = 'deviation';
      }
      if (this.phase === 'Поднимаетесь') {
        active.returnPeak = Math.max(active.returnPeak, angle);
        if (angle >= upper && frame.rawAngle >= upper) this.returnSince ??= timestamp;
        else this.returnSince = null;
        if (this.returnSince !== null && timestamp - this.returnSince >= tracking.positionMs) {
          this.closeAttempt('returned_to_top', timestamp, true);
          this.armed = true;
          this.upperPeak = angle;
        } else if (descending && angle < active.returnPeak - tracking.departure) {
          this.closeAttempt('reversed_before_top', timestamp);
          this.beginAttempt(timestamp, angle);
          this.collect(frame.criteria, reasons, timestamp);
        }
      }
      if (this.pending) {
        this.criteria.depth!.status = this.pending.reachedLower ? 'passed' : 'unassessed';
        if (this.pending.reachedLower) this.criteria.depth!.reasons = [];
        this.criteria.extension!.status = 'unassessed';
        for (const code of ['lean', 'line'] as const) {
          if (this.pending.criteria[code]) this.criteria[code] = structuredClone(this.pending.criteria[code]);
        }
        const codes = Object.entries(this.pending.criteria)
          .filter(([, criterion]) => criterion.status === 'deviation').map(([code]) => code as FeedbackCode);
        if (this.phase === 'Поднимаетесь' && !this.pending.reachedLower && !this.pending.missingData) codes.push('depth');
        this.feedback = [...new Set(codes)].map(code => ({ code, message: feedbackMessage(this.exercise, code) }));
      }
    }
    // Partial frames can identify movement boundaries with visible motion joints, but cannot
    // give technical feedback, display a live angle, or produce an assessed complete repetition.
    if (!this.usable()) this.feedback = [];
    return this.snapshot();
  }
  private beginAttempt(timestamp: number, angle: number) {
    this.pending = { startedAt: timestamp, minAngle: angle, returnPeak: angle, reachedLower: false, missingData: false, missingSince: null, criteria: {}, reasons: [], evidence: {} };
    this.lowerSince = null;
    this.returnSince = null;
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
      if (code === 'lean' || code === 'line') {
        const evidence = active.evidence[code] ?? { lastAt: null, deviationSince: null, observedMs: 0 };
        if (sample.status === 'unassessed') { evidence.lastAt = null; evidence.deviationSince = null; }
        else {
          if (evidence.lastAt !== null) evidence.observedMs += timestamp - evidence.lastAt;
          evidence.lastAt = timestamp;
          if (sample.status === 'deviation') evidence.deviationSince ??= timestamp;
          else evidence.deviationSince = null;
          if (evidence.deviationSince !== null && timestamp - evidence.deviationSince >= tracking.findingMs) accumulated.status = 'deviation';
        }
        if (accumulated.status !== 'deviation') accumulated.status = accumulated.reasons.length || evidence.observedMs < tracking.findingMs ? 'unassessed' : 'passed';
        active.evidence[code] = evidence;
      } else if (accumulated.status !== 'deviation') accumulated.status = accumulated.reasons.length ? 'unassessed' : sample.status;
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
    for (const [code, check] of Object.entries(active.criteria)) {
      if (check.status === 'unassessed' && !check.reasons.length) check.reasons.push({ code: 'movement_pending', criterion: code as FeedbackCode });
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
