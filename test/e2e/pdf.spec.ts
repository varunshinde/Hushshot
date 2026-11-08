import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { characterErrorRate, expect, norm, test } from './harness';

async function pdfjs(bytes: Buffer) {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await lib.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: { width: number; height: number; items: { str: string; x: number; y: number; w: number }[] }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    pages.push({
      width: p.view[2],
      height: p.view[3],
      items: (tc.items as any[]).filter((it) => 'str' in it).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })),
    });
  }
  return { info: (await doc.getMetadata()).info as Record<string, string>, pages };
}

const tool = (name: string) => {
  try {
    execFileSync('which', [name]);
    return true;
  } catch {
    return false;
  }
};

test('multi-page A4 PDF is searchable, selectable and aligned with the image', async ({ ext }) => {
  const { page, tabId } = await ext.open('article.html');
  const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const { pdf, plan, name } = await ext.exportPdf(out.id!, { pdfPaper: 'a4', pdfMargins: 'none', pdfSmaller: false });
  expect(name).toMatch(/\.pdf$/);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  const dir = mkdtempSync(join(tmpdir(), 'lc-pdf-'));
  const file = join(dir, 'capture.pdf');
  writeFileSync(file, pdf);
  test.info().attachments.push({ name: 'article-a4.pdf', path: file, contentType: 'application/pdf' });

  // pdf.js (Firefox's engine): pages, metadata, full text and positions.
  const doc = await pdfjs(pdf);
  expect(doc.pages.length).toBe(plan.segments.length);
  expect(doc.pages.length).toBeGreaterThan(10);
  expect(doc.pages[0].width).toBeCloseTo(595.28, 1);
  expect(doc.info.Title).toBe('Long article fixture');
  expect(doc.info.Subject).toMatch(/article\.html$/);
  expect(doc.info.Producer).toBe('Hushshot');
  const pdfText = norm(doc.pages.map((p) => p.items.map((i) => i.str).join(' ')).join(' '));
  const domText = norm(await page.evaluate(() => document.getElementById('content')!.innerText));
  const cer = characterErrorRate(domText.replace(/\s/g, ''), pdfText.replace(/\s/g, ''));
  expect(cer, 'text layer vs DOM text').toBeLessThan(0.001);

  // Alignment: the heading "Section 5:" must sit where it is in the page.
  const k = 595.28 / 2560;
  const rect = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((e) => e.textContent!.startsWith('Section 5:'))!;
    const r = document.createRange();
    r.selectNodeContents(h.firstChild!);
    const b = r.getClientRects()[0];
    return { left: b.left + scrollX, bottom: b.bottom + scrollY };
  });
  const segIdx = plan.segments.findIndex((s: any) => s.y0 <= rect.bottom * 2 && s.y1 > rect.bottom * 2);
  const item = doc.pages[segIdx].items.find((i) => i.str.startsWith('Section'))!;
  const pageItems = doc.pages[segIdx].items.filter((i) => i.str.startsWith('Section'));
  const hit = pageItems.find((i) => Math.abs(i.x - rect.left * 2 * k) < 2 && Math.abs(i.y - (doc.pages[segIdx].height - (rect.bottom * 2 - plan.segments[segIdx].y0) * k)) < 2) ?? item;
  expect(Math.abs(hit.x - rect.left * 2 * k)).toBeLessThan(2);
  expect(Math.abs(hit.y - (doc.pages[segIdx].height - (rect.bottom * 2 - plan.segments[segIdx].y0) * k))).toBeLessThan(2);

  // Poppler (pdftotext), if installed.
  if (tool('pdftotext')) {
    const txt = execFileSync('pdftotext', [file, '-']).toString();
    expect(norm(txt)).toContain('A very long article for stitching tests');
    expect(norm(txt)).toContain('Section 5:');
  }

  // macOS PDFKit (Preview's engine): text found and selection bounds line up.
  if (process.platform === 'darwin' && existsSync('/usr/bin/swift')) {
    const res = JSON.parse(execFileSync('swift', [join(import.meta.dirname, 'pdfkit-check.swift'), file, 'Section 5:'], { timeout: 180000 }).toString());
    expect(res.pages).toBe(doc.pages.length);
    expect(res.found).toBe(true);
    expect(res.page).toBe(segIdx);
    const [bx, by] = res.bounds;
    expect(Math.abs(bx - rect.left * 2 * k)).toBeLessThan(3);
    // PDFKit bounds start at the glyph box bottom = our word box bottom (baseline).
    expect(Math.abs(by - (res.pageHeight - (rect.bottom * 2 - plan.segments[segIdx].y0) * k))).toBeLessThan(3);
  }
});

test('continuous-page PDF uses the image size at its DPI', async ({ ext }) => {
  const { tabId } = await ext.open('article.html');
  const out = await ext.capture(tabId, { mode: 'region', region: { x: 0, y: 0, width: 1280, height: 3000 }, settings: { quality: 2, ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const { pdf, plan } = await ext.exportPdf(out.id!, { pdfPaper: 'continuous', maxSegmentHeight: 16000 });
  const doc = await pdfjs(pdf);
  expect(doc.pages.length).toBe(1);
  expect(plan.segments.length).toBe(1);
  // 2560 x 6000 px at 192 DPI = 960 x 2250 pt.
  expect(doc.pages[0].width).toBeCloseTo(960, 1);
  expect(doc.pages[0].height).toBeCloseTo(2250, 1);
});

test('vector PDF (print) contains real text', async ({ ext }) => {
  const { tabId } = await ext.open('sticky.html');
  const out = await ext.capture(tabId, { mode: 'visible', settings: { quality: 2, ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const key = await ext.sw.evaluate((id) => (globalThis as any).__lcTest.printPdf(id), out.id!);
  const h = await ext.hooks();
  const data = Buffer.from(await h.evaluate((k) => (globalThis as any).__lcPreviewTest.blob(k), key), 'base64');
  expect(data.subarray(0, 5).toString()).toBe('%PDF-');
  const doc = await pdfjs(data);
  expect(norm(doc.pages[0].items.map((i) => i.str).join(' '))).toContain('Sticky site header');
});
