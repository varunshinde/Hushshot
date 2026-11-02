import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from './harness';

/** Writes sample outputs from the fixtures to ./samples (run with SAMPLES=1). */
const OUT = resolve(import.meta.dirname, '../../samples');
test.skip(!process.env.SAMPLES, 'set SAMPLES=1 to write sample outputs');

test('write sample outputs', async ({ ext }) => {
  mkdirSync(OUT, { recursive: true });
  const save = (name: string, data: Buffer | string) => writeFileSync(join(OUT, name), data);

  const article = await ext.open('article.html');
  const a = await ext.capture(article.tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  expect(a.ok, a.error).toBe(true);
  for (const f of (await ext.exportPng(a.id!)).files) save(`article-2x_${f.name.split('_').pop()}`, f.png);
  save('article-2x-a4.pdf', (await ext.exportPdf(a.id!, { pdfPaper: 'a4' })).pdf);
  const t = await ext.text(a.id!);
  save('article.md', t.md);

  const paged = await ext.open('paged.html');
  const pg = await ext.capture(paged.tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  save('paged-a4-normal.pdf', (await ext.exportPdf(pg.id!, { pdfPaper: 'a4', pdfMargins: 'normal', pdfSmaller: true })).pdf);

  const sticky = await ext.open('sticky.html');
  const s = await ext.capture(sticky.tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  save('sticky-2x.png', (await ext.exportPng(s.id!, { maxSegmentHeight: 16000 })).files[0].png);

  const inner = await ext.open('inner-scroll.html');
  const i = await ext.capture(inner.tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  save('inner-scroll-2x.png', (await ext.exportPng(i.id!, { maxSegmentHeight: 16000 })).files[0].png);

  const ocr = await ext.open('ocr.html');
  const o = await ext.capture(ocr.tabId, { mode: 'element', elementSelector: '#shot', settings: { quality: 2, ocrMode: 'auto' } });
  await ext.record(o.id!, true);
  save('ocr-image-2x.png', (await ext.exportPng(o.id!)).files[0].png);
  save('ocr-image-2x-searchable.pdf', (await ext.exportPdf(o.id!, { pdfPaper: 'continuous' })).pdf);
  save('ocr-image.txt', (await ext.text(o.id!)).plain);

  // Preview page screenshot for a visual check of the UI.
  const preview = await ext.context.newPage();
  await preview.setViewportSize({ width: 1440, height: 900 });
  await preview.goto(`chrome-extension://${ext.extId}/preview.html?id=${a.id}`);
  await preview.getByRole('button', { name: /Download PNG/ }).waitFor();
  await preview.waitForTimeout(1500);
  save('preview-ui.png', await preview.screenshot());
  await preview.getByRole('radio', { name: 'PDF' }).click();
  await preview.waitForTimeout(1500);
  save('preview-ui-pdf.png', await preview.screenshot());
  const popup = await ext.context.newPage();
  await popup.setViewportSize({ width: 340, height: 600 });
  await popup.goto(`chrome-extension://${ext.extId}/popup.html`);
  await popup.getByText('Full page').first().waitFor();
  save('popup-ui.png', await popup.screenshot({ fullPage: true }));
});
