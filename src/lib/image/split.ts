import type { Interval } from '../types';

/**
 * Smart split: choose cut rows for a tall image so no cut passes through a
 * line of text or an image.
 *
 * 1. Prefer rows outside every "forbidden" interval (text line boxes, images,
 *    form controls, from DOM layout data), nearest the target height.
 * 2. Otherwise fall back to an image scan: the band of rows with the lowest
 *    luminance variance (blank/whitespace rows) in the search window.
 * 3. Otherwise cut at the target.
 */

export interface SplitOptions {
  /** Desired segment height in pixels. */
  target: number;
  /** Search window as fractions of target. Default 0.85 … 1.15. */
  minFrac?: number;
  maxFrac?: number;
  /** Segments may never exceed this height (canvas/PDF page limit). */
  hardMax?: number;
  /** Forbidden intervals taller than this fraction of target are ignored (unavoidable). Default 0.5. */
  ignoreTallerThan?: number;
}

export interface SplitResult {
  cuts: number[];
  /** How each cut was chosen. */
  methods: ('dom' | 'scan' | 'forced')[];
}

/** Returns per-row "busyness" for rows [y0, y1); lower = blanker. */
export type RowEnergy = (y0: number, y1: number) => Float32Array | null | Promise<Float32Array | null>;

export function mergeIntervals(list: Interval[], pad = 0): Interval[] {
  const sorted = list
    .filter(([a, b]) => b > a)
    .map(([a, b]) => [a - pad, b + pad] as Interval)
    .sort((p, q) => p[0] - q[0]);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

/** A cut at row y splits rows [.., y) from [y, ..). It is safe if no interval has a < y < b. */
export function isSafeCut(y: number, merged: Interval[]): boolean {
  for (const [a, b] of merged) {
    if (a >= y) return true;
    if (y > a && y < b) return false;
  }
  return true;
}

/** Nearest safe row to `ideal` within [lo, hi], keeping a 2px margin from intervals when possible. */
export function nearestSafe(ideal: number, lo: number, hi: number, merged: Interval[]): number | null {
  const withMargin = mergeIntervals(merged, 2);
  for (const set of [withMargin, merged]) {
    for (let d = 0; d <= Math.max(ideal - lo, hi - ideal); d++) {
      for (const y of [ideal - d, ideal + d]) {
        if (y >= lo && y <= hi && isSafeCut(y, set)) return y;
      }
    }
  }
  return null;
}

/** Lowest-energy band centre in [lo, hi]; ties broken by distance to ideal. */
export function lowestEnergyRow(energy: Float32Array, lo: number, ideal: number, band = 6): number {
  const n = energy.length;
  if (n === 0) return ideal;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + energy[i];
  const half = band >> 1;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const avg = (prefix[b] - prefix[a]) / (b - a);
    // Small distance penalty so equal-blank bands prefer the target height.
    const score = avg + Math.abs(lo + i - ideal) * 1e-6;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return lo + best;
}

export async function computeSplits(
  total: number,
  forbidden: Interval[],
  opts: SplitOptions,
  energy?: RowEnergy,
): Promise<SplitResult> {
  const target = Math.max(1, Math.floor(opts.target));
  const hardMax = Math.max(target, Math.floor(opts.hardMax ?? Infinity));
  const minFrac = opts.minFrac ?? 0.85;
  const maxFrac = opts.maxFrac ?? 1.15;
  const ignore = (opts.ignoreTallerThan ?? 0.5) * target;
  const merged = mergeIntervals(forbidden.filter(([a, b]) => b - a <= ignore));

  const cuts: number[] = [];
  const methods: SplitResult['methods'] = [];
  let pos = 0;
  while (total - pos > Math.min(hardMax, Math.floor(target * maxFrac))) {
    const ideal = pos + target;
    const lo = Math.max(pos + 1, Math.floor(pos + target * minFrac));
    const hi = Math.min(total - 1, pos + hardMax, Math.floor(pos + target * maxFrac));
    let cut = nearestSafe(Math.min(ideal, hi), lo, hi, merged);
    let method: SplitResult['methods'][number] = 'dom';
    if (cut === null) {
      const e = await energy?.(lo, hi + 1);
      if (e && e.length) {
        cut = lowestEnergyRow(e, lo, Math.min(ideal, hi));
        method = 'scan';
      } else {
        cut = Math.min(ideal, hi);
        method = 'forced';
      }
    }
    cuts.push(cut);
    methods.push(method);
    pos = cut;
  }
  return { cuts, methods };
}

export interface Segment {
  y0: number;
  y1: number;
}

/** Turn cut rows into segments; each segment after the first starts `overlap` rows early. */
export function segmentsFromCuts(total: number, cuts: number[], overlap = 0): Segment[] {
  const edges = [0, ...cuts.filter((c) => c > 0 && c < total).sort((a, b) => a - b), total];
  const segs: Segment[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    if (edges[i + 1] <= edges[i]) continue;
    segs.push({ y0: i === 0 ? edges[i] : Math.max(0, edges[i] - overlap), y1: edges[i + 1] });
  }
  return segs;
}

/** Per-row luminance variance of an RGBA buffer. */
export function rowVariance(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Float32Array {
  const out = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let s = 0;
    let s2 = 0;
    const o = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = o + x * 4;
      const l = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
      s += l;
      s2 += l * l;
    }
    const m = s / width;
    out[y] = s2 / width - m * m;
  }
  return out;
}
