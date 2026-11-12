import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../public/audio/ru/manifest.json';
import { CoachingController } from '../exercises/coaching';
import { optionsFor } from '../exercises/registry';
import { demoObservation, type DemoScenario } from '../pose/demo';
import { TrainingController } from '../training/session';
import { RecordedSpeech } from './recordedSpeech';
import { VoiceScheduler, observationConfirmMs, voiceIntervalMs } from './voiceScheduler';

// Exercise the actual analyzer → session → coaching → scheduler → clip mapping.
// A fake media element uses each supplied WAV's real duration, rather than
// claiming success merely because play() was called before an immediate cancel.
function harness(exercise: 'squat' | 'pushup' | 'glute_bridge') {
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
  const session = new TrainingController(exercise, 'demo', {
    schemaVersion: 2, unit: 'reps', options: optionsFor(exercise), sets: 1, reps: 50, restSeconds: 0,
  }, '', 0);
  const frame = (elapsed: number, scenario: DemoScenario = 'technique', enabled = true) => {
    const { points, sourceReason } = demoObservation(exercise, elapsed, scenario);
    const analysis = session.sample(points, Date.now() + 1, 1.6, Date.now(), sourceReason);
    const cue = coaching.update(analysis, points, 1.6, Date.now());
    scheduler.update(session.acceptsFrames, enabled, session.phase === 'active' || cue.kind === 'observation' ? cue : null, Date.now());
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

  describe.each(['squat', 'pushup', 'glute_bridge'] as const)('%s tracking warnings', exercise => {
    it.each([['occlusion', 'observation-missing-points.wav'], ['no_pose', 'observation-no-pose.wav']] as const)(
      'plays one complete recording during %s even while assessment is suspended', (scenario, filename) => {
        const h = harness(exercise);
        let firstWarningAt: number | undefined;
        for (let elapsed = 0; elapsed < 5000; elapsed += 90) {
          const { analysis, cue } = h.frame(elapsed, scenario);
          if (cue.kind === 'observation' && cue.voiceMessage) {
            firstWarningAt ??= elapsed;
            expect(analysis.state).toBe('Оценка приостановлена');
          }
          vi.advanceTimersByTime(90);
        }
        const warnings = h.clips.filter(clip => clip.url.includes('/observation-'));
        expect(warnings).toHaveLength(1);
        expect(warnings[0].url.split('/').at(-1)).toBe(filename);
        expect(warnings[0].start - firstWarningAt!).toBeGreaterThanOrEqual(observationConfirmMs);
        expect(warnings[0].completed).toBe(true);
        expect(h.error).not.toHaveBeenCalled();
      },
    );
  });

  it('does not confuse a stopped source with a missing person', () => {
    const h = harness('squat');
    for (let elapsed = 0; elapsed < 5000; elapsed += 90) {
      h.frame(elapsed, 'source_gap');
      vi.advanceTimersByTime(90);
    }
    expect(h.clips).toHaveLength(0);
  });

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
    if (reason === 'pose-loss') h.frame(2600, 'no_pose');
    else h.frame(reason === 'correction' ? 6500 : elapsed, 'technique', reason !== 'mute');
    expect(h.audio.src).toBe('');
    expect(h.clips[0].completed).toBe(false);
    expect(h.clips[0].end! - h.clips[0].start).toBeLessThanOrEqual(90);
    h.scheduler.stop();
    vi.advanceTimersByTime(10000);
    expect(h.clips).toHaveLength(1);
    expect(h.error).not.toHaveBeenCalled();
  });
});
