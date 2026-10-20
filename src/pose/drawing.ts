import type { PoseLandmarks } from '../exercises/types';
import { edges, visible } from './landmarks';
import { containViewport } from './viewport';


export function drawPose(
  canvas: HTMLCanvasElement,
  points: PoseLandmarks,
  width: number,
  height: number,
  sourceWidth = width,
  sourceHeight = height,
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const viewport = containViewport(width, height, sourceWidth, sourceHeight);
  const x = (value: number) => viewport.x + value * viewport.width;
  const y = (value: number) => viewport.y + value * viewport.height;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#d5fb71';
  ctx.shadowColor = '#b1e856';
  ctx.shadowBlur = 12;
  for (const [i, j] of edges) {
    if (!visible(points[i]) || !visible(points[j])) continue;
    ctx.beginPath();
    ctx.moveTo(x(points[i].x), y(points[i].y));
    ctx.lineTo(x(points[j].x), y(points[j].y));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  for (const i of new Set(edges.flat())) {
    if (!visible(points[i])) continue;
    ctx.beginPath();
    ctx.arc(x(points[i].x), y(points[i].y), 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f4ffd9';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#445f1e';
    ctx.stroke();
  }
}

export function clearPose(canvas: HTMLCanvasElement) {
  canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
}
