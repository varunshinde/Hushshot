// Renders assets/icon.svg to the PNG sizes Chrome uses (public/icons). Run: node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const svg = readFileSync(resolve(root, 'assets/icon.svg'), 'utf8');
// The 16 px toolbar icon uses a pixel-aligned variant; fine lines blur at that size.
const small = readFileSync(resolve(root, 'assets/icon-small.svg'), 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${size === 16 ? small : svg}`);
  writeFileSync(resolve(root, `public/icons/icon-${size}.png`), await page.screenshot({ omitBackground: true }));
}
await browser.close();
console.log('icons written to public/icons');
