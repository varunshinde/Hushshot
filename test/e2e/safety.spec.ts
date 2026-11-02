import { expect, extensionDebuggerAttached, test } from './harness';

test('chrome:// pages show the friendly "can\'t capture" message', async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto('chrome://version');
  await page.bringToFront();
  const out = await ext.sw.evaluate(() => (globalThis as any).__lcTest.capture({ mode: 'full' }));
  expect(out.ok).toBe(false);
  expect(out.code).toBe('restricted');
  expect(out.error).toMatch(/Chrome doesn't allow capturing this page/);

  // Same request from the popup path opens the error page instead of failing silently.
  const hooks = await ext.hooks();
  const tabId = await ext.sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  await page.bringToFront();
  const opened = ext.context.waitForEvent('page', (p) => p.url().includes('preview.html?error=restricted'));
  await hooks.evaluate((id) => chrome.runtime.sendMessage({ target: 'background', type: 'capture', mode: 'visible', tabId: id }), tabId);
  const errPage = await opened;
  await expect(errPage.getByRole('heading')).toHaveText("This page can't be captured");
  await expect(errPage.getByRole('alert')).toContainText("Chrome doesn't allow capturing this page");
});

async function pageIsClean(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    prep: !!document.getElementById('__localcapture_prep'),
    attrs: document.querySelectorAll('[data-lc-hide],[data-lc-hide-always],[data-lc-unstick]').length,
    overlay: !!document.querySelector('localcapture-overlay'),
    y: scrollY,
  }));
}

test('cancelling mid-capture detaches the debugger and restores the page', async ({ ext }) => {
  const { page, tabId } = await ext.open('sticky.html');
  await page.evaluate(() => scrollTo(0, 1234));
  const out = await ext.capture(tabId, { mode: 'full', cancelAfterTiles: 3, settings: { quality: 3 } });
  expect(out.ok).toBe(false);
  expect(out.cancelled).toBe(true);
  expect(await extensionDebuggerAttached(ext, tabId)).toBe(false);
  expect(await pageIsClean(page)).toEqual({ prep: false, attrs: 0, overlay: false, y: 1234 });
  expect(await page.evaluate(() => devicePixelRatio)).toBeLessThan(3);
});

test('Esc in the page cancels a running capture', async ({ ext }) => {
  const { page, tabId } = await ext.open('article.html');
  const running = ext.capture(tabId, { mode: 'full', settings: { quality: 2, lazyPrepass: true } });
  await page.waitForFunction(() => !!document.getElementById('__localcapture_prep'));
  await page.keyboard.press('Escape');
  const out = await running;
  expect(out.cancelled).toBe(true);
  expect(await extensionDebuggerAttached(ext, tabId)).toBe(false);
  expect((await pageIsClean(page)).prep).toBe(false);
});

test('privacy: every mode, OCR and every export stay on the machine', async ({ ext }) => {
  // (The harness also asserts this after every test; here we exercise everything at once
  // and check the monitor really sees the offscreen document and its workers.)
  const { page, tabId } = await ext.open('ocr.html');
  for (const mode of ['visible', 'full'] as const) {
    const out = await ext.capture(tabId, { mode, settings: { quality: 2, ocrMode: 'auto', ocrWholeImage: 'always' } });
    expect(out.ok, out.error).toBe(true);
    await ext.record(out.id!, true);
    await ext.exportPng(out.id!);
    await ext.exportPdf(out.id!);
  }
  await page.bringToFront(); // scroll-and-stitch needs the tab in front
  const r = await ext.capture(tabId, { mode: 'region', region: { x: 0, y: 0, width: 400, height: 300 }, settings: { engine: 'scroll' } });
  expect(r.ok, r.error).toBe(true);
  const e = await ext.capture(tabId, { mode: 'element', elementSelector: '#shot' });
  expect(e.ok, e.error).toBe(true);
  await ext.exportPng(e.id!);
  const urls = ext.monitor.requests.map((x) => x.url);
  expect(urls.some((u) => u.endsWith('/ocr/lang/eng.traineddata.gz')), 'monitor saw the OCR worker load its model').toBe(true);
  expect(urls.some((u) => u.endsWith('/ocr/core/tesseract-core-simd-lstm.wasm.js'))).toBe(true);
  expect(ext.monitor.foreign()).toEqual([]);
  expect((await ext.proxyLog()).filter((x) => !/google|gstatic|gvt1/.test(x.url))).toEqual([]);
});
