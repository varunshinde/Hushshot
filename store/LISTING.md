# Chrome Web Store listing

What to enter in the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) for Hushshot. Upload `Hushshot-v<version>.zip` from the GitHub release (built with `pnpm zip`). The images are in `store/images/`; rebuild them with `pnpm docs:screenshots && STORE=1 pnpm exec playwright test store` after `pnpm build:e2e`.

## Package

Upload the same zip that's attached to the GitHub release, so both are byte-for-byte identical. The store takes the name, the short description (summary) and the icon from the manifest:

- **Name:** Hushshot
- **Summary:** Private, offline screenshots with searchable PDF export and on-device OCR. No network, no telemetry.

## Store listing tab

**Description:**

```
Capture entire web pages in pixel-sharp quality, and keep every screenshot on your own computer.

Hushshot makes no network requests at all. There's no account, no analytics and no upload. Everything it needs, including the text-recognition model, is inside the extension.

CAPTURE
• Full page, visible area, a region you draw, or a single element
• Sharp mode renders the page again at 2×, 3× or 4×, so text stays crisp when you zoom
• Long pages, pages with their own scroll area, sticky headers and lazy-loaded images are handled for you
• Cookie banners and chat bubbles are left out by default
• Keyboard shortcuts for every capture mode

SAVE AND SHARE
• Download PNG, JPEG, WebP or PDF in one click; the button remembers your choice
• PDFs with lossless images, paper size, margins and smart page breaks that avoid cutting through text
• Searchable PDFs: every word can be found and selected, including words inside images
• Optional page address, capture date and page numbers at the bottom of each PDF page
• Copy image or copy text straight to the clipboard

CROP, ZOOM AND TEXT
• Crop with handles, and every download uses just that area
• Zoom with trackpad pinch, a slider or the keyboard
• Select text anywhere on a capture and copy it, even from charts and pictures, with on-device text recognition (OCR)

PRIVATE BY DESIGN
• No account, no sign-in, no tracking, no ads, no watermark and no limits
• Captures are stored in your browser and saved only to your Downloads folder
• No host permissions: Hushshot only touches a tab when you click its icon or press a shortcut

About the install warning: Sharp mode uses Chrome's debugger permission to draw the page at higher resolution. Chrome's install dialog describes everything that permission could allow in general. Hushshot attaches it only to the tab you're capturing, only while a capture you started is running, and nothing ever leaves your computer. You can turn Sharp mode off in Settings.

Website and help: https://varunshinde.github.io/Hushshot/
Source code and what each permission is for: https://github.com/varunshinde/Hushshot
```

- **Category:** Productivity › Tools
- **Language:** English
- **Store icon (128×128):** `public/icons/icon-128.png`
- **Screenshots (1280×800), in this order:** `1-full-page.png`, `2-popup.png`, `3-pdf.png`, `4-copy-text.png`, `5-private.png`
- **Small promo tile (440×280):** `promo-small-440x280.png`
- **Marquee promo tile (1400×560, optional):** `promo-marquee-1400x560.png`
- **Official URL:** leave as "None" (it needs a domain verified in Google Search Console)
- **Homepage URL:** https://varunshinde.github.io/Hushshot/
- **Support URL:** https://github.com/varunshinde/Hushshot/issues
- **Mature content:** No

## Privacy practices tab

**Single purpose:**

```
Hushshot captures screenshots of the web page you're viewing (the full page, the visible area, a region or one element) and lets you crop them and save them as images or PDFs. Everything happens on your computer.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| activeTab | Gives temporary access to the current tab only when the user clicks the toolbar icon or presses a Hushshot shortcut, so the extension can capture that tab with captureVisibleTab and inject its capture script. |
| scripting | Injects the extension's own capture script into the tab the user chose to capture, on demand, to measure the page, prepare it for capture (hide scrollbars, pause animations) and show the region and element pickers. No content scripts run automatically. |
| storage | Saves the user's settings, such as capture quality and PDF options, in chrome.storage.local. |
| unlimitedStorage | Captures are kept as lossless PNG tiles in the extension's IndexedDB, often tens of megabytes each, so the browser's default quota could otherwise delete them. They never leave the browser profile. |
| offscreen | Creates a hidden extension page that stitches image tiles and runs text recognition (OCR) in a Web Worker, which the service worker can't do. |
| downloads | Saves the files the user exports (PNG, PDF, ZIP or text) to their Downloads folder. |
| clipboardWrite | Powers the "Copy image" and "Copy text" buttons on the result page. The extension never reads the clipboard. |
| debugger | Sharp mode: uses the Chrome DevTools Protocol on the tab being captured to render the page at 2×–4× (Emulation.setDeviceMetricsOverride) and capture it (Page.captureScreenshot), and for the optional print-style PDF (Page.printToPDF). It attaches only to the tab the user is capturing, only while a capture they started is running, and always detaches afterwards. Users can turn Sharp mode off in Settings. |

**Host permissions:** none requested.

**Are you using remote code?** No, I am not using remote code. (All JavaScript and the OCR WebAssembly and language model are packaged in the extension.)

**Data usage:** tick none of the data types. Hushshot doesn't collect or transmit any user data.

Tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://varunshinde.github.io/Hushshot/privacy.html

## Distribution tab

- **Visibility:** Public
- **Regions:** All regions

## Test instructions (optional)

```
No account or setup is needed. Open any web page, click the Hushshot icon and press "Capture full page". The result page opens with Download, Copy image and Copy text. Chrome shows a "started debugging this browser" bar during a Sharp mode capture; that's expected and it closes when the capture ends.
```
