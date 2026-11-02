import type { Interval, Rect } from '../lib/types';
import { fixedElements, HIDE_ATTRS } from './prep';
import type { Scroller } from './scroller';

/**
 * DOM text layer: every visible word with its box, plus layout data for smart
 * splitting (text line boxes, images, controls) and the areas that need image
 * OCR (images, canvas, video, path-only SVG, cross-origin frames, plugins).
 * All coordinates are CSS px relative to the capture target's top-left.
 */

export interface CssWord {
  t: string;
  x: number;
  y: number;
  w: number;
  h: number;
  line: number;
  block: number;
  tag?: string;
}

export interface TextRequest {
  /** Target rectangle in content coordinates. */
  target: Rect;
  /** Root scroll position while the first / last row of tiles was captured (for fixed elements). */
  firstScroll: { x: number; y: number };
  lastScroll: { x: number; y: number };
}

export interface TextResult {
  words: CssWord[];
  forbidden: Interval[];
  ocrRegions: Rect[];
  domTextChars: number;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE', 'OPTION', 'TITLE']);
const BLOCK_DISPLAY = /^(block|list-item|flex|grid|table|table-cell|table-row|table-caption|flow-root)/;
const ATOMIC = 'img,video,canvas,svg,iframe,embed,object,input,select,textarea,button,picture,math';
const OCR_SELECTOR = 'img,canvas,video,svg,iframe,embed,object';
const BLOCK_TAGS = /^(h[1-6]|li|pre|blockquote|td|th|p|figcaption|dt|dd|caption)$/;

export function collectText(sc: Scroller, req: TextRequest): TextResult {
  const { target } = req;
  const fixed = fixedElements();
  const topSet = new Set(fixed.top);
  const bottomSet = new Set(fixed.bottom);
  const win = sc.window();
  const cur = sc.scroll();

  const blockIds = new Map<Element, number>();
  const blockTag = new Map<number, string | undefined>();
  const visCache = new Map<Element, boolean>();
  const clipCache = new Map<Element, DOMRect | null>();
  const fixedOf = new Map<Element, 'top' | 'bottom' | null>();
  let nextBlock = 1;
  let nextLine = 1;

  const fixedKind = (el: Element): 'top' | 'bottom' | null => {
    if (fixedOf.has(el)) return fixedOf.get(el)!;
    let k: 'top' | 'bottom' | null = null;
    if (topSet.has(el)) k = 'top';
    else if (bottomSet.has(el)) k = 'bottom';
    else if (el.parentElement) k = fixedKind(el.parentElement);
    fixedOf.set(el, k);
    return k;
  };

  const visible = (el: Element): boolean => {
    const c = visCache.get(el);
    if (c !== undefined) return c;
    let v = true;
    if (el.closest(`[${HIDE_ATTRS.always}]`)) v = false;
    else if (typeof (el as HTMLElement).checkVisibility === 'function') {
      v = (el as HTMLElement).checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: false });
    } else v = getComputedStyle(el).visibility !== 'hidden';
    visCache.set(el, v);
    return v;
  };

  // Intersection of the boxes of ancestors that clip overflow (client coordinates).
  const clipRect = (el: Element | null): DOMRect | null => {
    if (!el || el === sc.el || el === document.documentElement || el === document.body) return null;
    if (clipCache.has(el)) return clipCache.get(el)!;
    const parentClip = clipRect(el.parentElement);
    let rect = parentClip;
    const s = getComputedStyle(el);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
      const r = el.getBoundingClientRect();
      if (!rect) rect = r;
      else {
        const x = Math.max(rect.left, r.left);
        const y = Math.max(rect.top, r.top);
        rect = new DOMRect(x, y, Math.max(0, Math.min(rect.right, r.right) - x), Math.max(0, Math.min(rect.bottom, r.bottom) - y));
      }
    }
    clipCache.set(el, rect);
    return rect;
  };

  const blockOf = (el: Element): number => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const existing = blockIds.get(e);
      if (existing) return existing;
      if (e === sc.el || e === document.body || BLOCK_DISPLAY.test(getComputedStyle(e).display)) {
        const id = nextBlock++;
        blockIds.set(e, id);
        const tagged = e.closest('h1,h2,h3,h4,h5,h6,li,pre,blockquote,td,th');
        const tag = tagged ? tagged.tagName.toLowerCase() : e.tagName.toLowerCase();
        blockTag.set(id, BLOCK_TAGS.test(tag) ? tag : undefined);
        return id;
      }
    }
    return 0;
  };

  /** Client rect -> target-relative content coordinates, accounting for fixed elements. */
  const toTarget = (r: { left: number; top: number }, el: Element, ox: number, oy: number) => {
    const kind = fixedKind(el);
    const sc0 = kind === 'top' ? req.firstScroll : kind === 'bottom' ? req.lastScroll : cur;
    const cx = r.left + ox - win.x + win.offsetX + sc0.x;
    const cy = r.top + oy - win.y + win.offsetY + sc0.y;
    // Non-fixed content is independent of scroll: use the live mapping.
    if (!kind) {
      const p = sc.toContent(r.left + ox, r.top + oy);
      return { x: p.x - target.x, y: p.y - target.y };
    }
    return { x: cx - target.x, y: cy - target.y };
  };

  const words: CssWord[] = [];
  const forbidden: Interval[] = [];
  const ocrRegions: Rect[] = [];
  let domTextChars = 0;
  const range = document.createRange();
  let prev: { block: number; top: number; right: number; h: number; line: number } | null = null;

  const walkDoc = (doc: Document, root: Node, ox: number, oy: number, frameClip: DOMRect | null) => {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        const p = n.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName) || !n.nodeValue || !/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      const el = node.parentElement!;
      if (!visible(el)) continue;
      const clip = clipRect(el);
      const block = blockOf(el);
      const text = node.nodeValue!;
      for (const m of text.matchAll(/\S+/g)) {
        range.setStart(node, m.index!);
        range.setEnd(node, m.index! + m[0].length);
        const rects = range.getClientRects();
        if (!rects.length) continue;
        let r: DOMRect = rects[0];
        if (rects.length > 1) {
          const b = range.getBoundingClientRect();
          if (b.height <= r.height * 1.5) r = b; // pieces on one line (e.g. ligatures, spans)
        }
        if (r.width < 0.5 || r.height < 0.5) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (clip && (cx < clip.left || cx > clip.right || cy < clip.top || cy > clip.bottom)) continue;
        if (frameClip && (cx < frameClip.left || cx > frameClip.right || cy < frameClip.top || cy > frameClip.bottom)) continue;
        const p = toTarget(r, el, ox, oy);
        const mx = p.x + r.width / 2;
        const my = p.y + r.height / 2;
        if (mx < 0 || my < 0 || mx > target.width || my > target.height) continue;
        const sameLine = prev && prev.block === block && Math.abs(prev.top - p.y) < Math.max(prev.h, r.height) * 0.5 && p.x >= prev.right - 2;
        const line = sameLine ? prev!.line : nextLine++;
        words.push({ t: m[0], x: p.x, y: p.y, w: r.width, h: r.height, line, block, tag: blockTag.get(block) });
        prev = { block, top: p.y, right: p.x + r.width, h: r.height, line };
        domTextChars += m[0].length;
        forbidden.push([p.y, p.y + r.height]);
      }
    }

    for (const el of (root as ParentNode).querySelectorAll(ATOMIC)) {
      if (el.tagName.toLowerCase() === 'svg' && el.parentElement?.closest('svg')) continue;
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const p = toTarget(r, el, ox, oy);
      if (p.y + r.height < 0 || p.y > target.height || p.x + r.width < 0 || p.x > target.width) continue;
      forbidden.push([p.y, p.y + r.height]);
      if (!el.matches(OCR_SELECTOR) || fixedKind(el)) continue;
      if (r.width < 40 || r.height < 16 || r.width * r.height < 2400) continue;
      if (el.tagName.toLowerCase() === 'svg' && el.querySelector('text')) continue;
      if (el.tagName.toLowerCase() === 'iframe') {
        let sameOrigin = false;
        try {
          sameOrigin = !!(el as HTMLIFrameElement).contentDocument;
        } catch {
          sameOrigin = false;
        }
        if (sameOrigin) continue; // walked as DOM text below
      }
      ocrRegions.push(clampRect({ x: p.x, y: p.y, width: r.width, height: r.height }, target));
    }

    // Elements with background images (banners with text baked in).
    for (const el of (root as ParentNode).querySelectorAll('*')) {
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg || bg === 'none' || !bg.includes('url(')) continue;
      if (!visible(el) || fixedKind(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 24 || r.width * r.height < 6000) continue;
      const p = toTarget(r, el, ox, oy);
      if (p.y + r.height < 0 || p.y > target.height) continue;
      ocrRegions.push(clampRect({ x: p.x, y: p.y, width: r.width, height: r.height }, target));
    }

    // Same-origin iframes: walk their documents with the frame's offset.
    for (const f of (root as ParentNode).querySelectorAll('iframe')) {
      let d: Document | null = null;
      try {
        d = (f as HTMLIFrameElement).contentDocument;
      } catch {
        d = null;
      }
      if (!d?.body || !visible(f)) continue;
      const fr = f.getBoundingClientRect();
      const fx = fr.left + (f as HTMLElement).clientLeft;
      const fy = fr.top + (f as HTMLElement).clientTop;
      const fclip = new DOMRect(0, 0, (f as HTMLElement).clientWidth, (f as HTMLElement).clientHeight);
      walkDoc(d, d.body, ox + fx, oy + fy, fclip);
    }
  };

  walkDoc(document, sc.kind === 'element' ? sc.el : document.body ?? document.documentElement, 0, 0, null);
  return { words, forbidden, ocrRegions: ocrRegions.filter((r) => r.width > 8 && r.height > 8), domTextChars };
}

function clampRect(r: Rect, target: Rect): Rect {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(target.width, r.x + r.width) - x),
    height: Math.max(0, Math.min(target.height, r.y + r.height) - y),
  };
}
