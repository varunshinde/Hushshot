import { describe, expect, it } from 'vitest';
import { characterErrorRate, normalizeBackground, ocrUpscale } from '../../src/lib/ocr/preprocess';

describe('ocr preprocessing', () => {
  it('upscales to at least 300 DPI', () => {
    expect(ocrUpscale(1)).toBe(4);
    expect(ocrUpscale(2)).toBe(2);
    expect(ocrUpscale(4)).toBe(1);
  });

  it('turns light-on-dark and dark-on-light into dark-on-white', () => {
    const w = 200, h = 100;
    const g = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dark = x >= 100;
      const ink = y % 10 === 0 && x % 7 === 0;
      g[y * w + x] = dark ? (ink ? 230 : 20) : (ink ? 30 : 245);
    }
    const out = normalizeBackground(g, w, h, 32);
    expect(out[5 * w + 50]).toBeGreaterThan(240); // light bg -> white
    expect(out[5 * w + 150]).toBeGreaterThan(240); // dark bg -> white
    expect(out[0 * w + 49]).toBeLessThan(40); // dark ink stays dark
    expect(out[0 * w + 154]).toBeLessThan(40); // light ink becomes dark
  });

  it('computes character error rate', () => {
    expect(characterErrorRate('hello', 'hello')).toBe(0);
    expect(characterErrorRate('hello', 'hallo')).toBeCloseTo(0.2);
  });
});
