import { useEffect, useState } from 'preact/hooks';
import { predictSize } from '../../lib/capture/plan';
import { restrictionReason } from '../../lib/capture/restricted';
import { sendToBackground } from '../../lib/messages';
import { loadSettings, QUALITY_LABELS, saveSettings, type Settings } from '../../lib/settings';
import { getBlob, listCaptures } from '../../lib/storage/db';
import type { CaptureMode, CaptureSummary } from '../../lib/types';
import { fmtBytes, fmtDate, fmtPx } from '../shared/format';
import { IconArea, IconElement, IconGear, IconLock, IconVisible } from '../shared/icons';

interface Measure {
  width: number;
  height: number;
  dpr: number;
  root: string;
}

const TIPS_KEY = 'tipsSeen';

const COMMAND_FOR: Record<CaptureMode, string> = {
  visible: 'capture-visible',
  full: 'capture-full',
  region: 'capture-region',
  element: 'capture-element',
};

const SMALL_MODES: { mode: CaptureMode; label: string; Icon: typeof IconVisible }[] = [
  { mode: 'visible', label: 'Visible', Icon: IconVisible },
  { mode: 'region', label: 'Area', Icon: IconArea },
  { mode: 'element', label: 'Element', Icon: IconElement },
];

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [tipsSeen, setTipsSeen] = useState(true);
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [recent, setRecent] = useState<(CaptureSummary & { thumb?: string })[]>([]);

  useEffect(() => {
    (async () => {
      setSettings(await loadSettings());
      setTipsSeen(!!(await chrome.storage.local.get(TIPS_KEY))[TIPS_KEY]);
      chrome.commands.getAll().then((cmds) => setShortcuts(Object.fromEntries(cmds.map((c) => [c.name ?? '', c.shortcut ?? '']))));
      // E2E builds only: ?tab=<id> targets a tab, so the popup can be opened as a page in tests.
      const forced = import.meta.env.MODE === 'e2e' ? Number(new URLSearchParams(location.search).get('tab')) : 0;
      const [t] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
      setTab(t ?? null);
      if (!t?.id) setError('No active tab to capture.');
      const blocked = restrictionReason(t?.url, await chrome.extension.isAllowedFileSchemeAccess());
      if (blocked) setError(blocked);
      else if (t?.id) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['/capture.js'] });
          const [r] = await chrome.scripting.executeScript({
            target: { tabId: t.id },
            func: () => (globalThis as unknown as { __localCapture: { measure(): Measure } }).__localCapture.measure(),
          });
          setMeasure(r.result as Measure);
        } catch {
          /* page not scriptable yet; capture will report */
        }
      }
      const list = await listCaptures(3);
      setRecent(
        await Promise.all(
          list.map(async (c) => {
            const b = c.thumbKey ? await getBlob(c.thumbKey) : undefined;
            return { ...c, thumb: b ? URL.createObjectURL(b) : undefined };
          }),
        ),
      );
    })();
  }, []);

  if (!settings) return <div class="pad muted">Loading…</div>;

  const update = async (patch: Partial<Settings>) => setSettings(await saveSettings(patch));
  const usesSharp = settings.engine !== 'scroll';
  const scale = usesSharp ? settings.quality : measure?.dpr ?? 1;
  const est = measure ? predictSize(measure.width, Math.min(measure.height, settings.maxHeightCss), scale) : null;
  const disabled = !!error || !tab || starting;

  const capture = async (mode: CaptureMode, pickContainer = false) => {
    if (disabled || !tab?.id) return;
    setStarting(true);
    setStartError(null);
    try {
      // Wait until the background accepts the request: a message sent from a popup that
      // closes straight away is dropped while Chrome wakes a sleeping service worker.
      await sendToBackground({ target: 'background', type: 'capture', mode, tabId: tab.id, pickContainer });
      window.close();
    } catch (e) {
      setStarting(false);
      setStartError(`Couldn't start the capture: ${(e as Error).message}`);
    }
  };

  const dismissTips = () => {
    chrome.storage.local.set({ [TIPS_KEY]: true });
    setTipsSeen(true);
  };

  const fullKey = shortcuts[COMMAND_FOR.full];
  const qualityName = usesSharp ? QUALITY_LABELS[settings.quality].replace(/ \(.*/, '') : 'Screen quality';

  return (
    <main>
      <header class="row">
        <img src="/icons/icon-32.png" width="22" height="22" alt="" />
        <strong class="grow">LocalFullPageCapture</strong>
        <span class="offline" title="Nothing leaves your computer: no account, no uploads, no network requests.">
          <IconLock size={12} /> Offline
        </span>
        <button class="icon-btn" onClick={() => chrome.runtime.openOptionsPage()} title="Settings" aria-label="Settings">
          <IconGear />
        </button>
      </header>

      {!tipsSeen && (
        <section class="tips" aria-label="Tips">
          <p>
            <b>Welcome.</b> A few things that help:
          </p>
          <ul>
            <li>{fullKey ? <kbd>{fullKey}</kbd> : 'A keyboard shortcut'} captures the full page from any tab.</li>
            <li>
              Press <kbd>Esc</kbd> to cancel a capture.
            </li>
            <li>Files are saved to Downloads{settings.downloadFolder ? `/${settings.downloadFolder}` : ''}.</li>
            {usesSharp && <li>While capturing, Chrome shows a bar saying this extension is debugging the tab. That's how Sharp mode draws the page at 2×–4×; it closes when the capture ends.</li>}
          </ul>
          <button onClick={dismissTips}>Got it</button>
        </section>
      )}

      {error && (
        <p class="notice err" role="alert">
          {error}
        </p>
      )}
      {startError && (
        <p class="notice err" role="alert">
          {startError}
        </p>
      )}

      <button class="capture-main" disabled={disabled} onClick={() => capture('full')} aria-keyshortcuts={fullKey || undefined}>
        <span class="label">Capture full page</span>
        {fullKey && <kbd>{fullKey}</kbd>}
        <span class="sub">
          {starting
            ? 'Starting…'
            : est
              ? `${qualityName} · about ${fmtBytes(est.pngMB * 1048576)} · ${fmtPx(est.width, est.height)}${measure!.height > settings.maxHeightCss ? ' (capped)' : ''}`
              : 'The whole page, top to bottom'}
        </span>
      </button>

      <section class="modes" aria-label="Other capture modes">
        {SMALL_MODES.map(({ mode, label, Icon }) => {
          const key = shortcuts[COMMAND_FOR[mode]];
          return (
            <button key={mode} disabled={disabled} onClick={() => capture(mode)} title={key ? `${label} (${key})` : label}>
              <Icon size={18} />
              <span>{label}</span>
              {key && <small>{key}</small>}
            </button>
          );
        })}
      </section>

      <div class="row quality">
        <span class="muted grow">Quality</span>
        {usesSharp ? (
          <select value={settings.quality} onChange={(e) => update({ quality: Number(e.currentTarget.value) as Settings['quality'] })} aria-label="Quality">
            {([1, 2, 3, 4] as const).map((q) => (
              <option key={q} value={q}>
                {QUALITY_LABELS[q]}
              </option>
            ))}
          </select>
        ) : (
          <button class="link" onClick={() => update({ engine: 'auto' })} title="Sharp mode is off in Settings">
            Screen ({measure?.dpr ?? 1}×) · Turn on Sharp mode
          </button>
        )}
      </div>
      {measure && measure.root !== 'page' && <p class="muted small">This page scrolls inside a panel ({measure.root}). It's captured automatically.</p>}

      {recent.length > 0 && (
        <section aria-label="Recent captures">
          <h2>Recent</h2>
          <ul class="recent">
            {recent.map((c) => (
              <li key={c.id}>
                <a href={chrome.runtime.getURL(`/preview.html?id=${c.id}`)} target="_blank" rel="noreferrer" title={`${c.title || 'Untitled'}\n${fmtDate(c.createdAt)} · ${fmtPx(c.width, c.height)}`}>
                  {c.thumb ? <img src={c.thumb} alt="" /> : <span class="ph" />}
                  <span class="t">{c.title || 'Untitled'}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer class="row">
        <button class="link" disabled={disabled} onClick={() => capture('full', true)} title="For app pages where the wrong part scrolls">
          Pick scroll area…
        </button>
        <span class="grow" />
        <span class="muted">Esc cancels a capture</span>
      </footer>
    </main>
  );
}
