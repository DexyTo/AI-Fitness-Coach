import { describe, expect, it } from 'vitest';
import { containViewport } from './viewport';
import { calculateAngle } from './geometry';

describe('video and skeleton contain transform', () => {
  for (const [sw, sh] of [[1920, 1080], [1080, 1920], [1000, 1000]]) {
    it(`keeps ${sw}×${sh} proportion and angles on wide and narrow stages`, () => {
      for (const [w, h] of [[800, 500], [360, 600]]) {
        const box = containViewport(w, h, sw, sh);
        expect(box.width / box.height).toBeCloseTo(sw / sh);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x * 2 + box.width).toBeCloseTo(w);
        expect(box.y * 2 + box.height).toBeCloseTo(h);
        const points = [{ x: 0.3, y: 0.25 }, { x: 0.5, y: 0.6 }, { x: 0.7, y: 0.85 }];
        const screen = points.map(p => ({ x: box.x + p.x * box.width, y: box.y + p.y * box.height }));
        expect(calculateAngle(points[0], points[1], points[2], sw / sh))
          .toBeCloseTo(calculateAngle(screen[0], screen[1], screen[2]));
      }
    });
  }
  it('places portrait video in centered pillarboxes', () => {
    expect(containViewport(800, 500, 1080, 1920)).toEqual({ x: 259.375, y: 0, width: 281.25, height: 500 });
  });
});
