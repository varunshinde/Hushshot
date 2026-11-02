import { expect, test } from './harness';

/**
 * Multi-page PDF quality on a page with mixed content: every page the same
 * size with the image at the same width, the image always fits its page, page
 * breaks never cut a line of text, and the space left at the bottom of each
 * page stays small and even.
 */

interface PdfPageGeom {
  width: number;
  height: number;
  /** Image placement in points (origin bottom-left). */
  img: { x: number; y: number; w: number; h: number };
}

async function pageGeometry(bytes: Buffer): Promise<PdfPageGeom[]> {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const out: PdfPageGeom[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const ops = await p.getOperatorList();
    let m: number[] = [1, 0, 0, 1, 0, 0];
    let img: PdfPageGeom['img'] | null = null;
    ops.fnArray.forEach((fn, j) => {
      if (fn === lib.OPS.transform) m = ops.argsArray[j] as number[];
      if (fn === lib.OPS.paintImageXObject) img = { x: m[4], y: m[5], w: m[0], h: m[3] };
    });
    out.push({ width: p.view[2], height: p.view[3], img: img! });
  }
  return out;
}

type Word = { x: number; y: number; w: number; h: number; source: string };

const SCENARIOS = [
  { paper: 'a4', margins: 'none' },
  { paper: 'a4', margins: 'normal' },
  { paper: 'letter', margins: 'small' },
] as const;

test.setTimeout(240_000);

test('fit-to-width PDF pages: same width, image fits, no cut text lines, small even bottom gaps', async ({ ext }) => {
  const { page, tabId } = await ext.open('paged.html');
  const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const rec = await ext.record(out.id!);
  const words: Word[] = rec.words.filter((w: Word) => w.source === 'dom');
  // Typical text line height in image px (90th percentile, so headings don't inflate it).
  const hs = words.map((w) => w.h).sort((a, b) => a - b);
  const lineH = hs[Math.floor(hs.length * 0.9)];

  // Image boxes (image px), to report how often figures are split.
  const imgs: [number, number][] = await page.evaluate((s) => [...document.querySelectorAll('img')].map((el) => {
    const r = el.getBoundingClientRect();
    return [(r.top + scrollY) * s, (r.bottom + scrollY) * s] as [number, number];
  }), rec.scale);

  for (const sc of SCENARIOS) {
    const { pdf, plan } = await ext.exportPdf(out.id!, { pdfPaper: sc.paper, pdfMargins: sc.margins, pdfOrientation: 'auto', pdfSmaller: true, segmentOverlap: 0 });
    const pages = await pageGeometry(pdf);
    expect(pages.length).toBe(plan.segments.length);
    const margin = { none: 0, small: 18, normal: 36 }[sc.margins];
    const k = pages[0].img.w / rec.width;
    const capacityPx = (pages[0].height - 2 * margin) / k;

    const gaps = pages.map((p) => p.img.y - margin); // top-aligned: bottom gap in points
    const cutWords = plan.cuts.filter((c: number) => words.some((w) => c > w.y + 1 && c < w.y + w.h - 1));
    const cutImages = plan.cuts.filter((c: number) => imgs.some(([a, b]) => c > a + 1 && c < b - 1));
    const gapPx = gaps.slice(0, -1).map((g) => g / k);
    console.log(
      `${sc.paper}/${sc.margins}: ${pages.length} pages, sizes ${[...new Set(pages.map((p) => `${p.width.toFixed(1)}x${p.height.toFixed(1)}`))].join(',')}, ` +
        `image widths ${[...new Set(pages.map((p) => p.img.w.toFixed(2)))].join(',')}, ` +
        `bottom gaps (px, excl. last) ${gapPx.map((g) => g.toFixed(0)).join(' ')}, line ${lineH.toFixed(0)}px, ` +
        `cut words ${cutWords.length}, cut images ${cutImages.length}/${plan.cuts.length}`,
    );

    // Every page has the same paper size and the image at the same width and left edge.
    for (const p of pages) {
      expect(p.width).toBeCloseTo(pages[0].width, 1);
      expect(p.height).toBeCloseTo(pages[0].height, 1);
      expect(p.img.w).toBeCloseTo(pages[0].width - 2 * margin, 1);
      expect(p.img.x).toBeCloseTo(margin, 1);
      // The image always fits inside the page margins.
      expect(p.img.y).toBeGreaterThanOrEqual(margin - 0.5);
      expect(p.img.y + p.img.h).toBeCloseTo(p.height - margin, 1);
    }
    // No page break passes through a line of text.
    expect(cutWords).toEqual([]);
    // Pages are filled: the gap left at the bottom stays within ~1.5 text lines,
    // except where a figure was kept whole (never more than 10% of the page).
    for (let i = 0; i < gapPx.length; i++) {
      const keptFigure = imgs.some(([a, b]) => b - a < capacityPx && a >= plan.segments[i].y1 - 2 && a <= plan.segments[i].y1 + lineH * 2);
      expect(gapPx[i], `page ${i + 1} bottom gap`).toBeLessThanOrEqual(keptFigure ? capacityPx * 0.1 : lineH * 1.5);
    }
  }
});

test('split lines placed for PNG never make PDF pages overflow', async ({ ext }) => {
  const { tabId } = await ext.open('paged.html');
  const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const rec = await ext.record(out.id!);
  // Split lines as if dragged in PNG mode: parts several paper pages tall.
  const userCuts = [7000, 15000];
  const hooks = await ext.hooks();
  await hooks.evaluate(([id, cuts]) => (globalThis as any).__lcPreviewTest.setSplits(id, cuts), [out.id!, userCuts] as const);

  const { pdf, plan } = await ext.exportPdf(out.id!, { pdfPaper: 'a4', pdfMargins: 'normal', pdfOrientation: 'auto', pdfSmaller: true, segmentOverlap: 40 });
  const pages = await pageGeometry(pdf);
  expect(pages.length).toBe(plan.segments.length);
  for (const c of userCuts) expect(plan.cuts).toContain(c);
  const k = pages[0].img.w / rec.width;
  for (const p of pages) {
    expect(p.img.w).toBeCloseTo(595.28 - 72, 1);
    expect(p.img.y, 'image stays inside the bottom margin').toBeGreaterThanOrEqual(36 - 0.5);
    expect(p.img.y + p.img.h).toBeCloseTo(841.89 - 36, 1);
    expect(p.img.h / k).toBeLessThanOrEqual((841.89 - 72) / k + 1);
  }
});

test('"page address and date" footer on every page, below the image', async ({ ext }) => {
  const { tabId } = await ext.open('paged.html');
  const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const { pdf, plan } = await ext.exportPdf(out.id!, { pdfPaper: 'a4', pdfMargins: 'none', pdfStamp: true, pdfSmaller: true, segmentOverlap: 0 });
  const pages = await pageGeometry(pdf);
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await lib.getDocument({ data: new Uint8Array(pdf) }).promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    const items = (tc.items as any[]).filter((it) => 'str' in it);
    const footer = items.filter((it) => it.transform[5] < 18);
    const text = footer.map((it) => it.str).join(' ');
    expect(text).toContain('127.0.0.1:4517/paged.html');
    expect(text).toContain(`Page ${i} of ${plan.segments.length}`);
    // The image sits above the footer band.
    expect(pages[i - 1].img.y).toBeGreaterThanOrEqual(18 - 0.5);
  }
});
