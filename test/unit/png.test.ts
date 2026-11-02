import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { crc32, encodePng, readPngInfo, withPhys } from '../../src/lib/image/png';

function gradient(w: number, h: number, alpha = 255) {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    d[i] = x * 7; d[i + 1] = y * 13; d[i + 2] = (x * y) & 255; d[i + 3] = alpha;
  }
  return d;
}

describe('png', () => {
  it('crc32 matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('encodes opaque images as lossless RGB with pHYs', () => {
    const src = gradient(37, 23);
    const bytes = encodePng(src, 37, 23, { dpi: 192 });
    const info = readPngInfo(bytes);
    expect(info).toMatchObject({ width: 37, height: 23, bitDepth: 8, colorType: 2 });
    expect(info.chunks.slice(0, 2)).toEqual(['IHDR', 'pHYs']);
    expect(info.dpi).toBeCloseTo(192, 0);
    const dec = PNG.sync.read(Buffer.from(bytes));
    expect(Buffer.from(dec.data).equals(Buffer.from(src))).toBe(true);
  });

  it('keeps alpha when present', () => {
    const src = gradient(9, 5, 100);
    const bytes = encodePng(src, 9, 5);
    expect(readPngInfo(bytes).colorType).toBe(6);
    expect(Buffer.from(PNG.sync.read(Buffer.from(bytes)).data).equals(Buffer.from(src))).toBe(true);
  });

  it('replaces pHYs in an existing PNG', () => {
    const a = encodePng(gradient(4, 4), 4, 4, { dpi: 96 });
    const b = withPhys(a, 288);
    expect(readPngInfo(b).dpi).toBeCloseTo(288, 0);
    expect(readPngInfo(b).chunks.filter((c) => c === 'pHYs')).toHaveLength(1);
    PNG.sync.read(Buffer.from(b));
  });
});
