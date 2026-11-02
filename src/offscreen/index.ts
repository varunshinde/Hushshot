import { isTrustedSender, type OffscreenRequest, type Reply } from '../lib/messages';
import { sanitizeSettings, type Settings } from '../lib/settings';
import { finalize } from './finalize';
import { runOcr } from './ocr';

/** One OCR run at a time; later requests queue behind it. */
let ocrQueue: Promise<unknown> = Promise.resolve();
const queueOcr = (id: string, settings: Settings) =>
  (ocrQueue = ocrQueue.then(() => runOcr(id, settings)).catch((e) => console.error('OCR failed', e)));

async function handle(msg: OffscreenRequest): Promise<unknown> {
  switch (msg.type) {
    case 'finalize': {
      await finalize(msg.id);
      if (msg.settings.ocrMode === 'auto') queueOcr(msg.id, msg.settings);
      return undefined;
    }
    case 'ocr':
      queueOcr(msg.id, msg.settings);
      return undefined;
  }
}

export function main() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.target !== 'offscreen') return false;
    if (!isTrustedSender(sender, msg)) {
      sendResponse({ ok: false, error: 'Untrusted sender' } satisfies Reply);
      return false;
    }
    const req = msg as OffscreenRequest;
    handle({ ...req, settings: sanitizeSettings(req.settings) }).then(
      (value) => sendResponse({ ok: true, value } satisfies Reply),
      (e) => sendResponse({ ok: false, error: String((e as Error)?.message ?? e) } satisfies Reply),
    );
    return true;
  });
}
