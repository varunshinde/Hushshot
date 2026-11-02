import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { buildFilename } from '../../lib/export/filename';
import {
  advancedDefaults,
  BUNDLED_OCR_LANGUAGES,
  DEFAULT_SETTINGS,
  loadSettings,
  QUALITY_LABELS,
  sanitizeSettings,
  saveSettings,
  type Settings,
} from '../../lib/settings';

type Opt<T> = [T, string][];
type Tab = 'general' | 'shortcuts' | 'advanced' | 'backup';
const TABS: [Tab, string][] = [
  ['general', 'General'],
  ['shortcuts', 'Shortcuts'],
  ['advanced', 'Advanced'],
  ['backup', 'Backup & reset'],
];

/** One setting: name and explanation on the left, the control on the right. */
function Row({ name, help, children, id }: { name: string; help?: ComponentChildren; children: ComponentChildren; id?: string }) {
  return (
    <div class="set">
      <div class="set-text">
        <label class="set-name" for={id}>
          {name}
        </label>
        {help && <p class="set-help">{help}</p>}
      </div>
      <div class="set-control">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="group">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const RESULT_KEYS: [string, string][] = [
  ['⌘S / Ctrl+S', 'Download in the current format'],
  ['⌘C / Ctrl+C', 'Copy the image (or the selected words)'],
  ['⌘⇧C / Ctrl+Shift+C', 'Copy all text'],
  ['C', 'Crop · Enter to finish, Esc to cancel'],
  ['T', 'Select text'],
  ['H', 'Move around'],
  ['+ / −, pinch', 'Zoom in and out'],
  ['0 · F · 1', 'Fit width · Fit page · Actual pixels'],
];

export function App() {
  const [s, setS] = useState<Settings | null>(null);
  const [hasSharp, setHasSharp] = useState(false);
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1) as Tab;
    return TABS.some(([t]) => t === h) ? h : 'general';
  });

  useEffect(() => {
    loadSettings().then(setS);
    chrome.permissions.contains({ permissions: ['debugger'] }).then(setHasSharp);
    chrome.commands.getAll().then(setCommands);
    const onHash = () => {
      const h = location.hash.slice(1) as Tab;
      if (TABS.some(([t]) => t === h)) setTab(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  if (!s) return null;

  const set = async (patch: Partial<Settings>) => setS(await saveSettings(patch));
  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(''), 3000);
  };
  const sel = <K extends keyof Settings>(key: K, opts: Opt<Settings[K]>, num = false) => (
    <select
      id={key}
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
  const toggle = (key: keyof Settings) => (
    <input id={key} type="checkbox" role="switch" class="switch" checked={s[key] as boolean} onChange={(e) => set({ [key]: e.currentTarget.checked } as Partial<Settings>)} />
  );
  const number = (key: keyof Settings, min: number, max: number, step = 1) => (
    <input id={key} type="number" min={min} max={max} step={step} value={s[key] as number} onChange={(e) => set({ [key]: Number(e.currentTarget.value) } as Partial<Settings>)} />
  );
  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, '', `#${t}`);
  };

  const example = buildFilename(s.filenameTemplate, { title: 'A Weekend on the Coast Trail', date: new Date(), part: 1, total: 1, ext: s.downloadFormat === 'jpeg' ? 'jpg' : s.downloadFormat });

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
      setS(await saveSettings(sanitizeSettings(JSON.parse(await file.text()))));
      flash('Settings imported.');
    } catch (e) {
      flash(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <div class="shell">
      <nav class="side" aria-label="Settings sections">
        <div class="brand">
          <img src="/icons/icon-32.png" width="24" height="24" alt="" />
          <span>LocalFullPageCapture</span>
        </div>
        {TABS.map(([t, label]) => (
          <a key={t} href={`#${t}`} aria-current={tab === t ? 'page' : undefined} onClick={(e) => (e.preventDefault(), go(t))}>
            {label}
          </a>
        ))}
        <p class="privacy">Everything runs on this computer. No account, no uploads, no network requests.</p>
      </nav>

      <main>
        {tab === 'general' && (
          <>
            <h1>General</h1>
            <Group title="Capturing">
              <Row name="Sharp mode" help="Re-draws the page at 2× to 4× so text stays crisp. While it captures, Chrome shows a bar saying this extension is debugging the tab.">
                {hasSharp ? (
                  <span class="row">
                    <span class="ok">Allowed</span>
                    <button onClick={async () => setHasSharp(!(await chrome.permissions.remove({ permissions: ['debugger'] })))}>Turn off</button>
                  </span>
                ) : (
                  <button class="primary" onClick={async () => setHasSharp(await chrome.permissions.request({ permissions: ['debugger'] }))}>
                    Allow Sharp mode
                  </button>
                )}
              </Row>
              <Row id="quality" name="Quality" help={hasSharp ? 'Higher is sharper and larger. Sharp (2×) suits most pages.' : 'Needs Sharp mode. Without it, captures use your screen’s resolution.'}>
                {sel('quality', ([1, 2, 3, 4] as const).map((q) => [q, QUALITY_LABELS[q]]), true)}
              </Row>
              <Row id="toolbarClick" name="Clicking the toolbar icon">
                {sel('toolbarClick', [
                  ['menu', 'Shows the capture menu'],
                  ['capture', 'Captures the full page right away'],
                ])}
              </Row>
            </Group>

            <Group title="Clean pages">
              <Row id="hideCookieBanners" name="Hide cookie banners" help="Removed from the screenshot only. The page itself isn’t changed.">
                {toggle('hideCookieBanners')}
              </Row>
              <Row id="hideChatWidgets" name="Hide chat bubbles">
                {toggle('hideChatWidgets')}
              </Row>
              <Row id="stickyMode" name="Sticky headers" help="Stops a site’s top bar from repeating down a long screenshot.">
                {sel('stickyMode', [
                  ['once', 'Show once, at the top'],
                  ['hide', 'Hide'],
                  ['asis', 'Leave as they are'],
                ])}
              </Row>
            </Group>

            <Group title="Saving">
              <Row id="downloadFormat" name="Download as" help="The result page’s Download button uses this. Choosing another format there updates it.">
                {sel('downloadFormat', [
                  ['png', 'PNG (lossless image)'],
                  ['pdf', 'PDF (searchable pages)'],
                  ['jpeg', 'JPEG (smaller image)'],
                  ['webp', 'WebP (smallest image)'],
                ])}
              </Row>
              <Row id="pdfPaper" name="PDF paper">
                {sel('pdfPaper', [
                  ['a4', 'A4'],
                  ['letter', 'US Letter'],
                  ['legal', 'Legal'],
                  ['continuous', 'One long page'],
                ])}
              </Row>
              <Row id="downloadFolder" name="Save to" help={<>Example file: {example}</>}>
                <span class="row folder">
                  <span class="muted">Downloads /</span>
                  <input id="downloadFolder" type="text" value={s.downloadFolder} placeholder="(top level)" onChange={(e) => set({ downloadFolder: e.currentTarget.value })} />
                </span>
              </Row>
            </Group>

            <Group title="Text">
              <Row id="ocrMode" name="Read text in images" help="On-device text recognition for pictures, charts and canvas. Nothing is uploaded.">
                {sel('ocrMode', [
                  ['auto', 'Automatically after each capture'],
                  ['demand', 'Only when I ask'],
                ])}
              </Row>
            </Group>
          </>
        )}

        {tab === 'shortcuts' && (
          <>
            <h1>Shortcuts</h1>
            <Group title="Capture from any tab">
              {commands
                .filter((c) => c.name && !c.name.startsWith('_'))
                .map((c) => (
                  <Row key={c.name} name={c.description ?? c.name!}>
                    {c.shortcut ? <kbd>{c.shortcut}</kbd> : <span class="muted">Not set</span>}
                  </Row>
                ))}
              <div class="row">
                <button onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>Change shortcuts</button>
                <span class="muted small">Chrome manages these keys. Press Esc to cancel any capture.</span>
              </div>
            </Group>
            <Group title="On the result page">
              {RESULT_KEYS.map(([k, d]) => (
                <Row key={k} name={d}>
                  <kbd>{k}</kbd>
                </Row>
              ))}
            </Group>
          </>
        )}

        {tab === 'advanced' && (
          <>
            <div class="row heading">
              <h1 class="grow">Advanced</h1>
              <button onClick={async () => (setS(await saveSettings(advancedDefaults())), flash('Advanced settings reset.'))}>Reset advanced settings</button>
            </div>
            <p class="muted intro">The defaults work for most pages. Change these if a site captures oddly or you need a specific output.</p>

            <Group title="Capture method">
              <Row id="engine" name="Method" help="Automatic uses Sharp mode when it’s allowed. Compatibility mode scrolls the page and stitches screenshots at your screen’s resolution.">
                {sel('engine', [
                  ['auto', 'Automatic'],
                  ['cdp', 'Sharp mode only'],
                  ['scroll', 'Compatibility mode'],
                ])}
              </Row>
              <Row id="cdpStrategy" name="Sharp mode tiling" help="Scrolling keeps fixed footers and chat bubbles at the bottom. Single render is faster but can pin fixed footers over the first screen.">
                {sel('cdpStrategy', [
                  ['scroll', 'Scroll the page (recommended)'],
                  ['beyond', 'Single render'],
                ])}
              </Row>
              <Row id="maxTileHeight" name="Tile height (device px)" help="Lower it if very tall captures come out blank.">
                {number('maxTileHeight', 1024, 16384, 256)}
              </Row>
              <Row id="colorScheme" name="Colour scheme" help="Sharp mode only.">
                {sel('colorScheme', [
                  ['asis', 'As the page shows it'],
                  ['light', 'Force light'],
                  ['dark', 'Force dark'],
                ])}
              </Row>
            </Group>

            <Group title="Page loading">
              <Row id="lazyPrepass" name="Load lazy images first" help="Scrolls through the page before capturing so images that load on scroll are there.">
                {toggle('lazyPrepass')}
              </Row>
              <Row id="maxWaitMs" name="Wait for images (ms)" help="Longest wait for images, fonts and network to settle.">
                {number('maxWaitMs', 0, 30000, 250)}
              </Row>
              <Row id="maxHeightCss" name="Longest page (CSS px)" help="Endless-scroll pages stop here; you’ll be told when it happens.">
                {number('maxHeightCss', 1000, 200000, 1000)}
              </Row>
              <Row id="fullWidth" name="Capture full width" help="Also capture content that scrolls sideways.">
                {toggle('fullWidth')}
              </Row>
            </Group>

            <Group title="Cleanup rules">
              <Row id="cookieSelectors" name="Cookie banner selectors" help="CSS selectors, one per line.">
                <textarea id="cookieSelectors" rows={5} value={s.cookieSelectors} onChange={(e) => set({ cookieSelectors: e.currentTarget.value })} />
              </Row>
              <Row id="chatSelectors" name="Chat bubble selectors" help="CSS selectors, one per line.">
                <textarea id="chatSelectors" rows={5} value={s.chatSelectors} onChange={(e) => set({ chatSelectors: e.currentTarget.value })} />
              </Row>
              <div class="row">
                <button onClick={() => set({ cookieSelectors: DEFAULT_SETTINGS.cookieSelectors, chatSelectors: DEFAULT_SETTINGS.chatSelectors })}>Restore default selectors</button>
              </div>
            </Group>

            <Group title="Files">
              <Row id="filenameTemplate" name="File name" help={<>Tokens: {'{title} {date} {time} {part}'} · Example: {example}</>}>
                <input id="filenameTemplate" type="text" value={s.filenameTemplate} onChange={(e) => set({ filenameTemplate: e.currentTarget.value })} />
              </Row>
              <Row id="maxSegmentHeight" name="Maximum part height (px)" help="Long images are split into parts no taller than this, between lines of text.">
                {number('maxSegmentHeight', 500, 16000, 100)}
              </Row>
              <Row id="segmentOverlap" name="Repeat at each break" help="Repeats a strip of the previous part at the top of the next one.">
                {sel('segmentOverlap', [
                  [0, 'Nothing'],
                  [40, '40 px'],
                  [80, '80 px'],
                ], true)}
              </Row>
              <Row id="multiPart" name="Save parts as">
                {sel('multiPart', [
                  ['separate', 'Separate files'],
                  ['zip', 'One .zip file'],
                ])}
              </Row>
              <Row id="lossyQuality" name="JPEG and WebP quality" help="0.5 to 1. Higher is sharper and larger.">
                {number('lossyQuality', 0.5, 1, 0.01)}
              </Row>
              <Row id="openPreview" name="Open the result page after each capture">
                {toggle('openPreview')}
              </Row>
            </Group>

            <Group title="PDF">
              <Row id="pdfMargins" name="Margins">
                {sel('pdfMargins', [
                  ['none', 'None'],
                  ['small', 'Small'],
                  ['normal', 'Normal'],
                ])}
              </Row>
              <Row id="pdfOrientation" name="Orientation">
                {sel('pdfOrientation', [
                  ['auto', 'Automatic'],
                  ['portrait', 'Portrait'],
                  ['landscape', 'Landscape'],
                ])}
              </Row>
              <Row id="pdfStamp" name="Add page address and date" help="Prints the page’s address, the capture date and the page number at the bottom of each page.">
                {toggle('pdfStamp')}
              </Row>
              <Row id="pdfSmaller" name="Smaller PDFs" help="Uses JPEG images. Slightly less sharp.">
                {toggle('pdfSmaller')}
              </Row>
            </Group>

            <Group title="Text recognition">
              <Row id="ocrWholeImage" name="Read the whole image" help="Automatic does this only when the page has almost no real text, such as canvas apps.">
                {sel('ocrWholeImage', [
                  ['auto', 'Automatic'],
                  ['always', 'Always'],
                  ['never', 'Never (pictures and charts only)'],
                ])}
              </Row>
              <Row id="ocrThreshold" name="Clean up noisy backgrounds" help="Can help with textured or low-contrast images.">
                {toggle('ocrThreshold')}
              </Row>
              <Row name="Languages" help="Only languages bundled with the extension are offered. See the README to add one.">
                <span class="row">
                  {BUNDLED_OCR_LANGUAGES.map((l) => (
                    <label class="inline" key={l}>
                      <input
                        type="checkbox"
                        checked={s.ocrLanguages.includes(l)}
                        onChange={(e) => set({ ocrLanguages: e.currentTarget.checked ? [...s.ocrLanguages, l] : s.ocrLanguages.filter((x) => x !== l) })}
                      />
                      {l === 'eng' ? 'English' : l}
                    </label>
                  ))}
                </span>
              </Row>
            </Group>
          </>
        )}

        {tab === 'backup' && (
          <>
            <h1>Backup &amp; reset</h1>
            <Group title="Settings file">
              <Row name="Save your settings" help="A small JSON file you can import on another computer.">
                <button onClick={exportJson}>Export settings</button>
              </Row>
              <Row name="Load settings from a file">
                <label class="button">
                  Import settings
                  <input type="file" accept="application/json,.json" class="sr-only" onChange={(e) => importJson(e.currentTarget.files?.[0])} />
                </label>
              </Row>
            </Group>
            <Group title="Reset">
              <Row name="Reset everything" help="Puts every setting back to its default. Your saved captures are kept.">
                <button class="danger" onClick={async () => (setS(await saveSettings(DEFAULT_SETTINGS)), flash('All settings reset.'))}>
                  Reset all settings
                </button>
              </Row>
            </Group>
          </>
        )}
        {msg && (
          <p class="notice info" role="status">
            {msg}
          </p>
        )}
      </main>
    </div>
  );
}
