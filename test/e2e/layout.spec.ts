import { colorRuns, expect, pixel, rulerErrors, stack, test } from './harness';

const colorFor = (i: number): [number, number, number] => [(i * 67 + 40) % 256, (i * 131 + 90) % 256, (i * 29 + 160) % 256];

test('sticky header and fixed chat widget appear exactly once', async ({ ext }) => {
  const { tabId } = await ext.open('sticky.html');
  const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, stickyMode: 'once', ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const rec = await ext.record(out.id!);
  expect(rec.height).toBe(6060 * 2);
  const img = stack((await ext.exportPng(out.id!, { maxSegmentHeight: 16000 })).files.map((f) => f.png));

  const header = colorRuns(img, 1000 * 2, [200, 30, 30]);
  expect(header, 'header bands').toEqual([{ start: 0, length: 120 }]);

  const chat = colorRuns(img, (1280 - 16 - 40) * 2, [30, 160, 90]);
  expect(chat.length, 'chat widget bands').toBe(1);
  expect(chat[0].length).toBe(160);
  expect(Math.abs(chat[0].start - (6060 - 16 - 80) * 2)).toBeLessThanOrEqual(2);

  // Content under the header area of later tiles is intact (ruler continuous).
  const ruler = rulerErrors({ ...img, data: img.data.subarray(120 * img.width * 4), height: img.height - 120 }, 2);
  expect(ruler.bad).toBe(0);
});

test('sticky "hide all" removes the header and the widget', async ({ ext }) => {
  const { tabId } = await ext.open('sticky.html');
  const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 1, stickyMode: 'hide', ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const img = stack((await ext.exportPng(out.id!, { maxSegmentHeight: 16000 })).files.map((f) => f.png));
  expect(colorRuns(img, 1000, [200, 30, 30])).toEqual([]);
  expect(colorRuns(img, 1280 - 16 - 40, [30, 160, 90])).toEqual([]);
});

test('lazy-loaded images are all present', async ({ ext }) => {
  const { page, tabId } = await ext.open('lazy.html');
  const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const rec = await ext.record(out.id!);
  expect(rec.warnings.join(' ')).not.toMatch(/didn't load/);
  const img = stack((await ext.exportPng(out.id!, { maxSegmentHeight: 16000 })).files.map((f) => f.png));
  const centers = await page.evaluate(() =>
    [...document.querySelectorAll('img')].map((i) => {
      const r = i.getBoundingClientRect();
      return { i: Number((i as HTMLImageElement).dataset.index), x: r.left + r.width / 2 + scrollX, y: r.top + r.height / 2 + scrollY };
    }),
  );
  expect(centers.length).toBe(24);
  for (const c of centers) {
    const got = pixel(img, c.x * 2, c.y * 2);
    const want = colorFor(c.i);
    expect(got, `image ${c.i}`).toEqual(want);
  }
});

test('inner scroll container: captures the full inner content', async ({ ext }) => {
  const { tabId } = await ext.open('inner-scroll.html');
  const out = await ext.capture(tabId, { mode: 'full', settings: { quality: 2, ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  const rec = await ext.record(out.id!);
  expect(rec.height).toBe(9000 * 2);
  expect(rec.warnings.join(' ')).toMatch(/inner scroll container div#scroller/);
  const img = stack((await ext.exportPng(out.id!)).files.map((f) => f.png));
  expect(rulerErrors(img, 2).bad).toBe(0);
  const { plain } = await ext.text(out.id!);
  expect(plain).toContain('Message 1.');
  expect(plain).toContain('Message 90.');
  expect(plain).not.toContain('Inbox'); // sidebar is outside the container
});

test('user-picked scroll container overrides the guess', async ({ ext }) => {
  const { tabId } = await ext.open('inner-scroll.html');
  const out = await ext.capture(tabId, { mode: 'full', containerSelector: '#scroller', settings: { quality: 1, ocrMode: 'demand' } });
  expect(out.ok, out.error).toBe(true);
  expect((await ext.record(out.id!)).height).toBe(9000);
});
