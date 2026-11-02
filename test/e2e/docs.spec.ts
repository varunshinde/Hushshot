import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { decode, expect, test, type Img } from './harness';

/** Writes the README screenshots to ./docs/images from the generic demo page (run with DOCS=1). */
const OUT = resolve(import.meta.dirname, '../../docs/images');
test.skip(!process.env.DOCS, 'set DOCS=1 to write README screenshots');
test.setTimeout(240_000);

const encode = (img: Img) => PNG.sync.write(Object.assign(new PNG({ width: img.width, height: img.height }), { data: img.data }));

/** Box-filter downscale by an integer factor. */
function shrink(img: Img, f: number): Img {
  const width = Math.floor(img.width / f), height = Math.floor(img.height / f);
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) sum += img.data[((y * f + dy) * img.width + x * f + dx) * 4 + c];
        data[(y * width + x) * 4 + c] = Math.round(sum / (f * f));
      }
  return { width, height, data };
}

function crop(img: Img, x: number, y: number, width: number, height: number): Img {
  const data = Buffer.alloc(width * height * 4);
  for (let r = 0; r < height; r++) img.data.copy(data, r * width * 4, ((y + r) * img.width + x) * 4, ((y + r) * img.width + x + width) * 4);
  return { width, height, data };
}

type W = { text: string; x: number; y: number; w: number; h: number; source: string };

test('write README screenshots', async ({ ext }) => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const save = (name: string, data: Buffer) => writeFileSync(join(OUT, name), data);

  // The page as you'd see it in the browser: cookie banner and chat bubble included.
  const demo = await ext.open('demo.html');
  await demo.page.setViewportSize({ width: 1280, height: 800 });
  await demo.page.waitForTimeout(500);
  save('demo-page.png', await demo.page.screenshot());

  const settings = { quality: 2, ocrMode: 'auto', hideCookieBanners: true, hideChatWidgets: true };
  const cap = await ext.capture(demo.tabId, { mode: 'full', settings });
  expect(cap.ok, cap.error).toBe(true);
  const rec = await ext.record(cap.id!, true);
  const words: W[] = rec.words;

  // The whole capture, shrunk 4x for the README, plus a 1:1 crop of the chart at 2x.
  const full = decode((await ext.exportPng(cap.id!, { maxSegmentHeight: 30000 })).files[0].png);
  save('full-page.png', encode(shrink(full, 4)));
  // The chart's box in image pixels (document CSS px × capture scale).
  const r = await demo.page.locator('#profile').evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height };
  });
  const s = rec.scale as number;
  const chart = { x0: r.x * s, y0: r.y * s, x1: (r.x + r.w) * s, y1: (r.y + r.h) * s };
  const ocr = words.filter((w) => w.source === 'ocr' && w.x >= chart.x0 - 4 && w.y >= chart.y0 - 4 && w.x + w.w <= chart.x1 + 4 && w.y + w.h <= chart.y1 + 4);
  expect(ocr.map((w) => w.text)).toContain('Elevation');
  const cx = Math.round(chart.x0) - 24, cy = Math.round(chart.y0) - 24;
  save('detail-2x.png', encode(crop(full, cx, cy, Math.round(chart.x1 - chart.x0) + 48, Math.round(chart.y1 - chart.y0) + 48)));

  // The README shows the popup after the one-time tips are dismissed.
  await (await ext.hooks()).evaluate(() => chrome.storage.local.set({ tipsSeen: true }));
  const popup = await ext.context.newPage();
  await popup.setViewportSize({ width: 340, height: 440 });
  await popup.goto(`chrome-extension://${ext.extId}/popup.html?tab=${demo.tabId}`);
  await popup.getByText(/MB|px/).first().waitFor({ timeout: 5000 }).catch(() => {});
  await popup.waitForTimeout(800);
  save('popup.png', await popup.screenshot());

  const preview = await ext.context.newPage();
  await preview.setViewportSize({ width: 1440, height: 900 });
  await preview.goto(`chrome-extension://${ext.extId}/preview.html?id=${cap.id}`);
  await preview.getByRole('button', { name: /Download PNG/ }).waitFor();
  await preview.waitForTimeout(1500);
  save('result.png', await preview.screenshot());

  await preview.getByRole('button', { name: 'Choose format' }).click();
  await preview.getByRole('menuitem', { name: /Download options/ }).click();
  await preview.getByRole('radio', { name: 'PDF' }).click();
  await preview.waitForTimeout(1500);
  save('export-pdf.png', await preview.screenshot());
  await preview.getByRole('radio', { name: 'PNG' }).click();
  await preview.getByRole('button', { name: 'Close options' }).click();

  // Crop mode: the whole page fits on screen; pull the bottom edge up to keep the top of the article.
  await preview.getByRole('button', { name: /^Crop/ }).click();
  await preview.waitForTimeout(400);
  const s1 = (await preview.locator('.h-s').boundingBox())!;
  await preview.mouse.move(s1.x + 7, s1.y + 7);
  await preview.mouse.down();
  await preview.mouse.move(s1.x + 7, s1.y - (s1.y - 140) * 0.62, { steps: 12 });
  await preview.mouse.up();
  await preview.waitForTimeout(300);
  save('crop.png', await preview.screenshot());
  await preview.getByRole('button', { name: 'Cancel' }).click();
  await preview.waitForTimeout(300);

  // Scroll to the canvas chart (text only OCR can read) and drag a box over it in "Select text" mode.
  await preview.getByRole('button', { name: 'Select text' }).click();
  let box = (await preview.locator('.canvas').boundingBox())!;
  const z = box.width / rec.width;
  await preview.locator('.viewport').evaluate((el, top) => (el.scrollTop = top), chart.y0 * z - 260);
  await preview.waitForTimeout(500);
  box = (await preview.locator('.canvas').boundingBox())!;
  await preview.mouse.move(box.x + (chart.x0 - 30) * z, box.y + (chart.y0 - 20) * z);
  await preview.mouse.down();
  await preview.mouse.move(box.x + (chart.x1 + 30) * z, box.y + (chart.y1 + 20) * z, { steps: 12 });
  await preview.mouse.up();
  await preview.waitForTimeout(400);
  save('select-text.png', await preview.screenshot());


  const options = await ext.context.newPage();
  await options.setViewportSize({ width: 960, height: 900 });
  await options.goto(`chrome-extension://${ext.extId}/options.html`);
  await options.waitForTimeout(1000);
  save('settings.png', await options.screenshot());
});
