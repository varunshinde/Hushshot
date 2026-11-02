/**
 * Manifest permissions, shared by wxt.config.ts and the tests.
 *
 * `debugger` (Sharp mode) is required: Chrome doesn't allow it as an optional
 * permission. Listed there, it is silently dropped at install and
 * chrome.permissions.request() rejects it.
 */
export const PERMISSIONS = ['activeTab', 'scripting', 'storage', 'unlimitedStorage', 'offscreen', 'downloads', 'clipboardWrite', 'debugger'];

export const OPTIONAL_PERMISSIONS: string[] = [];

/** Permissions Chrome refuses to treat as optional (Chrome permissions API docs). */
export const NEVER_OPTIONAL = ['debugger', 'declarativeNetRequest', 'devtools', 'experimental', 'geolocation', 'mdns', 'proxy', 'tts', 'ttsEngine', 'wallpaper'];
