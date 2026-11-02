import type { Settings } from './settings';
import type { CaptureMode } from './types';

/** Messages handled by the service worker. */
export type BackgroundRequest =
  /** Replies as soon as the capture is accepted. With afterPermission, it starts once the debugger prompt is decided. */
  | { target: 'background'; type: 'capture'; mode: CaptureMode; tabId?: number; pickContainer?: boolean; afterPermission?: boolean }
  | { target: 'background'; type: 'permission-decided' }
  | { target: 'background'; type: 'cancel' }
  | { target: 'background'; type: 'print-pdf'; id: string }
  | { target: 'background'; type: 'ocr'; id: string }
  | { target: 'background'; type: 'measure'; tabId: number };

/** Messages handled by the offscreen document. */
/** Offscreen documents only get chrome.runtime, so the service worker passes settings along. */
export type OffscreenRequest =
  | { target: 'offscreen'; type: 'finalize'; id: string; settings: Settings }
  | { target: 'offscreen'; type: 'ocr'; id: string; settings: Settings };

/** Messages a content script may send. Nothing else is accepted from a tab. */
export type ContentRequest = { target: 'background'; type: 'content-cancel' };

export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; error: string; code?: string };

/** Broadcast on BroadcastChannel(EVENTS_CHANNEL) between extension contexts. */
export type ExtensionEvent =
  | { type: 'capture-updated'; id: string }
  | { type: 'ocr-progress'; id: string; progress: number; status: string }
  | { type: 'capture-progress'; tabId: number; stage: string; progress: number };

export const EVENTS_CHANNEL = 'localcapture-events';

const CONTENT_ALLOWED = new Set(['content-cancel']);

/**
 * Accept a runtime message only if it comes from this extension: one of its
 * own pages (popup, preview, options, offscreen), or — for the narrow set of
 * content-script messages — a script this extension injected.
 */
export function isTrustedSender(
  sender: chrome.runtime.MessageSender,
  message: unknown,
  extensionId: string = chrome.runtime.id,
): boolean {
  if (!sender || sender.id !== extensionId) return false;
  const origin = `chrome-extension://${extensionId}/`;
  const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(origin);
  if (fromExtensionPage) return true;
  const type = (message as { type?: unknown } | null)?.type;
  return sender.tab !== undefined && typeof type === 'string' && CONTENT_ALLOWED.has(type);
}

export function broadcast(event: ExtensionEvent): void {
  const ch = new BroadcastChannel(EVENTS_CHANNEL);
  ch.postMessage(event);
  ch.close();
}

export function onEvent(handler: (e: ExtensionEvent) => void): () => void {
  const ch = new BroadcastChannel(EVENTS_CHANNEL);
  ch.onmessage = (ev) => handler(ev.data as ExtensionEvent);
  return () => ch.close();
}

export async function sendToBackground<T>(msg: BackgroundRequest): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(msg)) as Reply<T> | undefined;
  if (!reply) throw new Error('No reply from background');
  if (!reply.ok) throw Object.assign(new Error(reply.error), { code: reply.code });
  return reply.value;
}
