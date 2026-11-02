import { getBlob } from '../storage/db';
import type { CaptureRecord, Placement, Rect } from '../types';

/**
 * Renders any area of a capture's master image straight from the stored
 * tiles. The master image is never materialised, so captures can be taller
 * than Chrome's canvas limits, and only the tiles an area touches are decoded
 * (LRU-cached). At outScale 1 every blit is integer and unsmoothed, so output
 * pixels are bit-identical to the captured ones.
 */
export class TileSource {
  private cache = new Map<number, Promise<ImageBitmap>>();

  constructor(
    private readonly rec: Pick<CaptureRecord, 'tiles'>,
    private readonly maxCached = 4,
  ) {}

  get(i: number): Promise<ImageBitmap> {
    let p = this.cache.get(i);
    if (p) {
      this.cache.delete(i);
      this.cache.set(i, p);
      return p;
    }
    p = (async () => {
      const t = this.rec.tiles[i];
      const blob = await getBlob(t.key);
      if (!blob) throw new Error(`Missing tile ${t.key}`);
      return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    })();
    this.cache.set(i, p);
    while (this.cache.size > this.maxCached) {
      const [k, old] = this.cache.entries().next().value!;
      this.cache.delete(k);
      old.then((b) => b.close()).catch(() => {});
    }
    return p;
  }

  close() {
    for (const p of this.cache.values()) p.then((b) => b.close()).catch(() => {});
    this.cache.clear();
  }
}

function intersect(p: Placement, area: Rect) {
  const x0 = Math.max(area.x, p.dx);
  const y0 = Math.max(area.y, p.dy);
  const x1 = Math.min(area.x + area.width, p.dx + p.w);
  const y1 = Math.min(area.y + area.height, p.dy + p.h);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

export async function renderArea(
  src: TileSource,
  placements: Placement[],
  area: Rect,
  outScale = 1,
  background = '#ffffff',
): Promise<OffscreenCanvas> {
  const W = Math.max(1, Math.round(area.width * outScale));
  const H = Math.max(1, Math.round(area.height * outScale));
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb', willReadFrequently: true })!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = outScale !== 1;
  ctx.imageSmoothingQuality = 'high';
  for (const p of placements) {
    const r = intersect(p, area);
    if (!r) continue;
    const bmp = await src.get(p.tile);
    const sx = p.sx + (r.x0 - p.dx);
    const sy = p.sy + (r.y0 - p.dy);
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (outScale === 1) {
      ctx.drawImage(bmp, sx, sy, w, h, r.x0 - area.x, r.y0 - area.y, w, h);
    } else {
      const dx = Math.round((r.x0 - area.x) * outScale);
      const dy = Math.round((r.y0 - area.y) * outScale);
      ctx.drawImage(bmp, sx, sy, w, h, dx, dy, Math.round((r.x1 - area.x) * outScale) - dx, Math.round((r.y1 - area.y) * outScale) - dy);
    }
  }
  return canvas;
}

export function readPixels(canvas: OffscreenCanvas): ImageData {
  return canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height, { colorSpace: 'srgb' });
}

/** Per-row luminance variance of rows [y0, y1) of `area`, for the smart-split image scan. */
export function rowEnergyFrom(src: TileSource, placements: Placement[], area: Rect) {
  return async (y0: number, y1: number): Promise<Float32Array | null> => {
    const h = y1 - y0;
    if (h <= 0) return null;
    const canvas = await renderArea(src, placements, { x: area.x, y: area.y + y0, width: area.width, height: h });
    const d = readPixels(canvas).data;
    const step = Math.max(1, Math.ceil(canvas.width / 1024));
    const out = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      let s2 = 0;
      let n = 0;
      for (let x = 0; x < canvas.width; x += step) {
        const i = (y * canvas.width + x) * 4;
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        s += l;
        s2 += l * l;
        n++;
      }
      const m = s / n;
      out[y] = s2 / n - m * m;
    }
    return out;
  };
}
