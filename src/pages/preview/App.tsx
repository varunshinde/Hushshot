import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  exportArea,
  exportImages,
  exportPdf,
  exportZip,
  planSplits,
  type ExportedFile,
  type ExportFormat,
  type SplitPlan,
} from '../../lib/export/exporter';
import { buildFilename, withFolder } from '../../lib/export/filename';
import {
  clampZoom,
  fitPageZoom,
  fitWidthZoom,
  isWholeImage,
  percentOf,
  roundRect,
  sliderOf,
  stepZoom,
  zoomLimits,
  zoomOfSlider,
} from '../../lib/geometry/view';
import { renderArea, TileSource } from '../../lib/image/render';
import { onEvent, sendToBackground } from '../../lib/messages';
import { loadSettings, QUALITY_LABELS, saveSettings, type Settings } from '../../lib/settings';
import { deleteCapture, getBlob, getCapture, updateCapture } from '../../lib/storage/db';
import { toMarkdown, toPlainText, wordsForArea, wordsInRect } from '../../lib/text/words';
import type { CaptureRecord, Rect, Word } from '../../lib/types';
import { fmtBytes, fmtDate, fmtPx } from '../shared/format';
import { IconChevron, IconClose, IconCopy, IconCrop, IconDownload, IconHand, IconMinus, IconMore, IconPlus, IconSelectText, IconText } from '../shared/icons';
import { Viewer, type Tool } from './Viewer';

type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

const FORMATS: { f: ExportFormat; name: string; hint: string }[] = [
  { f: 'png', name: 'PNG', hint: 'Lossless image' },
  { f: 'pdf', name: 'PDF', hint: 'Pages with searchable text' },
  { f: 'jpeg', name: 'JPEG', hint: 'Smaller image' },
  { f: 'webp', name: 'WebP', hint: 'Smallest image' },
];
const FORMAT_NAME = Object.fromEntries(FORMATS.map((x) => [x.f, x.name])) as Record<ExportFormat, string>;

/** Settings that move page breaks; changing one resets breaks the user dragged. */
const BREAK_KEYS: (keyof Settings)[] = ['maxSegmentHeight', 'segmentOverlap', 'pdfPaper', 'pdfMargins', 'pdfOrientation', 'pdfStamp'];

/** Largest image the clipboard path renders in one canvas. */
const COPY_MAX_SIDE = 16384;
const COPY_MAX_PIXELS = 120e6;
const VIEW_PAD = 24;

async function download(file: ExportedFile, folder: string) {
  const url = URL.createObjectURL(file.blob);
  try {
    await chrome.downloads.download({ url, filename: withFolder(folder, file.name), conflictAction: 'uniquify', saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  }
}

const ERROR_HELP: Record<string, string> = {
  restricted: 'Switch to a regular web page and try again.',
  busy: 'Wait for the current capture to finish, or press Esc on that page to cancel it.',
  'no-tab': 'Click into the page you want to capture, then try again.',
  missing: 'It may have been deleted. Take a new capture from the toolbar icon.',
};

function ErrorPage({ code, message }: { code: string; message: string }) {
  return (
    <main class="error-page">
      <img src="/icons/icon-48.png" width="40" height="40" alt="" />
      <h1>{code === 'restricted' ? "This page can't be captured" : code === 'missing' ? 'Capture not found' : 'The capture didn’t finish'}</h1>
      <p class={`notice ${code === 'restricted' ? 'warn' : 'err'}`} role="alert">
        {message}
      </p>
      <p class="muted">{ERROR_HELP[code] ?? 'Reload the page and try again. If it keeps happening, try Visible area, or turn off Sharp mode under Settings → Advanced.'}</p>
    </main>
  );
}

export function App() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const errCode = params.get('error');
  if (errCode) return <ErrorPage code={errCode} message={params.get('message') ?? 'Unknown error'} />;
  if (!id) return <ErrorPage code="missing" message="No capture selected." />;
  return <Preview id={id} />;
}

/** Small anchored popover that closes on outside click or Escape. */
function Popover({ open, onClose, children, align = 'right' }: { open: boolean; onClose: () => void; children: ComponentChildren; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);
  if (!open) return null;
  return (
    <div ref={ref} class={`popover ${align}`} role="menu">
      {children}
    </div>
  );
}

function Preview({ id }: { id: string }) {
  const [rec, setRec] = useState<CaptureRecord | null | undefined>(undefined);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-width');
  const [customZ, setCustomZ] = useState(1);
  const [vp, setVp] = useState({ w: 800, h: 600 });
  const [tool, setTool] = useState<Tool>('pan');
  const [cropBox, setCropBox] = useState<Rect | null>(null);
  const [plan, setPlan] = useState<SplitPlan | null>(null);
  const [busy, setBusy] = useState<{ label: string; progress: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; kind?: 'err' } | null>(null);
  const [ocr, setOcr] = useState<{ progress: number; status: string } | null>(null);
  const [selRect, setSelRect] = useState<Rect | null>(null);
  const [menu, setMenu] = useState<'download' | 'more' | null>(null);
  const [panel, setPanel] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const tilesRef = useRef<TileSource | null>(null);
  const anchor = useRef<{ ix: number; iy: number; fx: number; fy: number } | null>(null);
  /** Zoom requested but not rendered yet, so quick successive pinch events compound correctly. */
  const pendingZ = useRef<number | null>(null);
  const dpr = window.devicePixelRatio || 1;

  const reload = useCallback(async () => {
    const r = await getCapture(id);
    setRec(r ?? null);
    return r;
  }, [id]);

  useEffect(() => {
    loadSettings().then(setSettings);
    reload();
    return onEvent((e) => {
      if ('id' in e && e.id !== id) return;
      if (e.type === 'capture-updated') reload();
      if (e.type === 'ocr-progress') setOcr({ progress: e.progress, status: e.status });
    });
  }, [id, reload]);

  // Tile images for display (blob URLs) and a decoder cache for export.
  const tileKeys = rec?.tiles.map((t) => t.key).join('|');
  useEffect(() => {
    if (!rec) return;
    let alive = true;
    const made: string[] = [];
    tilesRef.current?.close();
    tilesRef.current = new TileSource(rec);
    Promise.all(rec.tiles.map((t) => getBlob(t.key))).then((blobs) => {
      if (!alive) return;
      const u = blobs.map((b) => (b ? URL.createObjectURL(b) : ''));
      made.push(...u);
      setUrls(u);
    });
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [tileKeys]);

  useEffect(() => {
    if (rec?.ocr.status !== 'running') setOcr(null);
  }, [rec?.ocr.status]);

  // Viewport size, for the fit zoom levels.
  const ready = rec?.status === 'ready';
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setVp({ w: Math.max(50, el.clientWidth - 2 * VIEW_PAD), h: Math.max(50, el.clientHeight - 2 * VIEW_PAD) });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  const format: ExportFormat = settings?.downloadFormat ?? 'png';
  const editing = tool === 'crop' && !!cropBox;

  // Page breaks for the current format and options.
  const planKey = rec && settings ? JSON.stringify([rec.crop, rec.splits, rec.placements.length, format, ...BREAK_KEYS.map((k) => settings[k]), rec.words.length]) : '';
  useEffect(() => {
    if (!rec || !settings || rec.status !== 'ready' || !tilesRef.current) return;
    let alive = true;
    planSplits(rec, tilesRef.current, settings, format).then((p) => alive && setPlan(p));
    return () => {
      alive = false;
    };
  }, [planKey]);

  const full: Rect = rec ? { x: 0, y: 0, width: rec.width, height: rec.height } : { x: 0, y: 0, width: 1, height: 1 };
  const area = rec ? exportArea(rec) : full;
  const view = editing ? full : area;
  const fitW = fitWidthZoom(vp.w, view.width, dpr);
  const fitP = fitPageZoom(vp.w, vp.h, view.width, view.height, dpr);
  const limits = zoomLimits(fitP, dpr);
  const z = zoomMode === 'fit-width' ? fitW : zoomMode === 'fit-page' ? fitP : clampZoom(customZ, limits);
  const zRef = useRef(z);
  zRef.current = z;

  /** Zoom to `next`, keeping the image point under (fx, fy) in place (default: viewport centre). */
  const zoomTo = useCallback((next: number, fx?: number, fy?: number) => {
    const el = viewportRef.current;
    const canvas = el?.querySelector('.canvas');
    if (el && canvas) {
      const vr = el.getBoundingClientRect();
      const x = fx ?? vr.left + vr.width / 2;
      const y = fy ?? vr.top + vr.height / 2;
      if (anchor.current) {
        // Still waiting for the previous zoom to render: keep its image point.
        anchor.current.fx = x;
        anchor.current.fy = y;
      } else {
        const cr = canvas.getBoundingClientRect();
        anchor.current = { ix: (x - cr.left) / zRef.current, iy: (y - cr.top) / zRef.current, fx: x, fy: y };
      }
    }
    pendingZ.current = next;
    setCustomZ(next);
    setZoomMode('custom');
  }, []);

  useLayoutEffect(() => {
    const a = anchor.current;
    const el = viewportRef.current;
    const canvas = el?.querySelector('.canvas');
    anchor.current = null;
    pendingZ.current = null;
    if (!a || !el || !canvas) return;
    const cr = canvas.getBoundingClientRect();
    el.scrollLeft += cr.left + a.ix * z - a.fx;
    el.scrollTop += cr.top + a.iy * z - a.fy;
  }, [z]);

  // Trackpad pinch and Ctrl/⌘ + wheel zoom around the pointer (Chrome reports pinch as a ctrl-wheel).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
      zoomTo(clampZoom((pendingZ.current ?? zRef.current) * factor, limitsRef.current), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ready]);
  const limitsRef = useRef(limits);
  limitsRef.current = limits;

  const selection: Word[] = useMemo(() => (rec && selRect ? wordsInRect(rec.words, selRect) : []), [rec?.words, selRect]);

  const flash = (text: string, kind?: 'err') => {
    setToast({ text, kind });
    setTimeout(() => setToast(null), kind ? 6000 : 2500);
  };

  const guard = async (label: string, fn: (progress: (p: number) => void) => Promise<void>) => {
    setBusy({ label, progress: 0 });
    try {
      await fn((progress) => setBusy({ label, progress }));
    } catch (e) {
      flash(`${label} failed: ${(e as Error).message}`, 'err');
    } finally {
      setBusy(null);
    }
  };

  const startCrop = () => {
    if (!rec) return;
    setCropBox(rec.crop ?? { x: 0, y: 0, width: rec.width, height: rec.height });
    setTool('crop');
    setSelRect(null);
    setZoomMode('fit-page');
    requestAnimationFrame(() => viewportRef.current?.scrollTo(0, 0));
  };
  const cancelCrop = () => {
    setCropBox(null);
    setTool('pan');
    setZoomMode('fit-width');
  };
  const finishCrop = async () => {
    if (!rec || !cropBox) return;
    const box = roundRect(cropBox, rec);
    const crop = isWholeImage(box, rec) ? null : box;
    await updateCapture(id, (r) => void ((r.crop = crop), (r.splits = null)));
    await reload();
    setCropBox(null);
    setTool('pan');
    setZoomMode('fit-width');
    requestAnimationFrame(() => viewportRef.current?.scrollTo(0, 0));
    flash(crop ? `Cropped to ${fmtPx(crop.width, crop.height)}` : 'Showing the whole capture');
  };
  const removeCrop = async () => {
    await updateCapture(id, (r) => void ((r.crop = null), (r.splits = null)));
    await reload();
    flash('Crop removed');
  };

  const copySelection = useCallback(async () => {
    if (!selection.length) return;
    await navigator.clipboard.writeText(toPlainText(selection));
    flash(`Copied ${selection.length} word${selection.length === 1 ? '' : 's'}`);
  }, [selection]);

  // Actions below need the loaded record; keyboard handling refers to them through a ref.
  const actions = useRef({ download: () => {}, copyImage: () => {}, copyText: () => {} });

  // Rebuilt every render so it always sees current state; attached once below.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (editing) {
        if (e.key === 'Escape') return cancelCrop();
        if (e.key === 'Enter') return void finishCrop();
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        return zoomTo(stepZoom(zRef.current, 1, dpr, limitsRef.current));
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        return zoomTo(stepZoom(zRef.current, -1, dpr, limitsRef.current));
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        return setZoomMode('fit-width');
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        return actions.current.download();
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        return actions.current.copyText();
      }
      if (mod && e.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
        e.preventDefault();
        return selection.length ? void copySelection() : actions.current.copyImage();
      }
      if (mod || e.altKey) return;
      if (e.key === 'Escape') return menu ? setMenu(null) : setSelRect(null);
      if (e.key === '+' || e.key === '=') zoomTo(stepZoom(zRef.current, 1, dpr, limitsRef.current));
      else if (e.key === '-') zoomTo(stepZoom(zRef.current, -1, dpr, limitsRef.current));
      else if (e.key === '0' || e.key === 'w') setZoomMode('fit-width');
      else if (e.key === 'f') setZoomMode('fit-page');
      else if (e.key === '1') zoomTo(1 / dpr);
      else if (e.key === 'h' || e.key === 'v') setTool('pan');
      else if (e.key === 't') setTool('select');
      else if (e.key === 'c' && !editing) startCrop();
    };
    onKeyRef.current = onKey;
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  if (rec === undefined || !settings) return <main class="loading muted">Loading capture…</main>;
  if (rec === null) return <ErrorPage code="missing" message="This capture no longer exists." />;
  if (rec.status !== 'ready') return <main class="loading muted">Preparing capture…</main>;

  const update = async (patch: Partial<Settings>) => {
    setSettings(await saveSettings(patch));
    if (rec.splits && BREAK_KEYS.some((k) => k in patch)) await updateCapture(id, (r) => void (r.splits = null)).then(reload);
  };
  const segs = plan?.segments ?? [];
  const words = wordsForArea(rec.words, area);
  const canCopyImage = area.height <= COPY_MAX_SIDE && area.width <= COPY_MAX_SIDE && area.width * area.height <= COPY_MAX_PIXELS;

  const doExport = (f: ExportFormat = format) =>
    guard(`Saving ${FORMAT_NAME[f]}`, async (progress) => {
      const tiles = tilesRef.current!;
      const p = f === format && plan ? plan : await planSplits(rec, tiles, settings, f);
      if (f === 'pdf') {
        await download(await exportPdf(rec, tiles, settings, p, progress), settings.downloadFolder);
      } else {
        const files = await exportImages(rec, tiles, settings, p, f, progress);
        if (files.length > 1 && settings.multiPart === 'zip') await download(await exportZip(rec, settings, files), settings.downloadFolder);
        else for (const file of files) await download(file, settings.downloadFolder);
      }
      flash(`Saved to Downloads${settings.downloadFolder ? `/${settings.downloadFolder}` : ''}`);
    });

  const pickFormat = async (f: ExportFormat) => {
    setMenu(null);
    if (f !== format) await update({ downloadFormat: f });
    doExport(f);
  };

  const copyImage = () =>
    canCopyImage
      ? guard('Copy image', async () => {
          const canvas = await renderArea(tilesRef.current!, rec.placements, area);
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          flash('Image copied');
        })
      : flash('This capture is too large to copy. Crop it first, or download it instead.', 'err');

  const copyText = async () => {
    if (!words.length) return flash('No text found in this capture.', 'err');
    await navigator.clipboard.writeText(toPlainText(words));
    flash(`Copied ${words.length.toLocaleString()} words`);
  };
  actions.current = { download: () => doExport(), copyImage, copyText };

  const exportText = (kind: 'txt' | 'md') =>
    guard('Export text', async () => {
      setMenu(null);
      const body = kind === 'md' ? toMarkdown(words, rec.title) : toPlainText(words);
      const name = buildFilename(settings.filenameTemplate, { title: rec.title, date: new Date(rec.createdAt), ext: kind });
      await download({ name, blob: new Blob([body], { type: kind === 'md' ? 'text/markdown' : 'text/plain' }) }, settings.downloadFolder);
      flash(`Saved ${kind === 'md' ? 'Markdown' : 'text'} file`);
    });

  const vectorPdf = () =>
    guard('Vector PDF', async () => {
      setMenu(null);
      const key = await sendToBackground<string>({ target: 'background', type: 'print-pdf', id });
      const blob = await getBlob(key);
      if (!blob) throw new Error('PDF missing');
      await download({ name: buildFilename(settings.filenameTemplate, { title: `${rec.title} (print)`, date: new Date(rec.createdAt), ext: 'pdf' }), blob }, settings.downloadFolder);
    });

  const runOcr = () => {
    setMenu(null);
    sendToBackground({ target: 'background', type: 'ocr', id }).catch((e) => flash(String(e.message), 'err'));
  };

  const remove = async () => {
    setMenu(null);
    if (!confirm('Delete this capture? Files you already downloaded are kept.')) return;
    await deleteCapture(id);
    window.close();
  };

  const quality = rec.engine === 'cdp' ? QUALITY_LABELS[Math.round(rec.scale) as Settings['quality']] ?? `${Number(rec.scale.toFixed(2))}×` : `Screen quality (${Number(rec.scale.toFixed(2))}×)`;
  const ocrNote = (() => {
    if (ocr) return `Reading text in images… ${Math.round(ocr.progress * 100)}%`;
    if (rec.ocr.status === 'running') return 'Reading text in images…';
    if (rec.ocr.status === 'error') return 'Reading text in images failed';
    return '';
  })();
  const partsLabel = format === 'pdf' ? `${segs.length} PDF page${segs.length === 1 ? '' : 's'}` : segs.length > 1 ? `${segs.length} parts` : '1 image';
  const percent = Math.round(percentOf(z, dpr));

  return (
    <div class="layout">
      <header class="top">
        <img class="logo" src="/icons/icon-32.png" width="24" height="24" alt="" />
        <div class="title">
          <h1 title={rec.title}>{rec.title || 'Untitled'}</h1>
          <p class="meta">
            <a href={rec.url} target="_blank" rel="noreferrer" class="url" title={rec.url}>
              {rec.url.replace(/^https?:\/\//, '')}
            </a>
            <span>{fmtPx(area.width, area.height)}</span>
            <span>{quality}</span>
            <span>{partsLabel}</span>
            <span title={fmtDate(rec.createdAt)}>{fmtDate(rec.createdAt)}</span>
            {ocrNote && <span class="ocr">{ocrNote}</span>}
          </p>
        </div>
        <div class="actions">
          <span class="split">
            <button class="primary" disabled={!!busy || !plan} onClick={() => doExport()} title="Download (⌘S)">
              <IconDownload /> Download {FORMAT_NAME[format]}
            </button>
            <button class="primary" aria-label="Choose format" aria-haspopup="menu" aria-expanded={menu === 'download'} onClick={() => setMenu(menu === 'download' ? null : 'download')}>
              <IconChevron />
            </button>
            <Popover open={menu === 'download'} onClose={() => setMenu(null)}>
              {FORMATS.map((x) => (
                <button key={x.f} role="menuitem" class={x.f === format ? 'on' : ''} onClick={() => pickFormat(x.f)}>
                  <b>{x.name}</b>
                  <span>{x.hint}</span>
                </button>
              ))}
              <hr />
              <button role="menuitem" onClick={() => (setMenu(null), setPanel(true))}>
                <b>Download options…</b>
                <span>Paper size, page breaks, file name</span>
              </button>
            </Popover>
          </span>
          <button disabled={!!busy} onClick={copyImage} title={canCopyImage ? 'Copy image (⌘C)' : 'Too large to copy. Crop it first.'}>
            <IconCopy /> Copy image
          </button>
          <button disabled={!words.length} onClick={copyText} title="Copy all text (⌘⇧C)">
            <IconText /> Copy text
          </button>
          <span class="split">
            <button class="icon-only" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}>
              <IconMore />
            </button>
            <Popover open={menu === 'more'} onClose={() => setMenu(null)}>
              <button role="menuitem" disabled={!words.length} onClick={() => exportText('txt')}>
                <b>Save text (.txt)</b>
              </button>
              <button role="menuitem" disabled={!words.length} onClick={() => exportText('md')}>
                <b>Save as Markdown (.md)</b>
                <span>Keeps headings and lists</span>
              </button>
              <button role="menuitem" disabled={rec.ocr.status === 'running' || !!ocr} onClick={runOcr}>
                <b>{rec.ocr.status === 'done' ? 'Read text in images again' : 'Read text in images'}</b>
                <span>On-device; adds text from pictures and charts</span>
              </button>
              {rec.engine === 'cdp' && (
                <button role="menuitem" onClick={vectorPdf} title="Prints the live page with real vector text. The layout follows the site's print styles.">
                  <b>Print-style PDF</b>
                  <span>Real text, from the open tab</span>
                </button>
              )}
              <a role="menuitem" href={rec.url} target="_blank" rel="noreferrer" onClick={() => setMenu(null)}>
                <b>Open original page</b>
              </a>
              <hr />
              <button role="menuitem" class="danger" onClick={remove}>
                <b>Delete capture</b>
              </button>
            </Popover>
          </span>
        </div>
      </header>

      {rec.warnings.length > 0 && (
        <ul class="warnings">
          {rec.warnings.map((w, i) => (
            <li key={i} class="notice warn">
              {w}
            </li>
          ))}
        </ul>
      )}

      <div class="toolbar" role="toolbar" aria-label="View tools">
        {editing ? (
          <div class="crop-bar">
            <IconCrop />
            <span>
              <b>Crop</b> · {fmtPx(cropBox!.width, cropBox!.height)}
              <span class="muted hint"> · Drag the edges or corners, or draw a new box</span>
            </span>
            <button onClick={() => setCropBox({ ...full })}>Whole capture</button>
            <button onClick={cancelCrop}>Cancel</button>
            <button class="primary" onClick={finishCrop}>
              Done cropping
            </button>
          </div>
        ) : (
          <>
            <div class="seg" role="group" aria-label="Tool">
              <button aria-pressed={tool === 'pan'} onClick={() => setTool('pan')} title="Move around (H)">
                <IconHand /> Move
              </button>
              <button aria-pressed={tool === 'select'} onClick={() => setTool('select')} title="Drag a box to copy its text (T)">
                <IconSelectText /> Select text
              </button>
              <button onClick={startCrop} title="Crop (C)">
                <IconCrop /> Crop
              </button>
            </div>
            {rec.crop && (
              <span class="chip">
                Cropped
                <button onClick={startCrop}>Edit</button>
                <button onClick={removeCrop}>Remove</button>
              </span>
            )}
            {rec.splits && (
              <button onClick={() => updateCapture(id, (r) => void (r.splits = null)).then(reload)} title="Back to automatic page breaks">
                Reset page breaks
              </button>
            )}
            {selection.length > 0 && <button onClick={copySelection}>Copy {selection.length} selected words</button>}
          </>
        )}
        <span class="grow" />
        <div class="zoom" role="group" aria-label="Zoom">
          <button aria-pressed={zoomMode === 'fit-page'} onClick={() => setZoomMode('fit-page')} title="Show the whole capture (F)">
            Fit page
          </button>
          <button aria-pressed={zoomMode === 'fit-width'} onClick={() => setZoomMode('fit-width')} title="Fit the width (0)">
            Fit width
          </button>
          <button class="icon-only" onClick={() => zoomTo(stepZoom(z, -1, dpr, limits))} aria-label="Zoom out" title="Zoom out (−)">
            <IconMinus />
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(sliderOf(z, limits) * 1000)}
            onInput={(e) => zoomTo(zoomOfSlider(Number(e.currentTarget.value) / 1000, limits))}
            aria-label="Zoom"
            aria-valuetext={`${percent}%`}
          />
          <button class="icon-only" onClick={() => zoomTo(stepZoom(z, 1, dpr, limits))} aria-label="Zoom in" title="Zoom in (+)">
            <IconPlus />
          </button>
          <button class="pct" onClick={() => zoomTo(1 / dpr)} title="Actual pixels (1)">
            {percent}%
          </button>
        </div>
      </div>

      <div class="body">
        <section class="viewport" ref={viewportRef} aria-label="Capture preview">
          <Viewer
            rec={rec}
            urls={urls}
            zoom={z}
            view={view}
            tool={tool}
            cropBox={editing ? cropBox : null}
            onCropBox={setCropBox}
            cuts={plan?.cuts ?? []}
            overlap={settings.segmentOverlap}
            selection={selection}
            selectRect={selRect}
            viewportRef={viewportRef}
            onCutsChange={(cuts) => updateCapture(id, (r) => void (r.splits = [...cuts].sort((a, b) => a - b))).then(reload)}
            onSelectRect={(r, final) => {
              setSelRect(r);
              if (final && r) {
                const ws = wordsInRect(rec.words, r);
                if (ws.length) navigator.clipboard.writeText(toPlainText(ws)).then(() => flash(`Copied ${ws.length} word${ws.length === 1 ? '' : 's'}`));
              }
            }}
          />
        </section>

        {panel && (
          <aside class="panel" aria-label="Download options">
            <div class="row">
              <h2 class="grow">Download options</h2>
              <button class="icon-only" onClick={() => setPanel(false)} aria-label="Close options">
                <IconClose />
              </button>
            </div>
            <div class="seg wide" role="radiogroup" aria-label="Format">
              {FORMATS.map((x) => (
                <button key={x.f} role="radio" aria-checked={format === x.f} aria-pressed={format === x.f} onClick={() => update({ downloadFormat: x.f })}>
                  {x.name}
                </button>
              ))}
            </div>
            <p class="muted small">{FORMATS.find((x) => x.f === format)!.hint}.</p>

            {format === 'pdf' && (
              <div class="fields">
                <span class="label">Paper</span>
                <div class="seg wide" role="radiogroup" aria-label="Paper">
                  {(
                    [
                      ['a4', 'A4'],
                      ['letter', 'Letter'],
                      ['legal', 'Legal'],
                      ['continuous', 'Long page'],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} role="radio" aria-checked={settings.pdfPaper === v} aria-pressed={settings.pdfPaper === v} onClick={() => update({ pdfPaper: v })}>
                      {l}
                    </button>
                  ))}
                </div>
                <span class="label">Margins</span>
                <div class="seg wide" role="radiogroup" aria-label="Margins">
                  {(
                    [
                      ['none', 'None'],
                      ['small', 'Small'],
                      ['normal', 'Normal'],
                    ] as const
                  ).map(([v, l]) => (
                    <button key={v} role="radio" aria-checked={settings.pdfMargins === v} aria-pressed={settings.pdfMargins === v} onClick={() => update({ pdfMargins: v })}>
                      {l}
                    </button>
                  ))}
                </div>
                <label class="inline">
                  <input type="checkbox" checked={settings.pdfStamp} onChange={(e) => update({ pdfStamp: e.currentTarget.checked })} />
                  Add page address and date
                </label>
                <label class="inline">
                  <input type="checkbox" checked={settings.pdfSmaller} onChange={(e) => update({ pdfSmaller: e.currentTarget.checked })} />
                  Smaller file (JPEG images)
                </label>
              </div>
            )}
            {format !== 'pdf' && segs.length > 1 && (
              <div class="fields">
                <p class="muted small">Long captures are saved in {segs.length} parts, split between lines of text.</p>
                <label>
                  Save parts as
                  <select value={settings.multiPart} onChange={(e) => update({ multiPart: e.currentTarget.value as Settings['multiPart'] })}>
                    <option value="separate">Separate files</option>
                    <option value="zip">One .zip file</option>
                  </select>
                </label>
              </div>
            )}
            {format !== 'pdf' && format !== 'png' && <p class="muted small">JPEG and WebP are smaller but slightly less sharp. PNG keeps every pixel.</p>}

            <details>
              <summary>More options</summary>
              <div class="fields">
                {format === 'pdf' && (
                  <label>
                    Orientation
                    <select value={settings.pdfOrientation} onChange={(e) => update({ pdfOrientation: e.currentTarget.value as Settings['pdfOrientation'] })}>
                      <option value="auto">Automatic</option>
                      <option value="portrait">Portrait</option>
                      <option value="landscape">Landscape</option>
                    </select>
                  </label>
                )}
                {(format !== 'pdf' || settings.pdfPaper === 'continuous') && (
                  <label>
                    Maximum part height (px)
                    <input type="number" min={500} max={16000} step={100} value={settings.maxSegmentHeight} onChange={(e) => update({ maxSegmentHeight: Number(e.currentTarget.value) })} />
                  </label>
                )}
                <label>
                  Repeat at each break
                  <select value={settings.segmentOverlap} onChange={(e) => update({ segmentOverlap: Number(e.currentTarget.value) as Settings['segmentOverlap'] })}>
                    <option value={0}>Nothing</option>
                    <option value={40}>40 px</option>
                    <option value={80}>80 px</option>
                  </select>
                </label>
                <p class="muted small">Drag the blue lines on the image to move page breaks.</p>
              </div>
            </details>

            <button class="primary big" disabled={!!busy || !plan} onClick={() => doExport()}>
              <IconDownload /> Download {FORMAT_NAME[format]}
            </button>
            <p class="muted small">
              {partsLabel} · {fmtPx(area.width, area.height)}
              {rec.tileBytes ? ` · about ${fmtBytes((rec.tileBytes * area.width * area.height) / Math.max(1, rec.width * rec.height))} as PNG` : ''}
            </p>
          </aside>
        )}
      </div>

      {busy && (
        <div class="busy" role="status">
          {busy.label}… {Math.round(busy.progress * 100)}%
        </div>
      )}
      {toast && (
        <div class={`toast ${toast.kind ?? ''}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
