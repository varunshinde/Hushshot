import { describe, expect, it } from 'vitest';
import { alignOffset, computePlacements } from '../../src/lib/image/compose';
import type { TileGeom } from '../../src/lib/types';

describe('compose', () => {
  it('splits overlaps at the midpoint and covers every row exactly once', () => {
    const geoms: TileGeom[] = [0, 1, 2].map((i) => ({
      tile: i, row: i, col: 0,
      src: { x: 0, y: 0, width: 100, height: 100 },
      dst: { x: 0, y: i === 2 ? 170 : i * 90 },
    }));
    const p = computePlacements(geoms, 100, 270);
    const covered = new Uint8Array(270);
    for (const q of p) for (let y = q.dy; y < q.dy + q.h; y++) covered[y]++;
    expect([...covered].every((c) => c === 1)).toBe(true);
    // Source row must map back to the same master row.
    for (const q of p) expect(q.sy + geoms[q.tile].dst.y).toBe(q.dy);
  });

  it('finds the true offset between overlapping tiles', () => {
    const w = 64;
    const master = new Uint8Array(w * 400).map((_, i) => (Math.floor(i / w) * 37 + (i % w) * 11) & 255);
    const prev = master.slice(0, w * 200);
    const cur = master.slice(w * 153, w * 353);
    expect(alignOffset(prev, 200, cur, 200, w, 151, 4)).toBe(153);
  });

  it('keeps the expected offset on flat overlaps', () => {
    const w = 32;
    const flat = new Uint8Array(w * 100).fill(255);
    expect(alignOffset(flat, 100, flat, 100, w, 60, 4)).toBe(60);
  });
});
