import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ocrHtml } from './ocr-truth';

/** Render the OCR fixture image (text baked into pixels) with plain Chromium, at 2x. */
export default async function globalSetup() {
  const dir = join(import.meta.dirname, '..', 'fixtures', 'generated');
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' }); // short-lived: headless is fine
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 800, height: 600 } });
  await page.setContent(ocrHtml());
  const png = await page.locator('#box').screenshot();
  writeFileSync(join(dir, 'ocr-text.png'), png);
  await browser.close();
}
