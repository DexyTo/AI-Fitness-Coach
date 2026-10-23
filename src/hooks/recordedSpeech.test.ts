import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../public/audio/ru/manifest.json';
import phrases from '../../public/audio/ru/phrases.json';
import { RecordedSpeech, recordingUrl, voiceTestMessage } from './recordedSpeech';
import { VoiceScheduler } from './voiceScheduler';

function setup() {
  const audio = {
    src: '', preload: '', volume: 0,
    onplaying: null as (() => void) | null,
    onended: null as (() => void) | null,
    onerror: null as (() => void) | null,
    play: vi.fn(() => Promise.resolve()), pause: vi.fn(), load: vi.fn(),
    removeAttribute: vi.fn(() => { audio.src = ''; }),
  };
  const create = vi.fn(() => audio as unknown as HTMLAudioElement);
  const error = vi.fn(), done = vi.fn();
  return { audio, create, error, done, player: new RecordedSpeech(create, error, done) };
}
afterEach(() => vi.useRealTimers());

describe('Xenia recording catalog', () => {
  it('maps every source phrase to its supplied Xenia WAV, including shortened recordings', () => {
    expect(manifest.speaker).toBe('xenia');
    expect(phrases).toHaveLength(28);
    expect(new Set(phrases.map(phrase => phrase.sourceText)).size).toBe(phrases.length);
    for (const phrase of phrases) {
      const entry = manifest.phrases.find(entry => entry.id === phrase.id)!;
      expect(entry).toMatchObject(phrase);
      expect(recordingUrl(phrase.sourceText)).toBe(`${import.meta.env.BASE_URL}audio/ru/${entry.file}`);
      const wav = readFileSync(new URL(`../../public/audio/ru/${entry.file}`, import.meta.url));
      expect(wav.subarray(0, 4).toString()).toBe('RIFF');
      expect(wav.subarray(8, 12).toString()).toBe('WAVE');
      expect(createHash('sha256').update(wav).digest('hex')).toBe(entry.sha256);
    }
    expect(recordingUrl(voiceTestMessage)).toMatch(/\/voice-test\.wav$/);
    expect(recordingUrl('Новая фраза без записи')).toBeNull();
  });
});

describe('recorded speech delivery', () => {
  it('plays the check and a technique clip on the same unlocked element at full volume', () => {
    vi.useFakeTimers();
    const h = setup();
    h.player.speak(voiceTestMessage);
    expect(h.audio.src).toMatch(/\/audio\/ru\/voice-test\.wav$/);
    expect(h.audio.volume).toBe(1);
    h.audio.onplaying!();
    vi.advanceTimersByTime(6000);
    expect(h.error).not.toHaveBeenCalled();
    h.audio.onended!();
    expect(h.done).toHaveBeenCalledOnce();
    h.player.speak(phrases[1].sourceText);
    expect(h.audio.src).toMatch(/\/squat-trunk\.wav$/);
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.audio.play).toHaveBeenCalledTimes(2);
    h.player.cancel();
    expect(h.audio.src).toBe('');
    expect(h.audio.pause).toHaveBeenCalled();
  });

  it('reports autoplay denial and allows a fresh user-initiated retry', async () => {
    vi.useFakeTimers();
    const h = setup();
    h.audio.play.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'));
    h.player.speak(voiceTestMessage);
    await Promise.resolve();
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining('заблокировал'));
    expect(h.done).toHaveBeenCalledOnce();
    h.player.speak(voiceTestMessage);
    h.audio.onplaying!();
    vi.advanceTimersByTime(6000);
    expect(h.error).toHaveBeenCalledOnce();
    h.player.cancel();
  });

  it.each(['media', 'timeout', 'throw'] as const)('reports %s failure once and releases the clip', reason => {
    vi.useFakeTimers();
    const h = setup();
    if (reason === 'throw') h.audio.play.mockImplementationOnce(() => { throw new Error('Failed'); });
    h.player.speak(voiceTestMessage);
    if (reason === 'media') h.audio.onerror!();
    vi.advanceTimersByTime(6000);
    expect(h.error).toHaveBeenCalledOnce();
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining('Проверить звук'));
    expect(h.done).toHaveBeenCalledOnce();
    expect(h.audio.src).toBe('');
  });

  it('ignores late media callbacks and rejected play promises from replaced/cancelled clips', async () => {
    vi.useFakeTimers();
    const h = setup();
    let reject!: (error: Error) => void;
    h.audio.play.mockReturnValueOnce(new Promise<void>((_, fail) => { reject = fail; }));
    h.player.speak(voiceTestMessage);
    const staleError = h.audio.onerror!, staleEnd = h.audio.onended!;
    h.player.speak(phrases[1].sourceText);
    h.audio.onplaying!();
    reject(new DOMException('Aborted', 'AbortError'));
    await Promise.resolve();
    staleError(); staleEnd();
    expect(h.audio.src).toMatch(/\/squat-trunk\.wav$/);
    h.player.cancel();
    vi.advanceTimersByTime(6000);
    expect(h.error).not.toHaveBeenCalled();
    expect(h.done).not.toHaveBeenCalled();
  });

  it('keeps unrecorded messages silent and does not leave a previous clip or timer running', () => {
    vi.useFakeTimers();
    const h = setup();
    h.player.speak(voiceTestMessage);
    h.player.speak('Новая фраза без записи');
    vi.advanceTimersByTime(6000);
    expect(h.audio.src).toBe('');
    expect(h.audio.play).toHaveBeenCalledOnce();
    expect(h.error).not.toHaveBeenCalled();
    expect(h.done).toHaveBeenCalledOnce();
  });

  it('stops an outdated technique clip, throttles its replacement and skips phase speech', () => {
    vi.useFakeTimers();
    const h = setup(), scheduler = new VoiceScheduler(h.player);
    const cue = { key: 'lean:1', kind: 'technique' as const, message: phrases[1].sourceText };
    scheduler.update(true, true, cue, 0);
    scheduler.update(true, true, { ...cue, key: 'line:2', message: phrases[2].sourceText }, 1000);
    expect(h.audio.src).toBe('');
    expect(h.audio.play).toHaveBeenCalledOnce();
    scheduler.update(true, true, { ...cue, key: 'line:2', message: phrases[2].sourceText }, 6500);
    expect(h.audio.src).toMatch(/\/pushup-line\.wav$/);
    scheduler.update(true, true, { ...cue, kind: 'phase' }, 7000);
    expect(h.audio.src).toBe('');
    scheduler.stop();
    vi.advanceTimersByTime(10000);
    expect(h.error).not.toHaveBeenCalled();
    expect(h.audio.play).toHaveBeenCalledTimes(2);
  });
});
