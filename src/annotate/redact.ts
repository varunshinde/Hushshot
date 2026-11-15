import type { Rect, Word } from '../lib/types';
import { intersects, redactions, type EditDoc, type RedactMode } from './model';

/**
 * Redaction is destructive at export: the covered pixels are replaced in every
 * exported image, and words under a redaction are removed from the PDF text
 * layer, "Copy text" and text exports. Any overlap removes the whole word.
 */
export function visibleWords(words: Word[], doc: EditDoc | null | undefined): Word[] {
  const boxes = redactions(doc).map((a) => a.r);
  if (!boxes.length) return words;
  return words.filter((w) => {
    const r = { x: w.x, y: w.y, width: w.w, height: w.h };
    return !boxes.some((b) => intersects(r, b));
  });
}

/**
 * Size of one pixelate block / the downscale factor for blur, in image px.
 * Large enough that text under it can't be read back: blur keeps one sample
 * per BLUR block and then smooths, pixelate keeps one average colour per block.
 */
export function blockSize(mode: RedactMode, scale: number): number {
  const s = Math.max(1, scale);
  return mode === 'blur' ? Math.round(14 * s) : Math.round(10 * s);
}

/**
 * Size of the low-resolution image a redaction keeps: every block of the
 * original becomes a single pixel, so nothing finer survives.
 */
export function reducedSize(r: Rect, block: number) {
  return { w: Math.max(1, Math.ceil(r.width / block)), h: Math.max(1, Math.ceil(r.height / block)) };
}

/**
 * The parts of `area` outside every hole, as disjoint rectangles (used to dim
 * everything but the spotlights without an extra full-size canvas).
 */
export function complementRects(area: Rect, holes: Rect[]): Rect[] {
  const hs = holes
    .map((h) => {
      const x0 = Math.max(area.x, h.x);
      const y0 = Math.max(area.y, h.y);
      const x1 = Math.min(area.x + area.width, h.x + h.width);
      const y1 = Math.min(area.y + area.height, h.y + h.height);
      return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
    })
    .filter((h): h is NonNullable<typeof h> => !!h);
  if (!hs.length) return [area];
  const xs = [...new Set([area.x, area.x + area.width, ...hs.flatMap((h) => [h.x0, h.x1])])].sort((a, b) => a - b);
  const ys = [...new Set([area.y, area.y + area.height, ...hs.flatMap((h) => [h.y0, h.y1])])].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    let run: Rect | null = null;
    for (let i = 0; i + 1 < xs.length; i++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cy = (ys[j] + ys[j + 1]) / 2;
      const covered = hs.some((h) => cx > h.x0 && cx < h.x1 && cy > h.y0 && cy < h.y1);
      if (!covered) {
        if (run && run.x + run.width === xs[i]) run.width = xs[i + 1] - run.x;
        else {
          run = { x: xs[i], y: ys[j], width: xs[i + 1] - xs[i], height: ys[j + 1] - ys[j] };
          out.push(run);
        }
      } else run = null;
    }
  }
  return out;
}
