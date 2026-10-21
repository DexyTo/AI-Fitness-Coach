import type { SpeechPort } from './voiceScheduler';

export function speechErrorMessage(code: string) {
  if (code === 'not-allowed') return 'Браузер заблокировал звук. Нажми «Проверить звук», чтобы разрешить озвучивание.';
  if (code === 'language-unavailable' || code === 'voice-unavailable') return 'Русский голос недоступен. Добавь русский голос в настройках речи устройства и повтори проверку.';
  return 'Не удалось воспроизвести голос. Проверь громкость и звук вкладки, затем нажми «Проверить звук». Если ошибка повторяется, открой приложение в другом браузере.';
}

// Keep the utterance alive, handle delayed voice loading and ignore callbacks from cancelled speech.
export class BrowserSpeech implements SpeechPort {
  private utterance: SpeechSynthesisUtterance | null = null;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly synth: SpeechSynthesis,
    private readonly create: (text: string) => SpeechSynthesisUtterance,
    private readonly onError: (message: string) => void,
    private readonly onDone: () => void,
  ) {}

  cancel() {
    clearTimeout(this.startTimer);
    this.utterance = null;
    this.synth.cancel();
  }

  speak(message: string) {
    this.cancel();
    const utterance = this.create(message);
    this.utterance = utterance;
    utterance.lang = 'ru-RU';
    utterance.rate = 0.95;
    utterance.volume = 1;
    const voices = this.synth.getVoices().filter(voice => /^ru([-_]|$)/i.test(voice.lang));
    const voice = voices.find(voice => voice.localService) ?? voices[0];
    if (voice) utterance.voice = voice;
    const fail = (code: string) => {
      if (this.utterance !== utterance) return;
      this.cancel();
      this.onError(speechErrorMessage(code));
      this.onDone();
    };
    utterance.onstart = () => {
      if (this.utterance === utterance) clearTimeout(this.startTimer);
    };
    utterance.onend = () => {
      if (this.utterance !== utterance) return;
      clearTimeout(this.startTimer);
      this.utterance = null;
      this.onDone();
    };
    utterance.onerror = event => fail(event.error);
    this.startTimer = setTimeout(() => fail('start-timeout'), 5000);
    try {
      // Some browsers retain a paused synthesizer even after its queue is cancelled.
      this.synth.resume();
      this.synth.speak(utterance);
    } catch {
      fail('synthesis-failed');
    }
  }
}
