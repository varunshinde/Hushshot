import type { Page } from '@playwright/test';
import { decode, expect, pixel, test, type Ext, type Img } from './harness';

/** Annotation editor, redaction and the private-info finder. */
test.setTimeout(240_000);

async function openResult(ext: Ext, id: string): Promise<Page> {
  const p = await ext.context.newPage();
  await p.setViewportSize({ width: 1400, height: 900 });
  await p.goto(`chrome-extension://${ext.extId}/preview.html?id=${id}`);
  await p.getByRole('button', { name: /^Download / }).first().waitFor();
  await p.waitForTimeout(400);
  return p;
}

async function capture(ext: Ext, page = 'private.html') {
  const { tabId } = await ext.open(page);
  const cap = await ext.capture(tabId, { mode: 'full', settings: { quality: 1, ocrMode: 'demand' } });
  expect(cap.ok, cap.error).toBe(true);
  return { id: cap.id!, rec: await ext.record(cap.id!) };
}

const hooks = async (ext: Ext, fn: string, ...args: unknown[]) => {
  const h = await ext.hooks();
  return h.evaluate(([f, a]) => (globalThis as any).__lcPreviewTest[f as string](...(a as unknown[])), [fn, args] as const);
};

const items = async (ext: Ext, id: string) => ((await ext.record(id)).edits?.items ?? []) as any[];

/** Drag on the image, in CSS px from the canvas's top-left corner. */
async function drag(p: Page, x0: number, y0: number, x1: number, y1: number) {
  const c = (await p.locator('.canvas').boundingBox())!;
  await p.mouse.move(c.x + x0, c.y + y0);
  await p.mouse.down();
  await p.mouse.move(c.x + x1, c.y + y1, { steps: 6 });
  await p.mouse.up();
}

const near = (a: number[], b: number[], tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('annotate: shapes, arrows and text are saved with the capture and drawn into downloads', async ({ ext }) => {
  const { id, rec } = await capture(ext);
  const clean = decode((await ext.exportPng(id, { maxSegmentHeight: 16000 })).files[0].png);
  const p = await openResult(ext, id);
  await p.getByRole('button', { name: /^Annotate/ }).click();
  await expect(p.getByRole('radiogroup', { name: 'Annotation tool' })).toBeVisible();
  const z = (await p.locator('.canvas').boundingBox())!.width / rec.width;

  await p.keyboard.press('r');
  await drag(p, 100, 100, 300, 200);
  await p.keyboard.press('a');
  await drag(p, 350, 300, 500, 240);
  await p.keyboard.press('t');
  const c = (await p.locator('.canvas').boundingBox())!;
  await p.mouse.click(c.x + 120, c.y + 420);
  await p.keyboard.type('Hello');
  await p.keyboard.press('Escape');

  await expect.poll(async () => (await items(ext, id)).map((a) => a.kind)).toEqual(['rect', 'arrow', 'text']);
  const text = (await items(ext, id))[2];
  expect(text.text).toBe('Hello');

  // The rectangle's top edge is red in the exported PNG, at full resolution.
  const png = decode((await ext.exportPng(id, { maxSegmentHeight: 16000 })).files[0].png);
  const edgeY = Math.round(100 / z);
  const midX = Math.round(200 / z);
  expect(near(pixel(png, midX, edgeY), [0xe5, 0x38, 0x3b])).toBe(true);
  expect(near(pixel(clean, midX, edgeY), [0xe5, 0x38, 0x3b])).toBe(false);
  // …and the original pixels inside the outline are untouched.
  expect(pixel(clean, midX, Math.round(150 / z))).toEqual(pixel(png, midX, Math.round(150 / z)));

  // Undo and redo with the keyboard.
  for (let i = 0; i < 3; i++) await p.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await items(ext, id)).length).toBe(0);
  for (let i = 0; i < 3; i++) await p.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await items(ext, id)).length).toBe(3);

  // Select the rectangle, move it with the arrow keys, delete it.
  await p.keyboard.press('v');
  await p.mouse.click(c.x + 100, c.y + 150);
  await expect(p.locator('.ann-sel')).toBeVisible();
  const x0 = (await items(ext, id))[0].r.x;
  await p.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await items(ext, id))[0].r.x).toBeCloseTo(x0 + 10 * rec.scale, 5);
  await p.keyboard.press('Delete');
  await expect.poll(async () => (await items(ext, id)).map((a) => a.kind)).toEqual(['arrow', 'text']);
});

test('annotate: undo and redo stay exact over 90 actions', async ({ ext }) => {
  const { id } = await capture(ext);
  const p = await openResult(ext, id);
  await p.getByRole('button', { name: /^Annotate/ }).click();
  await p.keyboard.press('n');
  const c = (await p.locator('.canvas').boundingBox())!;
  for (let i = 0; i < 30; i++) await p.mouse.click(c.x + 60 + (i % 10) * 50, c.y + 80 + Math.floor(i / 10) * 60);
  await expect.poll(async () => (await items(ext, id)).length).toBe(30);
  const before = await items(ext, id);
  expect(before.map((a) => a.n)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));

  for (let i = 0; i < 30; i++) await p.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await items(ext, id)).length).toBe(0);
  await expect(p.getByRole('button', { name: 'Undo' })).toBeDisabled();
  for (let i = 0; i < 30; i++) await p.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await items(ext, id)).length).toBe(30);
  expect(await items(ext, id)).toEqual(before);
  await expect(p.getByRole('button', { name: 'Redo' })).toBeDisabled();
});

function distinctColours(img: Img, r: { x: number; y: number; width: number; height: number }) {
  const set = new Set<number>();
  for (let y = Math.ceil(r.y); y < Math.floor(r.y + r.height); y++)
    for (let x = Math.ceil(r.x); x < Math.floor(r.x + r.width); x++) {
      const i = (y * img.width + x) * 4;
      set.add((img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2]);
    }
  return set.size;
}

test('redaction: private details are found, and their pixels and text are gone from every export', async ({ ext }) => {
  const { id, rec } = await capture(ext);
  const original = decode((await ext.exportPng(id, { maxSegmentHeight: 16000 })).files[0].png);
  const p = await openResult(ext, id);
  await p.getByRole('button', { name: /^Annotate/ }).click();
  await p.getByRole('button', { name: /Find private info/ }).click();
  const panel = p.getByRole('complementary', { name: 'Find private info' });
  for (const k of ['Email address', 'Phone number', 'Card number', 'API key or token']) await expect(panel.getByText(k)).toBeVisible();
  // The "Member since" date isn't mistaken for a phone number.
  await expect(panel.locator('code', { hasText: '2026-11-07' })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Redact 4 items' }).click();
  await expect.poll(async () => (await items(ext, id)).filter((a) => a.kind === 'redact').length).toBe(4);

  const secrets = ['jordan.example', 'mailbox.test', '4242', '555', 'sk-proj'];
  const text = await ext.text(id);
  for (const s of secrets) expect(text.plain).not.toContain(s);
  expect(text.plain).toContain('Jordan Example');
  expect(text.plain).toContain('Member since');

  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await ext.exportPdf(id, { pdfPaper: 'a4' });
  const doc = await lib.getDocument({ data: new Uint8Array(pdf.pdf) }).promise;
  let pdfText = '';
  for (let i = 1; i <= doc.numPages; i++) pdfText += ((await (await doc.getPage(i)).getTextContent()).items as any[]).map((it) => it.str ?? '').join(' ');
  for (const s of secrets) expect(pdfText).not.toContain(s);
  expect(pdfText).toContain('Jordan');

  // Pixelated: each redacted box keeps only one colour per block, and differs from the original.
  const redacts = (await items(ext, id)).filter((a) => a.kind === 'redact');
  const png = decode((await ext.exportPng(id, { maxSegmentHeight: 16000 })).files[0].png);
  const block = Math.round(10 * rec.scale);
  for (const a of redacts) {
    const blocks = Math.ceil(a.r.width / block) * Math.ceil(a.r.height / block);
    expect(distinctColours(png, a.r)).toBeLessThanOrEqual(blocks);
    expect(distinctColours(original, a.r)).toBeGreaterThan(blocks);
  }

  // Black box: solid black. Blur: smooth, with the sharp text edges gone.
  const [email, phone] = redacts;
  await hooks(ext, 'setEdits', id, { ...(await ext.record(id)).edits, items: [{ ...email, mode: 'box' }, { ...phone, mode: 'blur' }] });
  const png2 = decode((await ext.exportPng(id, { maxSegmentHeight: 16000 })).files[0].png);
  expect(distinctColours(png2, email.r)).toBe(1);
  expect(pixel(png2, Math.round(email.r.x + 3), Math.round(email.r.y + 3))).toEqual([0, 0, 0]);
  const roughness = (img: Img, r: { x: number; y: number; width: number; height: number }) => {
    let sum = 0;
    let n = 0;
    for (let y = Math.ceil(r.y) + 1; y < Math.floor(r.y + r.height) - 1; y++)
      for (let x = Math.ceil(r.x) + 1; x < Math.floor(r.x + r.width) - 1; x++) {
        const i = (y * img.width + x) * 4;
        sum += Math.abs(img.data[i] - img.data[i + 4]);
        n++;
      }
    return sum / n;
  };
  expect(roughness(png2, phone.r)).toBeLessThan(roughness(original, phone.r) / 3);
  // The editor stays usable: the tiles themselves were never changed.
  const tile = await hooks(ext, 'blob', rec.tiles[0].key);
  expect(tile).toBeTruthy();
});
