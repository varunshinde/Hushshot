# Changelog

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
- PDF export: lossless Flate images (JPEG only with "Smaller file"), fit-to-width A4/Letter/Legal or continuous pages, margins, orientation, metadata (title, source URL, date, producer "LocalCapture"). An invisible word-by-word text layer (glyphless font + ToUnicode) makes text searchable and selectable. Vector PDF via `Page.printToPDF`.
- Filenames like `page-title_2026-11-01_1432_part-01-of-04.png`, from a template.

### Text and OCR
- DOM text layer: every visible word with its box, mapped through scroll, scale, sticky handling and stitching. Clipped and hidden text are excluded; same-origin iframes are included.
- Tesseract.js 7 OCR (LSTM, `eng` best_int) fully bundled, run in a Worker inside the offscreen document, for images, canvas, video, path-only SVG, cross-origin frames and CSS background images (or the whole image when a page has no DOM text). Preprocessing: upscale to ≥300 DPI, grayscale, polarity-independent background normalisation (handles dark mode and mixed panels), optional adaptive threshold, and per-region page segmentation mode.
- Copy all text, rectangle text selection in the preview, and .txt/.md export (headings and list items from the DOM).

### UI
- Popup with mode buttons, quality/engine, predicted output size, high-resolution engine prompt and recent captures.
- Preview page: fit/100%/200% pixel-exact zoom, pan, crop, text selection, draggable splits, size estimates, warnings, OCR status, and the export panel.
- Options page with every setting, plus JSON export/import. Light/dark theme.

### Docs
- README with screenshots generated from a generic demo page (`pnpm docs:screenshots`).

### Tests
- 28 unit tests (Vitest) and 21 end-to-end tests (Playwright, real Chrome with the unpacked extension). See README for the summary.
