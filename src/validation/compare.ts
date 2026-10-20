import type { CriterionStatus, FeedbackCode } from '../exercises/types';
import { criteriaFor, PROTOCOL_VERSION, type Annotation, type Interval, type ValidationRun } from './types';
import { parseAnnotation, parseRun } from './schema';

export interface MatchOptions { startToleranceMs: number; endToleranceMs: number }
export const DEFAULT_MATCH: MatchOptions = { startToleranceMs: 1000, endToleranceMs: 1000 };

// Maximum cardinality, then minimum total absolute boundary error, preserving
// temporal order. Unlike nearest-neighbour matching this cannot consume a unique
// candidate of a later event just because it is closer to an earlier event.
export function matchIntervals(reference: Interval[], predicted: Interval[], options = DEFAULT_MATCH) {
  if (![options.startToleranceMs, options.endToleranceMs].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Invalid temporal tolerances');
  const n = reference.length, m = predicted.length;
  if ((n + 1) * (m + 1) > 4_000_000) throw new Error('Too many attempts: split the recording');
  const cells = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => ({ count: 0, cost: 0, action: '' })));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const up = cells[i - 1][j], left = cells[i][j - 1];
    let best = { ...up, action: 'reference' };
    if (left.count > best.count || (left.count === best.count && left.cost < best.cost)) best = { ...left, action: 'predicted' };
    const r = reference[i - 1], p = predicted[j - 1];
    const start = Math.abs(r.startMs - p.startMs), end = Math.abs(r.endMs - p.endMs);
    if (start <= options.startToleranceMs && end <= options.endToleranceMs && Math.max(r.startMs, p.startMs) < Math.min(r.endMs, p.endMs)) {
      const prev = cells[i - 1][j - 1];
      const candidate = { count: prev.count + 1, cost: prev.cost + start + end, action: 'match' };
      if (candidate.count > best.count || (candidate.count === best.count && candidate.cost <= best.cost)) best = candidate;
    }
    cells[i][j] = best;
  }
  const pairs: { reference: number; predicted: number }[] = [];
  let i = n, j = m;
  while (i && j) {
    const { action } = cells[i][j];
    if (action === 'match') { pairs.push({ reference: --i, predicted: --j }); }
    else if (action === 'reference') i--;
    else j--;
  }
  pairs.reverse();
  return {
    pairs,
    missed: reference.map((_, k) => k).filter(k => !pairs.some(p => p.reference === k)),
    extra: predicted.map((_, k) => k).filter(k => !pairs.some(p => p.predicted === k)),
  };
}
function union(intervals: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of [...intervals].sort((a, b) => a.startMs - b.startMs)) {
    const prev = out.at(-1);
    if (prev && x.startMs <= prev.endMs) prev.endMs = Math.max(prev.endMs, x.endMs);
    else out.push({ ...x });
  }
  return out;
}
function eligibleMs(startMs: number, endMs: number, excluded: Interval[]) {
  return Math.max(0, endMs - startMs - excluded.reduce((sum, e) => sum + Math.max(0, Math.min(endMs, e.endMs) - Math.max(startMs, e.startMs)), 0));
}
function overlaps(x: Interval, excluded: Interval[]) { return excluded.some(e => x.startMs < e.endMs && x.endMs > e.startMs); }
const ratio = (a: number, b: number) => b ? a / b : null;
export function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
  return { count: values.length, mean: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null,
    p50: percentile(0.5), p95: percentile(0.95), min: sorted[0] ?? null, max: sorted.at(-1) ?? null };
}
interface CriterionMetric {
  tp: number; fp: number; fn: number; tn: number;
  abstained: number; ignoredReference: number; missingNegativeAttempt: number;
  precision: number | null; recall: number | null;
  latencyMs: ReturnType<typeof distribution>;
  latencyUnavailable: number;
}
export function compare(annotationInput: Annotation, runInput: ValidationRun, options = DEFAULT_MATCH) {
  const annotation = parseAnnotation(annotationInput), run = parseRun(runInput);
  if (annotation.clipId !== run.clipId || annotation.video.sha256 !== run.video.sha256 ||
      Math.abs(annotation.video.durationMs - run.video.durationMs) > 1 || annotation.exercise !== run.exercise || annotation.variant !== run.variant ||
      JSON.stringify(annotation.sideConfirmationsMs) !== JSON.stringify(run.sideConfirmationsMs)) throw new Error('Annotation and run identity/settings mismatch');
  const excluded = union(annotation.unassessable);
  const reference = annotation.attempts.filter(a => !overlaps(a, excluded));
  const predicted = run.attempts.filter(a => !overlaps({ startMs: a.startedAt, endMs: a.endedAt }, excluded));
  const matches = matchIntervals(reference, predicted.map(a => ({ startMs: a.startedAt, endMs: a.endedAt })), options);
  const codes = criteriaFor(annotation.exercise);
  const criteria: Partial<Record<FeedbackCode, CriterionMetric>> = {};
  for (const code of codes) {
    const metric: CriterionMetric = { tp: 0, fp: 0, fn: 0, tn: 0, abstained: 0, ignoredReference: 0, missingNegativeAttempt: 0,
      precision: null, recall: null, latencyMs: distribution([]), latencyUnavailable: 0 };
    const latencies: number[] = [];
    const score = (truth: CriterionStatus, prediction: CriterionStatus | undefined, onset?: number, detected?: number) => {
      if (truth === 'unassessed') { metric.ignoredReference++; return; }
      if (prediction === 'unassessed') metric.abstained++;
      if (truth === 'deviation') {
        if (prediction === 'deviation') {
          metric.tp++;
          if (onset !== undefined && detected !== undefined) latencies.push(detected - onset);
          else metric.latencyUnavailable++;
        } else metric.fn++;
      } else if (prediction === 'deviation') metric.fp++;
      else if (prediction === 'passed') metric.tn++;
      else if (prediction === undefined) metric.missingNegativeAttempt++;
    };
    matches.pairs.forEach(pair => {
      const r = reference[pair.reference].criteria[code]!, p = predicted[pair.predicted];
      score(r.status, p.criteria[code]?.status, r.onsetMs, p.remarkDetectedAtMs[code]);
    });
    matches.missed.forEach(i => score(reference[i].criteria[code]!.status, undefined));
    matches.extra.forEach(i => { if (predicted[i].criteria[code]?.status === 'deviation') metric.fp++; });
    metric.precision = ratio(metric.tp, metric.tp + metric.fp);
    metric.recall = ratio(metric.tp, metric.tp + metric.fn);
    metric.latencyMs = distribution(latencies);
    criteria[code] = metric;
  }
  const eligibleDurationMs = eligibleMs(0, annotation.video.durationMs, excluded);
  let observedMs = 0, sufficientMs = 0, pointReadyMs = 0, preparedMs = 0;
  const perCriterionMs = Object.fromEntries(codes.map(c => [c, 0])) as Partial<Record<FeedbackCode, number>>;
  const views = { side: 0, unsuitable: 0, unknown: 0, not_required: 0 };
  let sideChanges = 0;
  let lastSide: string | null = null;
  for (let i = 0; i < run.frames.length; i++) {
    const f = run.frames[i];
    const end = Math.min(run.frames[i + 1]?.atMs ?? annotation.video.durationMs, f.atMs + Math.min(run.sampleIntervalMs * 2, 700));
    const ms = eligibleMs(f.atMs, end, excluded);
    observedMs += ms;
    if (f.sufficient) sufficientMs += ms;
    if (f.observation.status === 'ready') pointReadyMs += ms;
    if (f.preparation.stage === 'ready' || f.preparation.stage === 'active') preparedMs += ms;
    for (const code of f.observableCriteria) perCriterionMs[code]! += ms;
    views[f.preparation.view] += ms;
    if (f.observation.side) {
      if (lastSide && lastSide !== f.observation.side) sideChanges++;
      lastSide = f.observation.side;
    }
  }
  const referenceReps = reference.filter(a => a.outcome === 'complete').length;
  const predictedReps = predicted.filter(a => a.outcome === 'complete').length;
  const confusion: Record<string, number> = {};
  const timing = matches.pairs.map(pair => {
    const r = reference[pair.reference], p = predicted[pair.predicted];
    const key = `${r.outcome}->${p.outcome}`; confusion[key] = (confusion[key] ?? 0) + 1;
    return { referenceId: r.id, predictedId: p.id, startErrorMs: p.startedAt - r.startMs, endErrorMs: p.endedAt - r.endMs,
      detectionLatencyMs: p.detectedAtMs - r.endMs };
  });
  return {
    schemaVersion: 1, protocolVersion: PROTOCOL_VERSION,
    evidence: annotation.material === 'synthetic' ? 'synthetic-only' : 'real-video-pipeline',
    clipId: annotation.clipId, participantGroupId: annotation.participantGroupId, split: annotation.split,
    video: run.video, sampleIntervalMs: run.sampleIntervalMs, sideConfirmationsMs: run.sideConfirmationsMs,
    annotation: annotation.annotation, rulesVersion: run.rulesVersion, runMetadata: run.metadata,
    matching: { ...options, method: 'ordered-max-cardinality-min-boundary-error', pairs: timing,
      missedReferenceIds: matches.missed.map(i => reference[i].id), extraPredictedIds: matches.extra.map(i => predicted[i].id),
      excludedReferenceIds: annotation.attempts.filter(a => overlaps(a, excluded)).map(a => a.id),
      excludedPredictedIds: run.attempts.filter(a => overlaps({ startMs: a.startedAt, endMs: a.endedAt }, excluded)).map(a => a.id) },
    count: { referenceReps, predictedReps, signedError: predictedReps - referenceReps, absoluteError: Math.abs(predictedReps - referenceReps),
      referenceAttempts: reference.length, predictedAttempts: predicted.length, missed: matches.missed.length, extra: matches.extra.length, outcomeConfusion: confusion },
    criteria,
    timing: { startErrorMs: distribution(timing.map(t => t.startErrorMs)), endErrorMs: distribution(timing.map(t => t.endErrorMs)),
      detectionLatencyMs: distribution(timing.map(t => t.detectionLatencyMs)) },
    coverage: { totalDurationMs: annotation.video.durationMs, eligibleDurationMs, excludedMs: annotation.video.durationMs - eligibleDurationMs,
      observedMs, sufficientMs, sufficientFraction: ratio(sufficientMs, eligibleDurationMs), pointReadyMs, preparedMs,
      perCriterionMs, perCriterionFraction: Object.fromEntries(codes.map(c => [c, ratio(perCriterionMs[c]!, eligibleDurationMs)])),
      viewMs: views, referenceView: annotation.view, sideChanges, manualConfirmations: run.sideConfirmationsMs.length },
    performance: { ...run.performance, processedFrames: run.frames.length,
      processingFramesPerSecond: ratio(run.frames.length * 1000, run.performance.decodingAndAnalysisMs),
      videoSecondsPerWallSecond: ratio(annotation.video.durationMs, run.performance.decodingAndAnalysisMs),
      detectorMs: distribution(run.frames.map(f => f.detectorMs)), analyzerMs: distribution(run.frames.map(f => f.analyzerMs)),
      sourceIntervalsMs: distribution(run.frames.slice(1).map((f, i) => f.atMs - run.frames[i].atMs)) },
    limitations: ['Provisional 2D rules; no clinical validation.', 'Single clip; do not combine calibration and control or infer population accuracy.',
      'Offline sampled frames; app playback, voice and camera require separate checks.', 'No-event precision/recall and missing latency are null, never perfect scores.'],
  };
}
