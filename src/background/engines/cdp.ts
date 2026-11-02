import type { Settings } from '../../lib/settings';
import { base64ToBytes, pngSize, type CaptureEngine, type Shot, type ShotRequest } from './types';

/**
 * Engine A: Chrome DevTools Protocol. Re-rasterises the page at a configurable
 * device scale factor (real high-resolution text, not upscaling) and captures
 * PNG tiles. Metrics are always restored and the debugger detached in end().
 */
export class CdpEngine implements CaptureEngine {
  readonly kind = 'cdp' as const;
  private target: chrome.debugger.Debuggee | null = null;
  private detachedExternally = false;
  private onDetach = (source: chrome.debugger.Debuggee) => {
    if (source.tabId === this.target?.tabId) this.detachedExternally = true;
  };

  get wasDetached() {
    return this.detachedExternally;
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.target) throw new Error('Debugger not attached');
    if (this.detachedExternally) throw new Error('The debugger was detached (the "started debugging" bar was dismissed).');
    return (await chrome.debugger.sendCommand(this.target, method, params)) as T;
  }

  async attach(tabId: number): Promise<void> {
    this.target = { tabId };
    chrome.debugger.onDetach.addListener(this.onDetach);
    await chrome.debugger.attach(this.target, '1.3');
  }

  async begin(tabId: number, _windowId: number, settings: Settings): Promise<void> {
    await this.attach(tabId);
    // Keep the current viewport size (including any existing emulation, e.g.
    // DevTools device mode); only the device scale factor changes.
    const [width, height] = await this.viewport();
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: settings.quality,
      mobile: false,
    });
    if (settings.colorScheme !== 'asis') {
      await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: settings.colorScheme }] });
    }
    // Let the infobar appear and the page re-layout at the new scale.
    await new Promise((r) => setTimeout(r, 250));
  }

  private async viewport(): Promise<[number, number, number]> {
    const { result } = await this.send<{ result: { value: [number, number, number] } }>('Runtime.evaluate', {
      expression: '[innerWidth, innerHeight, devicePixelRatio]',
      returnByValue: true,
    });
    return result.value;
  }

  async shoot(req: ShotRequest): Promise<Shot> {
    const clip = req.docClip ?? {
      x: req.winX + req.view.x,
      y: req.winY + req.view.y,
      width: req.view.width,
      height: req.view.height,
    };
    const res = await this.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      clip: { ...clip, scale: 1 },
      captureBeyondViewport: !!req.docClip,
      fromSurface: true,
    });
    const bytes = base64ToBytes(res.data);
    return { bytes, ...pngSize(bytes), originX: 0, originY: 0, cssWidth: clip.width };
  }

  async printToPdf(): Promise<Uint8Array> {
    const res = await this.send<{ data: string }>('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      generateDocumentOutline: true,
      generateTaggedPDF: true,
    });
    return base64ToBytes(res.data);
  }

  async end(): Promise<void> {
    const t = this.target;
    this.target = null;
    chrome.debugger.onDetach.removeListener(this.onDetach);
    if (!t || this.detachedExternally) return;
    for (const [method, params] of [
      ['Emulation.clearDeviceMetricsOverride', {}],
      ['Emulation.setEmulatedMedia', { features: [] }],
    ] as const) {
      try {
        await chrome.debugger.sendCommand(t, method, params);
      } catch {
        /* tab closed or already detached */
      }
    }
    try {
      await chrome.debugger.detach(t);
    } catch {
      /* already detached */
    }
  }
}

/** Attach briefly to print the tab to a vector PDF. */
export async function printTabToPdf(tabId: number): Promise<Uint8Array> {
  const e = new CdpEngine();
  try {
    await e.attach(tabId);
    return await e.printToPdf();
  } finally {
    await e.end();
  }
}
