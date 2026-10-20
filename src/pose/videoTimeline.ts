// Analysis uses recording time; MediaPipe still receives performance.now(). Seeks
// create a new segment without adding skipped recording time or joining movements.
export class VideoTimeline {
  time = 0;
  private mediaTime: number | null = null;
  private boundary = false;
  seek() { this.boundary = true; }
  sample(seconds: number) {
    const media = seconds * 1000;
    const reset = this.boundary || (this.mediaTime !== null && media < this.mediaTime);
    const changed = reset || this.mediaTime === null || media !== this.mediaTime;
    if (changed) this.time += reset ? 1 : this.mediaTime === null ? 1 : media - this.mediaTime;
    this.mediaTime = media;
    this.boundary = false;
    return { time: this.time, reset, changed };
  }
}
