import { describe, expect, it } from 'vitest';
import { computeSplits, isSafeCut, mergeIntervals, segmentsFromCuts } from '../../src/lib/image/split';
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
