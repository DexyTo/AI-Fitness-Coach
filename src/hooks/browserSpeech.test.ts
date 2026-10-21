import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserSpeech } from './browserSpeech';

function setup() {
  const synth = { cancel: vi.fn(), resume: vi.fn(), speak: vi.fn(), getVoices: vi.fn(() => [] as SpeechSynthesisVoice[]) };
  const create = vi.fn(text => ({ text }) as SpeechSynthesisUtterance);
  const error = vi.fn(), done = vi.fn();
  const player = new BrowserSpeech(synth as unknown as SpeechSynthesis, create, error, done);
  return { synth, create, error, done, player, utterance: () => create.mock.results.at(-1)!.value as SpeechSynthesisUtterance };
}
afterEach(() => vi.useRealTimers());

describe('browser speech delivery', () => {
  it('resumes speech, uses full volume and picks a newly loaded local Russian voice', () => {
    vi.useFakeTimers();
    const h = setup();
    h.player.speak('Проверка');
    expect(h.synth.resume).toHaveBeenCalledOnce();
    expect(h.utterance()).toMatchObject({ lang: 'ru-RU', volume: 1, rate: 0.95 });
    const remote = { lang: 'ru-RU', localService: false } as SpeechSynthesisVoice;
    const local = { lang: 'ru_RU', localService: true } as SpeechSynthesisVoice;
    h.synth.getVoices.mockReturnValue([remote, local]);
    h.player.speak('Подсказка');
    expect(h.utterance().voice).toBe(local);
    h.utterance().onstart!({} as SpeechSynthesisEvent);
    vi.advanceTimersByTime(6000);
    expect(h.error).not.toHaveBeenCalled();
    h.utterance().onend!({} as SpeechSynthesisEvent);
    expect(h.done).toHaveBeenCalledOnce();
  });

  it('reports a blocked or silently stalled engine and allows a fresh attempt', () => {
    vi.useFakeTimers();
    const h = setup();
    h.player.speak('Проверка');
    h.utterance().onerror!({ error: 'not-allowed' } as SpeechSynthesisErrorEvent);
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining('заблокировал'));
    h.player.speak('Ещё раз');
    vi.advanceTimersByTime(5000);
    expect(h.error).toHaveBeenLastCalledWith(expect.stringContaining('Не удалось воспроизвести'));
    expect(h.done).toHaveBeenCalledTimes(2);
  });

  it('ignores delayed errors from cancelled speech and clears its timeout', () => {
    vi.useFakeTimers();
    const h = setup();
    h.player.speak('Старое');
    const stale = h.utterance();
    h.player.speak('Новое');
    stale.onerror!({ error: 'interrupted' } as SpeechSynthesisErrorEvent);
    stale.onend!({} as SpeechSynthesisEvent);
    h.player.cancel();
    vi.advanceTimersByTime(6000);
    expect(h.error).not.toHaveBeenCalled();
    expect(h.done).not.toHaveBeenCalled();
  });
});
