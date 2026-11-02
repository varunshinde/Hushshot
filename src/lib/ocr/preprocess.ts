/**
 * OCR input preprocessing. Operates on copies only; the exported image is
 * never altered.
 *
 * - Upscale so the effective resolution is at least ~300 DPI.
 * - Grayscale.
 * - Background normalisation: each pixel becomes its distance from the local
 *   background (the most common grey level of its neighbourhood), mapped to
 *   dark-on-white. This removes dark mode / inverted text and uneven
 *   backgrounds in one step, and works per area, so light and dark panels in
 *   one image are both handled.
 * - Optional adaptive (Bradley) threshold.
 */

/** Upscale factor so (96 × captureScale × factor) ≥ 300 DPI, capped at 4. */
export function ocrUpscale(captureScale: number, targetDpi = 300): number {
  const dpi = 96 * captureScale;
  return Math.min(4, Math.max(1, Math.ceil(targetDpi / dpi)));
}

export function toGray(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}

/** Most common grey level per block (histogram mode), as a coarse grid. */
export function backgroundGrid(gray: Uint8Array, w: number, h: number, block: number) {
  const gw = Math.max(1, Math.ceil(w / block));
  const gh = Math.max(1, Math.ceil(h / block));
  const grid = new Float32Array(gw * gh);
  const hist = new Uint32Array(64);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0);
      const x0 = gx * block;
      const y0 = gy * block;
      const x1 = Math.min(w, x0 + block);
      const y1 = Math.min(h, y0 + block);
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) hist[gray[y * w + x] >> 2]++;
      let best = 0;
      for (let b = 1; b < 64; b++) if (hist[b] > hist[best]) best = b;
      grid[gy * gw + gx] = best * 4 + 2;
    }
  }
  return { grid, gw, gh };
}

export function normalizeBackground(gray: Uint8Array, w: number, h: number, block = 96): Uint8Array {
  const { grid, gw, gh } = backgroundGrid(gray, w, h, block);
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < h; y++) {
    // Bilinear interpolation between block centres.
    const fy = Math.min(gh - 1, Math.max(0, (y - block / 2) / block));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x - block / 2) / block));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const bg =
        (grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx) * (1 - ty) +
        (grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx) * ty;
      const p = gray[y * w + x];
      // Contrast relative to the background, independent of polarity.
      const d = Math.abs(p - bg);
      const span = bg > 127 ? bg : 255 - bg;
      const v = Math.min(255, (d * 255) / Math.max(48, span));
      out[y * w + x] = 255 - v;
    }
  }
  return out;
}

/** Bradley adaptive threshold using an integral image. */
export function adaptiveThreshold(gray: Uint8Array, w: number, h: number, window = 31, t = 0.15): Uint8Array {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum;
    }
  }
  const out = new Uint8Array(gray.length);
  const r = window >> 1;
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(w, x + r + 1);
      const count = (xb - xa) * (yb - ya);
      const sum = integral[yb * (w + 1) + xb] - integral[ya * (w + 1) + xb] - integral[yb * (w + 1) + xa] + integral[ya * (w + 1) + xa];
      out[y * w + x] = gray[y * w + x] * count < sum * (1 - t) ? 0 : 255;
    }
  }
  return out;
}

/** Fraction of pixels darker than `level` (after normalisation: ink coverage). */
export function inkCoverage(gray: Uint8Array, level = 128): number {
  let n = 0;
  for (let i = 0; i < gray.length; i += 3) if (gray[i] < level) n++;
  return n / Math.max(1, Math.ceil(gray.length / 3));
}

/**
 * Page segmentation mode for a region:
 *  7 = single line (short, wide strips), 11 = sparse text (low ink coverage,
 *  e.g. UI screenshots and diagrams), 3 = fully automatic (blocks of text).
 */
export function choosePsm(normalized: Uint8Array, w: number, h: number, upscale: number): '3' | '7' | '11' {
  const cssH = h / upscale;
  if (cssH < 60 && w / h > 4) return '7';
  const ink = inkCoverage(normalized);
  if (ink < 0.015) return '11';
  return '3';
}

export function grayToRgba(gray: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(gray.length * 4));
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    out[j] = out[j + 1] = out[j + 2] = gray[i];
    out[j + 3] = 255;
  }
  return out;
}

/** Normalised Levenshtein distance between two strings (character error rate). */
export function characterErrorRate(reference: string, hypothesis: string): number {
  const a = [...reference];
  const b = [...hypothesis];
  if (!a.length) return b.length ? 1 : 0;
  let prev = new Uint32Array(b.length + 1).map((_, i) => i);
  let cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length] / a.length;
}
