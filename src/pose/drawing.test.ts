import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoPose } from './demo';
import { drawPose } from './drawing';
import { containViewport } from './viewport';

afterEach(() => vi.unstubAllGlobals());
describe('remark overlay uses the video contain viewport', () => {
  for (const [width, height, sourceWidth, sourceHeight] of [[960, 600, 1080, 1920], [340, 330, 1920, 1080]]) {
    it(`keeps the marked segment and label aligned in ${width}×${height}`, () => {
      vi.stubGlobal('window', { devicePixelRatio: 1 });
      const paths: { start: number[]; end?: number[] }[] = [];
      const ctx = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
        moveTo: (x: number, y: number) => paths.push({ start: [x, y] }),
        lineTo: (x: number, y: number) => { paths.at(-1)!.end = [x, y]; },
        stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), setLineDash: vi.fn(),
        measureText: () => ({ width: 75 }), fillRect: vi.fn(), fillText: vi.fn() };
      const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
      const points = demoPose('squat', 0);
      drawPose(canvas, points, width, height, sourceWidth, sourceHeight, { points: [11, 23], label: 'Корпус' });
      const viewport = containViewport(width, height, sourceWidth, sourceHeight);
      const projected = (i: number) => [viewport.x + points[i].x * viewport.width, viewport.y + points[i].y * viewport.height];
      expect(paths.at(-1)).toEqual({ start: projected(11), end: projected(23) });
      expect(ctx.setLineDash.mock.calls).toEqual([[[8, 6]], [[]]]);
      expect(ctx.fillText).toHaveBeenCalledWith('! Корпус', expect.any(Number), expect.any(Number));
      // The same segment was already drawn by the ordinary skeleton; highlights do not shift it.
      expect(paths.slice(0, -1)).toContainEqual(paths.at(-1));
    });
  }
  it('omits an entire highlight if any required point is unreliable', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    const ctx = { setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(), setLineDash: vi.fn(), fillText: vi.fn() };
    const canvas = { width: 960, height: 600, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const points = demoPose('squat', 0); points[23].visibility = 0;
    drawPose(canvas, points, 960, 600, 1600, 1000, { points: [11, 23], label: 'Корпус' });
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.setLineDash).not.toHaveBeenCalled();
  });
});
