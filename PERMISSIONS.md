# LocalFullPageCapture permissions

LocalFullPageCapture asks for the smallest set of permissions that makes each feature work. It has **no host permissions** in the production build, no `externally_connectable`, no `web_accessible_resources`, and never makes a network request.

**About the install warning.** Because Sharp mode needs `debugger`, Chrome's install dialog shows warnings such as *"Read and change all your data on all websites"* and *"Access the page debugger backend"*. Those describe what the permission could allow in general. LocalFullPageCapture attaches the debugger only to the tab you're capturing, only while a capture you started is running, and never sends anything off your computer.

## Required permissions

| Permission | Why it's needed | What it can't do |
|---|---|---|
| `activeTab` | Grants temporary access to the tab you're on, **only** when you click the toolbar icon or press a LocalFullPageCapture shortcut. Used to inject the capture script and to call `tabs.captureVisibleTab`. | No access to any other tab, and none until you invoke LocalFullPageCapture. Access ends when the tab navigates. |
| `scripting` | Injects the capture script (`capture.js`) into the active tab on demand: page preparation, the region/element pickers, layout measurement and the DOM text layer. | Only works on tabs `activeTab` has granted. Nothing is injected automatically; there are no declared content scripts. |
| `storage` | Saves your settings (quality, PDF options, …) in `chrome.storage.local`. | Never used for image data. |
| `unlimitedStorage` | Captures (lossless PNG tiles, often tens of MB) are kept in the extension's IndexedDB. Without this, Chrome's quota could evict them. | Stays inside the browser profile. |
| `offscreen` | Creates a hidden extension page that stitches tiles and runs Tesseract OCR in a Web Worker. The service worker can't start Workers or do heavy canvas work reliably. | The offscreen document can only use `chrome.runtime` messaging. |
| `downloads` | Saves exported files (PNG/PDF/ZIP/TXT/MD) to your Downloads folder, optionally in a subfolder. | Only for files you export. |
| `clipboardWrite` | "Copy image" and "Copy text" in the preview page. | Write-only; LocalFullPageCapture never reads your clipboard. |
| `debugger` | **Sharp mode.** Uses the Chrome DevTools Protocol to re-render the page at 2x/3x/4x (`Emulation.setDeviceMetricsOverride`) and capture PNG tiles (`Page.captureScreenshot`). Also used for the "Print-style PDF" export (`Page.printToPDF`). Chrome shows a "started debugging this browser" bar while it's attached. | Attaches only to the tab being captured, only during a capture you start, and is always detached afterwards, including on error or cancel. Turn Sharp mode off in Settings and it's never used. |

## Why `debugger` isn't optional

It used to be listed as an optional permission, to be requested on first use. Chrome doesn't allow that: `debugger` is one of the permissions that can't be optional, so Chrome silently dropped it and the request always failed (fixed in 0.2.0). The only way to offer Sharp mode is to request it at install. A unit test (`test/unit/manifest.test.ts`) and a production-build check (`pnpm test:prod`) now guard against this.

### Not requested

* **`<all_urls>` / host permissions.** Not needed: `activeTab` covers the tab you capture. (The E2E *test* build adds `<all_urls>`, because Playwright can't press extension shortcuts or click the toolbar icon to grant `activeTab`. Its permissions are otherwise identical. That build is never meant to be loaded for normal use; see `wxt.config.ts`.)
* **`tabs`.** Not needed; tab URL/title for the capture come with `activeTab`.
* **`notifications`.** Errors from shortcut captures open the preview page with the message instead.

## Other security measures

* **Content Security Policy:** `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. `wasm-unsafe-eval` is required to compile the bundled Tesseract WebAssembly. No `eval`, no `new Function`, no remote scripts.
* **Message validation:** every `chrome.runtime.onMessage` handler checks `sender.id === chrome.runtime.id` and that the sender is one of the extension's own pages. The only message accepted from a tab (the injected capture script) is "cancel" when you press Esc (`src/lib/messages.ts`, `isTrustedSender`).
* **Zero network:** all libraries, the OCR worker, WASM core and English language model are bundled. Tesseract's built-in CDN fallbacks are rewritten to an unroutable scheme at build time, and the build fails if any other remote URL remains in the bundle (`scripts/strip-remote-urls.mjs`). E2E tests record every request from every extension context over CDP and fail on anything that isn't a packaged file.
* **No install page:** nothing opens on install or update.
