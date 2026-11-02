/**
 * Pages Chrome never lets an extension capture or script. Checked up front so
 * the user gets a clear message instead of a silent failure.
 */
export const RESTRICTED_MESSAGE =
  "Chrome doesn't allow capturing this page. Browser pages (chrome://, about:, the New Tab page), the Chrome Web Store and other extensions' pages are protected.";

export const FILE_URL_MESSAGE =
  'To capture local files, enable "Allow access to file URLs" for LocalCapture in chrome://extensions.';

const BLOCKED_SCHEMES = ['chrome:', 'chrome-untrusted:', 'chrome-search:', 'chrome-extension:', 'edge:', 'about:', 'devtools:', 'view-source:', 'brave:', 'opera:', 'vivaldi:'];
const BLOCKED_HOSTS = ['chromewebstore.google.com', 'microsoftedge.microsoft.com'];

export function restrictionReason(url: string | undefined, fileAccess = false): string | null {
  if (!url) return null; // unknown (no access yet) — the injection attempt decides
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return RESTRICTED_MESSAGE;
  }
  if (BLOCKED_SCHEMES.includes(u.protocol)) return RESTRICTED_MESSAGE;
  if (BLOCKED_HOSTS.includes(u.hostname)) return RESTRICTED_MESSAGE;
  if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return RESTRICTED_MESSAGE;
  if (u.protocol === 'file:' && !fileAccess) return FILE_URL_MESSAGE;
  if (!['http:', 'https:', 'file:'].includes(u.protocol)) return RESTRICTED_MESSAGE;
  return null;
}

/** Map Chrome's injection errors for protected pages to the friendly message. */
export function isRestrictedError(message: string): boolean {
  return /cannot (access|be scripted)|chrome:\/\/|extensions gallery|cannot capture|not allowed|Missing host permission|chrome-extension:\/\//i.test(message);
}
