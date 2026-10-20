import { describe, expect, it } from 'vitest';
import { compare, distribution, matchIntervals } from './compare';
import { parseAnnotation, parseRun } from './schema';
import { PROTOCOL_VERSION, RULES_VERSION, type Annotation, type DetectedAttempt, type ReferenceAttempt, type ValidationFrame, type ValidationRun } from './types';

export function referenceAttempt(id: string, startMs = 1000, endMs = 2000): ReferenceAttempt {
  return { id, startMs, endMs, outcome: 'complete', criteria: {
    depth: { status: 'passed' }, extension: { status: 'passed' }, lean: { status: 'passed' },
  } };
}
export function detectedAttempt(id = 1, startedAt = 1100, endedAt = 2200): DetectedAttempt {
  return { id, startedAt, endedAt, outcome: 'complete', detectedAtMs: endedAt, endReason: 'returned_to_top', motionComplete: true,
    minAngle: 90, criteria: { depth: { status: 'passed', observedFrames: 1, reasons: [] },
      extension: { status: 'passed', observedFrames: 1, reasons: [] }, lean: { status: 'passed', observedFrames: 1, reasons: [] } },
    remarks: [], reasons: [], remarkDetectedAtMs: {} };
}
export function frame(atMs: number, sufficient = true): ValidationFrame {
  return { atMs, sufficient, observation: { status: sufficient ? 'ready' : 'unavailable', side: sufficient ? 'left' : null, reasons: [] },
    preparation: { stage: 'ready', view: 'side', viewConfirmed: false, message: '' },
    observableCriteria: sufficient ? ['depth', 'extension', 'lean'] : [], feedback: [], detectorMs: 10, analyzerMs: 1 };
}
export function fixture() {
  const annotation: Annotation = { schemaVersion: 1, material: 'synthetic', clipId: 'synthetic-test', participantGroupId: 'synthetic-person-1', split: 'control',
    permission: { allowed: true, reference: 'artificial test data; no recording' }, video: { sha256: '0'.repeat(64), durationMs: 4000 },
    exercise: 'squat', variant: 'bodyweight-side', view: 'side', conditions: ['synthetic'],
    annotation: { revision: '1', source: 'synthetic', reviewer: 'unreviewed', protocolVersion: PROTOCOL_VERSION, rulesVersion: RULES_VERSION },
    sideConfirmationsMs: [], unassessable: [], attempts: [] };
  const run: ValidationRun = { schemaVersion: 1, protocolVersion: PROTOCOL_VERSION, rulesVersion: RULES_VERSION, clipId: annotation.clipId,
    exercise: 'squat', variant: 'bodyweight-side', video: { ...annotation.video, width: 640, height: 480 }, sampleIntervalMs: 50,
    sideConfirmationsMs: [], metadata: { synthetic: true },
    performance: { wallMs: 150, initializationMs: 100, decodingAndAnalysisMs: 50, duplicateFrames: 0 }, frames: [frame(0)], attempts: [] };
  return { annotation, run };
}

describe('one-to-one temporal matching', () => {
  it('maximizes cardinality in an ambiguous case that defeats nearest-first greedy matching', () => {
    const r = [{ startMs: 1000, endMs: 1100 }, { startMs: 1500, endMs: 1600 }];
    const p = [{ startMs: 100, endMs: 1050 }, { startMs: 1050, endMs: 1550 }];
    expect(matchIntervals(r, p).pairs).toEqual([{ reference: 0, predicted: 0 }, { reference: 1, predicted: 1 }]);
  });
  it('minimizes boundary error and never matches the same reference twice', () => {
    const r = [{ startMs: 1000, endMs: 2000 }];
    const p = [{ startMs: 0, endMs: 1500 }, { startMs: 1500, endMs: 2100 }];
    expect(matchIntervals(r, p)).toEqual({ pairs: [{ reference: 0, predicted: 1 }], missed: [], extra: [0] });
  });
  it('requires both tolerances and positive overlap; exact tolerance is inclusive', () => {
    const r = [{ startMs: 1000, endMs: 2000 }];
    expect(matchIntervals(r, [{ startMs: 1100, endMs: 3001 }]).pairs).toEqual([]);
    expect(matchIntervals(r, [{ startMs: 2000, endMs: 3000 }]).pairs).toEqual([]);
    expect(matchIntervals(r, [{ startMs: 0, endMs: 2000 }]).pairs).toHaveLength(1);
    expect(() => matchIntervals(r, [], { startToleranceMs: NaN, endToleranceMs: 1 })).toThrow();
  });
});
describe('quality metrics are distinct from observation and speed', () => {
  it('no events gives zero count errors and undefined precision/recall/delay, not perfect scores', () => {
    const { annotation, run } = fixture();
    const report = compare(annotation, run);
    expect(report.evidence).toBe('synthetic-only');
    expect(report.count.absoluteError).toBe(0);
    expect(report.criteria.lean).toMatchObject({ tp: 0, fp: 0, fn: 0, precision: null, recall: null, latencyMs: { count: 0, mean: null } });
    expect(report.timing.detectionLatencyMs.mean).toBeNull();
  });
  it('counts false attempts and false criteria on a no-event recording', () => {
    const { annotation, run } = fixture();
    const p = detectedAttempt(); p.criteria.lean!.status = 'deviation'; p.remarks = ['lean'];
    run.attempts = [p];
    const report = compare(annotation, run);
    expect(report.count).toMatchObject({ signedError: 1, extra: 1 });
    expect(report.criteria.lean).toMatchObject({ fp: 1, precision: 0, recall: null });
  });
  it('missing attempts contribute missed positive criteria even with no matched events', () => {
    const { annotation, run } = fixture();
    const r = referenceAttempt('a'); r.criteria.depth = { status: 'deviation', onsetMs: 1500 };
    annotation.attempts = [r];
    const report = compare(annotation, run);
    expect(report.count).toMatchObject({ signedError: -1, missed: 1 });
    expect(report.criteria.depth).toMatchObject({ fn: 1, recall: 0 });
    expect(report.criteria.lean?.missingNegativeAttempt).toBe(1);
  });
  it('distinguishes FP/FN, abstention, ignored labels, and signed latency', () => {
    const { annotation, run } = fixture();
    const r = referenceAttempt('a');
    r.criteria.lean = { status: 'deviation', onsetMs: 1300 };
    r.criteria.depth = { status: 'unassessed', note: 'occluded' };
    const p = detectedAttempt(); p.criteria.lean!.status = 'deviation'; p.remarks = ['lean', 'depth', 'extension'];
    p.criteria.depth!.status = 'deviation'; p.criteria.extension!.status = 'deviation'; p.remarkDetectedAtMs.lean = 1600;
    annotation.attempts = [r]; run.attempts = [p];
    const report = compare(annotation, run);
    expect(report.criteria.lean).toMatchObject({ tp: 1, latencyMs: { mean: 300 } });
    expect(report.criteria.depth).toMatchObject({ fp: 0, ignoredReference: 1 });
    expect(report.criteria.extension?.fp).toBe(1);
    expect(report.timing).toMatchObject({ startErrorMs: { mean: 100 }, endErrorMs: { mean: 200 }, detectionLatencyMs: { mean: 200 } });
    p.criteria.lean!.status = 'unassessed'; p.remarks = ['depth', 'extension']; delete p.remarkDetectedAtMs.lean;
    expect(compare(annotation, run).criteria.lean).toMatchObject({ fn: 1, abstained: 1, recall: 0 });
  });
  it('does not invent onset times and keeps early detections negative', () => {
    const { annotation, run } = fixture();
    const r = referenceAttempt('a'); r.criteria.lean = { status: 'deviation' };
    const p = detectedAttempt(); p.criteria.lean!.status = 'deviation'; p.remarks = ['lean']; p.remarkDetectedAtMs.lean = 1200;
    annotation.attempts = [r]; run.attempts = [p];
    expect(compare(annotation, run).criteria.lean).toMatchObject({ latencyUnavailable: 1, latencyMs: { mean: null } });
    r.criteria.lean.onsetMs = 1500;
    expect(compare(annotation, run).criteria.lean?.latencyMs.mean).toBe(-300);
  });
  it('detects outcome disagreement even when aggregate counts cancel', () => {
    const { annotation, run } = fixture();
    const a = referenceAttempt('a', 500, 1500), b = referenceAttempt('b', 2000, 3000); b.outcome = 'incomplete';
    const p = detectedAttempt(1, 500, 1500), q = detectedAttempt(2, 2000, 3000); p.outcome = 'incomplete';
    annotation.attempts = [a, b]; run.attempts = [p, q];
    expect(compare(annotation, run).count).toMatchObject({ absoluteError: 0, outcomeConfusion: { 'complete->incomplete': 1, 'incomplete->complete': 1 } });
  });
  it('merges unassessable intervals, excludes overlapping attempts, and caps frame support over gaps', () => {
    const { annotation, run } = fixture();
    annotation.video.durationMs = 1000; run.video.durationMs = 1000;
    annotation.unassessable = [{ startMs: 50, endMs: 150, reason: 'occlusion' }, { startMs: 120, endMs: 200, reason: 'blur' }];
    annotation.attempts = [referenceAttempt('a', 10, 250)]; run.attempts = [detectedAttempt(1, 20, 240)];
    run.frames = [frame(0), frame(100, false), frame(900)];
    const report = compare(annotation, run);
    expect(report.coverage).toMatchObject({ eligibleDurationMs: 850, excludedMs: 150, observedMs: 150, sufficientMs: 150, sufficientFraction: 150 / 850 });
    expect(report.matching).toMatchObject({ excludedReferenceIds: ['a'], excludedPredictedIds: [1] });
    expect(report.count.referenceReps).toBe(0);
    annotation.unassessable = [{ startMs: 0, endMs: 1000, reason: 'unusable' }];
    expect(compare(annotation, run).coverage.sufficientFraction).toBeNull();
  });
  it('performance changes do not change count, criteria, or coverage', () => {
    const { annotation, run } = fixture();
    const before = compare(annotation, run);
    run.performance.decodingAndAnalysisMs *= 5; run.frames[0].detectorMs *= 8;
    const after = compare(annotation, run);
    expect(after.count).toEqual(before.count); expect(after.criteria).toEqual(before.criteria); expect(after.coverage).toEqual(before.coverage);
    expect(after.performance.processingFramesPerSecond).not.toBe(before.performance.processingFramesPerSecond);
  });
  it('uses nearest rank percentiles', () => {
    expect(distribution([100, -10, 0, 30])).toMatchObject({ mean: 30, p50: 0, p95: 100, min: -10 });
  });
});
describe('evidence validation', () => {
  it('rejects wrong hashes, split/source/version, unordered labels and ambiguous omissions', () => {
    const { annotation, run } = fixture();
    expect(() => compare(annotation, { ...run, clipId: 'other' })).toThrow(/mismatch/);
    expect(() => parseAnnotation({ ...annotation, video: { sha256: 'fake', durationMs: 1000 } })).toThrow(/sha256/);
    expect(() => parseAnnotation({ ...annotation, material: 'real' })).toThrow(/source/);
    expect(() => parseAnnotation({ ...annotation, split: 'training' })).toThrow(/split/);
    annotation.attempts = [referenceAttempt('a'), referenceAttempt('b')];
    expect(() => parseAnnotation(annotation)).toThrow(/order/);
    annotation.attempts = [referenceAttempt('a')]; delete annotation.attempts[0].criteria.depth;
    expect(() => parseAnnotation(annotation)).toThrow(/criteria.depth/);
  });
  it('rejects invalid run clocks, empty evidence and incompatible settings', () => {
    const { annotation, run } = fixture();
    expect(() => parseRun({ ...run, frames: [] })).toThrow(/empty/);
    expect(() => parseRun({ ...run, frames: [frame(100), frame(50)] })).toThrow(/order/);
    expect(() => compare(annotation, { ...run, sideConfirmationsMs: [100] })).toThrow(/mismatch/);
    const bad = detectedAttempt(); bad.detectedAtMs = bad.endedAt - 1;
    expect(() => parseRun({ ...run, attempts: [bad] })).toThrow(/detectedAtMs/);
    const duplicate = frame(0); duplicate.observableCriteria.push('lean');
    expect(() => parseRun({ ...run, frames: [duplicate] })).toThrow(/criterion codes/);
    const inconsistent = frame(0, false); inconsistent.sufficient = true;
    expect(() => parseRun({ ...run, frames: [inconsistent] })).toThrow(/consistency/);
  });
});
