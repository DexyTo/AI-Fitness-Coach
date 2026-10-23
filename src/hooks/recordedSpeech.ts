import phrases from '../../public/audio/ru/phrases.json';
import type { SpeechPort } from './voiceScheduler';

export const voiceTestMessage = phrases.find(phrase => phrase.id === 'voice-test')!.sourceText;
const recordings = new Map(phrases.map(phrase => [phrase.sourceText, `${phrase.id}.wav`]));

export function recordingUrl(message: string) {
  const file = recordings.get(message);
  return file ? `${import.meta.env.BASE_URL}audio/ru/${file}` : null;
}

function audioErrorMessage(code: string) {
  if (code === 'NotAllowedError') return 'Браузер заблокировал звук. Нажми «Проверить звук», чтобы разрешить озвучивание.';
  if (code === 'media') return 'Не удалось загрузить аудиоподсказку. Нажми «Проверить звук», чтобы повторить.';
  return 'Не удалось воспроизвести голос. Проверь громкость и звук вкладки, затем нажми «Проверить звук».';
}

// Reuse one media element so the user's sound check also unlocks subsequent cues.
// Every request owns its callbacks and timeout; cancelled advice is never resumed.
export class RecordedSpeech implements SpeechPort {
  private audio: HTMLAudioElement | null = null;
  private generation = 0;
  private startTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly create: () => HTMLAudioElement,
    private readonly onError: (message: string) => void,
    private readonly onDone: () => void,
  ) {}

  cancel() {
    this.generation++;
    clearTimeout(this.startTimer);
    if (!this.audio) return;
    this.audio.onplaying = this.audio.onended = this.audio.onerror = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
  }

  speak(message: string) {
    this.cancel();
    const url = recordingUrl(message);
    // New/unrecorded messages remain on screen until a matching clip is provided.
    if (!url) { this.onDone(); return; }
    const generation = this.generation;
    const audio = this.audio ??= this.create();
    const current = () => generation === this.generation;
    const fail = (code: string) => {
      if (!current()) return;
      this.cancel();
      this.onError(audioErrorMessage(code));
      this.onDone();
    };
    audio.preload = 'auto';
    audio.volume = 1;
    audio.src = url;
    audio.onplaying = () => { if (current()) clearTimeout(this.startTimer); };
    audio.onended = () => {
      if (!current()) return;
      this.cancel();
      this.onDone();
    };
    audio.onerror = () => fail('media');
    this.startTimer = setTimeout(() => fail('start-timeout'), 5000);
    try {
      void audio.play().catch((error: unknown) => fail(error instanceof Error ? error.name : 'play-failed'));
    } catch (error) {
      fail(error instanceof Error ? error.name : 'play-failed');
    }
  }
}
