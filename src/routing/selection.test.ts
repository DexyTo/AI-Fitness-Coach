import { describe, expect, it } from 'vitest';
import { readSelection, selectionSearch } from './selection';

describe('training URL selection', () => {
  it('round-trips every supported exercise/source and restores defaults for invalid input', () => {
    for (const exercise of ['squat', 'pushup'] as const) {
      for (const mode of ['camera', 'video', 'demo'] as const) {
        expect(readSelection(selectionSearch({ exercise, mode }))).toEqual({ exercise, mode });
      }
    }
    expect(readSelection('')).toEqual({ exercise: 'squat', mode: 'camera' });
    expect(readSelection('?exercise=unknown&mode=bad')).toEqual({ exercise: 'squat', mode: 'camera' });
    expect(selectionSearch(readSelection('?exercise=pushup&mode=video&mode=demo&extra=x'))).toBe('?exercise=pushup&mode=video');
  });
});
