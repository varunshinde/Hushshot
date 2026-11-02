import { zlibSync } from 'fflate';
import { filterScanlines, rgbaToRgb } from '../image/png';
import type { PdfImage } from './build';

/** Lossless PDF image: PNG-filtered RGB scanlines, deflated (alpha is dropped; screenshots are opaque). */
export function flateRgbImage(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): PdfImage {
  const data = zlibSync(filterScanlines(rgbaToRgb(rgba), width, height, 3), { level: 6 });
  return { kind: 'flate-rgb', width, height, data };
}
