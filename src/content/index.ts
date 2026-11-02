import type { Rect } from '../lib/types';
import type { StickyMode } from '../lib/settings';
import { elementTarget, selectElement, selectRegion } from './picker';
import { chooseScroller, currentScroller, prepare, restore, setTileState, type PrepOptions } from './prep';
import { nextFrame, sleep } from './scroller';
import { collectText, type TextRequest } from './text';

/**
 * Capture-side API installed in the page's isolated world. The service worker
 * calls it with chrome.scripting.executeScript({ func }) — there is no message
 * channel for the page to talk to; the only message this script ever sends is
 * "cancel" when the user presses Esc during a capture.
 */

export interface ScrollState {
  /** Root scroll position. */
  x: number;
  y: number;
  /** Window scroll position (for CDP clips, which use document coordinates). */
  winX: number;
  winY: number;
  innerWidth: number;
  /** The visible window onto the root's content, in client coordinates. */
  view: { x: number; y: number; width: number; height: number; offsetX: number; offsetY: number };
}

interface Selection {
  root: Element | null;
  rect: Rect | null;
  label: string;
}

let selection: Selection | null = null;
let pickedContainer: Element | null | undefined;
let cancelled = false;

const onEsc = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return;
  cancelled = true;
  chrome.runtime.sendMessage({ target: 'background', type: 'content-cancel' }).catch(() => {});
};

const api = {
  ping: () => true,

  /** Quick size estimate for the popup, without changing the page. */
  measure(useAuto = true) {
    const sc = chooseScroller(pickedContainer !== undefined ? pickedContainer ?? null : useAuto ? 'auto' : null, 'full');
    const c = sc.contentSize();
    const w = sc.window();
    return { width: w.width, height: c.height, contentWidth: c.width, dpr: window.devicePixelRatio, root: sc.label };
  },

  async selectRegion() {
    const r = await selectRegion();
    selection = r ? { root: null, rect: r.rect, label: 'region' } : null;
    return r ? { rect: r.rect } : null;
  },

  async selectElement() {
    const r = await selectElement(false);
    selection = r ? { root: r.root, rect: r.rect, label: r.label } : null;
    return r ? { rect: r.rect, label: r.label, inner: !!r.root } : null;
  },

  /** Use a known region/element instead of the interactive pickers (automation and tests). */
  useRegion(rect: Rect) {
    selection = { root: null, rect, label: 'region' };
    return true;
  },

  useElement(selector: string) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = elementTarget(el);
    selection = { root: r.root, rect: r.rect, label: r.label };
    return { rect: r.rect, label: r.label, inner: !!r.root };
  },

  usePickedContainer(selector: string | null) {
    pickedContainer = selector ? document.querySelector(selector) : null;
    return !!pickedContainer || selector === null;
  },

  async pickContainer() {
    const r = await selectElement(true);
    if (!r) return null;
    pickedContainer = r.root;
    return { label: r.label };
  },

  async prepare(opts: {
    mode: PrepOptions['mode'];
    stickyMode: StickyMode;
    hideSelectors: string[];
    lazyPrepass: boolean;
    maxWaitMs: number;
    maxHeightCss: number;
  }) {
    cancelled = false;
    window.addEventListener('keydown', onEsc, true);
    let root: PrepOptions['root'] = 'auto';
    if ((opts.mode === 'element' || opts.mode === 'region') && selection) root = selection.root;
    else if (opts.mode === 'full' && pickedContainer !== undefined) root = pickedContainer;
    else if (opts.mode === 'visible') root = null;
    const res = await prepare({ ...opts, root }, () => cancelled);
    return { ...res, selection: opts.mode === 'element' || opts.mode === 'region' ? selection?.rect ?? null : null, cancelled };
  },

  async scrollTo(x: number, y: number, settleMs = 0): Promise<ScrollState> {
    const sc = currentScroller();
    sc.scrollTo(x, y);
    await nextFrame();
    if (settleMs) await sleep(settleMs);
    await nextFrame();
    return api.scrollState();
  },

  scrollState(): ScrollState {
    const sc = currentScroller();
    const s = sc.scroll();
    return { x: s.x, y: s.y, winX: window.scrollX, winY: window.scrollY, innerWidth: window.innerWidth, view: sc.window() };
  },

  setTileState,

  collectText(req: TextRequest) {
    return collectText(currentScroller(), req);
  },

  isCancelled: () => cancelled,

  restore() {
    window.removeEventListener('keydown', onEsc, true);
    restore();
    return true;
  },
};

export type ContentApi = typeof api;

declare global {
  // eslint-disable-next-line no-var
  var __localCapture: ContentApi | undefined;
}

export function install() {
  if (!globalThis.__localCapture) globalThis.__localCapture = api;
}
