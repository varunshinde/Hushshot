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

async function printPdf(id: string): Promise<string> {
  const rec = await getCapture(id);
  if (!rec?.sourceTabId) throw new Error('Capture not found.');
  if (!(await chrome.permissions.contains({ permissions: ['debugger'] }))) {
    throw new Error('Print-style PDF needs Sharp mode, which Chrome has turned off for this extension. Reinstall it to restore Sharp mode.');
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
      startPopupCapture({ mode: msg.mode, tabId: msg.tabId, pickContainer: msg.pickContainer });
      return { accepted: true };
    }
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

/** Toolbar icon: the popup menu, or (one-click mode) a full-page capture with no popup. */
async function applyToolbarClick() {
  const s = await loadSettings();
  await chrome.action.setPopup({ popup: s.toolbarClick === 'capture' ? '' : 'popup.html' });
}

export function main() {
  void applyToolbarClick();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) void applyToolbarClick();
  });
  // Only fires when there's no popup, i.e. in one-click mode.
  chrome.action.onClicked.addListener((tab) => startPopupCapture({ mode: 'full', tabId: tab.id }));

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
