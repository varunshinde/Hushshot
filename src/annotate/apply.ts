import { renderArea, type TileSource } from '../lib/image/render';
import type { CaptureRecord, Rect } from '../lib/types';
import { drawDoc } from './draw';
import { expand, intersects, isEmptyDoc, type EditDoc, type Of } from './model';
import { blockSize, reducedSize, visibleWords } from './redact';

/**
 * Export-side glue: everything that writes pixels or text out of a capture
 * goes through here, so annotations and redactions apply to every download,
 * copy and text export.
 */

export const docOf = (rec: CaptureRecord): EditDoc | null => (isEmptyDoc(rec.edits) ? null : rec.edits!);

/** Words that may leave the capture: everything not under a redaction. */
export const exportWords = (rec: CaptureRecord) => visibleWords(rec.words, rec.edits);

/**
 * The low-resolution image a blur/pixelate redaction keeps, rendered from the
 * original tiles: one pixel per block, so the hidden detail is gone for good.
 */
export async function redactImage(tiles: TileSource, rec: CaptureRecord, a: Of<'redact'>): Promise<OffscreenCanvas> {
  const block = blockSize(a.mode, rec.scale);
  const { w, h } = reducedSize(a.r, block);
  const r: Rect = { x: Math.round(a.r.x), y: Math.round(a.r.y), width: Math.max(1, Math.round(a.r.width)), height: Math.max(1, Math.round(a.r.height)) };
  // Render at the block scale (each output pixel averages one block), then fix the size exactly.
  const small = await renderArea(tiles, rec.placements, r, Math.min(1, w / r.width));
  if (small.width === w && small.height === h) return small;
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);
  return out;
}

/** Draw a document's annotations into a canvas that shows image area `rect`. */
export async function decorate(canvas: OffscreenCanvas, rec: CaptureRecord, tiles: TileSource, rect: Rect, doc: EditDoc): Promise<void> {
  const ctx = canvas.getContext('2d')!;
  const images = new Map<string, OffscreenCanvas>();
  for (const a of doc.items) {
    if (a.kind === 'redact' && a.mode !== 'box' && intersects(expand(a.r, 1), rect)) images.set(a.id, await redactImage(tiles, rec, a));
  }
  ctx.save();
  ctx.setTransform(canvas.width / rect.width, 0, 0, canvas.height / rect.height, (-rect.x * canvas.width) / rect.width, (-rect.y * canvas.height) / rect.height);
  drawDoc(ctx, doc, rect, { redactImage: (a) => images.get(a.id) });
  ctx.restore();
}

/** Render an area of the capture with its annotations (no beautify). */
export async function renderEdited(tiles: TileSource, rec: CaptureRecord, rect: Rect): Promise<OffscreenCanvas> {
  const canvas = await renderArea(tiles, rec.placements, rect);
  const doc = docOf(rec);
  if (doc) await decorate(canvas, rec, tiles, rect, doc);
  return canvas;
}
