import type { CaptureEngine, Shot, ShotRequest } from './types';
import { base64ToBytes, pngSize } from './types';

/**
 * Engine B: scroll-and-stitch with chrome.tabs.captureVisibleTab (PNG, native
 * devicePixelRatio). No debugger permission needed. Respects Chrome's
 * MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota with throttling and backoff.
 */
const MIN_INTERVAL_MS = 1000 / (chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND ?? 2) + 30;

export class ScrollEngine implements CaptureEngine {
  readonly kind = 'scroll' as const;
  private windowId = 0;
  private tabId = 0;
  private last = 0;

  async begin(tabId: number, windowId: number): Promise<void> {
    this.tabId = tabId;
    this.windowId = windowId;
  }

  async shoot(req: ShotRequest): Promise<Shot> {
    let delay = MIN_INTERVAL_MS;
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + delay - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const tab = await chrome.tabs.get(this.tabId);
      if (!tab.active) throw new Error('The tab was switched away during capture. Keep it in front and try again.');
      try {
        this.last = Date.now();
        const url = await chrome.tabs.captureVisibleTab(this.windowId, { format: 'png' });
        const bytes = base64ToBytes(url.slice(url.indexOf(',') + 1));
        const size = pngSize(bytes);
        return { bytes, ...size, originX: req.view.x, originY: req.view.y, cssWidth: 0 };
      } catch (e) {
        const msg = String((e as Error).message ?? e);
        if (attempt < 5 && /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota/i.test(msg)) {
          delay *= 2;
          continue;
        }
        throw e;
      }
    }
  }

  async end(): Promise<void> {}
}
