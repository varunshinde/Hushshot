import { exportImages, exportPdf, planSplits, type ExportFormat } from '../../lib/export/exporter';
import { TileSource } from '../../lib/image/render';
import { loadSettings, sanitizeSettings, type Settings } from '../../lib/settings';
import { getBlob, getCapture } from '../../lib/storage/db';
import { toMarkdown, toPlainText } from '../../lib/text/words';

/** E2E-only hooks (compiled out of production builds). */
async function b64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function ctx(id: string, patch: Partial<Settings> = {}) {
  const rec = await getCapture(id);
  if (!rec) throw new Error('missing capture');
  const settings = sanitizeSettings({ ...(await loadSettings()), ...patch });
  return { rec, settings, tiles: new TileSource(rec) };
}

export const previewTestHooks = {
  getRecord: (id: string) => getCapture(id),
  async waitFor(id: string, ocr = false, timeoutMs = 120000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const r = await getCapture(id);
      if (r && r.status === 'ready' && (!ocr || ['done', 'skipped', 'error'].includes(r.ocr.status))) return r;
      if (Date.now() > end) throw new Error(`timeout waiting for ${id}: ${r?.status} / ${r?.ocr.status}`);
      await new Promise((res) => setTimeout(res, 200));
    }
  },
  async plan(id: string, patch: Partial<Settings>, format: ExportFormat) {
    const { rec, settings, tiles } = await ctx(id, patch);
    try {
      return await planSplits(rec, tiles, settings, format);
    } finally {
      tiles.close();
    }
  },
  async exportImages(id: string, patch: Partial<Settings> = {}, format: 'png' | 'jpeg' | 'webp' = 'png') {
    const { rec, settings, tiles } = await ctx(id, patch);
    try {
      const plan = await planSplits(rec, tiles, settings, format);
      const files = await exportImages(rec, tiles, settings, plan, format);
      return { plan, files: await Promise.all(files.map(async (f) => ({ name: f.name, data: await b64(f.blob) }))) };
    } finally {
      tiles.close();
    }
  },
  async exportPdf(id: string, patch: Partial<Settings> = {}) {
    const { rec, settings, tiles } = await ctx(id, patch);
    try {
      const plan = await planSplits(rec, tiles, settings, 'pdf');
      const f = await exportPdf(rec, tiles, settings, plan);
      return { plan, name: f.name, data: await b64(f.blob) };
    } finally {
      tiles.close();
    }
  },
  async blob(key: string) {
    const b = await getBlob(key);
    return b ? b64(b) : null;
  },
  async text(id: string) {
    const rec = await getCapture(id);
    return { plain: toPlainText(rec!.words), md: toMarkdown(rec!.words, rec!.title) };
  },
};
