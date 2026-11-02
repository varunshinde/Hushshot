import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { BUNDLED_OCR_LANGUAGES, DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings, type Settings } from '../../lib/settings';

type Opt<T> = [T, string][];

function Field({ label, help, children }: { label: string; help?: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span class="name">{label}</span>
      {children}
      {help && <span class="help">{help}</span>}
    </label>
  );
}

export function App() {
  const [s, setS] = useState<Settings | null>(null);
  const [hasDebugger, setHasDebugger] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    loadSettings().then(setS);
    chrome.permissions.contains({ permissions: ['debugger'] }).then(setHasDebugger);
  }, []);
  if (!s) return null;

  const set = async (patch: Partial<Settings>) => setS(await saveSettings(patch));
  const sel = <K extends keyof Settings>(key: K, opts: Opt<Settings[K]>, num = false) => (
    <select
      value={String(s[key])}
      onChange={(e) => {
        const v = e.currentTarget.value;
        set({ [key]: num ? Number(v) : v } as Partial<Settings>);
      }}
    >
      {opts.map(([v, l]) => (
        <option key={String(v)} value={String(v)}>
          {l}
        </option>
      ))}
    </select>
  );
  const check = (key: keyof Settings, text: string) => (
    <label class="inline">
      <input type="checkbox" checked={s[key] as boolean} onChange={(e) => set({ [key]: e.currentTarget.checked } as Partial<Settings>)} />
      {text}
    </label>
  );
  const number = (key: keyof Settings, min: number, max: number, step = 1) => (
    <input type="number" min={min} max={max} step={step} value={s[key] as number} onChange={(e) => set({ [key]: Number(e.currentTarget.value) } as Partial<Settings>)} />
  );

  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'localfullpagecapture-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const next = sanitizeSettings(JSON.parse(await file.text()));
      setS(await saveSettings(next));
      setMsg('Settings imported.');
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <main>
      <h1>LocalFullPageCapture settings</h1>
      <p class="muted">Everything runs on this computer. LocalFullPageCapture makes no network requests.</p>

      <section>
        <h2>Capture</h2>
        <Field label="Quality" help="Device scale factor for the high-resolution engine. Text is re-rendered at this scale, not upscaled.">
          {sel('quality', [[1, 'Standard (1x)'], [2, 'High (2x)'], [3, 'Ultra (3x)'], [4, 'Max (4x)']], true)}
        </Field>
        <Field label="Engine" help="Auto uses the high-resolution (CDP) engine when its permission is granted, otherwise scroll-and-stitch.">
          {sel('engine', [['auto', 'Auto'], ['cdp', 'High-resolution (CDP)'], ['scroll', 'Scroll-and-stitch']])}
        </Field>
        <div class="field">
          <span class="name">High-resolution engine permission</span>
          {hasDebugger ? (
            <div class="row">
              <span>Granted</span>
              <button onClick={async () => setHasDebugger(!(await chrome.permissions.remove({ permissions: ['debugger'] })))}>Revoke</button>
            </div>
          ) : (
            <div class="row">
              <span class="muted">Not granted</span>
              <button onClick={async () => setHasDebugger(await chrome.permissions.request({ permissions: ['debugger'] }))}>Grant</button>
            </div>
          )}
          <span class="help">Chrome shows a "started debugging this browser" bar during CDP captures. That's expected.</span>
        </div>
        <Field label="CDP tiling" help="Scroll tiles keep fixed footers and chat widgets at the bottom of the page. Beyond-viewport renders the page once, but pins fixed footers over the first screen.">
          {sel('cdpStrategy', [['scroll', 'Scroll tiles (recommended)'], ['beyond', 'Beyond-viewport tiles']])}
        </Field>
        <Field label="Max tile height (device px)" help="Keep under GPU texture limits.">
          {number('maxTileHeight', 1024, 16384, 256)}
        </Field>
        <Field label="Sticky headers">{sel('stickyMode', [['once', 'Show once'], ['hide', 'Hide all'], ['asis', 'Leave as-is']])}</Field>
        <Field label="Full width" help="Also capture horizontal overflow.">
          {check('fullWidth', 'Capture full page width')}
        </Field>
        <Field label="Max page height (CSS px)" help="Infinite-scroll pages are capped here; you'll be told when it happens.">
          {number('maxHeightCss', 1000, 200000, 1000)}
        </Field>
        <Field label="Lazy-load prepass">{check('lazyPrepass', 'Scroll through the page first so lazy images load')}</Field>
        <Field label="Max wait for images/network quiet (ms)">{number('maxWaitMs', 0, 30000, 250)}</Field>
        <Field label="Colour scheme (CDP only)">{sel('colorScheme', [['asis', 'As rendered'], ['light', 'Force light'], ['dark', 'Force dark']])}</Field>
      </section>

      <section>
        <h2>Cleanup</h2>
        {check('hideCookieBanners', 'Hide cookie banners')}
        <Field label="Cookie banner selectors (one per line)">
          <textarea rows={5} value={s.cookieSelectors} onChange={(e) => set({ cookieSelectors: e.currentTarget.value })} />
        </Field>
        {check('hideChatWidgets', 'Hide chat widgets')}
        <Field label="Chat widget selectors (one per line)">
          <textarea rows={5} value={s.chatSelectors} onChange={(e) => set({ chatSelectors: e.currentTarget.value })} />
        </Field>
        <button onClick={() => set({ cookieSelectors: DEFAULT_SETTINGS.cookieSelectors, chatSelectors: DEFAULT_SETTINGS.chatSelectors })}>Restore default selectors</button>
      </section>

      <section>
        <h2>Output</h2>
        <Field label="Default image format" help="PNG is lossless. JPEG/WebP only when you choose them.">
          {sel('imageFormat', [['png', 'PNG (lossless)'], ['jpeg', 'JPEG'], ['webp', 'WebP']])}
        </Field>
        <Field label="JPEG/WebP quality">{number('lossyQuality', 0.5, 1, 0.01)}</Field>
        <Field label="Max segment height (px)">{number('maxSegmentHeight', 500, 16000, 100)}</Field>
        <Field label="Segment overlap">{sel('segmentOverlap', [[0, 'None'], [40, '40 px'], [80, '80 px']], true)}</Field>
        <Field label="Multiple parts">{sel('multiPart', [['separate', 'Separate files'], ['zip', 'One .zip']])}</Field>
        <Field label="PDF page size">{sel('pdfPaper', [['a4', 'A4'], ['letter', 'US Letter'], ['legal', 'Legal'], ['continuous', 'Continuous page per segment']])}</Field>
        <Field label="PDF margins">{sel('pdfMargins', [['none', 'None'], ['small', 'Small'], ['normal', 'Normal']])}</Field>
        <Field label="PDF orientation">{sel('pdfOrientation', [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']])}</Field>
        {check('pdfSmaller', 'Smaller PDFs (JPEG images)')}
        <Field label="Filename template" help="Tokens: {title} {date} {time} {part}">
          <input type="text" value={s.filenameTemplate} onChange={(e) => set({ filenameTemplate: e.currentTarget.value })} />
        </Field>
        <Field label="Download subfolder" help="Inside your Downloads folder. Leave empty for none.">
          <input type="text" value={s.downloadFolder} onChange={(e) => set({ downloadFolder: e.currentTarget.value })} />
        </Field>
        {check('openPreview', 'Open the preview after each capture')}
      </section>

      <section>
        <h2>OCR</h2>
        <Field label="Run OCR">{sel('ocrMode', [['auto', 'Automatically after capture'], ['demand', 'Only when I ask']])}</Field>
        <Field label="OCR the whole image" help="Auto: only when the page has (almost) no DOM text, e.g. canvas apps.">
          {sel('ocrWholeImage', [['auto', 'Auto'], ['always', 'Always'], ['never', 'Never (images/canvas only)']])}
        </Field>
        {check('ocrThreshold', 'Adaptive threshold before OCR (can help with noisy backgrounds)')}
        <Field label="Languages" help="Only bundled language packs are offered. To add one, put its .traineddata.gz in public/ocr/lang/ and rebuild (see README).">
          <div class="langs">
            {BUNDLED_OCR_LANGUAGES.map((l) => (
              <label class="inline" key={l}>
                <input
                  type="checkbox"
                  checked={s.ocrLanguages.includes(l)}
                  onChange={(e) => set({ ocrLanguages: e.currentTarget.checked ? [...s.ocrLanguages, l] : s.ocrLanguages.filter((x) => x !== l) })}
                />
                {l}
              </label>
            ))}
          </div>
        </Field>
      </section>

      <section>
        <h2>Shortcuts &amp; backup</h2>
        <p>
          Change keyboard shortcuts at <code>chrome://extensions/shortcuts</code>{' '}
          <button onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>Open</button>
        </p>
        <div class="row">
          <button onClick={exportJson}>Export settings (JSON)</button>
          <label class="button">
            Import settings
            <input type="file" accept="application/json,.json" class="sr-only" onChange={(e) => importJson(e.currentTarget.files?.[0])} />
          </label>
          <button onClick={async () => setS(await saveSettings(DEFAULT_SETTINGS))}>Reset to defaults</button>
        </div>
        {msg && <p class="notice info">{msg}</p>}
      </section>
    </main>
  );
}
