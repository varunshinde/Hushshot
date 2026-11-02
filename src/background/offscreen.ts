import type { OffscreenRequest, Reply } from '../lib/messages';
import { loadSettings, type Settings } from '../lib/settings';

const OFFSCREEN_PATH = '/offscreen.html';
let creating: Promise<void> | null = null;

/** The offscreen document hosts canvas work and the OCR Web Worker, off the service worker. */
export async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
      justification: 'Stitch captured tiles and run on-device OCR in a Web Worker.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

export async function sendToOffscreen<T>(msg: Omit<OffscreenRequest, 'target'>): Promise<T> {
  await ensureOffscreen();
  const reply = (await chrome.runtime.sendMessage({ ...msg, target: 'offscreen' })) as Reply<T> | undefined;
  if (!reply) throw new Error('Offscreen document did not reply');
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export const finalizeInOffscreen = async (id: string, settings?: Settings) =>
  sendToOffscreen<void>({ type: 'finalize', id, settings: settings ?? (await loadSettings()) });
export const ocrInOffscreen = async (id: string) => sendToOffscreen<void>({ type: 'ocr', id, settings: await loadSettings() });
