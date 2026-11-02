import type { ContentApi } from '../content';
import { isRestrictedError, RESTRICTED_MESSAGE } from '../lib/capture/restricted';

export class CaptureError extends Error {
  constructor(message: string, readonly code: string = 'error') {
    super(message);
  }
}

/** Inject the capture script (idempotent; it installs one global API). */
export async function injectContent(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['/capture.js'] });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (isRestrictedError(msg)) throw new CaptureError(RESTRICTED_MESSAGE, 'restricted');
    throw new CaptureError(`Couldn't access this page: ${msg}`, 'inject');
  }
}

type Fn = (...args: never[]) => unknown;
type Method = { [K in keyof ContentApi]: ContentApi[K] extends Fn ? K : never }[keyof ContentApi];

/** Call a content-API method in the tab's isolated world and return its (awaited) result. */
export async function callContent<M extends Method>(
  tabId: number,
  method: M,
  ...args: Parameters<ContentApi[M]>
): Promise<Awaited<ReturnType<ContentApi[M]>>> {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (m: string, a: unknown[]) => {
      const api = (globalThis as unknown as { __localCapture?: Record<string, (...x: unknown[]) => unknown> }).__localCapture;
      if (!api) return { ok: false, error: 'Capture script not loaded' };
      try {
        return { ok: true, value: await api[m](...a) };
      } catch (e) {
        return { ok: false, error: String((e as Error)?.message ?? e) };
      }
    },
    args: [method, args as unknown[]],
  });
  const r = res?.result as { ok: boolean; value?: unknown; error?: string } | undefined;
  if (!r) throw new CaptureError('No result from the page (it may have navigated).', 'page');
  if (!r.ok) throw new CaptureError(r.error ?? 'Page script failed', 'page');
  return r.value as Awaited<ReturnType<ContentApi[M]>>;
}
