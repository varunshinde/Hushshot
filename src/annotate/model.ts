import type { Rect } from '../lib/types';

/**
 * Annotation document for one capture. Every coordinate and size is in
 * master-image pixels, so annotations stay sharp at 2×–4× and export at the
 * capture's full resolution.
 */

export interface Pt {
  x: number;
  y: number;
}

export type Kind = 'arrow' | 'line' | 'rect' | 'ellipse' | 'pen' | 'highlighter' | 'text' | 'step' | 'callout' | 'stamp' | 'redact' | 'spotlight';
export type RedactMode = 'blur' | 'pixelate' | 'box';

interface Base {
  id: string;
  color: string;
  /** Stroke width in image px. */
  width: number;
  /** 0–1. */
  opacity: number;
}

export type Annotation =
  | (Base & { kind: 'arrow' | 'line'; a: Pt; b: Pt })
  | (Base & { kind: 'rect' | 'ellipse'; r: Rect; fill: boolean })
  | (Base & { kind: 'pen' | 'highlighter'; pts: Pt[] })
  | (Base & { kind: 'text'; at: Pt; text: string; size: number; bg: boolean })
  | (Base & { kind: 'step'; at: Pt; n: number; size: number })
  | (Base & { kind: 'callout'; r: Rect; tail: Pt; text: string; size: number })
  | (Base & { kind: 'stamp'; at: Pt; glyph: string; size: number })
  | (Base & { kind: 'redact'; r: Rect; mode: RedactMode })
  | (Base & { kind: 'spotlight'; r: Rect });

export type Of<K extends Kind> = Extract<Annotation, { kind: K }>;

export type Rotation = 0 | 90 | 180 | 270;
export type Aspect = 'auto' | '16:9' | '4:3' | '1:1' | '9:16';
export type Frame = 'none' | 'browser' | 'browser-dark';

export interface Beautify {
  /** CSS px at the capture's scale (multiplied by rec.scale when drawn). */
  padding: number;
  radius: number;
  shadow: boolean;
  /** Index into BACKGROUNDS. */
  background: number;
  frame: Frame;
  aspect: Aspect;
}

export interface EditDoc {
  v: 1;
  items: Annotation[];
  beautify: Beautify | null;
  rotate: Rotation;
  /** Output size as a fraction of the original, 0.1–1. */
  scale: number;
}

export const emptyDoc = (): EditDoc => ({ v: 1, items: [], beautify: null, rotate: 0, scale: 1 });

export const isEmptyDoc = (d: EditDoc | null | undefined) => !d || (!d.items.length && !d.beautify && !d.rotate && d.scale === 1);

/** Whether the export must be composed into one image (background, rotation or resize). */
export const needsCompose = (d: EditDoc | null | undefined) => !!d && (!!d.beautify || d.rotate !== 0 || d.scale !== 1);

export const COLORS = ['#e5383b', '#ff8a00', '#f7c600', '#2fb344', '#1c7cf4', '#7c4dff', '#111111', '#ffffff'];
export const STAMPS = ['✅', '❌', '⚠️', '❓', '⭐', '👍', '👎', '🔥', '💡', '🐞', '👉', '✏️'];

let counter = 0;
export const newAnnotationId = () => `a${Date.now().toString(36)}${(counter++).toString(36)}`;

export const normRect = (r: Rect): Rect => ({
  x: r.width < 0 ? r.x + r.width : r.x,
  y: r.height < 0 ? r.y + r.height : r.y,
  width: Math.abs(r.width),
  height: Math.abs(r.height),
});

export const rectOfPoints = (a: Pt, b: Pt): Rect => normRect({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y });

export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const expand = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, width: r.width + 2 * d, height: r.height + 2 * d });

/** Measures text in image px; the canvas renderer supplies a real one. */
export type Measure = (text: string, size: number) => number;
export const roughMeasure: Measure = (text, size) => text.length * size * 0.56;

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const LINE_HEIGHT = 1.25;

/** Lines of a text annotation, or of a callout wrapped to its box. */
export function textLines(text: string, size: number, measure: Measure, maxWidth?: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!maxWidth) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && measure(next.trimEnd(), size) > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export const textPad = (size: number) => Math.round(size * 0.35);

/** Box a text annotation occupies. */
export function textBox(a: Of<'text'>, measure: Measure): Rect {
  const lines = textLines(a.text || ' ', a.size, measure);
  const w = Math.max(a.size, ...lines.map((l) => measure(l, a.size)));
  const pad = a.bg ? textPad(a.size) : 0;
  return { x: a.at.x - pad, y: a.at.y - pad, width: w + 2 * pad, height: lines.length * a.size * LINE_HEIGHT + 2 * pad };
}

/** Bounding box of an annotation (without stroke). */
export function bounds(a: Annotation, measure: Measure = roughMeasure): Rect {
  switch (a.kind) {
    case 'arrow':
    case 'line':
      return rectOfPoints(a.a, a.b);
    case 'rect':
    case 'ellipse':
    case 'redact':
    case 'spotlight':
      return a.r;
    case 'callout': {
      const r = a.r;
      const x0 = Math.min(r.x, a.tail.x);
      const y0 = Math.min(r.y, a.tail.y);
      return { x: x0, y: y0, width: Math.max(r.x + r.width, a.tail.x) - x0, height: Math.max(r.y + r.height, a.tail.y) - y0 };
    }
    case 'pen':
    case 'highlighter': {
      const xs = a.pts.map((p) => p.x);
      const ys = a.pts.map((p) => p.y);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      return { x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 };
    }
    case 'text':
      return textBox(a, measure);
    case 'step':
    case 'stamp':
      return { x: a.at.x - a.size / 2, y: a.at.y - a.size / 2, width: a.size, height: a.size };
  }
}

function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const inRect = (p: Pt, r: Rect, pad = 0) => p.x >= r.x - pad && p.x <= r.x + r.width + pad && p.y >= r.y - pad && p.y <= r.y + r.height + pad;

/** Whether point p (image px) touches annotation a; tol is the pick tolerance in image px. */
export function hit(a: Annotation, p: Pt, tol: number, measure: Measure = roughMeasure): boolean {
  const t = tol + a.width / 2;
  switch (a.kind) {
    case 'arrow':
    case 'line':
      return distToSegment(p, a.a, a.b) <= t;
    case 'pen':
    case 'highlighter':
      for (let i = 1; i < a.pts.length; i++) if (distToSegment(p, a.pts[i - 1], a.pts[i]) <= t) return true;
      return a.pts.length === 1 && Math.hypot(p.x - a.pts[0].x, p.y - a.pts[0].y) <= t;
    case 'rect':
    case 'redact':
    case 'spotlight':
      if (a.kind !== 'rect' || a.fill) return inRect(p, a.r, tol);
      return inRect(p, a.r, t) && !inRect(p, { x: a.r.x + t, y: a.r.y + t, width: a.r.width - 2 * t, height: a.r.height - 2 * t });
    case 'ellipse': {
      const rx = a.r.width / 2;
      const ry = a.r.height / 2;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (p.x - (a.r.x + rx)) / rx;
      const ny = (p.y - (a.r.y + ry)) / ry;
      const d = Math.hypot(nx, ny);
      if (a.fill) return d <= 1 + t / Math.min(rx, ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= t;
    }
    case 'callout':
      return inRect(p, a.r, tol) || distToSegment(p, { x: a.r.x + a.r.width / 2, y: a.r.y + a.r.height / 2 }, a.tail) <= t;
    case 'text':
    case 'step':
    case 'stamp':
      return inRect(p, bounds(a, measure), tol);
  }
}

/** Topmost annotation under p. */
export function pick(items: Annotation[], p: Pt, tol: number, measure?: Measure): Annotation | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (hit(items[i], p, tol, measure)) return items[i];
  return undefined;
}

export function translate<A extends Annotation>(a: A, dx: number, dy: number): A {
  const m = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
  const mr = (r: Rect) => ({ ...r, x: r.x + dx, y: r.y + dy });
  switch (a.kind) {
    case 'arrow':
    case 'line':
      return { ...a, a: m(a.a), b: m(a.b) };
    case 'rect':
    case 'ellipse':
    case 'redact':
    case 'spotlight':
      return { ...a, r: mr(a.r) };
    case 'callout':
      return { ...a, r: mr(a.r), tail: m(a.tail) };
    case 'pen':
    case 'highlighter':
      return { ...a, pts: a.pts.map(m) };
    case 'text':
    case 'step':
    case 'stamp':
      return { ...a, at: m(a.at) };
  }
  return a;
}

/** Annotations whose shape is a box the user can resize with 8 handles. */
export const boxed = (a: Annotation): a is Of<'rect' | 'ellipse' | 'redact' | 'spotlight' | 'callout'> =>
  a.kind === 'rect' || a.kind === 'ellipse' || a.kind === 'redact' || a.kind === 'spotlight' || a.kind === 'callout';

/** Renumber step markers 1, 2, 3… in the order they were placed. */
export function renumberSteps(items: Annotation[]): Annotation[] {
  let n = 0;
  return items.map((a) => (a.kind === 'step' ? { ...a, n: ++n } : a));
}

export const nextStep = (items: Annotation[]) => items.filter((a) => a.kind === 'step').length + 1;

/** Redaction rectangles, clipped to the image. */
export const redactions = (d: EditDoc | null | undefined): Of<'redact'>[] => (d ? (d.items.filter((a) => a.kind === 'redact') as Of<'redact'>[]) : []);
