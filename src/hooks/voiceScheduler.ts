import type { CoachingCue } from '../exercises/coaching';

export interface SpeechPort { cancel(): void; speak(message: string): void }
export const voiceIntervalMs = 6500;

// Never enqueue delayed advice. If throttled, only the cue still current on a later frame can speak.
export class VoiceScheduler {
  private current: string | null = null;
  private spoken: string | null = null;
  private lastAt = -Infinity;
  constructor(private readonly port: SpeechPort) {}
  update(active: boolean, enabled: boolean, cue: CoachingCue | null, now: number) {
    const key = active && enabled && cue?.kind === 'technique' ? cue.key : null;
    if (key !== this.current || !key) {
      if (this.current) this.port.cancel();
      this.current = key;
    }
    if (!key || !cue || key === this.spoken || now - this.lastAt < voiceIntervalMs) return;
    this.port.cancel();
    this.port.speak(cue.message);
    this.spoken = key;
    this.lastAt = now;
  }
  stop() { this.port.cancel(); this.current = this.spoken = null; }
}
