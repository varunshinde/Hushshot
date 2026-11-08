import { describe, expect, it } from 'vitest';
import { buildPdf, fitLayout, FOOTER_PT, pageForSegment } from '../../src/lib/pdf/build';
import { flateRgbImage } from '../../src/lib/pdf/image';
import { buildGlyphlessFont } from '../../src/lib/pdf/glyphless';
import type { Word } from '../../src/lib/types';

async function pdfText(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: false } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push({ view: page.view, items: tc.items as { str: string; transform: number[]; width: number; height: number }[] });
  }
  return { meta: await doc.getMetadata(), pages };
}

describe('pdf', () => {
  it('builds a valid glyphless font', () => {
    const f = buildGlyphlessFont();
    expect(f.length % 4).toBe(0);
    expect(new DataView(f.buffer).getUint32(0)).toBe(0x00010000);
  });

  it('lays out fit-to-width pages', () => {
    const l = fitLayout(2000, 9000, { paper: 'a4', margins: 'none', orientation: 'auto', dpi: 192 });
    expect(l.k).toBeCloseTo(595.28 / 2000);
    expect(l.rowsPerPage).toBe(Math.floor(841.89 / l.k));
    const c = pageForSegment(1000, 500, { paper: 'continuous', margins: 'none', orientation: 'auto', dpi: 192 });
    expect(c.widthPt).toBeCloseTo(375);
  });

  it('keeps every page of a long capture in the document layout, including a short last page', () => {
    const o = { paper: 'a4', margins: 'normal', orientation: 'auto', dpi: 192 } as const;
    const doc = fitLayout(2000, 20000, o);
    const middle = pageForSegment(2000, doc.rowsPerPage, o, doc);
    const last = pageForSegment(2000, 300, o, doc); // wider than tall on its own
    for (const p of [middle, last]) {
      expect(p.widthPt).toBeCloseTo(595.28);
      expect(p.heightPt).toBeCloseTo(841.89);
      expect(p.box.w).toBeCloseTo(595.28 - 72);
      expect(p.box.y + p.box.h).toBeCloseTo(841.89 - 36);
    }
    expect(middle.box.y).toBeGreaterThanOrEqual(36 - 1e-6);
  });

  it('writes an invisible text layer aligned with the image', async () => {
    const W = 400, H = 200;
    const rgba = new Uint8Array(W * H * 4).fill(255);
    const words: Word[] = [
      { text: 'Hello', x: 20, y: 30, w: 80, h: 20, source: 'dom', conf: 100, line: 1, block: 1 },
      { text: 'wörld', x: 110, y: 30, w: 80, h: 20, source: 'dom', conf: 100, line: 1, block: 1 },
      { text: 'Next', x: 20, y: 80, w: 60, h: 20, source: 'ocr', conf: 90, line: 2, block: 1 },
    ];
    const geo = pageForSegment(W, H, { paper: 'continuous', margins: 'none', orientation: 'auto', dpi: 96 });
    const bytes = await buildPdf([{ image: flateRgbImage(rgba, W, H), words, ...geo }], {
      title: 'Test page', subject: 'http://example.test/', created: new Date('2026-11-01T10:00:00Z'),
    });
    const { meta, pages } = await pdfText(bytes);
    expect((meta.info as Record<string, string>).Title).toBe('Test page');
    expect((meta.info as Record<string, string>).Producer).toBe('Hushshot');
    const text = pages[0].items.map((i) => i.str).join('');
    expect(text.replace(/\s+/g, ' ').trim()).toContain('Hello wörld');
    expect(text).toContain('Next');
    const hello = pages[0].items.find((i) => i.str.startsWith('Hello'))!;
    // 96 dpi -> 0.75 pt per px. x = 20px -> 15pt; baseline at (200 - 50) px -> 112.5pt.
    expect(hello.transform[4]).toBeCloseTo(15, 0);
    expect(hello.transform[5]).toBeCloseTo(112.5, 0);
    // Box spans to the next word (90px) for 'Hello ' (6 glyphs); pdf.js may report 'Hello' alone.
    expect(hello.width).toBeCloseTo((90 * 0.75 * [...hello.str].length) / 6, 0);
  });

  it('prints the page address and date in a footer band that never overlaps the image', async () => {
    const o = { paper: 'a4', margins: 'none', orientation: 'portrait', dpi: 192 } as const;
    expect(fitLayout(2000, 9000, { ...o, footer: true }).rowsPerPage).toBeLessThan(fitLayout(2000, 9000, o).rowsPerPage);
    const W = 1600, H = 300;
    const image = flateRgbImage(new Uint8Array(W * H * 4).fill(255), W, H);
    const geo = pageForSegment(W, H, { ...o, paper: 'continuous', footer: true });
    expect(geo.box.y).toBeCloseTo(FOOTER_PT);
    expect(geo.heightPt).toBeCloseTo(geo.box.h + FOOTER_PT);
    const url = 'https://example.com/a-very-long-path/that-keeps-going/and-going/until-it-no-longer-fits-on-the-page/index.html?q=1';
    const bytes = await buildPdf([{ image, words: [], ...geo, footer: { left: url, right: 'Captured 2 Nov 2026, 14:32 · Page 1 of 1' } }], { title: 't', subject: 's', created: new Date(0) });
    const { pages } = await pdfText(bytes);
    const text = pages[0].items.map((i) => i.str).join(' ');
    expect(text).toContain('Page 1 of 1');
    expect(text).toContain('https://example.com/');
    for (const it of pages[0].items) expect(it.transform[5]).toBeLessThan(FOOTER_PT);
    const left = pages[0].items.find((i) => i.str.startsWith('https://'))!;
    const right = pages[0].items.find((i) => i.str.includes('Page 1'))!;
    expect(left.transform[4] + left.width).toBeLessThan(right.transform[4]);
  });
});
