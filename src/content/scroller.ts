/**
 * Uniform access to the thing being scrolled: the document, or an inner
 * scroll container (Gmail, Notion, Slack-style app layouts).
 */

export interface ViewportWindow {
  /** The visible window onto the content, in viewport (client) coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Content coordinate shown at the window's top-left = scroll + offset. */
  offsetX: number;
  offsetY: number;
}

export interface Scroller {
  kind: 'document' | 'element';
  el: Element;
  label: string;
  scroll(): { x: number; y: number };
  scrollTo(x: number, y: number): void;
  window(): ViewportWindow;
  contentSize(): { width: number; height: number };
  /** Convert a client-coordinate point to content coordinates. */
  toContent(cx: number, cy: number): { x: number; y: number };
}

export function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

export function documentScroller(): Scroller {
  const se = (document.scrollingElement ?? document.documentElement) as HTMLElement;
  return {
    kind: 'document',
    el: se,
    label: 'page',
    scroll: () => ({ x: window.scrollX, y: window.scrollY }),
    scrollTo: (x, y) => window.scrollTo({ left: x, top: y, behavior: 'instant' }),
    window: () => ({
      x: 0,
      y: 0,
      width: document.documentElement.clientWidth || window.innerWidth,
      height: document.documentElement.clientHeight || window.innerHeight,
      offsetX: 0,
      offsetY: 0,
    }),
    contentSize: () => ({
      width: Math.max(se.scrollWidth, document.body?.scrollWidth ?? 0),
      height: Math.max(se.scrollHeight, document.body?.scrollHeight ?? 0),
    }),
    toContent: (cx, cy) => ({ x: cx + window.scrollX, y: cy + window.scrollY }),
  };
}

export function elementScroller(el: Element): Scroller {
  const e = el as HTMLElement;
  const win = (): ViewportWindow => {
    const r = e.getBoundingClientRect();
    const left = r.left + e.clientLeft;
    const top = r.top + e.clientTop;
    // Clamp to the browser viewport; the hidden part shifts the content offset.
    const x = Math.max(0, left);
    const y = Math.max(0, top);
    const right = Math.min(document.documentElement.clientWidth, left + e.clientWidth);
    const bottom = Math.min(document.documentElement.clientHeight, top + e.clientHeight);
    return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y), offsetX: x - left, offsetY: y - top };
  };
  return {
    kind: 'element',
    el,
    label: describe(el),
    scroll: () => ({ x: e.scrollLeft, y: e.scrollTop }),
    scrollTo: (x, y) => e.scrollTo({ left: x, top: y, behavior: 'instant' }),
    window: win,
    contentSize: () => ({ width: e.scrollWidth, height: e.scrollHeight }),
    toContent: (cx, cy) => {
      const r = e.getBoundingClientRect();
      return { x: cx - r.left - e.clientLeft + e.scrollLeft, y: cy - r.top - e.clientTop + e.scrollTop };
    },
  };
}

export function isScrollable(el: Element): boolean {
  const e = el as HTMLElement;
  if (e.scrollHeight <= e.clientHeight + 4 && e.scrollWidth <= e.clientWidth + 4) return false;
  const s = getComputedStyle(e);
  return /(auto|scroll|overlay)/.test(s.overflowY + s.overflowX);
}

export function documentScrolls(): boolean {
  const se = document.scrollingElement ?? document.documentElement;
  const s = getComputedStyle(document.documentElement);
  const b = document.body ? getComputedStyle(document.body) : s;
  if (/hidden|clip/.test(s.overflowY) && /hidden|clip/.test(b.overflowY)) return false;
  return se.scrollHeight > window.innerHeight + 4;
}

/** The largest visible scrollable element, if it covers a meaningful part of the viewport. */
export function largestScrollable(): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  const vpArea = window.innerWidth * window.innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    const e = el as HTMLElement;
    if (e.scrollHeight <= e.clientHeight + 20 || e.clientHeight < 100) continue;
    const s = getComputedStyle(e);
    if (!/(auto|scroll|overlay)/.test(s.overflowY)) continue;
    const r = e.getBoundingClientRect();
    const w = Math.max(0, Math.min(window.innerWidth, r.right) - Math.max(0, r.left));
    const h = Math.max(0, Math.min(window.innerHeight, r.bottom) - Math.max(0, r.top));
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = el;
    }
  }
  return best && bestArea >= vpArea * 0.25 ? best : null;
}

/** Nearest scrollable ancestor (or null for the document). */
export function scrollableAncestor(el: Element | null): Element | null {
  for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
    if (isScrollable(e)) return e;
  }
  return null;
}

export const nextFrame = () =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 120);
    requestAnimationFrame(() => requestAnimationFrame(() => (clearTimeout(t), resolve())));
  });

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
