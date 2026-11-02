import { alignOffset, computePlacements, luminance } from '../lib/image/compose';
import { renderArea, TileSource } from '../lib/image/render';
import { broadcast } from '../lib/messages';
import { getCapture, putBlob, updateCapture } from '../lib/storage/db';
import type { CaptureRecord, TileGeom } from '../lib/types';

const ALIGN_RADIUS = 4;

function band(bmp: ImageBitmap, x: number, y: number, w: number, h: number): Uint8Array {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  return luminance(ctx.getImageData(0, 0, w, h).data);
}

/**
 * Scroll-and-stitch tiles come from scroll offsets that can be off by a
 * device pixel at fractional zoom levels. Match pixel rows in each overlap to
 * remove seams and duplicated rows.
 */
export async function refineRows(geoms: TileGeom[], tiles: TileSource): Promise<TileGeom[]> {
  const out = geoms.map((g) => ({ ...g, src: { ...g.src }, dst: { ...g.dst } }));
  const rows = [...new Set(out.map((g) => g.row))].sort((a, b) => a - b);
  for (let r = 1; r < rows.length; r++) {
    const p = out.find((g) => g.row === rows[r - 1] && g.col === 0);
    const c = out.find((g) => g.row === rows[r] && g.col === 0);
    if (!p || !c) continue;
    const overlap = p.dst.y + p.src.height - c.dst.y;
    if (overlap < 16) continue;
    const w = Math.min(p.src.width, c.src.width);
    const bh = Math.min(p.src.height, overlap + 2 * ALIGN_RADIUS + 8);
    const ch = Math.min(c.src.height, overlap + 2 * ALIGN_RADIUS + 8);
    const prevBand = band(await tiles.get(p.tile), p.src.x, p.src.y + p.src.height - bh, w, bh);
    const curBand = band(await tiles.get(c.tile), c.src.x, c.src.y, w, ch);
    const expected = c.dst.y - (p.dst.y + p.src.height - bh);
    const best = alignOffset(prevBand, bh, curBand, ch, w, expected, ALIGN_RADIUS);
    const delta = best - expected;
    if (delta) for (const g of out) if (g.row === rows[r]) g.dst.y += delta;
  }
  return out;
}

export async function finalize(id: string): Promise<CaptureRecord> {
  const rec = await getCapture(id);
  if (!rec) throw new Error(`Capture ${id} not found`);
  const tiles = new TileSource(rec);
  try {
    const geoms = rec.engine === 'scroll' ? await refineRows(rec.geoms, tiles) : rec.geoms;
    const placements = computePlacements(geoms, rec.width, rec.height);
    // Thumbnail of the top of the capture.
    const tw = Math.min(320, rec.width);
    const s = tw / rec.width;
    const th = Math.min(rec.height, Math.round(tw * 1.25 / s));
    const thumb = await renderArea(tiles, placements, { x: 0, y: 0, width: rec.width, height: th }, s);
    const thumbKey = `${id}/thumb`;
    await putBlob(thumbKey, await thumb.convertToBlob({ type: 'image/png' }));
    const next = await updateCapture(id, (r) => {
      r.geoms = geoms;
      r.placements = placements;
      r.thumbKey = thumbKey;
      r.status = 'ready';
    });
    broadcast({ type: 'capture-updated', id });
    return next;
  } finally {
    tiles.close();
  }
}
