import type { Rect } from '../lib/types';
import { describe, isScrollable, scrollableAncestor } from './scroller';

/**
 * Interactive selection overlays: drag a region (auto-scrolls near the
 * viewport edges), or hover-and-click an element / scroll container.
 * Esc cancels and resolves null.
 */

const Z = '2147483647';
const ACCENT = '#2563eb';

function overlayRoot(): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('localcapture-overlay');
  host.style.cssText = `all: initial; position: fixed; inset: 0; z-index: ${Z};`;
  const root = host.attachShadow({ mode: 'closed' });
  document.documentElement.appendChild(host);
  return { host, root };
}

function label(root: ShadowRoot): HTMLDivElement {
  const l = document.createElement('div');
  l.style.cssText = `position: fixed; padding: 3px 6px; font: 12px/1.3 system-ui, sans-serif; color: #fff; background: ${ACCENT}; border-radius: 4px; pointer-events: none; white-space: nowrap;`;
  root.appendChild(l);
  return l;
}

function hint(root: ShadowRoot, text: string) {
  const h = document.createElement('div');
  h.textContent = text;
  h.style.cssText = 'position: fixed; top: 12px; left: 50%; transform: translateX(-50%); padding: 6px 12px; font: 13px/1.4 system-ui, sans-serif; color: #fff; background: rgba(17,24,39,.9); border-radius: 6px; pointer-events: none;';
  root.appendChild(h);
}

export interface RegionResult {
  /** Document coordinates (CSS px). */
  rect: Rect;
}

export function selectRegion(): Promise<RegionResult | null> {
  return new Promise((resolve) => {
    const { host, root } = overlayRoot();
    const pane = document.createElement('div');
    pane.style.cssText = 'position: fixed; inset: 0; cursor: crosshair; background: rgba(0,0,0,.25);';
    const box = document.createElement('div');
    box.style.cssText = `position: absolute; display: none; border: 1px solid ${ACCENT}; box-shadow: 0 0 0 99999px rgba(0,0,0,.35); pointer-events: none;`;
    pane.appendChild(box);
    root.appendChild(pane);
    const lab = label(root);
    lab.style.display = 'none';
    hint(root, 'Drag to select an area · scrolls when you drag near an edge · Esc to cancel');

    let start: { x: number; y: number } | null = null;
    let last = { cx: 0, cy: 0 };
    let raf = 0;

    const current = (): Rect | null => {
      if (!start) return null;
      const ex = last.cx + window.scrollX;
      const ey = last.cy + window.scrollY;
      return { x: Math.min(start.x, ex), y: Math.min(start.y, ey), width: Math.abs(ex - start.x), height: Math.abs(ey - start.y) };
    };
    const draw = () => {
      const r = current();
      if (!r) return;
      pane.style.background = 'transparent';
      box.style.display = 'block';
      box.style.left = `${r.x - window.scrollX}px`;
      box.style.top = `${r.y - window.scrollY}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      lab.style.display = 'block';
      lab.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
      lab.style.left = `${Math.min(window.innerWidth - 90, last.cx + 12)}px`;
      lab.style.top = `${Math.min(window.innerHeight - 24, last.cy + 12)}px`;
    };
    const tick = () => {
      if (!start) return;
      const edge = 40;
      let dy = 0;
      if (last.cy < edge) dy = -Math.ceil((edge - last.cy) / 2);
      else if (last.cy > window.innerHeight - edge) dy = Math.ceil((last.cy - (window.innerHeight - edge)) / 2);
      if (dy) {
        window.scrollBy({ top: dy, behavior: 'instant' });
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    const finish = (result: RegionResult | null) => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      host.remove();
      resolve(result);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      }
    };
    pane.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pane.setPointerCapture(e.pointerId);
      start = { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
      last = { cx: e.clientX, cy: e.clientY };
      raf = requestAnimationFrame(tick);
    });
    pane.addEventListener('pointermove', (e) => {
      last = { cx: e.clientX, cy: e.clientY };
      draw();
    });
    pane.addEventListener('pointerup', () => {
      const r = current();
      finish(r && r.width >= 4 && r.height >= 4 ? { rect: r } : null);
    });
    window.addEventListener('keydown', onKey, true);
  });
}

/** An element's rect in its scroll root's content coordinates (document, or the nearest inner scroll container). */
export function elementTarget(el: Element): ElementResult {
  const r = el.getBoundingClientRect();
  const anc = scrollableAncestor(el.parentElement);
  if (anc) {
    const ar = anc.getBoundingClientRect();
    const a = anc as HTMLElement;
    return {
      el,
      root: anc,
      label: describe(el),
      rect: { x: r.left - ar.left - a.clientLeft + a.scrollLeft, y: r.top - ar.top - a.clientTop + a.scrollTop, width: r.width, height: r.height },
    };
  }
  return { el, root: null, label: describe(el), rect: { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height } };
}

export interface ElementResult {
  /** The element (kept in the content script), its rect in document coordinates, and its scroll root. */
  el: Element;
  rect: Rect;
  root: Element | null;
  label: string;
}

/**
 * Hover highlights elements; click picks. ↑ selects the parent, ↓ goes back.
 * With `scrollable`, only scroll containers (or the whole page) are offered.
 */
export function selectElement(scrollable = false): Promise<ElementResult | null> {
  return new Promise((resolve) => {
    const { host, root } = overlayRoot();
    const pane = document.createElement('div');
    pane.style.cssText = 'position: fixed; inset: 0; cursor: pointer;';
    const box = document.createElement('div');
    box.style.cssText = `position: fixed; border: 2px solid ${ACCENT}; background: rgba(37,99,235,.12); pointer-events: none; display: none;`;
    root.append(pane, box);
    const lab = label(root);
    hint(
      root,
      scrollable
        ? 'Click the area that scrolls (or anywhere for the whole page) · Esc to cancel'
        : 'Click an element to capture it · ↑ parent · ↓ child · Enter to confirm · Esc to cancel',
    );
    let current: Element | null = null;
    const stack: Element[] = [];

    const under = (x: number, y: number): Element | null => {
      host.style.pointerEvents = 'none';
      pane.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      host.style.pointerEvents = '';
      pane.style.pointerEvents = '';
      if (!el || el === host) return null;
      return scrollable ? scrollableAncestor(el) ?? document.documentElement : el;
    };
    const show = (el: Element | null) => {
      current = el;
      if (!el) {
        box.style.display = 'none';
        lab.style.display = 'none';
        return;
      }
      const r = el === document.documentElement ? new DOMRect(0, 0, window.innerWidth, window.innerHeight) : el.getBoundingClientRect();
      Object.assign(box.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      const full = el === document.documentElement ? 'whole page' : describe(el);
      const h = el === document.documentElement ? document.documentElement.scrollHeight : scrollable ? (el as HTMLElement).scrollHeight : r.height;
      lab.textContent = `${full} · ${Math.round(r.width)} × ${Math.round(h)}`;
      lab.style.display = 'block';
      lab.style.left = `${Math.max(4, Math.min(window.innerWidth - 220, r.left))}px`;
      lab.style.top = `${r.top > 28 ? r.top - 24 : Math.min(window.innerHeight - 24, r.bottom + 4)}px`;
    };
    const finish = (el: Element | null) => {
      window.removeEventListener('keydown', onKey, true);
      host.remove();
      if (!el) return resolve(null);
      if (scrollable) {
        const isDoc = el === document.documentElement || !isScrollable(el);
        return resolve({ el, rect: { x: 0, y: 0, width: 0, height: 0 }, root: isDoc ? null : el, label: isDoc ? 'page' : describe(el) });
      }
      resolve(elementTarget(el));
    };
    const onKey = (e: KeyboardEvent) => {
      const keys = ['Escape', 'Enter', 'ArrowUp', 'ArrowDown'];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') finish(null);
      else if (e.key === 'Enter') finish(current);
      else if (e.key === 'ArrowUp' && current?.parentElement && current !== document.body) {
        stack.push(current);
        show(current.parentElement);
      } else if (e.key === 'ArrowDown' && stack.length) show(stack.pop()!);
    };
    pane.addEventListener('mousemove', (e) => {
      stack.length = 0;
      show(under(e.clientX, e.clientY));
    });
    pane.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      finish(current ?? under(e.clientX, e.clientY));
    });
    window.addEventListener('keydown', onKey, true);
  });
}
