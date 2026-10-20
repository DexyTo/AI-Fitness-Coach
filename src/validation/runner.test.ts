import { describe, expect, it, vi, afterEach } from 'vitest';
import { createAnalyzer } from '../exercises/analyzer';
import { demoPose } from '../pose/demo';
import { RunCollector, seekFrame } from './runner';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('validation export with the real analyzer and artificial points', () => {
  it('preserves absolute source times and flushes an unfinished movement once', () => {
    const analyzer = createAnalyzer('squat');
    const collector = new RunCollector();
    for (let at = 0; at < 6000; at += 50) {
      collector.collect(analyzer.analyze(demoPose('squat', at), at, 1.6), at, 10, 1, 'squat');
    }
    const before = collector.attempts.length;
    collector.collect(analyzer.finish(6000), 6000, 0, 0, 'squat', true);
    collector.collect(analyzer.finish(6000), 6000, 0, 0, 'squat', true);
    expect(before).toBe(1);
    expect(collector.attempts).toHaveLength(2);
    expect(collector.attempts[1]).toMatchObject({ detectedAtMs: 6000, endedAt: 6000, endReason: 'session_finished' });
    expect(collector.frames.at(-1)?.atMs).toBe(5950);
    expect(collector.frames).toHaveLength(120);
    expect(collector.attempts[0].startedAt).toBeGreaterThan(500);
  });
  it('records only first public feedback and retains it through closure', () => {
    const analyzer = createAnalyzer('squat');
    const collector = new RunCollector();
    let first: number | undefined;
    for (let at = 0; at < 3600; at += 50) {
      const points = demoPose('squat', at);
      // A persistent, synthetic trunk deviation, on both sides.
      if (at > 900 && at < 2400) for (const offset of [0, 1]) {
        points[11 + offset] = { ...points[23 + offset], x: points[23 + offset].x - 0.2, y: points[23 + offset].y - 0.1 };
      }
      const result = analyzer.analyze(points, at, 1.6);
      if (result.feedback.some(f => f.code === 'lean')) first ??= at;
      collector.collect(result, at, 1, 1, 'squat');
    }
    collector.collect(analyzer.finish(3600), 3600, 0, 0, 'squat', true);
    expect(first).toBeGreaterThanOrEqual(1250);
    expect(collector.attempts[0].remarkDetectedAtMs.lean).toBe(first);
    expect(collector.attempts[0].remarks).toContain('lean');
    expect(collector.attempts[0].detectedAtMs).toBeGreaterThan(first!);
  });
  it('does not count historical missing-data reasons as current coverage loss', () => {
    const analyzer = createAnalyzer('squat');
    const collector = new RunCollector();
    for (let at = 0; at < 2200; at += 50) {
      const points = demoPose('squat', at);
      if (at === 1300) { points[11].visibility = 0; points[12].visibility = 0; }
      collector.collect(analyzer.analyze(points, at, 1.6), at, 1, 1, 'squat');
    }
    expect(collector.frames.find(f => f.atMs === 1300)?.observableCriteria).not.toContain('lean');
    expect(collector.frames.find(f => f.atMs === 1400)?.observableCriteria).toContain('lean');
  });
});
describe('decoded-frame sampling adapter (mocked browser, no real video)', () => {
  it('waits for seek and presentation and returns decoder mediaTime rather than the seek request', async () => {
    vi.stubGlobal('window', globalThis);
    const events = new EventTarget();
    let present!: VideoFrameRequestCallback;
    const cancel = vi.fn();
    const video = Object.assign(events, { currentTime: 0, requestVideoFrameCallback: vi.fn(cb => { present = cb; return 1; }), cancelVideoFrameCallback: cancel });
    const promise = seekFrame(video as unknown as HTMLVideoElement, 1.234);
    let finished = false; void promise.then(() => { finished = true; });
    events.dispatchEvent(new Event('seeked'));
    await Promise.resolve(); expect(finished).toBe(false);
    present(0, { mediaTime: 1.2 } as VideoFrameCallbackMetadata);
    expect(await promise).toBe(1200);
    expect(video.currentTime).toBe(1.234);
    expect(cancel).toHaveBeenCalledWith(1);
  });
  it('rejects a stalled decoder instead of returning a fake timestamp', async () => {
    vi.useFakeTimers(); vi.stubGlobal('window', globalThis);
    const video = Object.assign(new EventTarget(), { currentTime: 0, requestVideoFrameCallback: () => 1, cancelVideoFrameCallback: vi.fn() });
    const promise = seekFrame(video as unknown as HTMLVideoElement, 1);
    const rejection = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(15000); await rejection;
  });
});
