import { exerciseRegistry, isLegacy, MULTI_RULES_VERSION, optionsFor } from '../exercises/registry';
import { multiTiming } from '../exercises/multiAnalyzer';
import { createAnalyzer } from '../exercises/analyzer';
import { RULES_VERSION, tracking, variant } from '../exercises/config';
import { COACHING_POLICY_VERSION } from '../exercises/coaching';
import type { ExerciseAnalysisResult, ExerciseResult, ExerciseType, InputMode, PoseLandmarks, UnavailableSourceReason } from '../exercises/types';

export const SCHEMA_VERSION = 1;
export const ANALYSIS_VERSION = 'training-session-v1';
export type SessionPhase = 'preparing' | 'active' | 'paused' | 'rest' | 'next' | 'completed';
export const phaseLabels: Record<SessionPhase, string> = {
  preparing: 'Подготовка', active: 'Активный подход', paused: 'Пауза', rest: 'Отдых', next: 'Следующий подход', completed: 'Завершение',
};
export const modeLabels: Record<InputMode, string> = { camera: 'Живая тренировка', video: 'Анализ записи', demo: 'Синтетическое демо' };
export { validGoal } from '../../shared/workout';
export type { TrainingGoal, ObservationSummary, SetRecord, SourceContext, WorkoutRecord } from '../../shared/workout';
import { goalReached, validExerciseGoal, type TrainingGoal, type ObservationSummary, type SetRecord, type SourceContext, type WorkoutRecord } from '../../shared/workout';
export const emptyResult = (): ExerciseResult => ({ reps: 0, incomplete: 0, unassessed: 0, withoutFindings: 0, withErrors: 0, errors: {}, attempts: [] });
export function combineResults(results: ExerciseResult[]): ExerciseResult {
  const all = emptyResult();
  for (const result of results) {
    if (result.hold) {
      all.kind='hold';all.hold ??= {creditedMs:0,longestMs:0,deviationMs:0,unassessedMs:0,intervals:[]};
      all.hold.creditedMs+=result.hold.creditedMs;all.hold.longestMs=Math.max(all.hold.longestMs,result.hold.longestMs);
      all.hold.deviationMs+=result.hold.deviationMs;all.hold.unassessedMs+=result.hold.unassessedMs;all.hold.intervals.push(...structuredClone(result.hold.intervals));
    }
    if(result.sides){all.sides??={left:0,right:0};all.sides.left+=result.sides.left;all.sides.right+=result.sides.right;}
    for (const key of ['reps', 'incomplete', 'unassessed', 'withoutFindings', 'withErrors'] as const) all[key] += result[key];
    for (const [code, count] of Object.entries(result.errors)) all.errors[code as keyof typeof all.errors] = (all.errors[code as keyof typeof all.errors] ?? 0) + count;
    for (const attempt of result.attempts) all.attempts.push({ ...structuredClone(attempt), id: all.attempts.length + 1 });
  }
  return all;
}

// Owns all transitions, including automatic target completion. No frames reach the
// analyzer during pause/rest/next; every continuation requires fresh preparation.
export class TrainingController {
  analyzer;
  phase: SessionPhase = 'preparing';
  sets: SetRecord[] = [];
  private restUntil = 0;
  private setStart: number;
  private lastSample: { at: number; status: 'ready' | 'partial' | 'unavailable' } | null = null;
  private observation: ObservationSummary = this.blankObservation();
  private final: WorkoutRecord | null = null;
  private lastSourceTime = 0;
  private readonly exerciseSnapshot;

  constructor(readonly exercise: ExerciseType, readonly mode: InputMode, readonly goal: TrainingGoal,
    readonly conditions: string, private startAt: number, private date = new Date().toISOString(), private id: string = crypto.randomUUID(), private source?: SourceContext) {
    if (!validExerciseGoal(exercise, goal)) throw new Error('Проверьте цель: подходы 1–100, повторы 1–1000, отдых 0–3600 секунд.');
    this.exerciseSnapshot={id:exercise,version:MULTI_RULES_VERSION,unit:exerciseRegistry[exercise].unit,options:optionsFor(exercise,goal.options),thresholds:structuredClone(exerciseRegistry[exercise].thresholds)};
    this.goal = structuredClone(goal);
    this.analyzer = createAnalyzer(exercise, goal.options);
    this.setStart = startAt;
  }
  private blankObservation(): ObservationSummary { return { readyMs: 0, partialMs: 0, unavailableMs: 0, sampledMs: 0, sideViewConfirmed: false }; }
  get acceptsFrames() { return this.phase === 'preparing' || this.phase === 'active'; }
  get currentSet() { return this.sets.length + (this.phase === 'completed' || this.phase === 'rest' ? 0 : 1); }
  remainingRest(now: number) { this.advance(now); return Math.max(0, Math.ceil((this.restUntil - now) / 1000)); }
  advance(now: number) { if (this.phase === 'rest' && now >= this.restUntil) this.phase = 'next'; }
  sample(points: PoseLandmarks, sourceTime: number, aspect: number, now: number, reason?: UnavailableSourceReason): ExerciseAnalysisResult {
    this.advance(now);
    if (!this.acceptsFrames) return this.analyzer.snapshot();
    this.lastSourceTime = sourceTime;
    const current = this.analyzer.analyze(points, sourceTime, aspect, reason);
    if (this.lastSample) {
      // Unsupported gaps are unavailable, never assumed to be good observation.
      const dt = Math.max(0, now - this.lastSample.at);
      const supported = Math.min(dt, 250);
      this.observation[`${this.lastSample.status}Ms`] += supported;
      this.observation.unavailableMs += dt - supported;
      this.observation.sampledMs += dt;
    }
    this.lastSample = { at: now, status: current.observation.status };
    this.observation.sideViewConfirmed ||= current.preparation.viewConfirmed;
    this.phase = current.preparation.stage === 'ready' || current.preparation.stage === 'active' ? 'active' : 'preparing';
    if (goalReached(current.result, this.goal)) this.endSet(sourceTime, now);
    return this.analyzer.snapshot();
  }
  pause(sourceTime: number) {
    if (!this.acceptsFrames) return;
    this.lastSourceTime = sourceTime;
    this.analyzer.interrupt(sourceTime, 'session_paused');
    this.phase = 'paused';
    this.lastSample = null;
  }
  resume(now: number) {
    this.advance(now);
    if (this.phase === 'paused') this.phase = 'preparing';
    else if (this.phase === 'next') {
      this.analyzer = createAnalyzer(this.exercise, this.goal.options);
      this.observation = this.blankObservation();
      this.setStart = now;
      this.phase = 'preparing';
    }
    this.lastSample = null;
  }
  interrupt(sourceTime: number) {
    if (!this.acceptsFrames) return this.analyzer.snapshot();
    this.lastSourceTime = sourceTime;
    this.phase = 'preparing';
    this.lastSample = null;
    return this.analyzer.interrupt(sourceTime, 'timeline_reset');
  }
  endSet(sourceTime: number, now: number, ended: SetRecord['ended'] = 'completed') {
    if (!this.acceptsFrames && this.phase !== 'paused') return;
    const analysis = this.analyzer.finish(sourceTime);
    this.sets.push({ number: this.sets.length + 1, ended, durationMs: Math.max(0, now - this.setStart),
      observation: { ...this.observation }, result: analysis.result });
    this.lastSample = null;
    if (this.sets.length >= this.goal.sets) this.phase = 'completed';
    else { this.restUntil = now + this.goal.restSeconds * 1000; this.phase = this.goal.restSeconds ? 'rest' : 'next'; }
  }
  finish(sourceTime = this.lastSourceTime, now = performance.now()): WorkoutRecord {
    if (this.final) return structuredClone(this.final);
    if (this.acceptsFrames || this.phase === 'paused') this.endSet(sourceTime, now, 'interrupted');
    this.phase = 'completed';
    this.final = {
      schemaVersion: isLegacy(this.exercise) ? 1 : 3, id: this.id, date: this.date, exercise: this.exercise, mode: this.mode,
      goal: { ...this.goal }, conditions: this.conditions.trim(), duration: Math.max(0, (now - this.startAt) / 1000),
      metadata: { rulesVersion: isLegacy(this.exercise) ? RULES_VERSION : MULTI_RULES_VERSION, analysisVersion: ANALYSIS_VERSION, coachingVersion: COACHING_POLICY_VERSION,
        variant: { ...variant(this.exercise) }, tracking: isLegacy(this.exercise) ? { ...tracking } : { ...multiTiming },
        ...(!isLegacy(this.exercise) ? {exerciseSnapshot:structuredClone(this.exerciseSnapshot)} : {}), detector: this.mode === 'demo' ? 'synthetic-landmarks-v1' : 'MediaPipe 1.0.1 / pose_landmarker_lite',
        sampling: 'realtime-throttled-85ms-v1', ...(this.source ? { source: structuredClone(this.source) } : {}) },
      sets: structuredClone(this.sets),
    };
    return structuredClone(this.final);
  }
}
