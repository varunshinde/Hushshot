import { chromium, expect, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { FIXTURE_PORT, PROXY_PORT } from '../../playwright.config';
import { ExtensionNetworkMonitor } from './netmon';

export const BASE = `http://127.0.0.1:${FIXTURE_PORT}`;
const CHROME_OWN_HOSTS = /^(https?:\/\/)?([a-z0-9-]+\.)*(google\.com|gstatic\.com|googleapis\.com|gvt1\.com|googleusercontent\.com)(:\d+)?(\/|$)/;
const EXT_PATH = resolve(import.meta.dirname, '../../dist/chrome-mv3-e2e');

// Report service-worker network activity too (needed for the privacy checks).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

export interface Img {
  width: number;
  height: number;
  data: Buffer;
}

export interface CaptureReq {
  mode: 'visible' | 'full' | 'region' | 'element';
  region?: { x: number; y: number; width: number; height: number };
  elementSelector?: string;
  containerSelector?: string | null;
  cancelAfterTiles?: number;
  settings?: Record<string, unknown>;
}

export interface Ext {
  context: BrowserContext;
  sw: Worker;
  extId: string;
  /** Requests made by extension contexts (service worker, extension pages). */
  extRequests: string[];
  /** CDP-level record of every request from extension targets, including the offscreen document and workers. */
  monitor: ExtensionNetworkMonitor;
  open(path: string): Promise<{ page: Page; tabId: number }>;
  capture(tabId: number, req: CaptureReq): Promise<{ ok: boolean; id?: string; error?: string; code?: string; cancelled?: boolean }>;
  hooks(): Promise<Page>;
  record(id: string, ocr?: boolean): Promise<Record<string, any>>;
  exportPng(id: string, settings?: Record<string, unknown>): Promise<{ files: { name: string; png: Buffer }[]; plan: any }>;
  plan(id: string, settings?: Record<string, unknown>, format?: string): Promise<any>;
  exportPdf(id: string, settings?: Record<string, unknown>): Promise<{ name: string; pdf: Buffer; plan: any }>;
  text(id: string): Promise<{ plain: string; md: string }>;
  proxyLog(): Promise<{ method: string; url: string }[]>;
}

export const test = base.extend<{ ext: Ext }>({
  ext: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'localcapture-e2e-'));
    // Signed Google Chrome: on this macOS, ad-hoc-signed "Chrome for Testing"
    // builds are killed at launch, and headless Chrome exits by itself after
    // ~30 s, so tests run headful with the window placed off-screen. Branded
    // Chrome ignores --load-extension; the unpacked build is loaded over CDP
    // (Extensions.loadUnpacked). Set E2E_HEADLESS=1 where headless works.
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: !!process.env.E2E_HEADLESS,
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        '--enable-unsafe-extension-debugging',
        `--proxy-server=http://127.0.0.1:${PROXY_PORT}`,
        '--disable-sync',
        '--no-pings',
        '--disable-domain-reliability',
        '--window-position=-3000,-3000',
        '--window-size=1300,1000',
      ],
    });
    const cdp = await context.browser()!.newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: EXT_PATH });
    const sw = context.serviceWorkers().find((w) => w.url().endsWith('/background.js')) ?? (await context.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).host;
    const monitor = new ExtensionNetworkMonitor(cdp, extId);
    if (!process.env.NO_NETMON) await monitor.start();
    const extRequests: string[] = [];
    context.on('request', (r) => {
      let frameUrl = '';
      try {
        frameUrl = r.frame().url();
      } catch {
        /* service-worker request */
      }
      if (r.serviceWorker() || frameUrl.startsWith('chrome-extension://')) extRequests.push(r.url());
    });
    await fetch(`${BASE}/__proxylog/clear`);
    let hooksPage: Page | null = null;

    const ext: Ext = {
      context,
      sw,
      extId,
      extRequests,
      monitor,
      async open(path) {
        const page = await context.newPage();
        await page.goto(`${BASE}/${path}`, { waitUntil: 'load' });
        await page.bringToFront();
        const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id ?? -1, page.url());
        expect(tabId).toBeGreaterThan(0);
        return { page, tabId };
      },
      async capture(tabId, req) {
        return sw.evaluate((r) => (globalThis as any).__lcTest.capture(r), { ...req, tabId });
      },
      async hooks() {
        if (hooksPage && !hooksPage.isClosed()) return hooksPage;
        hooksPage = await context.newPage();
        hooksPage.on('crash', () => console.log('[hooks page] crashed'));
        hooksPage.on('pageerror', (e) => console.log('[hooks page] error', e.message));
        await hooksPage.goto(`chrome-extension://${extId}/preview.html?error=test&message=hooks`);
        await hooksPage.waitForFunction(() => !!(globalThis as any).__lcPreviewTest);
        return hooksPage;
      },
      async record(id, ocr = false) {
        const h = await ext.hooks();
        return h.evaluate(([i, o]) => (globalThis as any).__lcPreviewTest.waitFor(i, o), [id, ocr] as const);
      },
      async exportPng(id, settings = {}) {
        const h = await ext.hooks();
        const r = await h.evaluate(([i, s]) => (globalThis as any).__lcPreviewTest.exportImages(i, s, 'png'), [id, settings] as const);
        return { plan: r.plan, files: r.files.map((f: { name: string; data: string }) => ({ name: f.name, png: Buffer.from(f.data, 'base64') })) };
      },
      async plan(id, settings = {}, format = 'png') {
        const h = await ext.hooks();
        return h.evaluate(([i, s, f]) => (globalThis as any).__lcPreviewTest.plan(i, s, f), [id, settings, format] as const);
      },
      async exportPdf(id, settings = {}) {
        const h = await ext.hooks();
        const r = await h.evaluate(([i, s]) => (globalThis as any).__lcPreviewTest.exportPdf(i, s), [id, settings] as const);
        return { plan: r.plan, name: r.name, pdf: Buffer.from(r.data, 'base64') };
      },
      async text(id) {
        const h = await ext.hooks();
        return h.evaluate((i) => (globalThis as any).__lcPreviewTest.text(i), id);
      },
      async proxyLog() {
        return (await fetch(`${BASE}/__proxylog`)).json();
      },
    };
    await use(ext);

    // Privacy invariant for every test: nothing left the machine, and
    // extension contexts only loaded their own packaged resources.
    // Branded Chrome talks to Google for its own sign-in/variations service;
    // that traffic is the browser's, not the extension's (the CDP monitor
    // proves which contexts made which requests), so those hosts are exempt
    // from the proxy check. Anything else reaching the proxy fails the test.
    const leaked = (await ext.proxyLog()).filter((r) => !CHROME_OWN_HOSTS.test(r.url));
    const foreign = [...extRequests.filter((u) => !/^(chrome-extension|data|blob):/.test(u)), ...monitor.foreign().map((r) => `${r.url} (${r.where})`)];
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
    expect(leaked, 'requests that tried to leave the machine').toEqual([]);
    expect(foreign, 'non-local requests from extension contexts').toEqual([]);
  },
});

export { expect };

/**
 * Is LocalFullPageCapture's own debugger session still attached to the tab?
 * (getTargets().attached is also true for Playwright's connection, so probe by
 * attaching: that only fails if this extension is already attached.)
 */
export async function extensionDebuggerAttached(ext: Ext, tabId: number): Promise<boolean> {
  return ext.sw.evaluate(async (id) => {
    try {
      await chrome.debugger.attach({ tabId: id }, '1.3');
      await chrome.debugger.detach({ tabId: id });
      return false;
    } catch (e) {
      return /already attached/i.test(String((e as Error).message));
    }
  }, tabId);
}

export function decode(png: Buffer): Img {
  const p = PNG.sync.read(png);
  return { width: p.width, height: p.height, data: p.data };
}

/** Stack exported segments back into one image, dropping overlap rows. */
export function stack(files: Buffer[], overlap = 0): Img {
  const imgs = files.map(decode);
  const width = imgs[0].width;
  const height = imgs.reduce((n, im, i) => n + im.height - (i ? overlap : 0), 0);
  const data = Buffer.alloc(width * height * 4);
  let y = 0;
  imgs.forEach((im, i) => {
    const skip = i ? overlap : 0;
    im.data.copy(data, y * width * 4, skip * width * 4);
    y += im.height - skip;
  });
  return { width, height, data };
}

/**
 * Check the fixture ruler: master row r must show CSS row floor(r / scale) + offset.
 * Returns the number of rows that don't (duplicated, missing or seamed rows).
 */
export function rulerErrors(img: Img, scale: number, offsetCss = 0, xCss = 6): { bad: number; firstBad: number[] } {
  const x = Math.round(xCss * scale);
  let bad = 0;
  const firstBad: number[] = [];
  for (let r = 0; r < img.height; r++) {
    const i = (r * img.width + x) * 4;
    const code = img.data[i] + 256 * img.data[i + 1];
    const expected = Math.floor(r / scale) + offsetCss;
    if (img.data[i + 2] !== 200 || code !== expected) {
      bad++;
      if (firstBad.length < 10) firstBad.push(r);
    }
  }
  return { bad, firstBad };
}

export function pixel(img: Img, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** Lengths of runs of rows whose pixel at column x matches `rgb` (±tol). */
export function colorRuns(img: Img, x: number, rgb: [number, number, number], tol = 6): { start: number; length: number }[] {
  const runs: { start: number; length: number }[] = [];
  let start = -1;
  for (let y = 0; y <= img.height; y++) {
    const p = y < img.height ? pixel(img, x, y) : [-99, -99, -99];
    const hit = p.every((v, k) => Math.abs(v - rgb[k]) <= tol);
    if (hit && start < 0) start = y;
    if (!hit && start >= 0) {
      runs.push({ start, length: y - start });
      start = -1;
    }
  }
  return runs;
}

export function characterErrorRate(ref: string, hyp: string): number {
  const a = [...ref];
  const b = [...hyp];
  if (!a.length) return b.length ? 1 : 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / a.length;
}

export const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
