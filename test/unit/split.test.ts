import { describe, expect, it } from 'vitest';
import { computeSplits, fitCutsToCapacity, highestSafe, isSafeCut, mergeIntervals, paginate, segmentsFromCuts } from '../../src/lib/image/split';
import type { Interval } from '../../src/lib/types';

describe('smart split', () => {
  it('never cuts through text lines when a gap exists', async () => {
    // 20px lines with 6px gaps.
    const lines: Interval[] = [];
    for (let y = 0; y < 50000; y += 26) lines.push([y, y + 20]);
    const { cuts, methods } = await computeSplits(50000, lines, { target: 8000 });
    expect(cuts.length).toBeGreaterThanOrEqual(5);
    for (const c of cuts) expect(isSafeCut(c, mergeIntervals(lines))).toBe(true);
    expect(methods.every((m) => m === 'dom')).toBe(true);
    let prev = 0;
    for (const c of cuts) {
      expect(c - prev).toBeGreaterThanOrEqual(8000 * 0.85);
      expect(c - prev).toBeLessThanOrEqual(8000 * 1.15);
      prev = c;
    }
  });

  it('respects a hard maximum', async () => {
    const { cuts } = await computeSplits(10000, [], { target: 3000, maxFrac: 1, hardMax: 3000 });
    let prev = 0;
    for (const c of cuts) { expect(c - prev).toBeLessThanOrEqual(3000); prev = c; }
    expect(10000 - prev).toBeLessThanOrEqual(3000);
  });

  it('falls back to the blankest rows when DOM data blocks the window', async () => {
    const big: Interval[] = [[0, 4000]]; // e.g. a tall table
    const energy = (y0: number, y1: number) => {
      const e = new Float32Array(y1 - y0).fill(100);
      for (let y = 2700; y < 2710; y++) if (y >= y0 && y < y1) e[y - y0] = 0;
      return e;
    };
    const { cuts, methods } = await computeSplits(6000, big, { target: 2900, ignoreTallerThan: 2 }, energy);
    expect(methods[0]).toBe('scan');
    expect(cuts[0]).toBeGreaterThanOrEqual(2700);
    expect(cuts[0]).toBeLessThan(2710);
  });

  it('builds overlapping segments', () => {
    expect(segmentsFromCuts(100, [40, 70], 5)).toEqual([{ y0: 0, y1: 40 }, { y0: 35, y1: 70 }, { y0: 65, y1: 100 }]);
  });
});

describe('PDF pagination', () => {
  // 20px text lines every 32px (12px gaps), like a paragraph.
  const para = (from: number, to: number): Interval[] => {
    const out: Interval[] = [];
    for (let y = from; y + 20 <= to; y += 32) out.push([y, y + 20]);
    return out;
  };

  it('finds the highest clean row at or above the page bottom', () => {
    const m = mergeIntervals([[100, 120], [132, 152]]);
    expect(highestSafe(160, 0, m)).toBe(160);
    expect(highestSafe(140, 0, m)).toBe(132);
    expect(highestSafe(140, 135, m)).toBeNull();
    expect(highestSafe(130.5, 0, mergeIntervals([[120.4, 130.7], [110, 120.2]]))).toBe(110);
  });

  it('fills every page: the gap left is under one line and no line is cut', async () => {
    const lines = para(0, 30000);
    const cap = 3000;
    const { cuts, methods } = await paginate(30000, lines, [], { capacity: cap });
    let prev = 0;
    for (const c of cuts) {
      expect(c - prev).toBeLessThanOrEqual(cap);
      expect(cap - (c - prev)).toBeLessThan(32);
      expect(isSafeCut(c, mergeIntervals(lines))).toBe(true);
      prev = c;
    }
    expect(30000 - prev).toBeLessThanOrEqual(cap);
    expect(methods.every((m) => m === 'dom')).toBe(true);
  });

  it('moves a figure to the next page only when little space is lost', async () => {
    const cap = 1000;
    // Figure starting 60px above the page bottom: moved whole (6% of the page left empty), with a 2px margin.
    const small = await paginate(3000, para(0, 900), [[940, 1300]], { capacity: cap });
    expect(small.cuts[0]).toBe(938);
    // Figure starting 400px above the bottom: moving it would waste 40%, so the break goes through it at the bottom.
    const big = await paginate(3000, para(0, 560), [[600, 1300]], { capacity: cap });
    expect(big.cuts[0]).toBe(1000);
  });

  it('cuts the fewest lines when no clean row exists, preferring blank rows near the bottom', async () => {
    // Two columns whose lines interleave so that every row crosses some line.
    const left: Interval[] = [];
    const right: Interval[] = [];
    for (let y = 0; y < 3000; y += 30) left.push([y, y + 24]);
    for (let y = 15; y < 3000; y += 30) right.push([y, y + 24]);
    const { cuts, methods } = await paginate(3000, [...left, ...right], [], { capacity: 1000 });
    expect(methods[0]).toBe('scan');
    expect(cuts[0]).toBeLessThanOrEqual(1000);
    expect(cuts[0]).toBeGreaterThan(800);
    const crossing = (y: number) => [...left, ...right].filter(([a, b]) => y > a && y < b).length;
    expect(crossing(cuts[0])).toBe(1);
  });

  it('keeps split lines the user placed but adds breaks where a part would not fit a page', async () => {
    const breaks = async (y0: number, y1: number) => (await paginate(y1 - y0, [], [], { capacity: 1000 })).cuts.map((c) => c + y0);
    expect(await fitCutsToCapacity(5000, [800, 3500], 0, breaks, 1000)).toEqual([800, 1800, 2800, 3500, 4500]);
    // Overlap counts towards the page: pages hold 1000 rows, 20 of them repeated from the previous page.
    const withOverlap = async (y0: number, y1: number) => (await paginate(y1 - y0, [], [], { capacity: 980 })).cuts.map((c) => c + y0);
    const cuts = await fitCutsToCapacity(2000, [1000], 20, withOverlap, 1000);
    expect(cuts).toEqual([1000, 1980]);
    for (const seg of segmentsFromCuts(2000, cuts, 20)) expect(seg.y1 - seg.y0).toBeLessThanOrEqual(1000);
  });
});
