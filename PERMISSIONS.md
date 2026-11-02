# LocalCapture permissions

LocalCapture asks for the smallest set of permissions that makes each feature work. It has **no host permissions** in the production build, no `externally_connectable`, no `web_accessible_resources`, and never makes a network request.

## Required permissions

| Permission | Why it's needed | What it can't do |
|---|---|---|
| `activeTab` | Grants temporary access to the tab you're on, **only** when you click the toolbar icon or press a LocalCapture shortcut. Used to inject the capture script and to call `tabs.captureVisibleTab`. | No access to any other tab, and none until you invoke LocalCapture. Access ends when the tab navigates. |
| `scripting` | Injects the capture script (`capture.js`) into the active tab on demand: page preparation, the region/element pickers, layout measurement and the DOM text layer. | Only works on tabs `activeTab` has granted. Nothing is injected automatically; there are no declared content scripts. |
| `storage` | Saves your settings (quality, PDF options, …) in `chrome.storage.local`. | Never used for image data. |
| `unlimitedStorage` | Captures (lossless PNG tiles, often tens of MB) are kept in the extension's IndexedDB. Without this, Chrome's quota could evict them. | Stays inside the browser profile. |
| `offscreen` | Creates a hidden extension page that stitches tiles and runs Tesseract OCR in a Web Worker. The service worker can't start Workers or do heavy canvas work reliably. | The offscreen document can only use `chrome.runtime` messaging. |
| `downloads` | Saves exported files (PNG/PDF/ZIP/TXT/MD) to your Downloads folder, optionally in a subfolder. | Only for files you export. |
| `clipboardWrite` | "Copy image" and "Copy text" in the preview page. | Write-only; LocalCapture never reads your clipboard. |

## Optional permissions (requested at runtime)

| Permission | When it's requested | Why |
|---|---|---|
| `debugger` | The first time you capture from the popup with Engine = Auto/CDP, or when you click "Enable 2x–4x" in the popup or "Grant" in Settings. | The high-resolution engine uses the Chrome DevTools Protocol to re-render the page at 2x/3x/4x (`Emulation.setDeviceMetricsOverride`) and capture PNG tiles (`Page.captureScreenshot`). It's also used for the optional "Vector PDF (print)" export (`Page.printToPDF`). The debugger attaches only to the tab being captured, and only for the duration of the capture; it is always detached afterwards, including on error or cancel. Chrome shows a "started debugging this browser" bar while it's attached. |

If you decline `debugger`, captures fall back to the scroll-and-stitch engine at your display's native resolution. You can revoke it any time in Settings.

### Not requested

* **`<all_urls>` / host permissions.** Not needed: `activeTab` covers the tab you capture. (The E2E *test* build adds `<all_urls>` and makes `debugger` required, because Playwright can't press extension shortcuts or accept permission prompts. That build is never meant to be loaded for normal use; see `wxt.config.ts`.)
* **`tabs`.** Not needed; tab URL/title for the capture come with `activeTab`.
* **`notifications`.** Errors from shortcut captures open the preview page with the message instead.

## Other security measures

* **Content Security Policy:** `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. `wasm-unsafe-eval` is required to compile the bundled Tesseract WebAssembly. No `eval`, no `new Function`, no remote scripts.
* **Message validation:** every `chrome.runtime.onMessage` handler checks `sender.id === chrome.runtime.id` and that the sender is one of the extension's own pages. The only message accepted from a tab (the injected capture script) is "cancel" when you press Esc (`src/lib/messages.ts`, `isTrustedSender`).
* **Zero network:** all libraries, the OCR worker, WASM core and English language model are bundled. Tesseract's built-in CDN fallbacks are rewritten to an unroutable scheme at build time, and the build fails if any other remote URL remains in the bundle (`scripts/strip-remote-urls.mjs`). E2E tests record every request from every extension context over CDP and fail on anything that isn't a packaged file.
* **No install page:** nothing opens on install or update.
