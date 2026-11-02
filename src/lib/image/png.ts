import { zlibSync } from 'fflate';

/**
 * Lossless PNG encoder: 8-bit RGB when the image is fully opaque, RGBA
 * otherwise, with a pHYs chunk declaring the effective DPI. Written by hand
 * (instead of canvas.toBlob) so colour type and metadata are deterministic.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length, seed = 0xffffffff): number {
  let c = seed;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

export function dpiToPixelsPerMeter(dpi: number): number {
  return Math.round(dpi / 0.0254);
}

export function physChunk(dpi: number): Uint8Array {
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  const ppm = dpiToPixelsPerMeter(dpi);
  dv.setUint32(0, ppm);
  dv.setUint32(4, ppm);
  data[8] = 1; // unit: metre
  return chunk('pHYs', data);
}

export function isOpaque(rgba: Uint8Array | Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false;
  return true;
}

/** Drop the alpha channel. */
export function rgbaToRgb(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i];
    out[j + 1] = rgba[i + 1];
    out[j + 2] = rgba[i + 2];
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Apply PNG row filters (adaptive: per row, the filter with the smallest sum
 * of absolute signed residuals). Output is the byte stream PNG IDAT and PDF
 * FlateDecode /Predictor 15 both expect: one filter-type byte per row.
 */
export function filterScanlines(px: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * (stride + 1));
  const cand = Array.from({ length: 5 }, () => new Uint8Array(stride));
  const zero = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : zero;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = prev[i];
        const cc = i >= bpp ? prev[i - bpp] : 0;
        const x = row[i];
        let v: number;
        switch (f) {
          case 0: v = x; break;
          case 1: v = x - a; break;
          case 2: v = x - b; break;
          case 3: v = x - ((a + b) >> 1); break;
          default: v = x - paeth(a, b, cc);
        }
        v &= 0xff;
        c[i] = v;
        sum += v < 128 ? v : 256 - v;
        if (sum >= bestSum) break;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    // Recompute the chosen filter fully (the loop above may have exited early).
    const o = y * (stride + 1);
    out[o] = best;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const cc = i >= bpp ? prev[i - bpp] : 0;
      const x = row[i];
      let v: number;
      switch (best) {
        case 0: v = x; break;
        case 1: v = x - a; break;
        case 2: v = x - b; break;
        case 3: v = x - ((a + b) >> 1); break;
        default: v = x - paeth(a, b, cc);
      }
      out[o + 1 + i] = v & 0xff;
    }
  }
  return out;
}

export interface EncodeOptions {
  dpi?: number;
  /** zlib level 0-9. Default 6. */
  level?: number;
}

export function encodePng(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  opts: EncodeOptions = {},
): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error('RGBA buffer size mismatch');
  const opaque = isOpaque(rgba);
  const bpp = opaque ? 3 : 4;
  const px = opaque ? rgbaToRgb(rgba) : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const filtered = filterScanlines(px, width, height, bpp);
  const idat = zlibSync(filtered, { level: (opts.level ?? 6) as 6 });

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // colour type RGB / RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr)];
  if (opts.dpi) parts.push(physChunk(opts.dpi));
  parts.push(chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  /** DPI from pHYs, if present and in metres. */
  dpi?: number;
  chunks: string[];
}

export function readPngInfo(bytes: Uint8Array): PngInfo {
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  const info: PngInfo = { width: 0, height: 0, bitDepth: 0, colorType: 0, chunks: [] };
  while (off < bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    info.chunks.push(type);
    const d = off + 8;
    if (type === 'IHDR') {
      info.width = dv.getUint32(d);
      info.height = dv.getUint32(d + 4);
      info.bitDepth = bytes[d + 8];
      info.colorType = bytes[d + 9];
    } else if (type === 'pHYs' && bytes[d + 8] === 1) {
      info.dpi = Math.round(dv.getUint32(d) * 0.0254 * 100) / 100;
    }
    off = d + len + 4;
    if (type === 'IEND') break;
  }
  return info;
}

/** Insert (or replace) a pHYs chunk in an existing PNG. */
export function withPhys(bytes: Uint8Array, dpi: number): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pieces: Uint8Array[] = [bytes.subarray(0, 8)];
  let off = 8;
  while (off < bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const end = off + 12 + len;
    if (type !== 'pHYs') pieces.push(bytes.subarray(off, end));
    if (type === 'IHDR') pieces.push(physChunk(dpi));
    off = end;
  }
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of pieces) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
