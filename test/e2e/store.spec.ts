import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from './harness';

/**
 * Chrome Web Store images (run with STORE=1 after `pnpm docs:screenshots`):
 * five 1280×800 screenshots with a caption, a 440×280 small promo tile and a
 * 1400×560 marquee, all built from the website screenshots in docs/images.
 */
const DOCS = resolve(import.meta.dirname, '../../docs/images');
const OUT = resolve(import.meta.dirname, '../../store/images');
test.skip(!process.env.STORE, 'set STORE=1 to write the Chrome Web Store images');
test.setTimeout(120_000);

const img = (name: string) => `data:image/png;base64,${readFileSync(join(DOCS, name)).toString('base64')}`;

const BASE = `
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #141b26;
    background: linear-gradient(160deg, #eef3ff 0%, #f7f8fb 55%, #e9f0ff 100%); }
  .shot { border-radius: 12px; box-shadow: 0 2px 6px rgba(20, 30, 45, .10), 0 24px 60px rgba(20, 30, 45, .22); display: block; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; }
`;

/** A store screenshot: caption on top, the product screenshot below. */
function slide(title: string, sub: string, body: string) {
  return `<!doctype html><html><head><style>${BASE}
    .top { padding: 44px 64px 0; display: flex; justify-content: space-between; align-items: flex-start; gap: 32px; }
    h1 { font-size: 40px; line-height: 1.15; letter-spacing: -.02em; }
    p { font-size: 20px; color: #586273; margin-top: 10px; }
    .brand { font-size: 22px; flex: none; margin-top: 6px; }
    .stage { position: absolute; left: 64px; right: 64px; top: 196px; bottom: 0; display: flex; justify-content: center; align-items: flex-start; }
  </style></head><body>
    <div class="top"><div><h1>${title}</h1><p>${sub}</p></div><div class="brand"><img src="${img('icon-128.png')}" width="36" height="36">Hushshot</div></div>
    <div class="stage">${body}</div>
  </body></html>`;
}

test('write Chrome Web Store images', async ({ ext }) => {
  mkdirSync(OUT, { recursive: true });
  const page = await ext.context.newPage();
  const render = async (name: string, html: string, width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await page.setContent(html);
    await page.waitForTimeout(300);
    writeFileSync(join(OUT, name), await page.screenshot());
  };

  const wide = (name: string) => `<img class="shot" src="${img(name)}" style="width: 1152px; height: auto; border-radius: 12px 12px 0 0">`;

  await render('1-full-page.png', slide('The whole page, pixel-sharp', 'Capture entire web pages at 2× to 4×, then download PNG or PDF in one click.', wide('result.png')), 1280, 800);
  await render(
    '2-popup.png',
    slide(
      'One click from the toolbar',
      'Full page, visible area, a region or a single element. Shortcuts for each.',
      `<div style="position: relative; width: 1152px">
         <img class="shot" src="${img('demo-page.png')}" style="width: 1152px; height: auto; border-radius: 12px 12px 0 0; filter: saturate(.9)">
         <img class="shot" src="${img('popup.png')}" style="position: absolute; right: 36px; top: 24px; width: 340px; height: auto">
       </div>`,
    ),
    1280,
    800,
  );
  await render('3-pdf.png', slide('Searchable PDFs, lossless images', 'Pick paper size, margins and page breaks. Every word can be searched and selected.', wide('export-pdf.png')), 1280, 800);
  await render('4-copy-text.png', slide('Copy text, even from images', 'On-device text recognition reads charts, screenshots and pictures. Nothing is uploaded.', wide('select-text.png')), 1280, 800);
  await render(
    '5-private.png',
    slide(
      'Private by design',
      'No account, no analytics, no uploads. Hushshot makes no network requests at all.',
      `<img class="shot" src="${img('settings.png')}" style="width: 768px; height: auto; border-radius: 12px 12px 0 0">`,
    ),
    1280,
    800,
  );

  const tile = (w: number, h: number, icon: number, name: number, tag: number, extra = '') => `<!doctype html><html><head><style>${BASE}
    body { background: linear-gradient(135deg, #2457d6 0%, #1a3fa3 100%); color: #fff; display: flex; align-items: center; justify-content: center; }
    .brand { font-size: ${name}px; letter-spacing: -.02em; gap: ${Math.round(icon / 3)}px; }
    .brand img { border-radius: ${Math.round(icon / 5)}px; background: #fff; padding: ${Math.round(icon / 10)}px; }
    p { font-size: ${tag}px; opacity: .92; margin-top: ${Math.round(tag * 0.6)}px; }
  </style></head><body><div>
    <div class="brand"><img src="${img('icon-128.png')}" width="${icon}" height="${icon}">Hushshot</div>
    <p>Private full-page screenshots</p>${extra}
  </div></body></html>`;
  await render('promo-small-440x280.png', tile(440, 280, 64, 44, 20), 440, 280);
  await render(
    'promo-marquee-1400x560.png',
    tile(1400, 560, 120, 96, 38, '<p style="font-size: 26px; opacity: .8">Sharp 2×–4× captures · searchable PDFs · on-device OCR · nothing leaves your computer</p>'),
    1400,
    560,
  );
});
