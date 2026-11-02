import type { Placement, TileGeom } from '../types';

/**
 * Turns captured tiles into non-overlapping, pixel-exact placements in the
 * master image. Neighbouring rows (and columns) of tiles may overlap; each
 * overlap is split at its midpoint so neither tile's edge pixels are used.
 */

export interface Axis {
  start: number;
  end: number;
}

/** Ownership ranges along one axis for consecutive spans, splitting overlaps at the middle. */
export function ownership(spans: Axis[]): Axis[] {
  const out = spans.map((s) => ({ ...s }));
  for (let i = 1; i < out.length; i++) {
    const prevEnd = spans[i - 1].end;
    const curStart = spans[i].start;
    if (curStart < prevEnd) {
      const mid = Math.round((curStart + prevEnd) / 2);
      out[i - 1].end = Math.min(out[i - 1].end, mid);
      out[i].start = Math.max(out[i].start, mid);
    } else {
      out[i - 1].end = Math.min(out[i - 1].end, spans[i - 1].end);
    }
  }
  return out;
}

export function computePlacements(geoms: TileGeom[], masterW: number, masterH: number): Placement[] {
  const rows = [...new Set(geoms.map((g) => g.row))].sort((a, b) => a - b);
  const cols = [...new Set(geoms.map((g) => g.col))].sort((a, b) => a - b);
  const first = (pred: (g: TileGeom) => boolean) => geoms.find(pred)!;
  const rowSpans = rows.map((r) => {
    const g = first((t) => t.row === r);
    return { start: g.dst.y, end: g.dst.y + g.src.height };
  });
  const colSpans = cols.map((c) => {
    const g = first((t) => t.col === c);
    return { start: g.dst.x, end: g.dst.x + g.src.width };
  });
  const rowOwn = ownership(rowSpans);
  const colOwn = ownership(colSpans);

  const out: Placement[] = [];
  for (const g of geoms) {
    const ro = rowOwn[rows.indexOf(g.row)];
    const co = colOwn[cols.indexOf(g.col)];
    const y0 = Math.max(ro.start, g.dst.y, 0);
    const y1 = Math.min(ro.end, g.dst.y + g.src.height, masterH);
    const x0 = Math.max(co.start, g.dst.x, 0);
    const x1 = Math.min(co.end, g.dst.x + g.src.width, masterW);
    if (y1 <= y0 || x1 <= x0) continue;
    out.push({
      tile: g.tile,
      sx: g.src.x + (x0 - g.dst.x),
      sy: g.src.y + (y0 - g.dst.y),
      w: x1 - x0,
      h: y1 - y0,
      dx: x0,
      dy: y0,
    });
  }
  return out;
}

/**
 * Refine the vertical offset between two vertically adjacent tiles by matching
 * pixel rows in their overlap.
 *
 * `prev` / `cur` are luminance rows (width `w`) of the two tiles' usable areas.
 * `expected` is the predicted offset of cur's first row relative to prev's
 * first row (from scroll positions). Returns the best offset within
 * expected ± radius, or `expected` if the overlap has no texture to match.
 */
export function alignOffset(
  prev: Uint8Array,
  prevRows: number,
  cur: Uint8Array,
  curRows: number,
  w: number,
  expected: number,
  radius = 4,
): number {
  let best = expected;
  let bestScore = Infinity;
  let worst = 0;
  const step = Math.max(1, Math.floor(w / 512));
  for (let off = expected - radius; off <= expected + radius; off++) {
    // Overlap: prev rows [off, prevRows) correspond to cur rows [0, prevRows - off).
    const ov = Math.min(prevRows - off, curRows);
    if (ov < 8 || off < 0) continue;
    // Skip the outermost rows of both tiles, where edge artefacts live.
    const skip = Math.min(2, Math.floor(ov / 4));
    let diff = 0;
    let n = 0;
    for (let r = skip; r < ov - skip; r++) {
      const pi = (off + r) * w;
      const ci = r * w;
      for (let x = 0; x < w; x += step) {
        diff += Math.abs(prev[pi + x] - cur[ci + x]);
        n++;
      }
    }
    const score = n ? diff / n : Infinity;
    if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) < 1e-9 && Math.abs(off - expected) < Math.abs(best - expected))) {
      bestScore = score;
      best = off;
    }
    if (score !== Infinity) worst = Math.max(worst, score);
  }
  // Flat overlap (all candidates equally good) or poor match: trust scroll positions.
  if (worst - bestScore < 0.5 || bestScore > 12) return expected;
  return best;
}

export function luminance(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}
