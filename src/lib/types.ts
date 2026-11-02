export type CaptureMode = 'visible' | 'full' | 'region' | 'element';
export type EngineKind = 'cdp' | 'scroll';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Vertical [start, end) interval in master-image pixels. */
export type Interval = [number, number];

/** One captured image as stored in IndexedDB. */
export interface TileRef {
  key: string;
  width: number;
  height: number;
}

/**
 * Where a captured tile lands in the master image, before seam alignment.
 * `src` is the usable area inside the tile image, `dst` its top-left in the
 * master image. `row`/`col` index the scroll grid (col > 0 only for full-width
 * captures of horizontally overflowing pages).
 */
export interface TileGeom {
  tile: number;
  row: number;
  col: number;
  src: Rect;
  dst: { x: number; y: number };
}

/** A pixel-exact blit from tile `tile` into the master image. */
export interface Placement {
  tile: number;
  sx: number;
  sy: number;
  w: number;
  h: number;
  dx: number;
  dy: number;
}

export type WordSource = 'dom' | 'ocr';

/** A word with its box in master-image pixels. */
export interface Word {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  source: WordSource;
  /** 0-100. DOM words are 100. */
  conf: number;
  /** Line id, unique within the capture. Words of one line share it. */
  line: number;
  /** Block id (paragraph / heading / list item / OCR block). */
  block: number;
  /** Block-level tag for DOM words, e.g. "h1", "li", "p", "pre". */
  tag?: string;
}

export type OcrStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface CaptureRecord {
  id: string;
  createdAt: number;
  url: string;
  title: string;
  mode: CaptureMode;
  engine: EngineKind;
  /** Master-image pixels per CSS pixel. */
  scale: number;
  /** 96 × scale. Written into PNG pHYs. */
  dpi: number;
  /** Master image size in pixels. */
  width: number;
  height: number;
  tiles: TileRef[];
  geoms: TileGeom[];
  /** Filled by the offscreen finalize step. */
  placements: Placement[];
  /** Spans (text lines, images, controls) a split line must not cut through. */
  forbidden: Interval[];
  /** Areas without DOM text where image OCR should run (images, canvas, …). */
  ocrRegions: Rect[];
  words: Word[];
  crop: Rect | null;
  /** User-adjusted split positions; null means "compute automatically". */
  splits: number[] | null;
  warnings: string[];
  status: 'capturing' | 'finalizing' | 'ready' | 'error';
  error?: string;
  ocr: { status: OcrStatus; progress: number; error?: string; words?: number };
  thumbKey?: string;
  sourceTabId?: number;
  /** Total bytes of the stored tile PNGs, used for size estimates. */
  tileBytes: number;
}

export interface CaptureSummary {
  id: string;
  createdAt: number;
  title: string;
  url: string;
  width: number;
  height: number;
  thumbKey?: string;
  status: CaptureRecord['status'];
}
