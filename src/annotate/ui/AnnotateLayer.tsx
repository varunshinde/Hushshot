import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { dragCrop, HANDLES, type Handle } from '../../lib/geometry/view';
import type { TileSource } from '../../lib/image/render';
import type { CaptureRecord, Rect } from '../../lib/types';
import { redactImage } from '../apply';
import { canvasMeasure, contrastOn, drawDoc, fontOf } from '../draw';
import {
  bounds,
  boxed,
  LINE_HEIGHT,
  newAnnotationId,
  nextStep,
  pick,
  rectOfPoints,
  textLines,
  textPad,
  translate,
  type Annotation,
  type EditDoc,
  type Of,
  type Pt,
} from '../model';
import type { Editor } from './state';

interface Props {
  rec: CaptureRecord;
  doc: EditDoc;
  /** Image area on show (crop applied), image px. */
  view: Rect;
  /** CSS px per image px. */
  zoom: number;
  /** Editing (true) or just showing the annotations (false). */
  active: boolean;
  editor: Editor;
  tiles: TileSource | null;
  viewportRef: { current: HTMLDivElement | null };
}

type Drag =
  | { kind: 'draw'; start: Pt }
  | { kind: 'move'; id: string; start: Annotation; p0: Pt }
  | { kind: 'resize'; id: string; handle: Handle | 'a' | 'b' | 'tail'; start: Annotation; p0: Pt }
  | { kind: 'pan'; x0: number; y0: number; sl: number; st: number };

/**
 * Annotation overlay inside the preview canvas. Draws with the same renderer
 * as the export (a canvas covering just the part on screen) and, when active,
 * handles drawing, selecting, moving, resizing and text editing.
 */
export function AnnotateLayer(p: Props) {
  const { rec, doc, view, zoom: z, editor: ed } = p;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [visible, setVisible] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const redacts = useRef(new Map<string, OffscreenCanvas | 'pending'>());
  const [redactTick, setRedactTick] = useState(0);
  const s = rec.scale;
  const bounds0 = { width: rec.width, height: rec.height };

  // Which part of the canvas is on screen; the drawing canvas only covers that.
  const measureVisible = () => {
    const root = rootRef.current;
    const vp = p.viewportRef.current;
    if (!root || !vp) return;
    const c = root.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    const left = Math.max(c.left, v.left);
    const top = Math.max(c.top, v.top);
    const right = Math.min(c.right, v.right);
    const bottom = Math.min(c.bottom, v.bottom);
    if (right <= left || bottom <= top) return setVisible(null);
    const next = { left: left - c.left, top: top - c.top, width: right - left, height: bottom - top };
    setVisible((old) => (old && old.left === next.left && old.top === next.top && old.width === next.width && old.height === next.height ? old : next));
  };
  useLayoutEffect(measureVisible, [z, view.x, view.y, view.width, view.height]);
  useEffect(() => {
    const vp = p.viewportRef.current;
    if (!vp) return;
    vp.addEventListener('scroll', measureVisible, { passive: true });
    const ro = new ResizeObserver(measureVisible);
    ro.observe(vp);
    return () => {
      vp.removeEventListener('scroll', measureVisible);
      ro.disconnect();
    };
  }, []);

  // Low-resolution copies for blur/pixelate redactions, made from the original tiles like the export does.
  const redactKey = (a: Of<'redact'>) => `${a.id}:${a.mode}:${Math.round(a.r.x)},${Math.round(a.r.y)},${Math.round(a.r.width)},${Math.round(a.r.height)}`;
  useEffect(() => {
    if (!p.tiles) return;
    const wanted = new Set<string>();
    for (const a of doc.items) {
      if (a.kind !== 'redact' || a.mode === 'box' || a.r.width < 1 || a.r.height < 1) continue;
      const key = redactKey(a);
      wanted.add(key);
      if (redacts.current.has(key)) continue;
      redacts.current.set(key, 'pending');
      redactImage(p.tiles, rec, a)
        .then((img) => {
          redacts.current.set(key, img);
          setRedactTick((n) => n + 1);
        })
        .catch(() => redacts.current.delete(key));
    }
    for (const k of [...redacts.current.keys()]) if (!wanted.has(k) && redacts.current.get(k) !== 'pending') redacts.current.delete(k);
  }, [doc, p.tiles]);

  // Draw.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(visible.width * dpr);
    const H = Math.round(visible.height * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const x0 = view.x + visible.left / z;
    const y0 = view.y + visible.top / z;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, -x0 * dpr * z, -y0 * dpr * z);
    const shown = draft ? { ...doc, items: [...doc.items, draft] } : doc;
    // Text being typed is shown by the text box instead; a callout keeps its bubble behind the box.
    const typing = ed.editingText ? doc.items.find((a) => a.id === ed.editingText) : undefined;
    drawDoc(ctx, shown, { x: x0, y: y0, width: visible.width / z, height: visible.height / z }, {
      hide: typing?.kind === 'text' ? typing.id : undefined,
      redactImage: (a) => {
        const img = redacts.current.get(redactKey(a));
        return img && img !== 'pending' ? img : undefined;
      },
    });
  }, [doc, draft, visible, z, view.x, view.y, ed.editingText, redactTick]);

  const toImage = (cx: number, cy: number): Pt => {
    const r = rootRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rec.width, (cx - r.left) / z + view.x)),
      y: Math.max(0, Math.min(rec.height, (cy - r.top) / z + view.y)),
    };
  };

  const base = () => ({ id: newAnnotationId(), color: ed.style.color, width: Math.max(1, ed.style.width * s), opacity: ed.style.opacity });

  const startDraft = (pt: Pt): Annotation | null => {
    const t = ed.tool;
    const b = base();
    switch (t) {
      case 'arrow':
      case 'line':
        return { ...b, kind: t, a: pt, b: pt };
      case 'rect':
      case 'ellipse':
        return { ...b, kind: t, r: { x: pt.x, y: pt.y, width: 0, height: 0 }, fill: ed.style.fill };
      case 'redact':
        return { ...b, kind: 'redact', opacity: 1, r: { x: pt.x, y: pt.y, width: 0, height: 0 }, mode: ed.style.redact };
      case 'spotlight':
        return { ...b, kind: 'spotlight', opacity: 1, r: { x: pt.x, y: pt.y, width: 0, height: 0 } };
      case 'callout':
        return { ...b, kind: 'callout', opacity: 1, r: { x: pt.x, y: pt.y, width: 0, height: 0 }, tail: pt, text: '', size: ed.style.size * s };
      case 'pen':
        return { ...b, kind: 'pen', pts: [pt] };
      case 'highlighter':
        return { ...b, kind: 'highlighter', width: Math.max(4, ed.style.width * 4 * s), opacity: Math.min(ed.style.opacity, 0.45), pts: [pt] };
      default:
        return null;
    }
  };

  const onDown = (e: PointerEvent) => {
    if (!p.active || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (ed.editingText) {
      finishText();
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pt = toImage(e.clientX, e.clientY);
    const target = e.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-ahandle]')?.dataset.ahandle as Handle | 'a' | 'b' | 'tail' | undefined;
    const sel = ed.selected ? doc.items.find((a) => a.id === ed.selected) : undefined;
    if (handle && sel) {
      drag.current = { kind: 'resize', id: sel.id, handle, start: sel, p0: pt };
      return;
    }
    const t = ed.tool;
    if (t === 'select') {
      const hitA = pick(doc.items, pt, 6 / z, canvasMeasure);
      if (hitA) {
        ed.setSelected(hitA.id);
        drag.current = { kind: 'move', id: hitA.id, start: hitA, p0: pt };
      } else {
        ed.setSelected(null);
        const vp = p.viewportRef.current!;
        drag.current = { kind: 'pan', x0: e.clientX, y0: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
      }
      return;
    }
    if (t === 'text') {
      const a: Of<'text'> = { ...base(), kind: 'text', at: pt, text: '', size: ed.style.size * s, bg: ed.style.fill };
      // Placing and typing the text is one undo step, finished when the text box closes.
      ed.live((d) => ({ ...d, items: [...d.items, a] }));
      ed.setSelected(a.id);
      ed.setEditingText(a.id);
      return;
    }
    if (t === 'step') {
      ed.add({ ...base(), kind: 'step', at: pt, n: nextStep(doc.items), size: Math.max(16, ed.style.size * 1.4 * s) });
      return;
    }
    if (t === 'stamp') {
      ed.add({ ...base(), kind: 'stamp', at: pt, glyph: ed.style.stamp, size: Math.max(16, ed.style.size * 2 * s) });
      return;
    }
    const d = startDraft(pt);
    if (d) {
      setDraft(d);
      drag.current = { kind: 'draw', start: pt };
    }
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    if (d.kind === 'pan') {
      const vp = p.viewportRef.current!;
      vp.scrollLeft = d.sl - (e.clientX - d.x0);
      vp.scrollTop = d.st - (e.clientY - d.y0);
      return;
    }
    const pt = toImage(e.clientX, e.clientY);
    if (d.kind === 'draw') {
      setDraft((a) => {
        if (!a) return a;
        if (a.kind === 'arrow' || a.kind === 'line') {
          // Shift keeps lines horizontal, vertical or at 45°.
          let b = pt;
          if (e.shiftKey) {
            const ang = Math.round(Math.atan2(pt.y - a.a.y, pt.x - a.a.x) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(pt.x - a.a.x, pt.y - a.a.y);
            b = { x: a.a.x + Math.cos(ang) * len, y: a.a.y + Math.sin(ang) * len };
          }
          return { ...a, b };
        }
        if (a.kind === 'pen' || a.kind === 'highlighter') {
          const last = a.pts[a.pts.length - 1];
          return Math.hypot(pt.x - last.x, pt.y - last.y) * z < 1.5 ? a : { ...a, pts: [...a.pts, pt] };
        }
        if ('r' in a) {
          let r = rectOfPoints(d.start, pt);
          if (e.shiftKey && (a.kind === 'rect' || a.kind === 'ellipse')) {
            const m = Math.max(r.width, r.height);
            r = rectOfPoints(d.start, { x: d.start.x + Math.sign(pt.x - d.start.x || 1) * m, y: d.start.y + Math.sign(pt.y - d.start.y || 1) * m });
          }
          return { ...a, r } as Annotation;
        }
        return a;
      });
      return;
    }
    const dx = pt.x - d.p0.x;
    const dy = pt.y - d.p0.y;
    if (d.kind === 'move') {
      ed.live((doc0) => ({ ...doc0, items: doc0.items.map((a) => (a.id === d.id ? translate(d.start, dx, dy) : a)) }));
      return;
    }
    const a0 = d.start;
    let next: Annotation = a0;
    if ((a0.kind === 'arrow' || a0.kind === 'line') && (d.handle === 'a' || d.handle === 'b')) {
      next = { ...a0, [d.handle]: { x: a0[d.handle].x + dx, y: a0[d.handle].y + dy } };
    } else if (a0.kind === 'callout' && d.handle === 'tail') {
      next = { ...a0, tail: { x: a0.tail.x + dx, y: a0.tail.y + dy } };
    } else if (boxed(a0) && d.handle !== 'a' && d.handle !== 'b' && d.handle !== 'tail') {
      next = { ...a0, r: dragCrop(a0.r, d.handle, dx, dy, bounds0) };
    }
    ed.live((doc0) => ({ ...doc0, items: doc0.items.map((a) => (a.id === d.id ? next : a)) }));
  };

  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.stopPropagation();
    if (d.kind === 'move' || d.kind === 'resize') return ed.end();
    if (d.kind !== 'draw' || !draft) return;
    const a = draft;
    setDraft(null);
    const tiny = 4 / z;
    if (a.kind === 'arrow' || a.kind === 'line') {
      if (Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y) < tiny) return;
    } else if (a.kind === 'callout') {
      let r = a.r;
      if (r.width < 24 / z || r.height < 16 / z) r = { x: a.r.x, y: a.r.y, width: 220 * s, height: 64 * s };
      const tail = { x: Math.min(rec.width, r.x + r.width * 0.2), y: Math.min(rec.height, r.y + r.height + Math.max(28 * s, r.height * 0.5)) };
      const c = { ...a, r, tail };
      ed.live((d) => ({ ...d, items: [...d.items, c] }));
      ed.setSelected(c.id);
      ed.setEditingText(c.id);
      return;
    } else if ('r' in a) {
      if (a.r.width < tiny || a.r.height < tiny) return;
    }
    ed.add(a);
  };

  const onDouble = (e: MouseEvent) => {
    if (!p.active) return;
    const pt = toImage(e.clientX, e.clientY);
    const a = pick(doc.items, pt, 6 / z, canvasMeasure);
    if (a && (a.kind === 'text' || a.kind === 'callout')) {
      e.stopPropagation();
      ed.setSelected(a.id);
      ed.setEditingText(a.id);
    }
  };

  /** Close the text box. An empty text leaves nothing behind (and no undo step). */
  const finishText = () => {
    const id = ed.editingText;
    if (!id) return;
    const cur = doc.items.find((x) => x.id === id) as Of<'text' | 'callout'> | undefined;
    ed.setEditingText(null);
    if (cur && !cur.text.trim()) ed.live((d) => ({ ...d, items: d.items.filter((x) => x.id !== id) }));
    ed.end();
  };

  const L = (x: number) => (x - view.x) * z;
  const T = (y: number) => (y - view.y) * z;
  const sel = p.active && ed.selected ? doc.items.find((a) => a.id === ed.selected) : undefined;
  const editing = ed.editingText ? (doc.items.find((a) => a.id === ed.editingText) as Of<'text' | 'callout'> | undefined) : undefined;

  return (
    <div
      ref={rootRef}
      class={`ann-layer${p.active ? ` active tool-${ed.tool}` : ''}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDblClick={onDouble}
    >
      {visible && (
        <canvas
          ref={canvasRef}
          class="ann-canvas"
          aria-hidden="true"
          style={{ left: `${visible.left}px`, top: `${visible.top}px`, width: `${visible.width}px`, height: `${visible.height}px` }}
        />
      )}
      {sel && !editing && <Selection a={sel} L={L} T={T} z={z} />}
      {editing && (
        <TextEditor
          a={editing}
          L={L}
          T={T}
          z={z}
          onInput={(text) =>
            ed.live((d) => ({
              ...d,
              items: d.items.map((x) => {
                if (x.id !== editing.id) return x;
                if (x.kind !== 'callout') return { ...x, text } as Annotation;
                // Callouts grow to fit their text.
                const pad = textPad(x.size) * 1.4;
                const lines = textLines(text, x.size, canvasMeasure, Math.max(x.size, x.r.width - 2 * pad)).length;
                return { ...x, text, r: { ...x.r, height: Math.max(x.r.height, lines * x.size * LINE_HEIGHT + 2 * pad) } };
              }),
            }))
          }
          onDone={finishText}
        />
      )}
    </div>
  );
}

function Selection({ a, L, T, z }: { a: Annotation; L: (x: number) => number; T: (y: number) => number; z: number }) {
  if (a.kind === 'arrow' || a.kind === 'line') {
    return (
      <>
        <i class="ann-dot" data-ahandle="a" style={{ left: `${L(a.a.x)}px`, top: `${T(a.a.y)}px` }} />
        <i class="ann-dot" data-ahandle="b" style={{ left: `${L(a.b.x)}px`, top: `${T(a.b.y)}px` }} />
      </>
    );
  }
  const r = boxed(a) ? a.r : bounds(a, canvasMeasure);
  const pad = boxed(a) ? 0 : 4 / z;
  return (
    <>
      <div
        class="ann-sel"
        style={{ left: `${L(r.x - pad)}px`, top: `${T(r.y - pad)}px`, width: `${(r.width + 2 * pad) * z}px`, height: `${(r.height + 2 * pad) * z}px` }}
      >
        {boxed(a) && HANDLES.map((h) => <i key={h} class={`handle h-${h}`} data-ahandle={h} />)}
      </div>
      {a.kind === 'callout' && <i class="ann-dot tail" data-ahandle="tail" style={{ left: `${L(a.tail.x)}px`, top: `${T(a.tail.y)}px` }} />}
    </>
  );
}

function TextEditor(p: { a: Of<'text' | 'callout'>; L: (x: number) => number; T: (y: number) => number; z: number; onInput: (t: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { a, z } = p;
  useLayoutEffect(() => {
    ref.current?.focus();
  }, [a.id]);
  const size = a.size * z;
  const box =
    a.kind === 'callout'
      ? { x: a.r.x + textPad(a.size) * 1.4, y: a.r.y + textPad(a.size) * 1.4, width: a.r.width - textPad(a.size) * 2.8, height: a.r.height - textPad(a.size) * 2.8 }
      : { x: a.at.x, y: a.at.y, width: Math.max(160 / z, bounds(a, canvasMeasure).width + a.size * 2), height: bounds(a, canvasMeasure).height };
  return (
    <textarea
      ref={ref}
      class="ann-text"
      aria-label={a.kind === 'callout' ? 'Callout text' : 'Text'}
      value={a.text}
      placeholder="Type here"
      spellcheck={false}
      style={{
        left: `${p.L(box.x)}px`,
        top: `${p.T(box.y)}px`,
        width: `${Math.max(40, box.width * z)}px`,
        height: `${Math.max(size * LINE_HEIGHT, box.height * z)}px`,
        font: fontOf(size),
        lineHeight: String(LINE_HEIGHT),
        color: a.kind === 'callout' ? contrastOn(a.color) : a.color,
        background: a.kind === 'callout' ? a.color : 'transparent',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onInput={(e) => p.onInput(e.currentTarget.value)}
      onBlur={p.onDone}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          (e.currentTarget as HTMLTextAreaElement).blur();
        }
      }}
    />
  );
}
