import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  estimateSizes,
  exportArea,
  exportImages,
  exportPdf,
  exportZip,
  planSplits,
  segmentRect,
  type ExportedFile,
  type ExportFormat,
  type SplitPlan,
} from '../../lib/export/exporter';
import { buildFilename, withFolder } from '../../lib/export/filename';
import { renderArea, TileSource } from '../../lib/image/render';
import { onEvent, sendToBackground } from '../../lib/messages';
import { loadSettings, saveSettings, type Settings } from '../../lib/settings';
import { deleteCapture, getBlob, getCapture, updateCapture } from '../../lib/storage/db';
import { toMarkdown, toPlainText, wordsForArea, wordsInRect } from '../../lib/text/words';
import type { CaptureRecord, Rect, Word } from '../../lib/types';
import { fmtBytes, fmtDate, fmtPx } from '../shared/format';
import { Viewer, type Tool } from './Viewer';

type Zoom = 'fit' | 1 | 2;

async function download(file: ExportedFile, folder: string) {
  const url = URL.createObjectURL(file.blob);
  try {
    await chrome.downloads.download({ url, filename: withFolder(folder, file.name), conflictAction: 'uniquify', saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  }
}

function ErrorPage({ code, message }: { code: string; message: string }) {
  return (
    <main class="error-page">
      <h1>{code === 'restricted' ? "This page can't be captured" : 'Capture failed'}</h1>
      <p class={`notice ${code === 'restricted' ? 'warn' : 'err'}`} role="alert">
        {message}
      </p>
      {code === 'restricted' && <p class="muted">Switch to a regular web page and try again. Captures never leave your computer.</p>}
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

function Preview({ id }: { id: string }) {
  const [rec, setRec] = useState<CaptureRecord | null | undefined>(undefined);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [fitZ, setFitZ] = useState(1);
  const [tool, setTool] = useState<Tool>('pan');
  const [format, setFormat] = useState<ExportFormat>('png');
  const [plan, setPlan] = useState<SplitPlan | null>(null);
  const [busy, setBusy] = useState<{ label: string; progress: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; kind?: 'err' } | null>(null);
  const [ocr, setOcr] = useState<{ progress: number; status: string } | null>(null);
  const [selRect, setSelRect] = useState<Rect | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const tilesRef = useRef<TileSource | null>(null);

  const reload = useCallback(async () => {
    const r = await getCapture(id);
    setRec(r ?? null);
    return r;
  }, [id]);

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setFormat(s.imageFormat);
    });
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

  // Fit-to-width zoom.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !rec) return;
    const update = () => setFitZ(Math.min(1 / window.devicePixelRatio * 2, (vp.clientWidth - 32) / rec.width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [rec?.width, rec?.status]);

  // Split plan for the current format and options.
  const planKey = rec && settings ? JSON.stringify([rec.crop, rec.splits, rec.placements.length, format, settings.maxSegmentHeight, settings.segmentOverlap, settings.pdfPaper, settings.pdfMargins, settings.pdfOrientation, rec.words.length]) : '';
  useEffect(() => {
    if (!rec || !settings || rec.status !== 'ready' || !tilesRef.current) return;
    let alive = true;
    planSplits(rec, tilesRef.current, settings, format).then((p) => alive && setPlan(p));
    return () => {
      alive = false;
    };
  }, [planKey]);

  const z = zoom === 'fit' ? fitZ : zoom / window.devicePixelRatio;
  const area = rec ? exportArea(rec) : { x: 0, y: 0, width: 0, height: 0 };
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

  const copySelection = useCallback(async () => {
    if (!selection.length) return;
    await navigator.clipboard.writeText(toPlainText(selection));
    flash(`Copied ${selection.length} word${selection.length === 1 ? '' : 's'}`);
  }, [selection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selection.length) {
        e.preventDefault();
        copySelection();
      } else if (e.key === 'Escape') setSelRect(null);
      else if (e.key === '0') setZoom('fit');
      else if (e.key === '1') setZoom(1);
      else if (e.key === '2') setZoom(2);
      else if (e.key === 'v' || e.key === 'h') setTool('pan');
      else if (e.key === 't') setTool('select');
      else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) setTool('crop');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, copySelection]);

  if (rec === undefined || !settings) return <main class="loading muted">Loading capture…</main>;
  if (rec === null) return <ErrorPage code="missing" message="This capture no longer exists." />;
  if (rec.status !== 'ready') return <main class="loading muted">Preparing capture…</main>;

  const update = async (patch: Partial<Settings>) => {
    setSettings(await saveSettings(patch));
    if (rec.splits) await updateCapture(id, (r) => void (r.splits = null)).then(reload);
  };
  const sizes = estimateSizes(rec, settings);
  const segs = plan?.segments ?? [];
  const words = wordsForArea(rec.words, area);

  const doExport = () =>
    guard('Export', async (progress) => {
      const tiles = tilesRef.current!;
      const p = plan ?? (await planSplits(rec, tiles, settings, format));
      if (format === 'pdf') {
        await download(await exportPdf(rec, tiles, settings, p, progress), settings.downloadFolder);
      } else {
        const files = await exportImages(rec, tiles, settings, p, format, progress);
        if (files.length > 1 && settings.multiPart === 'zip') await download(await exportZip(rec, settings, files), settings.downloadFolder);
        else for (const f of files) await download(f, settings.downloadFolder);
      }
      flash('Saved to Downloads');
    });

  const copyImage = () =>
    guard('Copy image', async () => {
      const canvas = await renderArea(tilesRef.current!, rec.placements, segmentRect(area, segs[0] ?? { y0: 0, y1: area.height }));
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flash('Image copied');
    });

  const copyText = async () => {
    await navigator.clipboard.writeText(toPlainText(words));
    flash(`Copied ${words.length.toLocaleString()} words`);
  };

  const exportText = (kind: 'txt' | 'md') =>
    guard('Export text', async () => {
      const body = kind === 'md' ? toMarkdown(words, rec.title) : toPlainText(words);
      const name = buildFilename(settings.filenameTemplate, { title: rec.title, date: new Date(rec.createdAt), ext: kind });
      await download({ name, blob: new Blob([body], { type: kind === 'md' ? 'text/markdown' : 'text/plain' }) }, settings.downloadFolder);
    });

  const vectorPdf = () =>
    guard('Vector PDF', async () => {
      const key = await sendToBackground<string>({ target: 'background', type: 'print-pdf', id });
      const blob = await getBlob(key);
      if (!blob) throw new Error('PDF missing');
      await download({ name: buildFilename(settings.filenameTemplate, { title: `${rec.title} (print)`, date: new Date(rec.createdAt), ext: 'pdf' }), blob }, settings.downloadFolder);
    });

  const runOcr = () => sendToBackground({ target: 'background', type: 'ocr', id }).catch((e) => flash(String(e.message), 'err'));

  const ocrLabel = (() => {
    const o = rec.ocr;
    if (ocr) return `OCR ${Math.round(ocr.progress * 100)}%`;
    if (o.status === 'done') return `OCR done · ${o.words ?? 0} words from images`;
    if (o.status === 'skipped') return 'OCR: no image text areas';
    if (o.status === 'error') return `OCR failed: ${o.error}`;
    if (o.status === 'running') return 'OCR running…';
    return 'OCR not run';
  })();
  const domWords = rec.words.filter((w) => w.source === 'dom').length;

  return (
    <div class="layout">
      <header class="top">
        <div class="title">
          <h1 title={rec.title}>{rec.title || 'Untitled'}</h1>
          <a href={rec.url} target="_blank" rel="noreferrer" class="muted url">
            {rec.url}
          </a>
        </div>
        <dl class="meta">
          <div>
            <dt>Size</dt>
            <dd>{fmtPx(area.width, area.height)}</dd>
          </div>
          <div>
            <dt>Scale</dt>
            <dd>
              {Number(rec.scale.toFixed(2))}x · {Math.round(rec.dpi)} DPI · {rec.engine === 'cdp' ? 'CDP' : 'scroll-stitch'}
            </dd>
          </div>
          <div>
            <dt>Estimated</dt>
            <dd>
              PNG ≈ {fmtBytes(sizes.png)} · PDF ≈ {fmtBytes(sizes.pdf)}
            </dd>
          </div>
          <div>
            <dt>Text</dt>
            <dd>
              {domWords.toLocaleString()} DOM words · {ocrLabel}
            </dd>
          </div>
        </dl>
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

      <div class="body">
        <section class="stage" aria-label="Capture preview">
          <div class="toolbar" role="toolbar" aria-label="View tools">
            <div class="seg" role="group" aria-label="Zoom">
              {(['fit', 1, 2] as Zoom[]).map((v) => (
                <button key={String(v)} aria-pressed={zoom === v} onClick={() => setZoom(v)} title={v === 'fit' ? 'Fit (0)' : `${Number(v) * 100}% (${v})`}>
                  {v === 'fit' ? 'Fit' : `${Number(v) * 100}%`}
                </button>
              ))}
            </div>
            <div class="seg" role="group" aria-label="Tool">
              <button aria-pressed={tool === 'pan'} onClick={() => setTool('pan')} title="Pan (H)">
                Pan
              </button>
              <button aria-pressed={tool === 'select'} onClick={() => setTool('select')} title="Select text (T)">
                Select text
              </button>
              <button aria-pressed={tool === 'crop'} onClick={() => setTool('crop')} title="Crop (C)">
                Crop
              </button>
            </div>
            {rec.crop && (
              <button onClick={() => updateCapture(id, (r) => void ((r.crop = null), (r.splits = null))).then(reload)}>Reset crop</button>
            )}
            {rec.splits && <button onClick={() => updateCapture(id, (r) => void (r.splits = null)).then(reload)}>Reset splits</button>}
            {selection.length > 0 && <button onClick={copySelection}>Copy {selection.length} selected words</button>}
            <span class="grow" />
            <span class="muted">{segs.length > 1 ? `${segs.length} parts · drag the blue lines to move splits` : '1 part'}</span>
          </div>
          <div class="viewport" ref={viewportRef}>
            <Viewer
              rec={rec}
              urls={urls}
              zoom={z}
              tool={tool}
              area={area}
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
              onCrop={(c) => {
                updateCapture(id, (r) => void ((r.crop = c), (r.splits = null))).then(reload);
                setTool('pan');
              }}
            />
          </div>
        </section>

        <aside class="panel" aria-label="Export">
          <h2>Export</h2>
          <div class="seg wide" role="radiogroup" aria-label="Format">
            {(['png', 'pdf', 'jpeg', 'webp'] as ExportFormat[]).map((f) => (
              <button key={f} role="radio" aria-checked={format === f} aria-pressed={format === f} onClick={() => setFormat(f)}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          {format !== 'pdf' && format !== 'png' && <p class="muted small">Lossy format. PNG is lossless.</p>}

          {format === 'pdf' && (
            <div class="fields">
              <label>
                Page size
                <select value={settings.pdfPaper} onChange={(e) => update({ pdfPaper: e.currentTarget.value as Settings['pdfPaper'] })}>
                  <option value="a4">Fit to width · A4</option>
                  <option value="letter">Fit to width · US Letter</option>
                  <option value="legal">Fit to width · Legal</option>
                  <option value="continuous">One continuous page per segment</option>
                </select>
              </label>
              <div class="row">
                <label class="grow">
                  Margins
                  <select value={settings.pdfMargins} onChange={(e) => update({ pdfMargins: e.currentTarget.value as Settings['pdfMargins'] })}>
                    <option value="none">None</option>
                    <option value="small">Small</option>
                    <option value="normal">Normal</option>
                  </select>
                </label>
                <label class="grow">
                  Orientation
                  <select value={settings.pdfOrientation} onChange={(e) => update({ pdfOrientation: e.currentTarget.value as Settings['pdfOrientation'] })}>
                    <option value="auto">Auto</option>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </label>
              </div>
              <label class="inline">
                <input type="checkbox" checked={settings.pdfSmaller} onChange={(e) => update({ pdfSmaller: e.currentTarget.checked })} />
                Smaller file (JPEG images, lossy)
              </label>
            </div>
          )}

          {(format !== 'pdf' || settings.pdfPaper === 'continuous') && (
            <div class="fields">
              <label>
                Max segment height (px)
                <input
                  type="number"
                  min={500}
                  max={16000}
                  step={100}
                  value={settings.maxSegmentHeight}
                  onChange={(e) => update({ maxSegmentHeight: Number(e.currentTarget.value) })}
                />
              </label>
            </div>
          )}
          <div class="fields">
            <div class="row">
              <label class="grow">
                Overlap
                <select value={settings.segmentOverlap} onChange={(e) => update({ segmentOverlap: Number(e.currentTarget.value) as Settings['segmentOverlap'] })}>
                  <option value={0}>None</option>
                  <option value={40}>40 px</option>
                  <option value={80}>80 px</option>
                </select>
              </label>
              {format !== 'pdf' && (
                <label class="grow">
                  Multiple parts
                  <select value={settings.multiPart} onChange={(e) => update({ multiPart: e.currentTarget.value as Settings['multiPart'] })}>
                    <option value="separate">Separate files</option>
                    <option value="zip">One .zip</option>
                  </select>
                </label>
              )}
            </div>
          </div>

          <p class="muted small">
            {segs.length} {format === 'pdf' ? 'page' : 'file'}
            {segs.length === 1 ? '' : 's'}
            {plan?.methods.length ? ` · splits avoid text lines (${plan.methods.filter((m) => m === 'dom').length}/${plan.methods.length} from page layout)` : ''}
          </p>

          <button class="primary big" disabled={!!busy || !plan} onClick={doExport}>
            Download {format.toUpperCase()}
          </button>
          {format === 'pdf' && (
            <button disabled={!!busy || rec.engine !== 'cdp'} onClick={vectorPdf} title="Prints the live page with real vector text. Layout follows the page's print styles and may differ from the screen.">
              Vector PDF (print)
            </button>
          )}

          <h2>Clipboard &amp; text</h2>
          <div class="grid2">
            <button disabled={!!busy || segs.length > 1} onClick={copyImage} title={segs.length > 1 ? 'Copy image works on a single segment. Crop or raise the max segment height.' : ''}>
              Copy image
            </button>
            <button disabled={!words.length} onClick={copyText}>
              Copy all text
            </button>
            <button disabled={!words.length} onClick={() => exportText('txt')}>
              Export .txt
            </button>
            <button disabled={!words.length} onClick={() => exportText('md')}>
              Export .md
            </button>
          </div>
          <button disabled={rec.ocr.status === 'running' || !!ocr} onClick={runOcr}>
            {rec.ocr.status === 'done' ? 'Re-run OCR' : 'Run OCR now'}
          </button>
          {ocr && (
            <div class="progress" role="progressbar" aria-valuenow={Math.round(ocr.progress * 100)} aria-label="OCR progress">
              <span style={{ width: `${ocr.progress * 100}%` }} />
            </div>
          )}

          <h2>Capture</h2>
          <p class="muted small">
            {fmtDate(rec.createdAt)} · {rec.mode} · {rec.tiles.length} tiles
          </p>
          <button
            class="danger"
            onClick={async () => {
              if (!confirm('Delete this capture from LocalCapture? Downloaded files are not affected.')) return;
              await deleteCapture(id);
              window.close();
            }}
          >
            Delete capture
          </button>
        </aside>
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
