import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../public/audio/ru/manifest.json';
import { CoachingController } from '../exercises/coaching';
import { demoObservation } from '../pose/demo';
import { TrainingController } from '../training/session';
import { RecordedSpeech } from './recordedSpeech';
import { VoiceScheduler, voiceIntervalMs } from './voiceScheduler';

// Exercise the actual analyzer → session → coaching → scheduler → clip mapping.
// A fake media element uses each supplied WAV's real duration, rather than
// claiming success merely because play() was called before an immediate cancel.
function harness(exercise: 'squat' | 'pushup') {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const clips: { url: string; start: number; end?: number; completed: boolean }[] = [];
  let current: typeof clips[number] | null = null;
  let endTimer: ReturnType<typeof setTimeout>;
  const audio = {
    src: '', volume: 0, preload: '',
    onplaying: null as (() => void) | null,
    onended: null as (() => void) | null,
    onerror: null as (() => void) | null,
    play() {
      current = { url: audio.src, start: Date.now(), completed: false };
      clips.push(current);
      const duration = manifest.phrases.find(phrase => audio.src.endsWith('/' + phrase.file))!.durationSeconds * 1000;
      setTimeout(() => audio.onplaying?.(), 0);
      endTimer = setTimeout(() => {
        if (current) { current.end = Date.now(); current.completed = true; current = null; }
        audio.onended?.();
      }, duration);
      return Promise.resolve();
    },
    pause() {
      clearTimeout(endTimer);
      if (current) { current.end = Date.now(); current = null; }
    },
    removeAttribute() { audio.src = ''; }, load() {},
  };
  const error = vi.fn();
  const player = new RecordedSpeech(() => audio as unknown as HTMLAudioElement, error, () => {});
  const scheduler = new VoiceScheduler(player), coaching = new CoachingController(exercise);
  const session = new TrainingController(exercise, 'demo', { sets: 1, reps: 50, restSeconds: 0 }, '', 0);
  const frame = (elapsed: number, missing = false, enabled = true) => {
    const { points } = demoObservation(exercise, elapsed, 'technique');
    const analysis = session.sample(missing ? [] : points, Date.now() + 1, 1.6, Date.now());
    const cue = coaching.update(analysis, missing ? [] : points, 1.6, Date.now());
    scheduler.update(session.phase === 'active', enabled, cue, Date.now());
    return { analysis, cue };
  };
  return { clips, error, frame, scheduler, audio, session };
}
afterEach(() => vi.useRealTimers());

describe('live voice pipeline with synthetic observations', () => {
  for (const exercise of ['squat', 'pushup'] as const) {
    it.each([90, 150, 200])(`${exercise}: lets a current recorded finding finish across motion phases at %i ms/frame`, cadence => {
      const h = harness(exercise), phases = new Set<string>();
      for (let elapsed = 0; elapsed < 22000; elapsed += cadence) {
        const { analysis, cue } = h.frame(elapsed);
        if (cue.kind === 'technique') phases.add(analysis.state);
        vi.advanceTimersByTime(cadence);
      }
      h.scheduler.stop();
      expect(h.clips.length).toBeGreaterThanOrEqual(2);
      expect(h.clips.every(clip => clip.completed)).toBe(true);
      expect(phases.has('Нижняя точка')).toBe(true);
      expect(phases.has('Поднимаетесь')).toBe(true);
      expect(h.clips.every(clip => clip.url.endsWith(exercise === 'squat' ? '/squat-trunk.wav' : '/pushup-line.wav'))).toBe(true);
      for (let i = 1; i < h.clips.length; i++) expect(h.clips[i].start - h.clips[i - 1].start).toBeGreaterThanOrEqual(voiceIntervalMs);
      expect(h.error).not.toHaveBeenCalled();
      expect(h.session.analyzer.snapshot().result.withErrors).toBeGreaterThan(0);
    });
  }

  it.each(['pose-loss', 'correction', 'mute', 'pause'] as const)('still cancels immediately on %s instead of finishing stale advice', reason => {
    const h = harness('squat');
    let elapsed = 0;
    for (; elapsed < 5000 && !h.clips.length; elapsed += 90) {
      h.frame(elapsed);
      vi.advanceTimersByTime(90);
    }
    expect(h.clips).toHaveLength(1);
    if (reason === 'pause') h.session.pause(Date.now() + 1);
    // 6500 in the fixture is a corrected trunk position in the same attempt.
    h.frame(reason === 'correction' ? 6500 : elapsed, reason === 'pose-loss', reason !== 'mute');
    expect(h.audio.src).toBe('');
    expect(h.clips[0].completed).toBe(false);
    expect(h.clips[0].end! - h.clips[0].start).toBeLessThanOrEqual(90);
    h.scheduler.stop();
    vi.advanceTimersByTime(10000);
    expect(h.clips).toHaveLength(1);
    expect(h.error).not.toHaveBeenCalled();
  });
});
