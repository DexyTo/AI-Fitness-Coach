import { PROTOCOL_VERSION, RULES_VERSION, criteriaFor, type Annotation, type ValidationRun } from './types';

// Reject malformed evidence instead of silently producing flattering zero metrics.
type Obj = Record<string, unknown>;
function object(x: unknown, path: string): Obj {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error(`${path}: expected object`);
  return x as Obj;
}
function assert(ok: unknown, path: string): asserts ok { if (!ok) throw new Error(`Invalid ${path}`); }
function text(x: unknown) { return typeof x === 'string' && x.trim().length > 0; }
function finite(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x) && x >= 0; }
function array(x: unknown, path: string): unknown[] { assert(Array.isArray(x), path); return x; }
function oneOf(x: unknown, values: unknown[]) { return values.includes(x); }
function interval(x: Obj, duration: number, path: string) {
  assert(finite(x.startMs) && finite(x.endMs) && x.startMs < x.endMs && x.endMs <= duration, path);
}
function video(x: unknown) {
  const v = object(x, 'video');
  assert(typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256), 'video.sha256');
  assert(finite(v.durationMs) && v.durationMs > 0, 'video.durationMs');
  return v as { sha256: string; durationMs: number };
}
function confirmations(x: unknown, duration: number) {
  const times = array(x, 'sideConfirmationsMs');
  times.forEach((t, i) => assert(finite(t) && t < duration && (i === 0 || Number(times[i - 1]) < t), 'sideConfirmationsMs order/range'));
}
function exercise(x: Obj) {
  assert(oneOf(x.exercise, ['squat', 'pushup']), 'exercise');
  assert(x.variant === (x.exercise === 'squat' ? 'bodyweight-side' : 'pushup-side'), 'variant');
}
export function parseAnnotation(input: unknown): Annotation {
  const x = object(input, 'annotation');
  assert(x.schemaVersion === 1, 'schemaVersion');
  assert(oneOf(x.material, ['real', 'synthetic']), 'material');
  assert(text(x.clipId) && /^[a-zA-Z0-9_-]+$/.test(String(x.clipId)), 'clipId (anonymous slug)');
  assert(text(x.participantGroupId) && /^[a-zA-Z0-9_-]+$/.test(String(x.participantGroupId)), 'participantGroupId');
  assert(oneOf(x.split, ['calibration', 'control']), 'split');
  const p = object(x.permission, 'permission');
  assert(p.allowed === true && text(p.reference), 'permission');
  const v = video(x.video);
  exercise(x);
  assert(oneOf(x.view, ['side', 'unsuitable', 'unknown']), 'view');
  assert(array(x.conditions, 'conditions').every(text), 'conditions');
  const a = object(x.annotation, 'annotation provenance');
  assert(text(a.revision) && oneOf(a.source, ['human', 'synthetic']) && oneOf(a.reviewer, ['coach', 'unreviewed']), 'annotation provenance');
  assert(x.material === 'synthetic' ? a.source === 'synthetic' : a.source === 'human', 'material/source');
  assert(a.protocolVersion === PROTOCOL_VERSION && a.rulesVersion === RULES_VERSION, 'annotation protocol/rules version');
  confirmations(x.sideConfirmationsMs, v.durationMs);
  let previousEnd = 0;
  const ids = new Set();
  array(x.attempts, 'attempts').forEach((item, i) => {
    const t = object(item, `attempts[${i}]`);
    interval(t, v.durationMs, `attempts[${i}] interval`);
    assert(Number(t.startMs) >= previousEnd && text(t.id) && !ids.has(t.id), 'attempt order/unique id');
    previousEnd = Number(t.endMs); ids.add(t.id);
    assert(oneOf(t.outcome, ['complete', 'incomplete', 'insufficient_data']), 'attempt outcome');
    const checks = object(t.criteria, 'criteria');
    const codes = criteriaFor(x.exercise as Annotation['exercise']);
    assert(Object.keys(checks).every(k => codes.includes(k as typeof codes[number])), 'criterion for exercise');
    codes.forEach(code => {
      const c = object(checks[code], `criteria.${code}`);
      assert(oneOf(c.status, ['passed', 'deviation', 'unassessed']), 'criterion status');
      assert(c.onsetMs === undefined || (c.status === 'deviation' && finite(c.onsetMs) && c.onsetMs >= Number(t.startMs) && c.onsetMs <= Number(t.endMs)), 'criterion onsetMs');
      assert(c.status !== 'unassessed' || text(c.note), 'unassessed criterion needs note');
    });
  });
  array(x.unassessable, 'unassessable').forEach(item => {
    const t = object(item, 'unassessable interval'); interval(t, v.durationMs, 'unassessable interval');
    assert(text(t.reason), 'unassessable reason');
  });
  return input as Annotation;
}
export function parseRun(input: unknown): ValidationRun {
  const x = object(input, 'run');
  assert(x.schemaVersion === 1 && x.protocolVersion === PROTOCOL_VERSION && x.rulesVersion === RULES_VERSION, 'run versions');
  assert(text(x.clipId), 'run.clipId'); exercise(x);
  const v = video(x.video);
  const dimensions = object(x.video, 'video');
  assert(finite(dimensions.width) && dimensions.width > 0 && finite(dimensions.height) && dimensions.height > 0, 'video dimensions');
  assert(finite(x.sampleIntervalMs) && x.sampleIntervalMs >= 16 && x.sampleIntervalMs <= 200, 'sampleIntervalMs (16..200)');
  confirmations(x.sideConfirmationsMs, v.durationMs);
  object(x.metadata, 'metadata');
  const perf = object(x.performance, 'performance');
  ['wallMs', 'initializationMs', 'decodingAndAnalysisMs', 'duplicateFrames'].forEach(k => assert(finite(perf[k]), `performance.${k}`));
  let previous = -1;
  const frames = array(x.frames, 'frames');
  assert(frames.length > 0, 'frames must not be empty');
  frames.forEach(item => {
    const f = object(item, 'frame');
    assert(finite(f.atMs) && f.atMs > previous && f.atMs < v.durationMs, 'frame time/order'); previous = Number(f.atMs);
    assert(typeof f.sufficient === 'boolean' && finite(f.detectorMs) && finite(f.analyzerMs), 'frame data');
    const o = object(f.observation, 'observation');
    assert(oneOf(o.status, ['ready', 'partial', 'unavailable']) && oneOf(o.side, ['left', 'right', null]), 'observation');
    array(o.reasons, 'observation reasons');
    const p = object(f.preparation, 'preparation');
    assert(oneOf(p.stage, ['preparing', 'ready', 'active', 'recovering']) && oneOf(p.view, ['side', 'unsuitable', 'unknown', 'not_required']) && typeof p.viewConfirmed === 'boolean', 'preparation');
    const allowed = criteriaFor(x.exercise as Annotation['exercise']);
    [f.observableCriteria, f.feedback].forEach(codes => {
      const list = array(codes, 'frame criteria');
      assert(new Set(list).size === list.length && list.every(c => allowed.includes(c as typeof allowed[number])), 'frame criterion codes');
    });
    assert(!f.sufficient || (o.status === 'ready' && (f.observableCriteria as unknown[]).length === allowed.length &&
      p.view !== 'unsuitable' && (p.view !== 'unknown' || p.viewConfirmed)), 'sufficient data consistency');
  });
  previous = 0;
  array(x.attempts, 'run.attempts').forEach((item, i) => {
    const t = object(item, 'detected attempt');
    assert(t.id === i + 1 && finite(t.startedAt) && finite(t.endedAt) && t.startedAt >= previous && t.endedAt >= t.startedAt && t.endedAt <= v.durationMs, 'detected interval/id');
    previous = Number(t.endedAt);
    assert(finite(t.detectedAtMs) && t.detectedAtMs >= t.endedAt && t.detectedAtMs <= v.durationMs, 'detectedAtMs');
    assert(oneOf(t.outcome, ['complete', 'incomplete', 'insufficient_data']), 'detected outcome');
    const checks = object(t.criteria, 'detected criteria');
    const times = object(t.remarkDetectedAtMs, 'remarkDetectedAtMs');
    const codes = criteriaFor(x.exercise as Annotation['exercise']);
    codes.forEach(code => {
      assert(oneOf(object(checks[code], code).status, ['passed', 'deviation', 'unassessed']), 'detected criterion status');
      assert(times[code] === undefined || (object(checks[code], code).status === 'deviation' && finite(times[code]) && Number(times[code]) >= Number(t.startedAt) && Number(times[code]) <= Number(t.detectedAtMs)), 'remark time');
    });
    const remarks = array(t.remarks, 'remarks');
    assert(new Set(remarks).size === remarks.length && remarks.every(c => codes.includes(c as typeof codes[number])) &&
      codes.every(code => remarks.includes(code) === (object(checks[code], code).status === 'deviation')) &&
      Object.keys(times).every(code => codes.includes(code as typeof codes[number])), 'remarks consistency');
  });
  return input as ValidationRun;
}
