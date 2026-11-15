import type { Rect } from '../lib/types';
import { complementRects } from './redact';
import { bounds, FONT, LINE_HEIGHT, textLines, textPad, type Annotation, type EditDoc, type Measure, type Of, type Pt } from './model';

/**
 * One canvas renderer for annotations, used both on screen and at export, so
 * what you see is what you download. Coordinates are image px; the caller
 * sets the context transform (zoom, scroll, device pixel ratio).
 */

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DrawOptions {
  /** Low-resolution copy of the pixels under a blur/pixelate redaction (see redact.ts). */
  redactImage?: (a: Of<'redact'>) => CanvasImageSource | undefined;
  /** Leave this annotation out (it's being edited as text). */
  hide?: string;
}

export const DIM = 'rgba(0, 0, 0, 0.55)';

let measureCtx: OffscreenCanvasRenderingContext2D | null = null;
export const fontOf = (size: number) => `600 ${size}px ${FONT}`;

/** Text measurement with the same font the renderer uses. */
export const canvasMeasure: Measure = (text, size) => {
  measureCtx ??= new OffscreenCanvas(1, 1).getContext('2d')!;
  measureCtx.font = fontOf(size);
  return measureCtx.measureText(text).width;
};

export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Text colour that reads on `bg`. */
export const contrastOn = (bg: string) => (luminance(bg) > 0.45 ? '#111111' : '#ffffff');

function roundRectPath(ctx: Ctx, r: Rect, radius: number) {
  const rad = Math.max(0, Math.min(radius, r.width / 2, r.height / 2));
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, rad);
}

function smoothPath(ctx: Ctx, pts: Pt[]) {
  ctx.beginPath();
  if (!pts.length) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) {
    ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

export const arrowHead = (width: number) => Math.max(width * 3.2, 12);

function drawArrow(ctx: Ctx, a: Of<'arrow' | 'line'>) {
  const ang = Math.atan2(a.b.y - a.a.y, a.b.x - a.a.x);
  const len = Math.hypot(a.b.x - a.a.x, a.b.y - a.a.y);
  const head = Math.min(arrowHead(a.width), len * 0.6);
  const end = a.kind === 'arrow' ? { x: a.b.x - Math.cos(ang) * head * 0.7, y: a.b.y - Math.sin(ang) * head * 0.7 } : a.b;
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.a.x, a.a.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  if (a.kind !== 'arrow' || len < 1) return;
  const spread = Math.PI / 7;
  ctx.fillStyle = a.color;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, a.width / 2);
  ctx.beginPath();
  ctx.moveTo(a.b.x, a.b.y);
  ctx.lineTo(a.b.x - Math.cos(ang - spread) * head, a.b.y - Math.sin(ang - spread) * head);
  ctx.lineTo(a.b.x - Math.cos(ang + spread) * head, a.b.y - Math.sin(ang + spread) * head);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawText(ctx: Ctx, a: Of<'text'>, measure: Measure) {
  const lines = textLines(a.text, a.size, measure);
  ctx.font = fontOf(a.size);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  if (a.bg) {
    const box = bounds(a, measure);
    ctx.fillStyle = a.color;
    roundRectPath(ctx, box, a.size * 0.3);
    ctx.fill();
    ctx.fillStyle = contrastOn(a.color);
  } else {
    // A thin halo keeps text readable on any background.
    ctx.strokeStyle = contrastOn(a.color) === '#111111' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = Math.max(1, a.size * 0.12);
    ctx.lineJoin = 'round';
    lines.forEach((l, i) => ctx.strokeText(l, a.at.x, a.at.y + i * a.size * LINE_HEIGHT + a.size * 0.1));
    ctx.fillStyle = a.color;
  }
  lines.forEach((l, i) => ctx.fillText(l, a.at.x, a.at.y + i * a.size * LINE_HEIGHT + a.size * 0.1));
}

function drawCallout(ctx: Ctx, a: Of<'callout'>, measure: Measure) {
  const r = a.r;
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const ang = Math.atan2(a.tail.y - cy, a.tail.x - cx);
  const base = Math.max(8, Math.min(r.width, r.height) * 0.28);
  const px = -Math.sin(ang) * (base / 2);
  const py = Math.cos(ang) * (base / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = a.size * 0.5;
  ctx.shadowOffsetY = a.size * 0.12;
  ctx.fillStyle = a.color;
  const tail = () => {
    ctx.beginPath();
    ctx.moveTo(cx + px, cy + py);
    ctx.lineTo(a.tail.x, a.tail.y);
    ctx.lineTo(cx - px, cy - py);
    ctx.closePath();
    ctx.fill();
  };
  // Tail and bubble are filled separately (one path could leave a hole where they overlap).
  tail();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, Math.min(a.size * 0.6, r.width / 2, r.height / 2));
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = a.color;
  tail();
  const pad = textPad(a.size) * 1.4;
  const lines = textLines(a.text, a.size, measure, Math.max(a.size, r.width - 2 * pad));
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  ctx.font = fontOf(a.size);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = contrastOn(a.color);
  lines.forEach((l, i) => ctx.fillText(l, r.x + pad, r.y + pad + i * a.size * LINE_HEIGHT + a.size * 0.1));
  ctx.restore();
}

function drawRedact(ctx: Ctx, a: Of<'redact'>, o: DrawOptions) {
  const r = a.r;
  if (a.mode === 'box') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    return;
  }
  const img = o.redactImage?.(a);
  if (!img) {
    // Not ready yet (on screen only): show a neutral placeholder.
    ctx.fillStyle = '#9aa0a6';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.width, r.height);
  ctx.clip();
  // The reduced image keeps one pixel per block; blur smooths it back up, pixelate keeps the blocks.
  ctx.imageSmoothingEnabled = a.mode === 'blur';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, r.x, r.y, r.width, r.height);
  ctx.restore();
}

function drawOne(ctx: Ctx, a: Annotation, measure: Measure) {
  ctx.save();
  ctx.globalAlpha = a.opacity;
  switch (a.kind) {
    case 'arrow':
    case 'line':
      drawArrow(ctx, a);
      break;
    case 'rect':
    case 'ellipse': {
      ctx.beginPath();
      if (a.kind === 'rect') ctx.rect(a.r.x, a.r.y, a.r.width, a.r.height);
      else ctx.ellipse(a.r.x + a.r.width / 2, a.r.y + a.r.height / 2, Math.max(0.5, a.r.width / 2), Math.max(0.5, a.r.height / 2), 0, 0, Math.PI * 2);
      if (a.fill) {
        ctx.fillStyle = a.color;
        ctx.fill();
      } else {
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.width;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
      break;
    }
    case 'pen':
    case 'highlighter':
      if (a.kind === 'highlighter') ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      smoothPath(ctx, a.pts);
      ctx.stroke();
      break;
    case 'text':
      drawText(ctx, a, measure);
      break;
    case 'callout':
      drawCallout(ctx, a, measure);
      break;
    case 'step': {
      const rad = a.size / 2;
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.arc(a.at.x, a.at.y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, a.size * 0.08);
      ctx.stroke();
      ctx.fillStyle = contrastOn(a.color);
      ctx.font = fontOf(Math.round(a.size * (a.n > 9 ? 0.45 : 0.55)));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(a.n), a.at.x, a.at.y + a.size * 0.03);
      break;
    }
    case 'stamp':
      ctx.font = `${a.size * 0.85}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.glyph, a.at.x, a.at.y);
      break;
    case 'redact':
    case 'spotlight':
      break;
  }
  ctx.restore();
}

/**
 * Draw a document's annotations over the image area `clip` (image px), which
 * is the part of the image the canvas shows. Order: redactions, then the
 * spotlight dimming, then every other annotation in the order it was added.
 */
export function drawDoc(ctx: Ctx, doc: EditDoc, clip: Rect, o: DrawOptions = {}, measure: Measure = canvasMeasure) {
  const items = doc.items.filter((a) => a.id !== o.hide);
  for (const a of items) if (a.kind === 'redact') drawRedact(ctx, a, o);
  const spots = items.filter((a) => a.kind === 'spotlight').map((a) => (a as Of<'spotlight'>).r);
  if (spots.length) {
    ctx.save();
    ctx.fillStyle = DIM;
    for (const r of complementRects(clip, spots)) ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.restore();
  }
  for (const a of items) if (a.kind !== 'redact' && a.kind !== 'spotlight') drawOne(ctx, a, measure);
}
