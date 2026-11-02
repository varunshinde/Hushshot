import { isTrustedSender, type BackgroundRequest, type ContentRequest, type Reply } from '../lib/messages';
import { loadSettings, saveSettings } from '../lib/settings';
import { getCapture, putBlob } from '../lib/storage/db';
import type { CaptureMode } from '../lib/types';
import { cancelActive, runCapture, type CaptureOutcome, type CaptureRequest } from './capture';
import { printTabToPdf } from './engines/cdp';
import { ensureOffscreen, ocrInOffscreen } from './offscreen';

const COMMANDS: Record<string, CaptureMode> = {
  'capture-visible': 'visible',
  'capture-full': 'full',
  'capture-region': 'region',
  'capture-element': 'element',
};

/** Shortcut-triggered captures have no popup to show errors in, so open the preview page with the message. */
async function reportOutcome(outcome: CaptureOutcome) {
  if (outcome.ok || outcome.cancelled) return;
  const url = chrome.runtime.getURL(`/preview.html?error=${encodeURIComponent(outcome.code)}&message=${encodeURIComponent(outcome.error)}`);
  await chrome.tabs.create({ url });
}

/** Popup captures run detached: the popup only waits for the background to accept the request, then closes. */
function startPopupCapture(req: CaptureRequest) {
  runCapture(req)
    .then(reportOutcome)
    .catch((e) => reportOutcome({ ok: false, error: String((e as Error)?.message ?? e), code: 'error' }));
}

/**
 * A first capture that asked for the debugger permission. Chrome's permission
 * dialog can close the popup before it hears back, so the request is held here
 * (in session storage, in case the service worker sleeps while the dialog is
 * open) and started when the popup reports the decision or the permission is added.
 */
const PENDING_KEY = 'pendingCapture';
const PENDING_TTL_MS = 2 * 60_000;
let releasing: Promise<void> = Promise.resolve();

async function holdForPermission(req: CaptureRequest) {
  await chrome.storage.session.set({ [PENDING_KEY]: { req, at: Date.now() } });
}

/** Serialised, so the popup's report and permissions.onAdded can't both start it. */
function releasePending(): Promise<void> {
  releasing = releasing.then(async () => {
    const pending = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] as { req: CaptureRequest; at: number } | undefined;
    if (!pending) return;
    await chrome.storage.session.remove(PENDING_KEY);
    if (Date.now() - pending.at < PENDING_TTL_MS) startPopupCapture(pending.req);
  });
  return releasing;
}

async function printPdf(id: string): Promise<string> {
  const rec = await getCapture(id);
  if (!rec?.sourceTabId) throw new Error('Capture not found.');
  if (!(await chrome.permissions.contains({ permissions: ['debugger'] }))) {
    throw new Error('Vector PDF needs the optional "debugger" permission. Enable the high-resolution engine first.');
  }
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(rec.sourceTabId);
  } catch {
    throw new Error('The original tab is closed. Vector PDF prints the live page, so reopen it and capture again.');
  }
  if (tab.url !== rec.url) throw new Error('The original tab has navigated away. Vector PDF prints the live page.');
  const bytes = await printTabToPdf(tab.id!);
  const key = `${id}/vector.pdf`;
  await putBlob(key, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  return key;
}

async function handle(msg: BackgroundRequest | ContentRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'capture': {
      // Reply at once so the popup can close; errors are shown in a new tab like shortcut captures.
      const req = { mode: msg.mode, tabId: msg.tabId, pickContainer: msg.pickContainer };
      if (msg.afterPermission) await holdForPermission(req);
      else startPopupCapture(req);
      return { accepted: true };
    }
    case 'permission-decided':
      await releasePending();
      return true;
    case 'cancel':
      return cancelActive();
    case 'content-cancel':
      return cancelActive(sender.tab?.id);
    case 'print-pdf':
      return printPdf(msg.id);
    case 'ocr':
      return ocrInOffscreen(msg.id);
    default:
      throw new Error('Unknown request');
  }
}

export function main() {
  chrome.commands.onCommand.addListener(async (command, tab) => {
    const mode = COMMANDS[command];
    if (!mode) return;
    const outcome = await runCapture({ mode, tabId: tab?.id });
    await reportOutcome(outcome);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.target !== 'background') return false;
    if (!isTrustedSender(sender, msg)) {
      sendResponse({ ok: false, error: 'Untrusted sender' } satisfies Reply);
      return false;
    }
    handle(msg, sender).then(
      (value) => sendResponse({ ok: true, value } satisfies Reply),
      (e) => sendResponse({ ok: false, error: String((e as Error)?.message ?? e) } satisfies Reply),
    );
    return true;
  });

  chrome.permissions.onAdded.addListener((p) => {
    if (p.permissions?.includes('debugger')) void releasePending();
  });

  // Never open a welcome page or anything else on install.
  chrome.runtime.onInstalled.addListener(() => {});

  if (import.meta.env.MODE === 'e2e') {
    // Test-only hooks (absent from production builds): Playwright drives captures through these.
    Object.assign(globalThis, {
      __lcTest: {
        capture: (req: CaptureRequest) => runCapture({ openPreview: false, ...req }),
        cancel: () => cancelActive(),
        loadSettings,
        saveSettings,
        ensureOffscreen,
        printPdf,
      },
    });
  }
}
