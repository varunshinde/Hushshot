import { useEffect, useState } from 'preact/hooks';
import { predictSize } from '../../lib/capture/plan';
import { restrictionReason } from '../../lib/capture/restricted';
import { sendToBackground } from '../../lib/messages';
import { loadSettings, saveSettings, type Settings } from '../../lib/settings';
import { getBlob, listCaptures } from '../../lib/storage/db';
import type { CaptureMode, CaptureSummary } from '../../lib/types';
import { fmtBytes, fmtDate, fmtPx } from '../shared/format';

const MODES: { mode: CaptureMode; label: string; key: string; hint: string }[] = [
  { mode: 'visible', label: 'Visible area', key: 'S', hint: 'Current viewport' },
  { mode: 'full', label: 'Full page', key: 'F', hint: 'Entire scrollable page' },
  { mode: 'region', label: 'Region', key: 'R', hint: 'Drag a rectangle' },
  { mode: 'element', label: 'Element', key: 'E', hint: 'Click a page element' },
];

interface Measure {
  width: number;
  height: number;
  dpr: number;
  root: string;
}

const ASKED_KEY = 'debuggerAsked';

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [measure, setMeasure] = useState<Measure | null>(null);
  const [hasDebugger, setHasDebugger] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<(CaptureSummary & { thumb?: string })[]>([]);

  useEffect(() => {
    (async () => {
      setSettings(await loadSettings());
      setHasDebugger(await chrome.permissions.contains({ permissions: ['debugger'] }));
      // E2E builds only: ?tab=<id> targets a tab, so the popup can be opened as a page in tests.
      const forced = import.meta.env.MODE === 'e2e' ? Number(new URLSearchParams(location.search).get('tab')) : 0;
      const [t] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });
      setTab(t ?? null);
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
      const list = await listCaptures(5);
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
  const usesCdp = settings.engine !== 'scroll' && hasDebugger;
  const scale = usesCdp ? settings.quality : measure?.dpr ?? 1;
  const est = measure ? predictSize(measure.width, Math.min(measure.height, settings.maxHeightCss), scale) : null;

  const enableDebugger = async () => {
    await chrome.storage.local.set({ [ASKED_KEY]: true });
    const ok = await chrome.permissions.request({ permissions: ['debugger'] });
    setHasDebugger(ok);
    return ok;
  };

  const capture = async (mode: CaptureMode, pickContainer = false) => {
    if (error || !tab?.id) return;
    // First capture: offer the high-resolution engine (needs a user gesture, so it happens here).
    if (settings.engine !== 'scroll' && !hasDebugger) {
      const asked = (await chrome.storage.local.get(ASKED_KEY))[ASKED_KEY];
      if (!asked) await enableDebugger();
    }
    // The popup closes as soon as the page takes focus; the service worker reports any error in a new tab.
    sendToBackground({ target: 'background', type: 'capture', mode, tabId: tab.id, pickContainer }).catch(() => {});
    window.close();
  };

  return (
    <main>
      <header class="row">
        <strong class="grow">LocalFullPageCapture</strong>
        <span class="muted" title="Nothing leaves your computer">Offline · private</span>
      </header>

      {error && (
        <p class="notice err" role="alert">
          {error}
        </p>
      )}

      <section class="modes" aria-label="Capture modes">
        {MODES.map((m) => (
          <button key={m.mode} class={m.mode === 'full' ? 'primary' : ''} disabled={!!error} onClick={() => capture(m.mode)} aria-keyshortcuts={`Alt+Shift+${m.key}`}>
            <span class="label">{m.label}</span>
            <span class="hint">{m.hint}</span>
            <kbd>⌥⇧{m.key}</kbd>
          </button>
        ))}
      </section>
      <button class="link" disabled={!!error} onClick={() => capture('full', true)}>
        Choose scroll area, then capture…
      </button>

      {est && (
        <p class="muted est">
          Full page ≈ {fmtPx(est.width, est.height)} · ~{fmtBytes(est.pngMB * 1048576)} PNG
          {measure!.height > settings.maxHeightCss && ' (capped)'}
          {measure!.root !== 'page' && ` · inner scroll area ${measure!.root}`}
        </p>
      )}

      <section class="opts">
        <label>
          Quality
          <select value={settings.quality} onChange={(e) => update({ quality: Number(e.currentTarget.value) as Settings['quality'] })} disabled={!usesCdp}>
            <option value={1}>Standard (1x)</option>
            <option value={2}>High (2x)</option>
            <option value={3}>Ultra (3x)</option>
            <option value={4}>Max (4x)</option>
          </select>
        </label>
        <label>
          Engine
          <select value={settings.engine} onChange={(e) => update({ engine: e.currentTarget.value as Settings['engine'] })}>
            <option value="auto">Auto</option>
            <option value="cdp">High-resolution (CDP)</option>
            <option value="scroll">Scroll-stitch</option>
          </select>
        </label>
      </section>

      {settings.engine !== 'scroll' && !hasDebugger && (
        <div class="notice info">
          High-resolution engine is off, so captures use your display's native resolution ({measure?.dpr ?? 1}x).{' '}
          <button onClick={enableDebugger}>Enable 2x–4x</button>
        </div>
      )}
      {usesCdp && <p class="muted small">While capturing, Chrome shows a "started debugging this browser" bar. That's expected; it goes away when the capture finishes.</p>}

      {recent.length > 0 && (
        <section aria-label="Recent captures">
          <h2>Recent</h2>
          <ul class="recent">
            {recent.map((c) => (
              <li key={c.id}>
                <a href={chrome.runtime.getURL(`/preview.html?id=${c.id}`)} target="_blank" rel="noreferrer">
                  {c.thumb ? <img src={c.thumb} alt="" /> : <span class="ph" />}
                  <span class="t">{c.title || 'Untitled'}</span>
                  <span class="muted">{fmtDate(c.createdAt)} · {fmtPx(c.width, c.height)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer class="row">
        <a href={chrome.runtime.getURL('/options.html')} target="_blank" rel="noreferrer">
          Settings
        </a>
        <span class="grow" />
        <span class="muted">Esc cancels a capture</span>
      </footer>
    </main>
  );
}
