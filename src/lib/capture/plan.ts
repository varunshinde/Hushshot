import type { Rect, TileGeom } from '../types';

/**
 * Pure tile planning shared by both engines: which scroll positions to visit
 * and where each captured image lands in the master image.
 */

export interface PlanInput {
  /** Area to capture, in the scroll root's content coordinates (CSS px). */
  target: Rect;
  /** Size of the visible window onto the content (CSS px). */
  window: { width: number; height: number };
  maxScroll: { x: number; y: number };
  current: { x: number; y: number };
  /** Rows shared by consecutive tiles (CSS px); the seam sits in the middle. */
  overlap: number;
  /** Tallest tile allowed (CSS px), from the max-tile-height setting. */
  maxStepHeight: number;
}

export interface PlannedShot {
  row: number;
  col: number;
  x: number;
  y: number;
}

function axis(start: number, length: number, view: number, max: number, current: number, overlap: number): number[] {
  if (start >= current && start + length <= current + view) return [current];
  const clamp = (v: number) => Math.max(0, Math.min(max, v));
  const out = [clamp(start)];
  const step = Math.max(1, view - overlap);
  while (out[out.length - 1] + view < start + length) {
    const next = clamp(out[out.length - 1] + step);
    if (next <= out[out.length - 1]) break;
    out.push(next);
  }
  return out;
}

export function planScrolls(p: PlanInput): PlannedShot[] {
  const stepH = Math.max(50, Math.min(p.window.height, p.maxStepHeight));
  const ys = axis(p.target.y, p.target.height, stepH, p.maxScroll.y, p.current.y, Math.min(p.overlap, stepH / 4));
  const xs = axis(p.target.x, p.target.width, p.window.width, p.maxScroll.x, p.current.x, Math.min(p.overlap, p.window.width / 4));
  const shots: PlannedShot[] = [];
  ys.forEach((y, row) => xs.forEach((x, col) => shots.push({ row, col, x, y })));
  return shots;
}

export interface ShotInfo {
  tile: number;
  row: number;
  col: number;
  /** Content coordinate at the shot's top-left (root scroll + window offset). */
  contentX: number;
  contentY: number;
  /** Shot size in CSS px. */
  width: number;
  height: number;
  /** Where the shot's top-left is inside the captured image (CSS px). */
  originX: number;
  originY: number;
  imageWidth: number;
  imageHeight: number;
}

/** Map a shot onto the master image. Returns null if it doesn't intersect the target. */
export function geomForShot(s: ShotInfo, target: Rect, scale: number): TileGeom | null {
  const ix0 = Math.max(s.contentX, target.x);
  const iy0 = Math.max(s.contentY, target.y);
  const ix1 = Math.min(s.contentX + s.width, target.x + target.width);
  const iy1 = Math.min(s.contentY + s.height, target.y + target.height);
  if (ix1 <= ix0 || iy1 <= iy0) return null;
  const dx = Math.round((ix0 - target.x) * scale);
  const dy = Math.round((iy0 - target.y) * scale);
  const dx1 = Math.round((ix1 - target.x) * scale);
  const dy1 = Math.round((iy1 - target.y) * scale);
  const sx = Math.round((s.originX + ix0 - s.contentX) * scale);
  const sy = Math.round((s.originY + iy0 - s.contentY) * scale);
  const width = Math.max(0, Math.min(dx1 - dx, s.imageWidth - sx));
  const height = Math.max(0, Math.min(dy1 - dy, s.imageHeight - sy));
  if (!width || !height) return null;
  return { tile: s.tile, row: s.row, col: s.col, src: { x: sx, y: sy, width, height }, dst: { x: dx, y: dy } };
}

/** Predicted output for the popup: pixels and an uncompressed / typical-PNG size estimate. */
export function predictSize(cssW: number, cssH: number, scale: number) {
  const w = Math.round(cssW * scale);
  const h = Math.round(cssH * scale);
  const raw = w * h * 3;
  return { width: w, height: h, rawMB: raw / 1048576, pngMB: raw / 1048576 / 8 };
}
