import type { CDPSession, Page } from '@playwright/test';
import { expect, test, type Ext } from './harness';

/** Evaluate in the real toolbar popup (Playwright doesn't attach to action popups). */
async function popupEval(cdp: CDPSession, expression: string): Promise<unknown> {
  const { targetInfos } = await cdp.send('Target.getTargets');
  const t = targetInfos.find((x) => x.url.includes('/popup.html'));
  if (!t) throw new Error('popup is not open');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: false });
  const id = 1;
  const reply = new Promise<unknown>((resolve) => {
    const on = (e: { sessionId: string; message: string }) => {
      const m = JSON.parse(e.message);
      if (e.sessionId !== sessionId || m.id !== id) return;
      cdp.off('Target.receivedMessageFromTarget', on);
      resolve(m.result?.result?.value);
    };
    cdp.on('Target.receivedMessageFromTarget', on);
  });
  const params = { expression, awaitPromise: true, returnByValue: true };
  await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.evaluate', params }) });
  return reply;
}

/** Chrome stops idle extension service workers after ~30 s; do it now. */
async function sleepServiceWorker(ext: Ext, page: Page) {
  const s = await ext.context.newCDPSession(page);
  await s.send('ServiceWorker.enable');
  await s.send('ServiceWorker.stopAllWorkers');
  await page.waitForTimeout(1000);
}

const previewOpened = (ext: Ext) => ext.context.waitForEvent('page', { predicate: (p) => p.url().includes('preview.html?id='), timeout: 20_000 });

for (const when of ['as soon as it renders', 'after a pause']) {
  test(`one click in the toolbar popup starts a capture when the service worker is asleep (click ${when})`, async ({ ext }) => {
    const demo = await ext.open('demo.html');
    const hooks = await ext.hooks();
    const cdp = await ext.context.browser()!.newBrowserCDPSession();
    await sleepServiceWorker(ext, demo.page);
    await demo.page.bringToFront();
    const opened = previewOpened(ext);
    await hooks.evaluate(() => chrome.action.openPopup());
    await popupEval(
      cdp,
      `new Promise((done) => {
        const tick = () => {
          const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Full page') && !x.disabled);
          if (!b) return setTimeout(tick, 5);
          setTimeout(() => { b.click(); done(true); }, ${when === 'after a pause' ? 1500 : 0});
        };
        tick();
      })`,
    );
    const preview = await opened;
    await expect(preview.getByRole('button', { name: /Download PNG/ })).toBeVisible({ timeout: 20_000 });
  });
}

test('a capture held for the permission prompt survives the popup closing and the worker sleeping', async ({ ext }) => {
  const demo = await ext.open('demo.html');
  const hooks = await ext.hooks();
  const reply = await hooks.evaluate(
    (tabId) => chrome.runtime.sendMessage({ target: 'background', type: 'capture', mode: 'visible', tabId, afterPermission: true }),
    demo.tabId,
  );
  expect(reply).toEqual({ ok: true, value: { accepted: true } });
  // Nothing starts until the decision arrives.
  await demo.page.waitForTimeout(1500);
  expect(ext.context.pages().some((p) => p.url().includes('preview.html?id='))).toBe(false);

  await sleepServiceWorker(ext, demo.page);
  await demo.page.bringToFront();
  const opened = previewOpened(ext);
  await hooks.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'permission-decided' }));
  await opened;

  // Released once only: a second decision doesn't start another capture.
  await hooks.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'permission-decided' }));
  await demo.page.waitForTimeout(1500);
  expect(ext.context.pages().filter((p) => p.url().includes('preview.html')).length).toBe(2); // hooks page + one capture
});
