import { readPngInfo } from '../../src/lib/image/png';
import { decode, expect, extensionDebuggerAttached, rulerErrors, stack, test } from './harness';

for (const q of [2, 3] as const) {
  test(`visible area at ${q}x has exact pixel dimensions and pHYs DPI`, async ({ ext }) => {
    const { page, tabId } = await ext.open('article.html');
    await page.evaluate(() => scrollTo(0, 5000));
    const out = await ext.capture(tabId, { mode: 'visible', settings: { quality: q, ocrMode: 'demand' } });
    expect(out.ok, out.error).toBe(true);
    const { files } = await ext.exportPng(out.id!);
    expect(files.length).toBe(1);
    const info = readPngInfo(new Uint8Array(files[0].png));
    expect(info.width).toBe(1280 * q);
    expect(info.height).toBe(800 * q);
    expect(info.dpi).toBeCloseTo(96 * q, 1);
    expect(rulerErrors(decode(files[0].png), q, 5000).bad).toBe(0);
    // Page state restored afterwards: scroll, prep stylesheet, scale override, debugger.
    // Clearing the override returns the tab to the browser's natural metrics; that
    // also drops Playwright's own viewport emulation, so width/height are not compared.
    const after = await page.evaluate(() => ({ y: scrollY, dpr: devicePixelRatio, prep: !!document.getElementById('__localcapture_prep') }));
    expect(after).toMatchObject({ y: 5000, prep: false });
    if (q > 2) expect(after.dpr).toBeLessThan(q);
    expect(await extensionDebuggerAttached(ext, tabId)).toBe(false);
  });
}

test('region beyond the viewport is captured exactly', async ({ ext }) => {
  const { tabId } = await ext.open('article.html');
  const region = { x: 0, y: 3000, width: 600, height: 1700 };
  const out = await ext.capture(tabId, { mode: 'region', region, settings: { quality: 2, ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const img = stack((await ext.exportPng(out.id!)).files.map((f) => f.png));
  expect([img.width, img.height]).toEqual([1200, 3400]);
  expect(rulerErrors(img, 2, 3000).bad).toBe(0);
});

test('element taller than the viewport is captured to its full bounds', async ({ ext }) => {
  const { page, tabId } = await ext.open('article.html');
  const r = await page.evaluate(() => {
    const el = document.getElementById('content')!;
    el.style.minHeight = '0';
    const b = el.getBoundingClientRect();
    return { w: b.width, h: b.height };
  });
  const out = await ext.capture(tabId, { mode: 'element', elementSelector: '#content', settings: { quality: 2, ocrMode: 'demand', maxSegmentHeight: 16000 } });
  expect(out.ok, out.error).toBe(true);
  const rec = await ext.record(out.id!);
  expect(rec.width).toBe(Math.round(r.w * 2));
  expect(rec.height).toBe(Math.round(Math.min(r.h, 30000) * 2));
  expect(r.h).toBeGreaterThan(800);
});
