import { characterErrorRate, expect, norm, test } from './harness';
import { OCR_LINES } from './ocr-truth';

test('image OCR: character error rate < 2% at 2x (fonts, sizes, light and dark backgrounds)', async ({ ext }) => {
  const { tabId } = await ext.open('ocr.html');
  const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'auto' } });
  expect(out.ok, out.error).toBe(true);
  const rec = await ext.record(out.id!, true);
  expect(rec.ocr.status, rec.ocr.error).toBe('done');
  const ocrWords = rec.words.filter((w: any) => w.source === 'ocr');
  const got = norm(ocrWords.map((w: any) => w.text).join(' '));
  const want = norm(OCR_LINES.map((l) => l.text).join(' '));
  const cer = characterErrorRate(want, got);
  console.log(`OCR CER ${(cer * 100).toFixed(2)}%\n  want: ${want}\n  got:  ${got}`);
  test.info().annotations.push({ type: 'OCR CER', description: `${(cer * 100).toFixed(2)}%` });
  expect(cer).toBeLessThan(0.02);

  // OCR words live inside the image's box and merge into "Copy text" after the DOM heading.
  const { plain } = await ext.text(out.id!);
  expect(plain.indexOf('Screenshot with text')).toBeLessThan(plain.indexOf('quick brown fox'));
});

test('DOM-text pages have 0% CER and need no OCR', async ({ ext }) => {
  const { page, tabId } = await ext.open('sticky.html');
  const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'auto' } });
  expect(out.ok, out.error).toBe(true);
  const rec = await ext.record(out.id!, true);
  expect(['skipped', 'done']).toContain(rec.ocr.status);
  expect(rec.words.filter((w: any) => w.source === 'ocr').length).toBe(0);
  const { plain } = await ext.text(out.id!);
  const truth = await page.evaluate(() => document.body.innerText);
  expect(characterErrorRate(norm(truth), norm(plain))).toBe(0);
});
