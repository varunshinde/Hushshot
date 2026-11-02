import { describe, expect, it } from 'vitest';
import { geomForShot, planScrolls } from '../../src/lib/capture/plan';
import { restrictionReason } from '../../src/lib/capture/restricted';
import { computePlacements } from '../../src/lib/image/compose';

describe('tile planning', () => {
  it('covers a tall page with overlapping viewport tiles', () => {
    const shots = planScrolls({
      target: { x: 0, y: 0, width: 1000, height: 5000 },
      window: { width: 1000, height: 800 },
      maxScroll: { x: 0, y: 4200 },
      current: { x: 0, y: 1234 },
      overlap: 40,
      maxStepHeight: 4096,
    });
    expect(shots[0].y).toBe(0);
    expect(shots[shots.length - 1].y).toBe(4200);
    for (let i = 1; i < shots.length; i++) expect(shots[i].y - shots[i - 1].y).toBeLessThanOrEqual(760);
  });

  it('maps shots to a gap-free master image', () => {
    const scale = 2;
    const target = { x: 0, y: 0, width: 500, height: 2100 };
    const shots = planScrolls({ target, window: { width: 500, height: 600 }, maxScroll: { x: 0, y: 1500 }, current: { x: 0, y: 0 }, overlap: 16, maxStepHeight: 4096 });
    const geoms = shots.map((s, i) =>
      geomForShot({ tile: i, row: s.row, col: s.col, contentX: s.x, contentY: s.y, width: 500, height: 600, originX: 0, originY: 0, imageWidth: 1000, imageHeight: 1200 }, target, scale)!,
    );
    const p = computePlacements(geoms, 1000, 4200);
    const rows = new Uint8Array(4200);
    for (const q of p) for (let y = q.dy; y < q.dy + q.h; y++) rows[y]++;
    expect([...rows].every((r) => r === 1)).toBe(true);
    // Every master row comes from the image row showing the same content row.
    for (const q of p) {
      const shot = shots[q.tile];
      expect(q.sy / scale + shot.y).toBeCloseTo(q.dy / scale, 5);
    }
  });

  it('flags protected pages', () => {
    expect(restrictionReason('chrome://settings')).toMatch(/doesn't allow/);
    expect(restrictionReason('https://chromewebstore.google.com/detail/x')).toMatch(/doesn't allow/);
    expect(restrictionReason('https://example.com/')).toBeNull();
    expect(restrictionReason('file:///tmp/a.html')).toMatch(/file URLs/);
  });
});
