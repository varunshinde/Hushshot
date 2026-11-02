import { readPixels, renderArea, rowEnergyFrom, type TileSource } from '../image/render';
import { computeSplits, fitCutsToCapacity, paginate, segmentsFromCuts, type Segment } from '../image/split';
import { fitLayout, pageForSegment, type FitLayout, type PdfImage, type PdfPageInput } from '../pdf/build';
import type { Settings } from '../settings';
import { lineIntervals, wordsForArea } from '../text/words';
import type { CaptureRecord, Interval, Rect } from '../types';
import { buildFilename } from './filename';
import { runExportJob } from './worker-client';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'pdf';

export interface SplitPlan {
  area: Rect;
  cuts: number[];
  segments: Segment[];
  target: number;
  methods: string[];
}

export function exportArea(rec: CaptureRecord): Rect {
  return rec.crop ?? { x: 0, y: 0, width: rec.width, height: rec.height };
}

/** Forbidden intervals relative to the export area: DOM layout data plus OCR text lines. */
export function localForbidden(rec: CaptureRecord, area: Rect): Interval[] {
  const ocr = lineIntervals(rec.words.filter((w) => w.source === 'ocr'));
  return [...rec.forbidden, ...ocr]
    .map(([a, b]) => [a - area.y, b - area.y] as Interval)
    .filter(([a, b]) => b > 0 && a < area.height);
}

/** Text line boxes relative to the export area (DOM and OCR words). */
function localLines(rec: CaptureRecord, area: Rect): Interval[] {
  return lineIntervals(rec.words)
    .map(([a, b]) => [a - area.y, b - area.y] as Interval)
    .filter(([a, b]) => b > 0 && a < area.height);
}

/** One page layout for the whole PDF, so every page has the same size, orientation and scale. */
export function pdfLayout(rec: CaptureRecord, s: Settings): FitLayout {
  const area = exportArea(rec);
  return fitLayout(area.width, area.height, pdfLayoutOptions(rec, s));
}

export function pdfLayoutOptions(rec: CaptureRecord, s: Settings) {
  return { paper: s.pdfPaper, margins: s.pdfMargins, orientation: s.pdfOrientation, dpi: rec.dpi, footer: s.pdfStamp };
}

/** Footer text for "page address and date" PDFs. */
export function pdfFooter(rec: CaptureRecord, page: number, pages: number) {
  const when = new Date(rec.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return { left: rec.url, right: `Captured ${when} \u00b7 Page ${page} of ${pages}` };
}

/** Segment height target for a format (PDF fit-to-width: one paper page, less the overlap). */
export function segmentTarget(rec: CaptureRecord, s: Settings, format: ExportFormat): { target: number; hard: boolean } {
  if (format === 'pdf' && s.pdfPaper !== 'continuous') {
    return { target: Math.max(50, pdfLayout(rec, s).rowsPerPage - s.segmentOverlap), hard: true };
  }
  return { target: s.maxSegmentHeight, hard: false };
}

export async function planSplits(rec: CaptureRecord, tiles: TileSource, s: Settings, format: ExportFormat): Promise<SplitPlan> {
  const area = exportArea(rec);
  const { target, hard } = segmentTarget(rec, s, format);
  const H = Math.round(area.height);
  const energy = rowEnergyFrom(tiles, rec.placements, area);
  let cuts: number[];
  let methods: string[] = [];
  if (hard) {
    // Fixed-size pages: fill each page and break between text lines (see paginate).
    const lines = localLines(rec, area);
    const objects = localForbidden(rec, area);
    const breaks = async (y0: number, y1: number) => {
      const shift = (list: Interval[]) => list.map(([a, b]) => [a - y0, b - y0] as Interval).filter(([a, b]) => b > 0 && a < y1 - y0);
      const r = await paginate(y1 - y0, shift(lines), shift(objects), { capacity: target }, (a, b) => energy(a + y0, b + y0));
      methods.push(...r.methods);
      return r.cuts.map((c) => c + y0);
    };
    // Split lines the user placed are kept, with extra breaks wherever a part wouldn't fit a page.
    cuts = rec.splits ? await fitCutsToCapacity(H, rec.splits, s.segmentOverlap, breaks, target + s.segmentOverlap) : await breaks(0, H);
  } else if (rec.splits) {
    cuts = rec.splits.filter((c) => c > 0 && c < H);
  } else {
    const r = await computeSplits(H, localForbidden(rec, area), { target, maxFrac: 1.15, hardMax: 16000 }, energy);
    cuts = r.cuts;
    methods = r.methods;
  }
  return { area, cuts, segments: segmentsFromCuts(H, cuts, s.segmentOverlap), target, methods };
}

export function segmentRect(area: Rect, seg: Segment): Rect {
  return { x: area.x, y: area.y + seg.y0, width: area.width, height: seg.y1 - seg.y0 };
}

export interface ExportedFile {
  name: string;
  blob: Blob;
}

const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const;

export async function exportImages(
  rec: CaptureRecord,
  tiles: TileSource,
  s: Settings,
  plan: SplitPlan,
  format: 'png' | 'jpeg' | 'webp',
  onProgress?: (p: number) => void,
): Promise<ExportedFile[]> {
  const out: ExportedFile[] = [];
  const total = plan.segments.length;
  const date = new Date(rec.createdAt);
  for (let i = 0; i < total; i++) {
    const canvas = await renderArea(tiles, rec.placements, segmentRect(plan.area, plan.segments[i]));
    let blob: Blob;
    if (format === 'png') {
      const px = readPixels(canvas);
      const bytes = await runExportJob({ op: 'png', rgba: px.data.buffer as ArrayBuffer, width: px.width, height: px.height, dpi: rec.dpi }, [px.data.buffer]);
      blob = new Blob([bytes as BlobPart], { type: 'image/png' });
    } else {
      blob = await canvas.convertToBlob({ type: MIME[format], quality: s.lossyQuality });
    }
    const ext = format === 'jpeg' ? 'jpg' : format;
    out.push({ name: buildFilename(s.filenameTemplate, { title: rec.title, date, part: i + 1, total, ext }), blob });
    onProgress?.((i + 1) / total);
  }
  return out;
}

export async function exportZip(rec: CaptureRecord, s: Settings, files: ExportedFile[]): Promise<ExportedFile> {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  const bytes = await runExportJob({ op: 'zip', files: entries }, Object.values(entries).map((b) => b.buffer));
  return { name: buildFilename(s.filenameTemplate, { title: rec.title, date: new Date(rec.createdAt), ext: 'zip' }), blob: new Blob([bytes as BlobPart], { type: 'application/zip' }) };
}

export async function exportPdf(
  rec: CaptureRecord,
  tiles: TileSource,
  s: Settings,
  plan: SplitPlan,
  onProgress?: (p: number) => void,
): Promise<ExportedFile> {
  const pages: PdfPageInput[] = [];
  const layout = pdfLayoutOptions(rec, s);
  const doc = pdfLayout(rec, s);
  const n = plan.segments.length;
  for (let i = 0; i < n; i++) {
    const rect = segmentRect(plan.area, plan.segments[i]);
    const canvas = await renderArea(tiles, rec.placements, rect);
    let image: PdfImage;
    if (s.pdfSmaller) {
      const jpg = await canvas.convertToBlob({ type: 'image/jpeg', quality: s.lossyQuality });
      image = { kind: 'jpeg', width: canvas.width, height: canvas.height, data: new Uint8Array(await jpg.arrayBuffer()) };
    } else {
      const px = readPixels(canvas);
      const data = await runExportJob({ op: 'flate', rgba: px.data.buffer as ArrayBuffer, width: px.width, height: px.height }, [px.data.buffer]);
      image = { kind: 'flate-rgb', width: canvas.width, height: canvas.height, data };
    }
    pages.push({
      image,
      words: wordsForArea(rec.words, rect),
      ...pageForSegment(canvas.width, canvas.height, layout, doc),
      ...(s.pdfStamp ? { footer: pdfFooter(rec, i + 1, n) } : {}),
    });
    onProgress?.(((i + 1) / n) * 0.9);
  }
  const bytes = await runExportJob(
    { op: 'pdf', pages, meta: { title: rec.title, subject: rec.url, created: new Date(rec.createdAt) } },
    pages.map((p) => p.image.data.buffer),
  );
  onProgress?.(1);
  return {
    name: buildFilename(s.filenameTemplate, { title: rec.title, date: new Date(rec.createdAt), ext: 'pdf' }),
    blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }),
  };
}

/** Rough output sizes for the preview header. */
export function estimateSizes(rec: CaptureRecord, s: Settings) {
  const area = exportArea(rec);
  const tilePx = rec.tiles.reduce((n, t) => n + t.width * t.height, 0) || 1;
  const png = (rec.tileBytes * (area.width * area.height)) / tilePx;
  return { png, pdf: s.pdfSmaller ? area.width * area.height * 0.18 : png * 1.04 };
}
