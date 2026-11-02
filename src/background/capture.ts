import { geomForShot, planScrolls, type PlannedShot } from '../lib/capture/plan';
import { FILE_URL_MESSAGE, restrictionReason } from '../lib/capture/restricted';
import { broadcast } from '../lib/messages';
import { loadSettings, type Settings } from '../lib/settings';
import { newId, putBlob, putCapture } from '../lib/storage/db';
import type { CaptureMode, CaptureRecord, Interval, Rect, TileGeom, TileRef, Word } from '../lib/types';
import { callContent, CaptureError, injectContent } from './content-call';
import { CdpEngine } from './engines/cdp';
import { ScrollEngine } from './engines/scroll';
import { CaptureCancelled, type CaptureEngine } from './engines/types';
import { finalizeInOffscreen } from './offscreen';

export interface CaptureRequest {
  mode: CaptureMode;
  tabId?: number;
  /** Let the user click the scroll container before a full-page capture. */
  pickContainer?: boolean;
  /** Automation: skip the interactive pickers. */
  region?: Rect;
  elementSelector?: string;
  containerSelector?: string | null;
  /** Automation: cancel after this many tiles (tests the cleanup path). */
  cancelAfterTiles?: number;
  settings?: Partial<Settings>;
  openPreview?: boolean;
}

export type CaptureOutcome =
  | { ok: true; id: string; warnings: string[] }
  | { ok: false; cancelled?: boolean; error: string; code: string };

/** Max canvas side in Chrome; master width must fit one segment canvas. */
const MAX_CANVAS_SIDE = 16384;
const OVERLAP_CSS = { cdp: 24, scroll: 64 } as const;
const SETTLE_MS = { cdp: 40, scroll: 60 } as const;

let active: { tabId: number; cancelled: boolean } | null = null;

export function cancelActive(tabId?: number): boolean {
  if (!active || (tabId !== undefined && active.tabId !== tabId)) return false;
  active.cancelled = true;
  return true;
}

export function isCapturing(): boolean {
  return active !== null;
}

async function pickEngine(s: Settings): Promise<{ engine: CaptureEngine; note?: string }> {
  if (s.engine === 'scroll') return { engine: new ScrollEngine() };
  const granted = await chrome.permissions.contains({ permissions: ['debugger'] });
  if (granted) return { engine: new CdpEngine() };
  return {
    engine: new ScrollEngine(),
    note:
      s.engine === 'cdp'
        ? 'The high-resolution engine needs the optional "debugger" permission. Used scroll-and-stitch at native resolution instead — enable it from the popup.'
        : 'Captured with scroll-and-stitch at your display\'s native resolution. Enable the high-resolution engine in the popup for 2x–4x output.',
  };
}

async function resolveTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (tabId !== undefined) return chrome.tabs.get(tabId);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new CaptureError('No active tab to capture.', 'no-tab');
  return tab;
}

/** Progress on the toolbar icon: nothing drawn on the page could stay out of the screenshot. */
function setBadge(tabId: number, text: string, color = '#2563eb') {
  chrome.action.setBadgeBackgroundColor({ color, tabId }).catch(() => {});
  chrome.action.setBadgeText({ text, tabId }).catch(() => {});
}

export async function runCapture(req: CaptureRequest): Promise<CaptureOutcome> {
  if (active) return { ok: false, error: 'A capture is already running.', code: 'busy' };
  let tab: chrome.tabs.Tab;
  try {
    tab = await resolveTab(req.tabId);
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: 'no-tab' };
  }
  const tabId = tab.id!;
  active = { tabId, cancelled: false };
  setBadge(tabId, '…');
  let failed = false;
  try {
    const id = await capture(tab, req);
    return { ok: true, id, warnings: [] };
  } catch (e) {
    if (e instanceof CaptureCancelled) return { ok: false, cancelled: true, error: 'Capture cancelled.', code: 'cancelled' };
    failed = true;
    const code = e instanceof CaptureError ? e.code : 'error';
    return { ok: false, error: (e as Error).message ?? String(e), code };
  } finally {
    active = null;
    if (failed) {
      setBadge(tabId, '!', '#b3261e');
      setTimeout(() => setBadge(tabId, ''), 4000);
    } else setBadge(tabId, '');
  }
}

async function capture(tab: chrome.tabs.Tab, req: CaptureRequest): Promise<string> {
  const tabId = tab.id!;
  const settings = { ...(await loadSettings()), ...req.settings } as Settings;
  const fileAccess = await chrome.extension.isAllowedFileSchemeAccess();
  const blocked = restrictionReason(tab.url, fileAccess);
  if (blocked) throw new CaptureError(blocked, blocked === FILE_URL_MESSAGE ? 'file-access' : 'restricted');

  await injectContent(tabId);
  const checkCancel = () => {
    if (active?.cancelled) throw new CaptureCancelled();
  };

  // 1. Interactive selection (before any page changes).
  let mode = req.mode;
  if (mode === 'region') {
    const ok = req.region ? await callContent(tabId, 'useRegion', req.region) : await callContent(tabId, 'selectRegion');
    if (!ok) throw new CaptureCancelled();
  } else if (mode === 'element') {
    const ok = req.elementSelector ? await callContent(tabId, 'useElement', req.elementSelector) : await callContent(tabId, 'selectElement');
    if (!ok) throw new CaptureCancelled();
  } else if (mode === 'full' && req.containerSelector !== undefined) {
    await callContent(tabId, 'usePickedContainer', req.containerSelector);
  } else if (mode === 'full' && req.pickContainer) {
    const ok = await callContent(tabId, 'pickContainer');
    if (!ok) throw new CaptureCancelled();
  }
  checkCancel();

  const { engine, note } = await pickEngine(settings);
  const warnings: string[] = note ? [note] : [];
  const id = newId();
  const tiles: TileRef[] = [];
  const geoms: TileGeom[] = [];
  let tileBytes = 0;
  let scale = 0;
  let target: Rect;
  let words: Word[] = [];
  let forbidden: Interval[] = [];
  let ocrRegions: Rect[] = [];

  try {
    await engine.begin(tabId, tab.windowId, settings);
    const hide = [
      ...(settings.hideCookieBanners ? settings.cookieSelectors.split('\n') : []),
      ...(settings.hideChatWidgets ? settings.chatSelectors.split('\n') : []),
    ]
      .map((s) => s.trim())
      .filter(Boolean);
    const prep = await callContent(tabId, 'prepare', {
      mode,
      stickyMode: settings.stickyMode,
      hideSelectors: hide,
      lazyPrepass: settings.lazyPrepass,
      maxWaitMs: settings.maxWaitMs,
      maxHeightCss: settings.maxHeightCss,
    });
    warnings.push(...prep.warnings);
    if (prep.cancelled) throw new CaptureCancelled();
    checkCancel();

    const start = await callContent(tabId, 'scrollState');
    if (mode === 'visible') {
      target = { x: start.x + start.view.offsetX, y: start.y + start.view.offsetY, width: start.view.width, height: start.view.height };
    } else if (mode === 'full') {
      target = { x: 0, y: 0, width: settings.fullWidth ? prep.content.width : prep.window.width, height: prep.content.height };
    } else {
      const sel = prep.selection;
      if (!sel) throw new CaptureError('Nothing was selected.', 'selection');
      target = { ...sel, height: Math.min(sel.height, settings.maxHeightCss) };
      if (sel.height > settings.maxHeightCss) warnings.push(`Selection was capped at ${settings.maxHeightCss.toLocaleString()} CSS px.`);
    }
    const estScale = engine.kind === 'cdp' ? settings.quality : prep.dpr;
    if (target.width * estScale > MAX_CANVAS_SIDE) {
      target.width = Math.floor(MAX_CANVAS_SIDE / estScale);
      warnings.push(`Width was limited to ${target.width} CSS px to stay within Chrome's canvas size limit.`);
    }

    const maxStepCss = Math.floor(settings.maxTileHeight / estScale);
    const beyond = engine.kind === 'cdp' && settings.cdpStrategy === 'beyond' && prep.rootKind === 'document' && mode !== 'visible';
    let shots: (PlannedShot & { clip?: Rect })[];
    if (beyond) {
      shots = [];
      for (let y = target.y, row = 0; y < target.y + target.height; y += maxStepCss, row++) {
        shots.push({ row, col: 0, x: 0, y: 0, clip: { x: target.x, y, width: target.width, height: Math.min(maxStepCss, target.y + target.height - y) } });
      }
    } else {
      shots = planScrolls({
        target,
        window: prep.window,
        maxScroll: prep.maxScroll,
        current: { x: start.x, y: start.y },
        overlap: mode === 'visible' ? 0 : OVERLAP_CSS[engine.kind],
        maxStepHeight: maxStepCss,
      });
    }
    const lastRow = Math.max(...shots.map((s) => s.row));
    let firstScroll = { x: start.x, y: start.y };
    let lastScroll = firstScroll;

    for (let i = 0; i < shots.length; i++) {
      checkCancel();
      if (req.cancelAfterTiles !== undefined && i >= req.cancelAfterTiles) {
        active!.cancelled = true;
        checkCancel();
      }
      const s = shots[i];
      const st = beyond
        ? await callContent(tabId, 'scrollState')
        : await callContent(tabId, 'scrollTo', s.x, s.y, mode === 'visible' ? 0 : SETTLE_MS[engine.kind]);
      if (!beyond) await callContent(tabId, 'setTileState', s.row, lastRow);
      else if (i === 0) await callContent(tabId, 'setTileState', 0, 0);
      if (s.row === 0) firstScroll = { x: st.x, y: st.y };
      if (s.row === lastRow) lastScroll = { x: st.x, y: st.y };
      const shotH = Math.min(st.view.height, maxStepCss);
      const shot = await engine.shoot({
        view: { ...st.view, height: shotH },
        winX: st.winX,
        winY: st.winY,
        docClip: s.clip,
      });
      if (!scale) {
        scale = engine.kind === 'cdp' ? shot.width / shot.cssWidth : shot.width / st.innerWidth;
        // Snap tiny float errors (e.g. 1.9999) but keep genuine fractional zoom scales.
        if (Math.abs(scale - Math.round(scale)) < 0.01) scale = Math.round(scale);
      }
      const key = `${id}/t${i}`;
      await putBlob(key, new Blob([shot.bytes as BlobPart], { type: 'image/png' }));
      tiles.push({ key, width: shot.width, height: shot.height });
      tileBytes += shot.bytes.length;
      const geom = s.clip
        ? geomForShot(
            { tile: i, row: s.row, col: 0, contentX: s.clip.x, contentY: s.clip.y, width: s.clip.width, height: s.clip.height, originX: 0, originY: 0, imageWidth: shot.width, imageHeight: shot.height },
            target,
            scale,
          )
        : geomForShot(
            {
              tile: i,
              row: s.row,
              col: s.col,
              contentX: st.x + st.view.offsetX,
              contentY: st.y + st.view.offsetY,
              width: st.view.width,
              height: shotH,
              originX: shot.originX,
              originY: shot.originY,
              imageWidth: shot.width,
              imageHeight: shot.height,
            },
            target,
            scale,
          );
      if (geom) geoms.push(geom);
      broadcast({ type: 'capture-progress', tabId, stage: 'tiles', progress: (i + 1) / shots.length });
      setBadge(tabId, `${Math.min(99, Math.round(((i + 1) / shots.length) * 100))}%`);
    }

    checkCancel();
    const text = await callContent(tabId, 'collectText', { target, firstScroll, lastScroll });
    words = text.words.map((w) => ({
      text: w.t,
      x: w.x * scale,
      y: w.y * scale,
      w: w.w * scale,
      h: w.h * scale,
      source: 'dom' as const,
      conf: 100,
      line: w.line,
      block: w.block,
      tag: w.tag,
    }));
    forbidden = text.forbidden.map(([a, b]) => [a * scale, b * scale] as Interval);
    ocrRegions = text.ocrRegions.map((r) => ({ x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale }));
  } finally {
    await callContent(tabId, 'restore').catch(() => {});
    await engine.end().catch(() => {});
  }

  if (!geoms.length) throw new CaptureError('Nothing to capture: the selected area is empty.', 'empty');
  const width = Math.round(target.width * scale);
  const height = Math.round(target.height * scale);
  const rec: CaptureRecord = {
    id,
    createdAt: Date.now(),
    url: tab.url ?? '',
    title: tab.title ?? 'Untitled',
    mode,
    engine: engine.kind,
    scale,
    dpi: Math.round(96 * scale * 100) / 100,
    width,
    height,
    tiles,
    geoms,
    placements: [],
    forbidden,
    ocrRegions,
    words,
    crop: null,
    splits: null,
    warnings,
    status: 'finalizing',
    ocr: { status: 'pending', progress: 0 },
    sourceTabId: tabId,
    tileBytes,
  };
  await putCapture(rec);
  await finalizeInOffscreen(id, settings);
  if (req.openPreview ?? settings.openPreview) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`/preview.html?id=${encodeURIComponent(id)}`), index: tab.index + 1, openerTabId: tabId });
  }
  return id;
}
