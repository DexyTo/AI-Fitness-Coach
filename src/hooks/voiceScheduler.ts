import type { CoachingCue } from '../exercises/coaching';

export interface SpeechPort { cancel(): void; speak(message: string): void }
export const voiceIntervalMs = 6500;
export const observationConfirmMs = 350;

// Never enqueue delayed advice. If throttled, only the cue still current on a later frame can speak.
export class VoiceScheduler {
  private current: string | null = null;
  private currentSince = 0;
  private spokenTechnique: string | null = null;
  private lastTechniqueAt = -Infinity;
  private readonly lastObservationAt = new Map<string, number>();
  constructor(private readonly port: SpeechPort) {}
  update(active: boolean, enabled: boolean, cue: CoachingCue | null, now: number) {
    const message = cue?.kind === 'observation' ? cue.voiceMessage : cue?.kind === 'technique' ? cue.message : undefined;
    const key = active && enabled && cue && message ? cue.key : null;
    if (key !== this.current) {
      if (this.current) this.port.cancel();
      this.current = key;
      this.currentSince = now;
    }
    if (!key || !cue || !message) return;
    if (cue.kind === 'observation') {
      // A tracking warning takes priority over technique and plays once per episode.
      const lastAt = this.lastObservationAt.get(key) ?? -Infinity;
      if (now - this.currentSince < observationConfirmMs || lastAt >= this.currentSince || now - lastAt < voiceIntervalMs) return;
      this.lastObservationAt.set(key, now);
    } else {
      if (key === this.spokenTechnique || now - this.lastTechniqueAt < voiceIntervalMs) return;
      this.spokenTechnique = key;
      this.lastTechniqueAt = now;
    }
    this.port.cancel();
    this.port.speak(message);
  }
  stop() { this.port.cancel(); this.current = this.spokenTechnique = null; }
  reset() {
    this.stop();
    this.lastTechniqueAt = -Infinity;
    this.lastObservationAt.clear();
  }
}
