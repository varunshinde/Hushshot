import { chromium } from '@playwright/test';
import { readPngInfo } from '../../src/lib/image/png';
import { BASE, characterErrorRate, decode, expect, norm, rulerErrors, stack, test, type Img } from './harness';

/** Independent ground truth: plain Chromium (no extension) at the same scale, rendered in clipped chunks. */
async function groundTruth(scale: number, cssHeight: number): Promise<Img> {
  const browser = await chromium.launch({ channel: 'chrome', headless: !!process.env.E2E_HEADLESS, args: ['--window-position=-3000,-3000'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: scale });
  await page.goto(`${BASE}/article.html`);
  const chunks: Buffer[] = [];
  const step = 2500;
  for (let y = 0; y < cssHeight; y += step) {
    chunks.push(await page.screenshot({ clip: { x: 0, y, width: 1280, height: Math.min(step, cssHeight - y) }, fullPage: true }));
  }
  await browser.close();
  return stack(chunks);
}

function diffRatio(a: Img, b: Img, tol = 24): number {
  expect(a.width).toBe(b.width);
  expect(a.height).toBe(b.height);
  let bad = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > tol || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) bad++;
  }
  return bad / (a.width * a.height);
}

test.describe('full page, 25,000 px article', () => {
  test('CDP 2x: no seams, no duplicated or missing rows, matches ground truth', async ({ ext }) => {
    const { tabId } = await ext.open('article.html');
    const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, engine: 'auto', ocrMode: 'demand' } });
    expect(out.ok, out.error).toBe(true);
    const rec = await ext.record(out.id!);
    expect(rec.engine).toBe('cdp');
    expect(rec.scale).toBe(2);
    expect(rec.width).toBe(2560);
    expect(rec.height).toBe(50000);

    const { files, plan } = await ext.exportPng(out.id!);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const info = readPngInfo(new Uint8Array(f.png));
      expect(info.dpi).toBeCloseTo(192, 0);
      expect(info.colorType).toBe(2); // RGB: opaque
    }
    expect(files[0].name).toMatch(/^long-article-fixture_\d{4}-\d{2}-\d{2}_\d{4}_part-01-of-\d{2}\.png$/);
    const master = stack(files.map((f) => f.png));
    expect(master.height).toBe(50000);
    const ruler = rulerErrors(master, 2);
    expect(ruler.bad, `rows with wrong ruler code, first at ${ruler.firstBad}`).toBe(0);

    const truth = await groundTruth(2, 25000);
    const ratio = diffRatio(master, truth);
    console.log(`ground-truth diff: ${(ratio * 100).toFixed(4)}% of pixels differ by >24/255`);
    test.info().annotations.push({ type: 'ground-truth diff', description: `${(ratio * 100).toFixed(4)}% of pixels differ by >24/255` });
    expect(ratio).toBeLessThan(0.001);
    expect(plan.segments.length).toBe(files.length);
  });

  test('scroll-and-stitch engine: seam-free at native DPR', async ({ ext }) => {
    const { page, tabId } = await ext.open('article.html');
    const out = await ext.capture(tabId, { mode: 'full', settings: { engine: 'scroll', ocrMode: 'demand' } });
    expect(out.ok, out.error).toBe(true);
    const rec = await ext.record(out.id!);
    expect(rec.engine).toBe('scroll');
    // captureVisibleTab captures at the display's real pixel ratio (2 on a
    // Retina Mac), regardless of Playwright's DPR emulation.
    const dpr = rec.scale as number;
    expect([1, 2, 3]).toContain(dpr);
    void page;
    expect(rec.height).toBe(25000 * dpr);
    const { files } = await ext.exportPng(out.id!);
    const master = stack(files.map((f) => f.png));
    const ruler = rulerErrors(master, dpr);
    expect(ruler.bad, `first bad rows ${ruler.firstBad}`).toBe(0);
  });

  test('DOM text layer is exact (0% CER) and smart split never cuts a text line', async ({ ext }) => {
    const { page, tabId } = await ext.open('article.html');
    const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
    expect(out.ok, out.error).toBe(true);
    const { plain } = await ext.text(out.id!);
    const truth = await page.evaluate(() => document.getElementById('content')!.innerText);
    expect(characterErrorRate(norm(truth), norm(plain))).toBe(0);

    // Independent DOM line boxes, measured now in the page.
    const lines = await page.evaluate(() => {
      const out: [number, number][] = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const r = document.createRange();
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.nodeValue?.trim() || n.parentElement?.tagName === 'SCRIPT') continue;
        r.selectNodeContents(n);
        for (const rect of r.getClientRects()) out.push([rect.top + scrollY, rect.bottom + scrollY]);
      }
      return out;
    });
    for (const target of [8000, 3000, 1234]) {
      const plan = await ext.plan(out.id!, { maxSegmentHeight: target });
      for (const cut of plan.cuts as number[]) {
        const css = cut / 2;
        const through = lines.filter(([a, b]) => css > a + 0.01 && css < b - 0.01);
        expect(through, `cut at ${cut}px (target ${target}) crosses a text line`).toEqual([]);
      }
      // Each segment within ±15% of the target except the last.
      plan.segments.slice(0, -1).forEach((s: { y0: number; y1: number }) => {
        expect(s.y1 - s.y0).toBeGreaterThanOrEqual(target * 0.85 - 1);
        expect(s.y1 - s.y0).toBeLessThanOrEqual(target * 1.15 + 1);
      });
    }
    // Also decode one to be sure every exported part is a valid PNG.
    const { files } = await ext.exportPng(out.id!, { maxSegmentHeight: 3000 });
    expect(decode(files[0].png).width).toBe(2560);
  });
});
