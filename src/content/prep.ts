import type { StickyMode } from '../lib/settings';
import { documentScroller, documentScrolls, elementScroller, largestScrollable, nextFrame, sleep, type Scroller } from './scroller';

/**
 * Page preparation for clean captures, fully reverted by `restore()`:
 * hidden scrollbars, frozen motion, eager lazy images with a scroll prepass,
 * sticky/fixed handling, optional cookie-banner/chat-widget hiding.
 */

const STYLE_ID = '__localcapture_prep';
const ATTR_HIDE = 'data-lc-hide';
const ATTR_HIDE_ALWAYS = 'data-lc-hide-always';
const ATTR_UNSTICK = 'data-lc-unstick';

const PREP_CSS = `
html, body, * { scrollbar-width: none !important; }
*::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
*, *::before, *::after {
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
  content-visibility: visible !important;
}
html { scroll-behavior: auto !important; }
[${ATTR_HIDE}], [${ATTR_HIDE_ALWAYS}] { opacity: 0 !important; visibility: hidden !important; }
[${ATTR_UNSTICK}] { position: static !important; }
`;

export interface PrepOptions {
  mode: 'visible' | 'full' | 'region' | 'element';
  stickyMode: StickyMode;
  hideSelectors: string[];
  lazyPrepass: boolean;
  maxWaitMs: number;
  maxHeightCss: number;
  /** Explicit scroll root chosen by the user or by element mode. */
  root: Element | null | 'auto';
}

export interface PrepResult {
  rootKind: 'document' | 'element';
  rootLabel: string;
  dpr: number;
  window: { width: number; height: number };
  content: { width: number; height: number };
  maxScroll: { x: number; y: number };
  capped: boolean;
  initialScroll: { x: number; y: number };
  fixedTop: number;
  fixedBottom: number;
  hidden: number;
  warnings: string[];
}

interface PrepState {
  scroller: Scroller;
  styleEl: HTMLStyleElement;
  animations: Animation[];
  videos: HTMLMediaElement[];
  lazy: { el: Element; value: string }[];
  fixedTop: Element[];
  fixedBottom: Element[];
  initialWin: { x: number; y: number };
  initialRoot: { x: number; y: number };
  stickyMode: StickyMode;
}

let state: PrepState | null = null;

export function currentScroller(): Scroller {
  return state?.scroller ?? documentScroller();
}

export function fixedElements(): { top: Element[]; bottom: Element[] } {
  return { top: state?.fixedTop ?? [], bottom: state?.fixedBottom ?? [] };
}

export function chooseScroller(root: PrepOptions['root'], mode: PrepOptions['mode']): Scroller {
  if (root && root !== 'auto') return elementScroller(root);
  if (root === 'auto' && mode === 'full' && !documentScrolls()) {
    const inner = largestScrollable();
    if (inner) return elementScroller(inner);
  }
  return documentScroller();
}

function freezeMotion(s: PrepState) {
  for (const a of document.getAnimations()) {
    if (a.playState === 'running') {
      a.pause();
      s.animations.push(a);
    }
  }
  for (const v of document.querySelectorAll('video, audio')) {
    const m = v as HTMLMediaElement;
    if (!m.paused) {
      m.pause();
      s.videos.push(m);
    }
  }
}

function eagerLazy(s: PrepState) {
  for (const el of document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]')) {
    s.lazy.push({ el, value: el.getAttribute('loading') ?? '' });
    el.setAttribute('loading', 'eager');
  }
}

async function prepass(sc: Scroller, cap: number, isCancelled: () => boolean) {
  const step = Math.max(100, Math.floor(sc.window().height * 0.8));
  const start = performance.now();
  for (let y = 0, i = 0; i < 400; i++) {
    if (isCancelled()) return;
    sc.scrollTo(0, y);
    await sleep(90);
    const h = Math.min(cap, sc.contentSize().height);
    if (y + sc.window().height >= h || performance.now() - start > 60000) break;
    y += step;
  }
  sc.scrollTo(0, 0);
  await nextFrame();
}

/** Wait until images in range are loaded, fonts are ready and no new resources have started for a quiet period. */
async function settle(maxWaitMs: number): Promise<number> {
  const deadline = performance.now() + maxWaitMs;
  let lastResource = performance.now();
  let obs: PerformanceObserver | null = null;
  try {
    obs = new PerformanceObserver(() => (lastResource = performance.now()));
    obs.observe({ type: 'resource', buffered: false });
  } catch {
    /* unsupported */
  }
  const imgs = [...document.images].filter((i) => !i.complete && (i.currentSrc || i.src));
  const remaining = () => Math.max(0, deadline - performance.now());
  await Promise.race([
    Promise.all(
      imgs.map(
        (i) =>
          new Promise<void>((r) => {
            if (i.complete) return r();
            i.addEventListener('load', () => r(), { once: true });
            i.addEventListener('error', () => r(), { once: true });
          }),
      ),
    ),
    sleep(remaining()),
  ]);
  await Promise.race([document.fonts?.ready, sleep(remaining())]);
  // Decode so the images are paint-ready, not just downloaded.
  await Promise.race([Promise.allSettled([...document.images].filter((i) => i.complete && i.naturalWidth).map((i) => i.decode())), sleep(remaining())]);
  while (performance.now() < deadline && performance.now() - lastResource < 400) await sleep(100);
  obs?.disconnect();
  return [...document.images].filter((i) => (i.currentSrc || i.src) && !i.complete && isNearlyVisible(i)).length;
}

function isNearlyVisible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function classifyFixed(s: PrepState, mode: StickyMode, rootEl: Element | null) {
  if (mode === 'asis') return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fixed: Element[] = [];
  for (const el of document.querySelectorAll('body *')) {
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed') fixed.push(el);
    else if (pos === 'sticky') {
      if (rootEl && el.contains(rootEl)) continue;
      if (mode === 'once') el.setAttribute(ATTR_UNSTICK, '');
      else el.setAttribute(ATTR_HIDE_ALWAYS, '');
    }
  }
  const set = new Set(fixed);
  for (const el of fixed) {
    let p = el.parentElement;
    let nested = false;
    for (; p; p = p.parentElement) if (set.has(p)) { nested = true; break; }
    if (nested) continue;
    if (rootEl && el.contains(rootEl)) continue; // app shell around the scroll container
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const visibleArea = Math.max(0, Math.min(vw, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(vh, r.bottom) - Math.max(0, r.top));
    if (visibleArea > vw * vh * 0.7) continue; // full-screen layer / layout shell: leave as rendered
    if (mode === 'hide') el.setAttribute(ATTR_HIDE_ALWAYS, '');
    else if (r.top + r.height / 2 < vh / 2) s.fixedTop.push(el);
    else s.fixedBottom.push(el);
  }
}

function hideBySelectors(selectors: string[]): number {
  let n = 0;
  for (const sel of selectors) {
    try {
      for (const el of document.querySelectorAll(sel)) {
        el.setAttribute(ATTR_HIDE_ALWAYS, '');
        n++;
      }
    } catch {
      /* invalid selector in user list */
    }
  }
  return n;
}

export async function prepare(opts: PrepOptions, isCancelled: () => boolean): Promise<PrepResult> {
  if (state) restore();
  const scroller = chooseScroller(opts.root, opts.mode);
  const styleEl = document.createElement('style');
  styleEl.id = STYLE_ID;
  styleEl.textContent = PREP_CSS;
  (document.head ?? document.documentElement).appendChild(styleEl);
  const s: PrepState = {
    scroller,
    styleEl,
    animations: [],
    videos: [],
    lazy: [],
    fixedTop: [],
    fixedBottom: [],
    initialWin: { x: window.scrollX, y: window.scrollY },
    initialRoot: scroller.scroll(),
    stickyMode: opts.stickyMode,
  };
  state = s;
  const warnings: string[] = [];
  freezeMotion(s);
  eagerLazy(s);
  const hidden = hideBySelectors(opts.hideSelectors);
  await nextFrame();

  if (opts.mode === 'full') {
    if (opts.lazyPrepass) await prepass(scroller, opts.maxHeightCss, isCancelled);
    else scroller.scrollTo(0, 0);
  }
  const stuck = await settle(opts.maxWaitMs);
  if (stuck > 0) warnings.push(`${stuck} image${stuck === 1 ? '' : 's'} didn't load before the ${Math.round(opts.maxWaitMs / 100) / 10}s timeout.`);
  // Pause animations that started during the prepass (lazy content, carousels).
  freezeMotion(s);

  if (opts.mode !== 'visible') classifyFixed(s, opts.stickyMode, scroller.kind === 'element' ? scroller.el : null);
  await nextFrame();

  const content = scroller.contentSize();
  const win = scroller.window();
  const capped = opts.mode === 'full' && content.height > opts.maxHeightCss;
  if (capped) warnings.push(`Page is ${content.height.toLocaleString()} px tall; capture was capped at ${opts.maxHeightCss.toLocaleString()} CSS px (change in settings).`);
  if (scroller.kind === 'element') warnings.push(`Captured the inner scroll container ${scroller.label}. Use "Choose scroll area" if this is wrong.`);
  return {
    rootKind: scroller.kind,
    rootLabel: scroller.label,
    dpr: window.devicePixelRatio,
    window: { width: win.width, height: win.height },
    content: { width: content.width, height: Math.min(content.height, opts.maxHeightCss) },
    maxScroll: { x: Math.max(0, content.width - win.width), y: Math.max(0, content.height - win.height) },
    capped,
    initialScroll: s.initialRoot,
    fixedTop: s.fixedTop.length,
    fixedBottom: s.fixedBottom.length,
    hidden,
    warnings,
  };
}

/** Show top-fixed elements only on the first row of tiles and bottom-fixed only on the last. */
export async function setTileState(row: number, lastRow: number): Promise<void> {
  if (!state || state.stickyMode !== 'once') return;
  for (const el of state.fixedTop) el.toggleAttribute(ATTR_HIDE, row !== 0);
  for (const el of state.fixedBottom) el.toggleAttribute(ATTR_HIDE, row !== lastRow);
  await nextFrame();
}

export function restore(): void {
  const s = state;
  state = null;
  document.getElementById(STYLE_ID)?.remove();
  for (const a of [ATTR_HIDE, ATTR_HIDE_ALWAYS, ATTR_UNSTICK]) {
    for (const el of document.querySelectorAll(`[${a}]`)) el.removeAttribute(a);
  }
  if (!s) return;
  s.styleEl.remove();
  for (const { el, value } of s.lazy) el.setAttribute('loading', value || 'lazy');
  for (const a of s.animations) {
    try {
      a.play();
    } catch {
      /* animation removed */
    }
  }
  for (const v of s.videos) v.play().catch(() => {});
  s.scroller.scrollTo(s.initialRoot.x, s.initialRoot.y);
  if (s.scroller.kind === 'element') window.scrollTo({ left: s.initialWin.x, top: s.initialWin.y, behavior: 'instant' });
}

export const HIDE_ATTRS = { hide: ATTR_HIDE, always: ATTR_HIDE_ALWAYS };
