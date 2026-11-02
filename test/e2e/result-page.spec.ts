import type { Page } from '@playwright/test';
import { decode, expect, test, type Ext } from './harness';

/** The result page: crop with handles, zoom (buttons, slider, keys, pinch) and the download menu. */
test.setTimeout(180_000);

async function openResult(ext: Ext, id: string): Promise<Page> {
  const p = await ext.context.newPage();
  await p.setViewportSize({ width: 1400, height: 900 });
  await p.goto(`chrome-extension://${ext.extId}/preview.html?id=${id}`);
  await p.getByRole('button', { name: /^Download / }).first().waitFor();
  await p.waitForTimeout(500);
  return p;
}

const percent = async (p: Page) => Number((await p.locator('.zoom .pct').textContent())!.replace('%', ''));

test('crop: adjust the box with handles, finish with Done, and export exactly that area', async ({ ext }) => {
  const demo = await ext.open('demo.html');
  const cap = await ext.capture(demo.tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  expect(cap.ok, cap.error).toBe(true);
  const rec = await ext.record(cap.id!);
  const p = await openResult(ext, cap.id!);

  await p.getByRole('button', { name: /^Crop/ }).click();
  await expect(p.getByRole('button', { name: 'Fit page' })).toHaveAttribute('aria-pressed', 'true');
  await expect(p.locator('.crop-box')).toBeVisible();
  const z = (await p.locator('.canvas').boundingBox())!.width / rec.width;
  // The whole capture fits on screen in crop mode, so every handle is reachable.
  const canvas = (await p.locator('.canvas').boundingBox())!;
  expect(canvas.y + canvas.height).toBeLessThanOrEqual(900);

  const drag = async (sel: string, dx: number, dy: number) => {
    const b = (await p.locator(sel).boundingBox())!;
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down();
    await p.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 8 });
    await p.mouse.up();
  };
  await drag('.h-se', -120, -300);
  await drag('.h-nw', 40, 60);
  await expect(p.locator('.crop-size')).toBeVisible();

  // Esc cancels: nothing is saved.
  await p.keyboard.press('Escape');
  await expect(p.locator('.crop-box')).toHaveCount(0);
  expect((await ext.record(cap.id!)).crop).toBeNull();

  // Again, then Done.
  await p.getByRole('button', { name: /^Crop/ }).click();
  await drag('.h-se', -120, -300);
  await drag('.h-nw', 40, 60);
  await p.getByRole('button', { name: 'Done cropping' }).click();
  const crop = (await ext.record(cap.id!)).crop;
  expect(crop).not.toBeNull();
  const tol = 2 / z + 2;
  expect(Math.abs(crop.x - 40 / z)).toBeLessThan(tol);
  expect(Math.abs(crop.y - 60 / z)).toBeLessThan(tol);
  expect(Math.abs(crop.x + crop.width - (rec.width - 120 / z))).toBeLessThan(tol);
  expect(Math.abs(crop.y + crop.height - (rec.height - 300 / z))).toBeLessThan(tol);

  // Only the cropped area is shown afterwards.
  await expect(p.locator('.chip', { hasText: 'Cropped' })).toBeVisible();
  const shown = (await p.locator('.canvas').boundingBox())!;
  const z2 = shown.width / crop.width;
  expect(Math.abs(shown.height - crop.height * z2)).toBeLessThan(2);

  // Exports are exactly the crop, pixel for pixel.
  const out = decode((await ext.exportPng(cap.id!, { maxSegmentHeight: 16000 })).files[0].png);
  expect([out.width, out.height]).toEqual([crop.width, crop.height]);
  await p.getByRole('button', { name: 'Remove' }).click();
  await expect.poll(async () => (await ext.record(cap.id!)).crop).toBeNull();
  const full = decode((await ext.exportPng(cap.id!, { maxSegmentHeight: 16000 })).files[0].png);
  for (const row of [0, Math.floor(crop.height / 2), crop.height - 1]) {
    const a = out.data.subarray(row * out.width * 4, (row + 1) * out.width * 4);
    const start = ((crop.y + row) * full.width + crop.x) * 4;
    expect(Buffer.compare(Buffer.from(a), full.data.subarray(start, start + out.width * 4))).toBe(0);
  }
});

test('crop on a page taller than the screen: dragging to the edge scrolls and keeps growing the box', async ({ ext }) => {
  const { tabId } = await ext.open('article.html');
  const cap = await ext.capture(tabId, { mode: 'full', settings: { quality: 1, ocrMode: 'demand' } });
  expect(cap.ok, cap.error).toBe(true);
  const p = await openResult(ext, cap.id!);
  await p.getByRole('button', { name: /^Crop/ }).click();
  await p.keyboard.press('1'); // actual pixels: only a small part of the page is on screen
  await p.waitForTimeout(300);
  const vp = (await p.locator('.viewport').boundingBox())!;
  const c = (await p.locator('.canvas').boundingBox())!;
  // Draw a new box from near the top and hold the pointer at the bottom edge.
  await p.mouse.move(c.x + 50, Math.max(c.y, vp.y) + 40);
  await p.mouse.down();
  await p.mouse.move(c.x + 400, vp.y + vp.height - 4, { steps: 10 });
  for (let i = 0; i < 25; i++) {
    await p.mouse.move(c.x + 400 + (i % 2), vp.y + vp.height - 4);
    await p.waitForTimeout(60);
  }
  await p.mouse.up();
  const scrolled = await p.locator('.viewport').evaluate((el) => el.scrollTop);
  expect(scrolled).toBeGreaterThan(300);
  await p.getByRole('button', { name: 'Done cropping' }).click();
  const crop = (await ext.record(cap.id!)).crop;
  // Taller than what fitted on screen when the drag started.
  expect(crop.height).toBeGreaterThan(vp.height + 300);
});

test('zoom: fit buttons, slider, keys and trackpad pinch around the pointer', async ({ ext }) => {
  const demo = await ext.open('demo.html');
  const cap = await ext.capture(demo.tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  expect(cap.ok, cap.error).toBe(true);
  const rec = await ext.record(cap.id!);
  const p = await openResult(ext, cap.id!);

  const fitWidth = await percent(p);
  await p.getByRole('button', { name: 'Fit page' }).click();
  const fitPage = await percent(p);
  expect(fitPage).toBeLessThan(fitWidth);
  const c = (await p.locator('.canvas').boundingBox())!;
  expect(c.height).toBeLessThanOrEqual(900);

  await p.getByRole('button', { name: 'Fit width' }).click();
  expect(await percent(p)).toBe(fitWidth);
  await p.keyboard.press('+');
  expect(await percent(p)).toBeGreaterThan(fitWidth);
  await p.getByRole('button', { name: 'Zoom out' }).click();
  await p.getByRole('button', { name: 'Zoom out' }).click();
  expect(await percent(p)).toBeLessThan(fitWidth);

  await p.getByRole('slider', { name: 'Zoom' }).fill('1000');
  expect(await percent(p)).toBe(800);
  await p.getByRole('button', { name: /%$/ }).click(); // actual pixels
  expect(await percent(p)).toBe(100);

  // Pinch (Chrome sends it as a ctrl + wheel event) zooms in around the pointer.
  await p.getByRole('button', { name: 'Fit width' }).click();
  const vp = (await p.locator('.viewport').boundingBox())!;
  // Whole pixels: the wheel event reports the pointer position rounded.
  const at = { x: Math.round(vp.x + vp.width * 0.7), y: Math.round(vp.y + vp.height * 0.6) };
  const before = (await p.locator('.canvas').boundingBox())!;
  const z0 = before.width / rec.width;
  const imgPt = { x: (at.x - before.x) / z0, y: (at.y - before.y) / z0 };
  await p.mouse.move(at.x, at.y);
  await p.keyboard.down('Control');
  await p.mouse.wheel(0, -120);
  await p.keyboard.up('Control');
  await p.waitForTimeout(300);
  const after = (await p.locator('.canvas').boundingBox())!;
  const z1 = after.width / rec.width;
  expect(z1).toBeGreaterThan(z0 * 1.5);
  expect(Math.abs(after.x + imgPt.x * z1 - at.x)).toBeLessThan(2);
  expect(Math.abs(after.y + imgPt.y * z1 - at.y)).toBeLessThan(2);
  // The browser's own page zoom didn't change.
  expect(await p.evaluate(() => Math.round(window.devicePixelRatio * 100))).toBe(100);
});

test('download menu: choosing a format in Download options updates the main button and is remembered', async ({ ext }) => {
  const demo = await ext.open('demo.html');
  const cap = await ext.capture(demo.tabId, { mode: 'visible', settings: { quality: 1, ocrMode: 'demand' } });
  expect(cap.ok, cap.error).toBe(true);
  const p = await openResult(ext, cap.id!);
  await expect(p.getByRole('button', { name: 'Download PNG' }).first()).toBeVisible();
  await p.getByRole('button', { name: 'Choose format' }).click();
  await expect(p.getByRole('menuitem', { name: /PDF/ })).toBeVisible();
  await p.keyboard.press('Escape');
  await expect(p.getByRole('menu')).toHaveCount(0);
  await p.getByRole('button', { name: 'Choose format' }).click();
  await p.getByRole('menuitem', { name: /Download options/ }).click();
  await p.getByRole('radio', { name: 'PDF' }).click();
  await expect(p.getByRole('button', { name: 'Download PDF' }).first()).toBeVisible();
  await p.getByLabel('Add page address and date').check();
  const s = await ext.sw.evaluate(() => (globalThis as any).__lcTest.loadSettings());
  expect(s.downloadFormat).toBe('pdf');
  expect(s.pdfStamp).toBe(true);
  // A new result page opens with the remembered format.
  const p2 = await openResult(ext, cap.id!);
  await expect(p2.getByRole('button', { name: 'Download PDF' }).first()).toBeVisible();
  await ext.sw.evaluate(() => (globalThis as any).__lcTest.saveSettings({ downloadFormat: 'png', pdfStamp: false }));
});
