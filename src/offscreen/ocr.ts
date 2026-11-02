import Tesseract from 'tesseract.js/dist/tesseract.esm.min.js';
import { computeSplits } from '../lib/image/split';
import { readPixels, renderArea, rowEnergyFrom, TileSource } from '../lib/image/render';
import { broadcast } from '../lib/messages';
import { tesseractOptions } from '../lib/ocr/config';
import { adaptiveThreshold, choosePsm, grayToRgba, normalizeBackground, ocrUpscale, toGray } from '../lib/ocr/preprocess';
import type { Settings } from '../lib/settings';
import { getCapture, updateCapture } from '../lib/storage/db';
import { mergeWords } from '../lib/text/words';
import type { CaptureRecord, Rect, Word } from '../lib/types';

/**
 * Image OCR for areas without DOM text, run by Tesseract.js in a Web Worker
 * hosted by this offscreen document. Everything is loaded from the extension
 * package; nothing is fetched.
 */

type TWorker = Awaited<ReturnType<typeof Tesseract.createWorker>>;
let workerPromise: Promise<TWorker> | null = null;
let workerLangs = '';
let onProgress: ((p: number) => void) | null = null;

async function getWorker(langs: string[]): Promise<TWorker> {
  const key = langs.join('+');
  if (workerPromise && workerLangs === key) return workerPromise;
  if (workerPromise) (await workerPromise).terminate().catch(() => {});
  workerLangs = key;
  workerPromise = Tesseract.createWorker(langs, Tesseract.OEM.LSTM_ONLY, {
    ...tesseractOptions((p) => chrome.runtime.getURL(p)),
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  workerPromise.catch(() => (workerPromise = null));
  return workerPromise;
}

const MIN_CONF = 55;
const MAX_PIXELS = 24_000_000;
const CHUNK_ROWS = 1800;

interface Job {
  area: Rect;
  whole: boolean;
}

function mergeRegions(rects: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of [...rects].sort((a, b) => b.width * b.height - a.width * a.height)) {
    const inside = out.some((o) => r.x >= o.x - 2 && r.y >= o.y - 2 && r.x + r.width <= o.x + o.width + 2 && r.y + r.height <= o.y + o.height + 2);
    if (!inside) out.push(r);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Split tall areas at blank rows so Tesseract gets manageable images and no text line is cut. */
async function chunkArea(rec: CaptureRecord, area: Rect, tiles: TileSource): Promise<Rect[]> {
  if (area.height <= CHUNK_ROWS * 1.15) return [area];
  const energy = rowEnergyFrom(tiles, rec.placements, area);
  const local = rec.forbidden
    .map(([a, b]) => [a - area.y, b - area.y] as [number, number])
    .filter(([a, b]) => b > 0 && a < area.height);
  const { cuts } = await computeSplits(Math.round(area.height), local, { target: CHUNK_ROWS }, energy);
  const edges = [0, ...cuts, Math.round(area.height)];
  const out: Rect[] = [];
  for (let i = 0; i + 1 < edges.length; i++) out.push({ x: area.x, y: area.y + edges[i], width: area.width, height: edges[i + 1] - edges[i] });
  return out;
}

export async function runOcr(id: string, settings: Settings): Promise<void> {
  const rec = await getCapture(id);
  if (!rec) throw new Error(`Capture ${id} not found`);
  const domChars = rec.words.filter((w) => w.source === 'dom').reduce((n, w) => n + w.text.length, 0);
  const whole = settings.ocrWholeImage === 'always' || (settings.ocrWholeImage === 'auto' && domChars < 40);
  const tiles = new TileSource(rec);
  const jobs: Job[] = [];
  const crop = rec.crop ?? { x: 0, y: 0, width: rec.width, height: rec.height };
  if (whole) for (const a of await chunkArea(rec, crop, tiles)) jobs.push({ area: a, whole: true });
  else for (const r of mergeRegions(rec.ocrRegions)) for (const a of await chunkArea(rec, r, tiles)) jobs.push({ area: a, whole: false });

  if (!jobs.length) {
    await updateCapture(id, (r) => {
      r.ocr = { status: 'skipped', progress: 1, words: 0 };
    });
    broadcast({ type: 'capture-updated', id });
    tiles.close();
    return;
  }

  await updateCapture(id, (r) => {
    r.ocr = { status: 'running', progress: 0 };
  });
  broadcast({ type: 'ocr-progress', id, progress: 0, status: 'Loading OCR engine' });

  const ocrWords: Word[] = [];
  let lineId = 1_000_000;
  let blockId = 1_000_000;
  try {
    const worker = await getWorker(settings.ocrLanguages);
    const totalArea = jobs.reduce((n, j) => n + j.area.width * j.area.height, 0);
    let doneArea = 0;
    for (const job of jobs) {
      const a = job.area;
      let f = ocrUpscale(rec.scale);
      while (f > 1 && a.width * f * a.height * f > MAX_PIXELS) f--;
      const canvas = await renderArea(tiles, rec.placements, a, f);
      const px = readPixels(canvas);
      const gray = normalizeBackground(toGray(px.data), canvas.width, canvas.height, Math.round(48 * f));
      const prepped = settings.ocrThreshold ? adaptiveThreshold(gray, canvas.width, canvas.height, Math.round(15 * f) | 1) : gray;
      const psm = choosePsm(prepped, canvas.width, canvas.height, f * rec.scale);
      const ctx = canvas.getContext('2d')!;
      ctx.putImageData(new ImageData(grayToRgba(prepped), canvas.width, canvas.height), 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      await worker.setParameters({
        tessedit_pageseg_mode: psm as unknown as Tesseract.PSM,
        user_defined_dpi: String(Math.round(96 * rec.scale * f)),
        preserve_interword_spaces: '1',
      });
      const jobArea = a.width * a.height;
      onProgress = (p) => broadcast({ type: 'ocr-progress', id, progress: (doneArea + p * jobArea) / totalArea, status: 'Recognizing text' });
      const { data } = await worker.recognize(blob, {}, { blocks: true, text: false });
      onProgress = null;
      for (const block of data.blocks ?? []) {
        const b = blockId++;
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            const l = lineId++;
            for (const w of line.words) {
              const text = w.text.trim();
              if (!text || w.confidence < MIN_CONF || !/[\p{L}\p{N}]/u.test(text)) continue;
              ocrWords.push({
                text,
                x: a.x + w.bbox.x0 / f,
                y: a.y + w.bbox.y0 / f,
                w: (w.bbox.x1 - w.bbox.x0) / f,
                h: (w.bbox.y1 - w.bbox.y0) / f,
                source: 'ocr',
                conf: Math.round(w.confidence),
                line: l,
                block: b,
              });
            }
          }
        }
      }
      doneArea += jobArea;
      broadcast({ type: 'ocr-progress', id, progress: doneArea / totalArea, status: 'Recognizing text' });
    }
    await updateCapture(id, (r) => {
      r.words = mergeWords(r.words.filter((w) => w.source === 'dom'), ocrWords);
      r.ocr = { status: 'done', progress: 1, words: ocrWords.length };
    });
  } catch (e) {
    await updateCapture(id, (r) => {
      r.ocr = { status: 'error', progress: 0, error: String((e as Error)?.message ?? e) };
    });
    throw e;
  } finally {
    onProgress = null;
    tiles.close();
    broadcast({ type: 'capture-updated', id });
  }
}
