# Changelog

## 0.2.0 (2026-11-02): Simpler everywhere

### New look
- **Icon** for the toolbar and the extension page (it used to be a grey letter).
- **Popup:** one big **Capture full page** button with the expected size, and Visible, Area and Element next to it. Quality is one small menu; the "Engine" choice moved to Advanced. Recent captures show as thumbnails. A one-time tips card explains the shortcuts, and before the first capture a short note explains Sharp mode and Chrome's "debugging" bar.
- **One-click mode** (optional): clicking the toolbar icon captures the full page right away.
- **Progress on the toolbar icon** during a capture (…, 10%, 20%, …), and a red "!" if it fails.
- **Result page:** a top bar with **Download** (remembers your format; ▾ for PNG, PDF, JPEG, WebP), **Copy image** and **Copy text**, and a ⋯ menu for text files, reading text in images, print-style PDF, the original page and delete. Format options open in a side panel only when you ask.
- **Settings:** **General** (the everyday choices), **Shortcuts**, **Advanced** (every other option, grouped, with its own reset) and **Backup & reset**. Plain names throughout: Sharp mode, Compatibility mode, Area, parts, page breaks, Read text in images.
- Friendlier error page with what to do next.

### Crop and zoom
- **Crop** shows the whole capture with an adjustable box: eight handles, drag inside to move, or draw a new box. Dragging near the window edge scrolls, so long pages can be cropped. **Done cropping** applies it (Enter), Cancel discards it (Esc). After cropping, only the cropped area is shown, and **Edit** or **Remove** are one click away.
- **Zoom:** Fit page, Fit width, a zoom slider (5%–800%), +/− buttons, actual pixels, keyboard (+, −, 0, F, 1, ⌘+/⌘−) and **trackpad pinch**, which zooms around the pointer.

### PDF
- New option: **Add page address and date**: the page's address, capture date and "Page n of N" at the bottom of every page, in a band that never overlaps the screenshot.

### Defaults
- Cookie banners and chat bubbles are now hidden by default (only in the screenshot; the page isn't changed). Settings you saved earlier are kept.

### Fixed
- **Sharp mode never turned on.** It relied on Chrome's `debugger` permission being optional and requested on first use, but Chrome doesn't allow `debugger` as an optional permission: it was dropped at install and every "Allow Sharp mode" request failed silently. Captures fell back to your screen's resolution, so on Retina screens they were still 2×, but 3× and 4× had no effect. `debugger` is now requested at install, so Sharp mode works out of the box; Chrome's install dialog shows a broad warning for it (see PERMISSIONS.md). Settings → General has a simple Sharp mode switch instead of a permission button. The v0.2.0 download was replaced with this fix on 2 November 2026; if you installed it earlier, download it again and reload the extension.
- A unit test now rejects any permission Chrome won't accept as optional, and `pnpm test:prod` loads the real production build to check Sharp mode's permission is granted.

### Tests
- 49 unit tests, 32 end-to-end tests and 3 production-build checks, including crop with handles, auto-scroll on a 25,000 px page, pixel-exact crop export, zoom around the pinch point, the format menu, one-click mode, the progress badge and the PDF footer.

## 0.1.3 (2026-11-01)

- **Fixed: PDF pages with a different width.** With Orientation "Auto", each page chose portrait or landscape from its own slice, so the short last page of a long capture flipped to landscape and was drawn at a different width. All pages now share one layout (paper, orientation, scale) taken from the whole capture.
- **Fixed: uneven empty space at the bottom of PDF pages.** Page breaks used to land anywhere in the bottom 15% of a page. PDF pages are now filled to the bottom: the break goes in the nearest gap between text lines above the page edge, so at most about one line is left empty. A figure is moved whole to the next page only if that leaves at most 10% of the page empty; otherwise the break goes through the figure at the page edge. Where no clean gap exists (dense multi-column text), the break crosses the fewest lines.
- **Fixed: PDF pages could overflow.** Split lines dragged in the preview (for example for PNG parts) were reused for PDF pages even when a part was taller than a paper page, so the image ran off the page. Your split lines are kept, and extra breaks are added wherever a part wouldn't fit.
- Tests: a mixed-content pagination page (text sizes, figures from 90 to 1500 px, two columns, code, a table) checked on A4 and Letter with different margins for page size, image width, overflow, cut text lines and bottom gaps.

## 0.1.2 (2026-11-01)

- **Fixed: a click in the popup sometimes did nothing, so you had to click twice.** When Chrome had put the extension's background worker to sleep (after ~30 s idle), the popup sent "start capture" and closed before the worker woke, so Chrome dropped the message. The popup now waits for the background to accept the request before closing, and shows an error instead of closing silently if it can't.
- **Fixed: the first capture could be lost at the permission prompt.** Chrome's "debugger" permission dialog can close the popup mid-click. The background now holds that capture (surviving a worker restart) and starts it once you choose Allow or Deny.
- Capture buttons stay disabled until the popup knows which tab it's on, instead of silently ignoring early clicks.
- Tests: new end-to-end tests drive the real toolbar popup with a sleeping service worker. The privacy monitor now pauses new workers until it's watching them, so requests made at worker start-up are recorded too (Chrome 156 starts workers faster than the monitor could attach).
- `pnpm zip` now runs the full production build, including the remote-URL strip step, before zipping. WXT's own zip command skipped that step.
- README: install from a GitHub release zip, with an optional checksum check.

## 0.1.1 (2026-11-01)

- Renamed the extension to **LocalFullPageCapture** to match the GitHub repository. This covers the name in Chrome, page titles, the popup and settings, the PDF "Producer"/"Creator" fields and the default download folder (`Downloads/LocalFullPageCapture`). If you saved settings before, your chosen download folder is kept.
- Internal identifiers (the IndexedDB database, message channel and injected script names) are unchanged, so existing captures and settings carry over.
- README rewritten with screenshots generated from a generic demo page (`pnpm docs:screenshots`).

## 0.1.0 — Phase 1 (2026-11-01)

First working version: screenshots, full-page capture, PNG/PDF export and OCR.

### Capture
- Four modes, each with a shortcut and a popup button: visible area (Alt+Shift+S), full page (Alt+Shift+F), region (Alt+Shift+R, auto-scrolls while dragging near an edge), element (Alt+Shift+E, with ↑/↓ to pick parent/child). Esc cancels any mode or a running capture.
- Engine A (CDP): re-renders the page at 1x/2x/3x/4x via the optional `debugger` permission and captures PNG tiles. The default "scroll tiles" strategy keeps fixed footers at the bottom; "beyond-viewport" tiling is available in Settings. The page's viewport size is preserved, and the override is always cleared and the debugger detached, including on cancel.
- Engine B (scroll-and-stitch): `captureVisibleTab` at native DPR, throttled to Chrome's quota with backoff. Overlaps are aligned by pixel-row matching.
- Page preparation (fully reverted afterwards): hidden scrollbars, paused animations/transitions/videos, hidden caret, eager lazy images with a scroll prepass and waits for images, fonts and network quiet; sticky headers shown once, hidden, or left as-is; fixed widgets shown on the first or last row only; optional cookie-banner and chat-widget hiding with editable selectors; cap for infinite-scroll pages, with a warning.
- Inner scroll containers are detected automatically (Gmail/Notion-style layouts), with "Choose scroll area" to override. Horizontal overflow can be captured with the full-width option.
- Friendly error for chrome://, Web Store and other protected pages.

### Output
- Master image kept as lossless PNG tiles in IndexedDB; never materialised, so captures can exceed canvas limits.
- Smart split: cuts avoid text lines and images using DOM layout data, falling back to the blankest row band (±15% of the target). Overlap 0/40/80 px. Split lines can be dragged in the preview.
- PNG export: hand-written encoder, 8-bit RGB (RGBA only when there is transparency), with a `pHYs` chunk at 96 × scale DPI. Multiple parts as separate files or a ZIP. JPEG/WebP only when chosen.
- PDF export: lossless Flate images (JPEG only with "Smaller file"), fit-to-width A4/Letter/Legal or continuous pages, margins, orientation, metadata (title, source URL, date, producer "LocalFullPageCapture"). An invisible word-by-word text layer (glyphless font + ToUnicode) makes text searchable and selectable. Vector PDF via `Page.printToPDF`.
- Filenames like `page-title_2026-11-01_1432_part-01-of-04.png`, from a template.

### Text and OCR
- DOM text layer: every visible word with its box, mapped through scroll, scale, sticky handling and stitching. Clipped and hidden text are excluded; same-origin iframes are included.
- Tesseract.js 7 OCR (LSTM, `eng` best_int) fully bundled, run in a Worker inside the offscreen document, for images, canvas, video, path-only SVG, cross-origin frames and CSS background images (or the whole image when a page has no DOM text). Preprocessing: upscale to ≥300 DPI, grayscale, polarity-independent background normalisation (handles dark mode and mixed panels), optional adaptive threshold, and per-region page segmentation mode.
- Copy all text, rectangle text selection in the preview, and .txt/.md export (headings and list items from the DOM).

### UI
- Popup with mode buttons, quality/engine, predicted output size, high-resolution engine prompt and recent captures.
- Preview page: fit/100%/200% pixel-exact zoom, pan, crop, text selection, draggable splits, size estimates, warnings, OCR status, and the export panel.
- Options page with every setting, plus JSON export/import. Light/dark theme.

### Tests
- 28 unit tests (Vitest) and 21 end-to-end tests (Playwright, real Chrome with the unpacked extension). See README for the summary.
