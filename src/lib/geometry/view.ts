import type { Rect } from '../types';

/**
 * Viewer geometry: zoom levels, the zoom slider scale and crop-box editing.
 * Zoom `z` is CSS px per image px; "100%" means one image pixel per device pixel.
 */

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';
export const HANDLES: Exclude<Handle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Smallest crop, in image px. */
export const MIN_CROP = 16;
/** Highest zoom: 800%. */
export const MAX_PERCENT = 800;
/** Lowest zoom unless fitting the whole page needs less. */
export const MIN_PERCENT = 5;

export const percentOf = (z: number, dpr: number) => z * dpr * 100;
export const zoomFor = (percent: number, dpr: number) => percent / 100 / dpr;

/** Zoom that fits the image's width in the viewport, never above 100%. */
export function fitWidthZoom(viewW: number, imageW: number, dpr: number): number {
  return Math.max(1e-4, Math.min(1 / dpr, viewW / imageW));
}

/** Zoom that fits the whole image in the viewport, never above 100%. */
export function fitPageZoom(viewW: number, viewH: number, imageW: number, imageH: number, dpr: number): number {
  return Math.max(1e-4, Math.min(1 / dpr, viewW / imageW, viewH / imageH));
}

export function zoomLimits(fitPage: number, dpr: number): [number, number] {
  return [Math.min(fitPage, zoomFor(MIN_PERCENT, dpr)), zoomFor(MAX_PERCENT, dpr)];
}

/** Slider position 0…1 on a logarithmic scale between min and max zoom, and back. */
export function sliderOf(z: number, [min, max]: [number, number]): number {
  return Math.max(0, Math.min(1, Math.log(z / min) / Math.log(max / min)));
}
export function zoomOfSlider(t: number, [min, max]: [number, number]): number {
  return min * Math.pow(max / min, Math.max(0, Math.min(1, t)));
}

/** Next zoom step for the +/− buttons and keys: 25% … 800% stops, plus anything in between. */
const STEPS = [5, 10, 15, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400, 600, 800];
export function stepZoom(z: number, dir: 1 | -1, dpr: number, limits: [number, number]): number {
  const p = percentOf(z, dpr);
  const next = dir > 0 ? STEPS.find((s) => s > p + 0.5) ?? MAX_PERCENT : [...STEPS].reverse().find((s) => s < p - 0.5) ?? 0;
  return Math.max(limits[0], Math.min(limits[1], zoomFor(next, dpr) || limits[0]));
}

export function clampZoom(z: number, [min, max]: [number, number]): number {
  return Math.max(min, Math.min(max, z));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Rectangle spanned by two points, clipped to the image. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number, bounds: { width: number; height: number }): Rect {
  const x0 = clamp(Math.min(ax, bx), 0, bounds.width);
  const y0 = clamp(Math.min(ay, by), 0, bounds.height);
  const x1 = clamp(Math.max(ax, bx), 0, bounds.width);
  const y1 = clamp(Math.max(ay, by), 0, bounds.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Crop box after dragging `handle` by (dx, dy) image px from `start`.
 * Edges stay inside the image and the box never gets smaller than MIN_CROP;
 * 'move' slides the whole box.
 */
export function dragCrop(start: Rect, handle: Handle, dx: number, dy: number, bounds: { width: number; height: number }): Rect {
  const min = Math.min(MIN_CROP, bounds.width, bounds.height);
  if (handle === 'move') {
    return {
      x: clamp(start.x + dx, 0, bounds.width - start.width),
      y: clamp(start.y + dy, 0, bounds.height - start.height),
      width: start.width,
      height: start.height,
    };
  }
  let x0 = start.x;
  let y0 = start.y;
  let x1 = start.x + start.width;
  let y1 = start.y + start.height;
  if (handle.includes('w')) x0 = clamp(x0 + dx, 0, x1 - min);
  if (handle.includes('e')) x1 = clamp(x1 + dx, x0 + min, bounds.width);
  if (handle.includes('n')) y0 = clamp(y0 + dy, 0, y1 - min);
  if (handle.includes('s')) y1 = clamp(y1 + dy, y0 + min, bounds.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Whole image pixels, inside the image. */
export function roundRect(r: Rect, bounds: { width: number; height: number }): Rect {
  const x = clamp(Math.round(r.x), 0, bounds.width - 1);
  const y = clamp(Math.round(r.y), 0, bounds.height - 1);
  return {
    x,
    y,
    width: clamp(Math.round(r.x + r.width) - x, 1, bounds.width - x),
    height: clamp(Math.round(r.y + r.height) - y, 1, bounds.height - y),
  };
}

export function isWholeImage(r: Rect, bounds: { width: number; height: number }): boolean {
  return r.x <= 0 && r.y <= 0 && r.x + r.width >= bounds.width && r.y + r.height >= bounds.height;
}

/** Scroll speed (px per frame) when the pointer is within `edge` px of a viewport side. */
export function autoScrollSpeed(pos: number, start: number, end: number, edge = 36, max = 28): number {
  if (pos < start + edge) return -Math.ceil(max * Math.min(1, (start + edge - pos) / edge));
  if (pos > end - edge) return Math.ceil(max * Math.min(1, (pos - (end - edge)) / edge));
  return 0;
}
