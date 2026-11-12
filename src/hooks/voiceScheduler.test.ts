import { describe, expect, it, vi } from 'vitest';
import { VoiceScheduler, observationConfirmMs, voiceIntervalMs } from './voiceScheduler';
import type { CoachingCue } from '../exercises/coaching';

const cue = (key = 'lean:1'): CoachingCue => ({ key, kind: 'technique', message: key });
const observation = (key: string): CoachingCue => ({ key, kind: 'observation', message: 'Текст на экране', voiceMessage: key });
function setup() {
  const port = { cancel: vi.fn(), speak: vi.fn() };
  return { port, s: new VoiceScheduler(port) };
}
describe('speech lifecycle without native audio', () => {
  it('speaks once per current cue and throttles across phase/attempt changes', () => {
    const { s, port } = setup();
    s.update(true, true, cue(), 0);
    s.update(true, true, cue(), 200);
    s.update(true, true, cue('lean:2'), 500);
    expect(port.speak).toHaveBeenCalledTimes(1);
    expect(port.cancel).toHaveBeenCalledTimes(2);
    s.update(true, true, cue('lean:2'), 6600);
    expect(port.speak.mock.calls.map(c => c[0])).toEqual(['lean:1', 'lean:2']);
  });
  for (const reason of ['lost', 'finished', 'muted', 'no-cue', 'phase', 'improvement'] as const) {
    it(`cancels current speech on ${reason} and never replays a throttled stale cue`, () => {
      const { s, port } = setup();
      s.update(true, true, cue(), 0);
      s.update(true, true, cue('line:2'), 500);
      const current = reason === 'lost' ? { key: 'no_pose', kind: 'observation', message: 'Нет позы' } as CoachingCue
        : reason === 'phase' || reason === 'improvement' ? { ...cue(), kind: reason } as CoachingCue : null;
      s.update(reason !== 'finished', reason !== 'muted', current, 800);
      s.update(false, true, null, 10000);
      expect(port.cancel.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(port.speak.mock.calls.map(c => c[0])).toEqual(['lean:1']);
    });
  }
  it('works when voice is off from the start and cancels on disposal', () => {
    const { s, port } = setup();
    s.update(true, false, cue(), 0);
    expect(port.speak).not.toHaveBeenCalled();
    s.stop(); expect(port.cancel).toHaveBeenCalledOnce();
  });
  it('lets the first cue of a new workout speak without the previous cooldown', () => {
    const { s, port } = setup();
    s.update(true, true, cue(), 0);
    s.reset();
    s.update(true, true, cue(), 1000);
    expect(port.speak.mock.calls.map(c => c[0])).toEqual(['lean:1', 'lean:1']);
  });
  it('replaces a technique cue only after the tracking warning persists', () => {
    const { s, port } = setup();
    const lost = observation('no_pose');
    s.update(true, true, cue(), 0);
    s.update(true, true, lost, 100);
    expect(port.cancel).toHaveBeenCalledTimes(2);
    s.update(true, true, null, 200);
    s.update(true, true, lost, 500);
    s.update(true, true, lost, 500 + observationConfirmMs - 1);
    expect(port.speak.mock.calls.map(c => c[0])).toEqual(['lean:1']);
    s.update(true, true, lost, 500 + observationConfirmMs);
    s.update(true, true, lost, 10000);
    expect(port.speak.mock.calls.map(c => c[0])).toEqual(['lean:1', 'no_pose']);
  });
  it('limits repeated warnings for the same tracking issue across episodes', () => {
    const { s, port } = setup();
    const partial = observation('missing_points'), lost = observation('no_pose');
    s.update(true, true, partial, 0);
    s.update(true, true, partial, observationConfirmMs);
    s.update(true, true, null, 1000);
    s.update(true, true, partial, 1200);
    s.update(true, true, partial, 1200 + observationConfirmMs);
    s.update(true, true, lost, 2000);
    s.update(true, true, lost, 2000 + observationConfirmMs);
    expect(port.speak.mock.calls.map(c => c[0])).toEqual(['missing_points', 'no_pose']);
    s.update(true, true, partial, 3000);
    s.update(true, true, partial, observationConfirmMs + voiceIntervalMs);
    expect(port.speak.mock.calls.map(c => c[0])).toEqual(['missing_points', 'no_pose', 'missing_points']);
  });
});
