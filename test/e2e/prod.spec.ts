import { BASE, expect, test } from './harness';

/**
 * Checks on the real production build (run with `pnpm test:prod`), which the
 * other tests can't cover: they use the test build, whose manifest differs.
 * Chrome silently drops permissions it won't accept, so check what it grants.
 */
test.skip(!process.env.E2E_EXT_PATH, 'run with pnpm test:prod');

test('production build: Chrome grants Sharp mode its debugger permission at install', async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extId}/options.html`);
  const r = await page.evaluate(async () => ({
    name: chrome.runtime.getManifest().name,
    optional: chrome.runtime.getManifest().optional_permissions ?? [],
    hosts: chrome.runtime.getManifest().host_permissions ?? [],
    granted: await chrome.permissions.contains({ permissions: ['debugger'] }),
    all: (await chrome.permissions.getAll()).permissions,
  }));
  expect(r.name).toBe('LocalFullPageCapture');
  expect(r.granted).toBe(true);
  expect(r.all).toContain('debugger');
  expect(r.optional).toEqual([]);
  expect(r.hosts).toEqual([]);
});

test('production build: the debugger attaches to a page, so Sharp mode can render at 2×', async ({ ext }) => {
  const demo = await ext.context.newPage();
  await demo.goto(`${BASE}/demo.html`);
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extId}/options.html`);
  const dpr = await page.evaluate(async (url) => {
    // No `tabs` permission, so find the tab through the debugger's own target list.
    const t = (await chrome.debugger.getTargets()).find((x) => x.url === url && x.tabId !== undefined);
    if (!t) throw new Error('demo tab not found');
    const target = { tabId: t.tabId! };
    await chrome.debugger.attach(target, '1.3');
    try {
      await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 2, mobile: false });
      const res = (await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: 'devicePixelRatio', returnByValue: true })) as { result: { value: number } };
      await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride');
      return res.result.value;
    } finally {
      await chrome.debugger.detach(target);
    }
  }, demo.url());
  expect(dpr).toBe(2);
});

test('production build: Settings shows Sharp mode as an on/off switch, not a permission request', async ({ ext }) => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extId}/options.html`);
  const sharp = page.getByRole('switch', { name: 'Sharp mode' });
  await expect(sharp).toBeChecked();
  await expect(page.getByText('Allow Sharp mode')).toHaveCount(0);
  const engine = () => page.evaluate(async () => ((await chrome.storage.local.get('settings')).settings as { engine?: string } | undefined)?.engine ?? 'auto');
  await sharp.uncheck();
  await expect.poll(engine).toBe('scroll');
  await sharp.check();
  await expect.poll(engine).toBe('auto');
});
