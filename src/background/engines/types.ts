import type { EngineKind } from '../../lib/types';
import type { Settings } from '../../lib/settings';

export interface ShotRequest {
  /** Visible window onto the scroll root, client coordinates (CSS px). */
  view: { x: number; y: number; width: number; height: number };
  /** Window scroll position (document coordinates = client + window scroll). */
  winX: number;
  winY: number;
  /** For CDP beyond-viewport tiles: an explicit clip in document coordinates. */
  docClip?: { x: number; y: number; width: number; height: number };
}

export interface Shot {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Where the requested window's top-left sits inside the image (CSS px). */
  originX: number;
  originY: number;
  /** CSS width of the area the image represents (for measuring the scale). */
  cssWidth: number;
}

/**
 * A capture engine renders the tab's pixels for one tile. The shared tile
 * loop (capture.ts) handles scrolling, sticky elements and geometry.
 */
export interface CaptureEngine {
  kind: EngineKind;
  begin(tabId: number, windowId: number, settings: Settings): Promise<void>;
  shoot(req: ShotRequest): Promise<Shot>;
  /** Always safe to call, including after errors or cancel. */
  end(): Promise<void>;
}

export class CaptureCancelled extends Error {
  constructor() {
    super('Capture cancelled');
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
