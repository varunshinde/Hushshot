import type { Rect, Word } from '../types';

/**
 * Word-list utilities shared by "Copy text", text export, the PDF text layer
 * and rectangle selection in the preview.
 */

export interface Line {
  id: number;
  block: number;
  tag?: string;
  source: Word['source'];
  words: Word[];
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlapArea = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const wordRect = (w: Word): Rect => ({ x: w.x, y: w.y, width: w.w, height: w.h });

/** Group words into lines, keeping the order they first appear in the list. */
export function groupLines(words: Word[]): Line[] {
  const byId = new Map<number, Line>();
  const order: Line[] = [];
  for (const w of words) {
    let l = byId.get(w.line);
    if (!l) {
      l = { id: w.line, block: w.block, tag: w.tag, source: w.source, words: [], x: w.x, y: w.y, w: 0, h: 0 };
      byId.set(w.line, l);
      order.push(l);
    }
    l.words.push(w);
  }
  for (const l of order) {
    const x0 = Math.min(...l.words.map((w) => w.x));
    const y0 = Math.min(...l.words.map((w) => w.y));
    const x1 = Math.max(...l.words.map((w) => w.x + w.w));
    const y1 = Math.max(...l.words.map((w) => w.y + w.h));
    Object.assign(l, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return order;
}

/**
 * Merge DOM words (exact) with OCR words. OCR words that overlap a DOM word
 * are dropped (DOM wins). Remaining OCR lines are inserted into the DOM reading
 * order before the first DOM line that starts below them.
 */
export function mergeWords(dom: Word[], ocr: Word[]): Word[] {
  const domRects = dom.map(wordRect);
  // Bucket DOM words by row band for fast overlap tests.
  const band = 64;
  const buckets = new Map<number, number[]>();
  domRects.forEach((r, i) => {
    for (let b = Math.floor(r.y / band); b <= Math.floor((r.y + r.height) / band); b++) {
      const arr = buckets.get(b) ?? [];
      arr.push(i);
      buckets.set(b, arr);
    }
  });
  const kept = ocr.filter((w) => {
    const r = wordRect(w);
    const area = r.width * r.height || 1;
    const seen = new Set<number>();
    for (let b = Math.floor(r.y / band); b <= Math.floor((r.y + r.height) / band); b++) {
      for (const i of buckets.get(b) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        if (overlapArea(r, domRects[i]) / area > 0.3) return false;
      }
    }
    return true;
  });
  if (!kept.length) return dom;
  if (!dom.length) return kept;

  const domLines = groupLines(dom);
  const ocrLines = groupLines(kept).sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Word[] = [];
  let oi = 0;
  for (const dl of domLines) {
    while (oi < ocrLines.length && ocrLines[oi].y + ocrLines[oi].h / 2 < dl.y) out.push(...ocrLines[oi++].words);
    out.push(...dl.words);
  }
  while (oi < ocrLines.length) out.push(...ocrLines[oi++].words);
  return out;
}

/** Plain text with line breaks; blank line between blocks. */
export function toPlainText(words: Word[]): string {
  const lines = groupLines(words);
  let out = '';
  let prev: Line | null = null;
  for (const l of lines) {
    if (prev) out += prev.block !== l.block ? '\n\n' : '\n';
    out += l.words.map((w) => w.text).join(' ');
    prev = l;
  }
  return out.trim() + (out ? '\n' : '');
}

const HEADING = /^h([1-6])$/;

/** Markdown: headings, list items and preformatted blocks come from the DOM tags. */
export function toMarkdown(words: Word[], title?: string): string {
  const lines = groupLines(words);
  const blocks: { tag?: string; lines: string[] }[] = [];
  let cur: { block: number; tag?: string; lines: string[] } | null = null;
  for (const l of lines) {
    if (!cur || cur.block !== l.block) {
      cur = { block: l.block, tag: l.tag, lines: [] };
      blocks.push(cur);
    }
    cur.lines.push(l.words.map((w) => w.text).join(' '));
  }
  const parts: string[] = [];
  if (title) parts.push(`# ${title}`);
  for (const b of blocks) {
    const tag = b.tag ?? '';
    const h = HEADING.exec(tag);
    if (h) parts.push(`${'#'.repeat(Number(h[1]))} ${b.lines.join(' ')}`);
    else if (tag === 'li') parts.push(`- ${b.lines.join(' ')}`);
    else if (tag === 'pre') parts.push('```\n' + b.lines.join('\n') + '\n```');
    else if (tag === 'blockquote') parts.push(b.lines.map((l) => `> ${l}`).join('\n'));
    else parts.push(b.lines.join('\n'));
  }
  return parts.join('\n\n') + '\n';
}

/** Words whose centre lies inside `r`, in reading order. */
export function wordsInRect(words: Word[], r: Rect): Word[] {
  return words.filter((w) => {
    const cx = w.x + w.w / 2;
    const cy = w.y + w.h / 2;
    return cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
  });
}

/** Words shifted into a sub-image's coordinates (e.g. a segment or crop), keeping those whose centre is inside. */
export function wordsForArea(words: Word[], area: Rect): Word[] {
  return wordsInRect(words, area).map((w) => ({ ...w, x: w.x - area.x, y: w.y - area.y }));
}

/** Text-line boxes as vertical intervals (for split validation and smart split). */
export function lineIntervals(words: Word[]): [number, number][] {
  return groupLines(words).map((l) => [l.y, l.y + l.h] as [number, number]);
}
