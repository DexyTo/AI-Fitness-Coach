import { createAnalyzer } from '../exercises/analyzer';
import { exerciseVariants, tracking } from '../exercises/config';
import { createDetectorWithMetadata } from '../pose/poseDetector';
import type { ExerciseAnalysisResult, FeedbackCode } from '../exercises/types';
import { criteriaFor, PROTOCOL_VERSION, RULES_VERSION, type Annotation, type DetectedAttempt, type ValidationFrame, type ValidationRun } from './types';
import { parseAnnotation } from './schema';
import analyzerSource from '../exercises/analyzer.ts?raw';
import configSource from '../exercises/config.ts?raw';
import landmarkSource from '../pose/landmarks.ts?raw';
import geometrySource from '../pose/geometry.ts?raw';
import detectorSource from '../pose/poseDetector.ts?raw';
import runnerSource from './runner.ts?raw';
import manifest from '../../package-lock.json?raw';

export async function sha256(data: ArrayBuffer | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function provenance() {
  const assetHashes: Record<string, string> = {};
  const paths = ['models/pose_landmarker_lite.task', ...['vision_wasm_internal', 'vision_wasm_nosimd_internal', 'vision_wasm_module_internal']
    .flatMap(name => [`wasm/${name}.js`, `wasm/${name}.wasm`])];
  for (const path of paths) {
    const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!response.ok) throw new Error(`Missing local asset: ${path}`);
    assetHashes[path] = await sha256(await response.arrayBuffer());
  }
  const packages = JSON.parse(manifest).packages;
  return { assetHashes, mediaPipeVersion: packages['node_modules/@mediapipe/tasks-vision'].version,
    appVersion: packages[''].version, sourceSha256: await sha256([analyzerSource, configSource, landmarkSource, geometrySource, detectorSource, runnerSource].join('\n---FILE---\n')),
    rulesSha256: await sha256(configSource), tracking, exerciseVariants,
    runtime: { userAgent: navigator.userAgent, crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency },
    sampling: 'sequential-seeks-decoded-mediaTime-v1', timebase: 'absolute source milliseconds; MediaPipe receives same strictly increasing source timestamps' };
}
function once(video: HTMLVideoElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); video.removeEventListener(event, done); video.removeEventListener('error', failed); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error(`Video ${event}: decode failed/unsupported codec`)); };
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error(`Video ${event}: timeout`)); }, 15000);
    video.addEventListener(event, done, { once: true }); video.addEventListener('error', failed, { once: true });
  });
}
// A seek is only accepted with a newly presented decoded frame. currentTime can
// be a requested seek position between frames, so never use it as ground truth.
export function seekFrame(video: HTMLVideoElement, seconds: number): Promise<number> {
  if (!video.requestVideoFrameCallback) throw new Error('This runner requires requestVideoFrameCallback (current Chrome/Edge).');
  return new Promise((resolve, reject) => {
    let mediaTime: number | undefined;
    let seeked = false;
    const cleanup = () => { clearTimeout(timeout); video.cancelVideoFrameCallback(callback); video.removeEventListener('seeked', onSeeked); video.removeEventListener('error', failed); };
    const done = () => { if (seeked && mediaTime !== undefined) { cleanup(); resolve(mediaTime * 1000); } };
    const onSeeked = () => { seeked = true; done(); };
    const failed = () => { cleanup(); reject(new Error('Video seek/decode failed')); };
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('Decoded-frame seek timed out. Keep the validation tab visible.')); }, 15000);
    const callback = video.requestVideoFrameCallback((_, metadata) => { mediaTime = metadata.mediaTime; done(); });
    video.addEventListener('seeked', onSeeked, { once: true }); video.addEventListener('error', failed, { once: true });
    video.currentTime = seconds;
  });
}
export class RunCollector {
  frames: ValidationFrame[] = [];
  attempts: DetectedAttempt[] = [];
  private firstRemarks = new Map<number, Partial<Record<FeedbackCode, number>>>();
  private recordRemark(id: number, code: FeedbackCode, atMs: number) {
    const times = this.firstRemarks.get(id) ?? {};
    times[code] ??= atMs; this.firstRemarks.set(id, times);
  }
  collect(analysis: ExerciseAnalysisResult, atMs: number, detectorMs: number, analyzerMs: number, exercise: Annotation['exercise'], final = false) {
    for (const attempt of analysis.result.attempts.slice(this.attempts.length)) {
      attempt.remarks.forEach(code => this.recordRemark(attempt.id, code, atMs));
      this.attempts.push({ ...attempt, detectedAtMs: atMs, remarkDetectedAtMs: { ...this.firstRemarks.get(attempt.id) } });
    }
    if (analysis.preparation.stage === 'active') {
      const id = analysis.result.attempts.length + 1;
      // Only publicly available feedback counts as first detection, not a single
      // raw frame deviation or a private pending criterion.
      analysis.feedback.forEach(f => this.recordRemark(id, f.code, atMs));
    }
    if (!final) this.frames.push({ atMs, observation: analysis.observation, preparation: analysis.preparation,
      sufficient: analysis.observation.status === 'ready' && analysis.angle !== null,
      observableCriteria: criteriaFor(exercise).filter(c => analysis.observation.side !== null &&
        !analysis.observation.reasons.some(r => !r.criterion || r.criterion === c) &&
        !(c === 'lean' && (analysis.preparation.view === 'unsuitable' || (analysis.preparation.view === 'unknown' && !analysis.preparation.viewConfirmed)))),
      feedback: analysis.feedback.map(f => f.code), detectorMs, analyzerMs });
  }
}
export async function runVideo(file: File, input: Annotation, video: HTMLVideoElement, sampleIntervalMs: number, progress: (percent: number) => void): Promise<ValidationRun> {
  const annotation = parseAnnotation(input);
  if (!Number.isFinite(sampleIntervalMs) || sampleIntervalMs < 16 || sampleIntervalMs > 200) throw new Error('Sample interval must be 16..200 ms');
  const wallStart = performance.now();
  const digest = await sha256(await file.arrayBuffer());
  if (digest !== annotation.video.sha256) throw new Error('Video SHA-256 differs from annotation');
  const url = URL.createObjectURL(file);
  let detector: Awaited<ReturnType<typeof createDetectorWithMetadata>>['detector'] | undefined;
  try {
    video.pause(); video.controls = false; video.muted = true; video.preload = 'auto';
    const loaded = once(video, 'loadedmetadata'); video.src = url; await loaded;
    const durationMs = video.duration * 1000;
    if (!Number.isFinite(durationMs) || Math.abs(durationMs - annotation.video.durationMs) > 1) throw new Error(`Duration mismatch: actual ${durationMs} ms`);
    const metadata = await provenance();
    const created = await createDetectorWithMetadata(); detector = created.detector;
    const initializationMs = performance.now() - wallStart;
    const analysisStart = performance.now();
    const analyzer = createAnalyzer(annotation.exercise);
    const collector = new RunCollector();
    let confirmation = 0, lastAt = -1, duplicateFrames = 0;
    const steps = Math.ceil(durationMs / sampleIntervalMs);
    for (let index = 0; index <= steps; index++) {
      // First tiny seek forces a new decoded-frame notification; last seek samples
      // the final frame before EOF. No looping, playback, or user seeking.
      const target = Math.min(Math.max(index * sampleIntervalMs, 0.001), durationMs - 0.001);
      const atMs = await seekFrame(video, target / 1000);
      if (atMs <= lastAt) { duplicateFrames++; continue; }
      if (atMs >= durationMs) throw new Error('Decoder returned frame beyond video duration');
      lastAt = atMs;
      while (confirmation < annotation.sideConfirmationsMs.length && annotation.sideConfirmationsMs[confirmation] <= atMs) {
        analyzer.confirmSideView(); confirmation++;
      }
      const beforeDetector = performance.now();
      let landmarks: ReturnType<typeof detector.detectForVideo>['landmarks'][number] = [];
      let failed = false;
      try { landmarks = detector.detectForVideo(video, atMs).landmarks[0] ?? []; }
      catch { failed = true; }
      const detectorMs = performance.now() - beforeDetector;
      const beforeAnalysis = performance.now();
      const result = analyzer.analyze(landmarks, atMs, video.videoWidth / video.videoHeight, failed ? 'detector_error' : undefined);
      const analyzerMs = performance.now() - beforeAnalysis;
      collector.collect(result, atMs, detectorMs, analyzerMs, annotation.exercise);
      progress(Math.min(100, (index + 1) * 100 / (steps + 1)));
    }
    if (!collector.frames.length) throw new Error('No decoded frames');
    collector.collect(analyzer.finish(durationMs), durationMs, 0, 0, annotation.exercise, true);
    const now = performance.now();
    return { schemaVersion: 1, protocolVersion: PROTOCOL_VERSION, rulesVersion: RULES_VERSION,
      clipId: annotation.clipId, exercise: annotation.exercise, variant: annotation.variant,
      video: { sha256: digest, durationMs, width: video.videoWidth, height: video.videoHeight }, sampleIntervalMs,
      sideConfirmationsMs: [...annotation.sideConfirmationsMs],
      metadata: { ...metadata, delegate: created.delegate, detectorSettings: created.settings,
        cpuConfidenceDefaults: created.delegate === 'CPU' ? 'MediaPipe library defaults, same as application fallback' : null,
        detectorErrors: collector.frames.filter(f => f.observation.reasons.some(r => r.code === 'detector_error')).length },
      performance: { wallMs: now - wallStart, initializationMs, decodingAndAnalysisMs: now - analysisStart, duplicateFrames },
      frames: collector.frames, attempts: collector.attempts };
  } finally {
    detector?.close(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  }
}
