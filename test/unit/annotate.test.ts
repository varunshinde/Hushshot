import { describe, expect, it } from 'vitest';
import type { Word } from '../../src/lib/types';
import { findSensitive, luhn, scanText } from '../../src/annotate/detect';
import { commit, redo, startHistory, undo } from '../../src/annotate/history';
import { bounds, emptyDoc, hit, isEmptyDoc, needsCompose, pick, renumberSteps, textLines, translate, type Annotation, type EditDoc } from '../../src/annotate/model';
import { blockSize, complementRects, reducedSize, visibleWords } from '../../src/annotate/redact';

const base = { color: '#e5383b', width: 4, opacity: 1 };
const word = (text: string, x: number, y: number, line = 1): Word => ({ text, x, y, w: text.length * 8, h: 14, source: 'dom', conf: 100, line, block: 1 });

describe('annotation model', () => {
  it('hits lines near the stroke and boxes on their border', () => {
    const arrow: Annotation = { ...base, id: 'a', kind: 'arrow', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
    expect(hit(arrow, { x: 50, y: 3 }, 2)).toBe(true);
    expect(hit(arrow, { x: 50, y: 12 }, 2)).toBe(false);
    const rect: Annotation = { ...base, id: 'r', kind: 'rect', r: { x: 10, y: 10, width: 100, height: 50 }, fill: false };
    expect(hit(rect, { x: 10, y: 30 }, 2)).toBe(true);
    expect(hit(rect, { x: 60, y: 35 }, 2)).toBe(false);
    expect(hit({ ...rect, fill: true } as Annotation, { x: 60, y: 35 }, 2)).toBe(true);
  });

  it('picks the topmost annotation', () => {
    const a: Annotation = { ...base, id: 'a', kind: 'rect', r: { x: 0, y: 0, width: 50, height: 50 }, fill: true };
    const b: Annotation = { ...base, id: 'b', kind: 'rect', r: { x: 20, y: 20, width: 50, height: 50 }, fill: true };
    expect(pick([a, b], { x: 30, y: 30 }, 1)?.id).toBe('b');
    expect(pick([a, b], { x: 5, y: 5 }, 1)?.id).toBe('a');
  });

  it('moves every kind and keeps bounds consistent', () => {
    const items: Annotation[] = [
      { ...base, id: '1', kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
      { ...base, id: '2', kind: 'pen', pts: [{ x: 0, y: 0 }, { x: 5, y: 8 }] },
      { ...base, id: '3', kind: 'callout', r: { x: 0, y: 0, width: 40, height: 20 }, tail: { x: 10, y: 40 }, text: 'Hi', size: 12 },
      { ...base, id: '4', kind: 'step', at: { x: 5, y: 5 }, n: 1, size: 20 },
    ];
    for (const a of items) {
      const b0 = bounds(a);
      const b1 = bounds(translate(a, 7, -3));
      expect([b1.x - b0.x, b1.y - b0.y]).toEqual([7, -3]);
    }
  });

  it('wraps callout text to the box width', () => {
    const measure = (t: string, size: number) => t.length * size * 0.5;
    expect(textLines('one two three four', 10, measure, 45)).toEqual(['one two', 'three', 'four']);
    expect(textLines('a\nb', 10, measure)).toEqual(['a', 'b']);
  });

  it('renumbers steps after a deletion', () => {
    const steps: Annotation[] = [1, 2, 3].map((n) => ({ ...base, id: `s${n}`, kind: 'step', at: { x: 0, y: 0 }, n, size: 20 }));
    const after = renumberSteps(steps.filter((s) => s.id !== 's2'));
    expect(after.map((s) => (s.kind === 'step' ? s.n : 0))).toEqual([1, 2]);
  });

  it('knows when a document is empty or needs composing', () => {
    const d = emptyDoc();
    expect(isEmptyDoc(d)).toBe(true);
    expect(needsCompose(d)).toBe(false);
    expect(needsCompose({ ...d, rotate: 90 })).toBe(true);
    expect(needsCompose({ ...d, scale: 0.5 })).toBe(true);
  });
});

describe('undo and redo', () => {
  it('stays exact over 60 steps', () => {
    let h = startHistory<EditDoc>(emptyDoc());
    const states: EditDoc[] = [h.present];
    for (let i = 0; i < 60; i++) {
      const next = { ...h.present, items: [...h.present.items, { ...base, id: `a${i}`, kind: 'line' as const, a: { x: i, y: 0 }, b: { x: i, y: 10 } }] };
      h = commit(h, next);
      states.push(h.present);
    }
    for (let i = 59; i >= 0; i--) {
      h = undo(h);
      expect(h.present).toBe(states[i]);
    }
    expect(undo(h)).toBe(h);
    for (let i = 1; i <= 60; i++) {
      h = redo(h);
      expect(h.present).toBe(states[i]);
    }
    expect(redo(h)).toBe(h);
  });

  it('drops the redo branch after a new change', () => {
    let h = startHistory(1);
    h = commit(commit(h, 2), 3);
    h = undo(h);
    h = commit(h, 4);
    expect(h.future).toEqual([]);
    expect(h.past).toEqual([1, 2]);
  });
});

describe('redaction', () => {
  const doc = (r: { x: number; y: number; width: number; height: number }): EditDoc => ({
    ...emptyDoc(),
    items: [{ ...base, id: 'x', kind: 'redact', r, mode: 'box' }],
  });

  it('removes any word a redaction touches from text output', () => {
    const words = [word('public', 0, 0), word('secret@example.com', 100, 0), word('also', 300, 0)];
    const out = visibleWords(words, doc({ x: 110, y: 5, width: 10, height: 2 }));
    expect(out.map((w) => w.text)).toEqual(['public', 'also']);
  });

  it('keeps every word without redactions', () => {
    const words = [word('a', 0, 0)];
    expect(visibleWords(words, emptyDoc())).toBe(words);
    expect(visibleWords(words, undefined)).toBe(words);
  });

  it('keeps one sample per block, so detail cannot be recovered', () => {
    expect(blockSize('pixelate', 2)).toBe(20);
    expect(blockSize('blur', 1)).toBe(14);
    expect(reducedSize({ x: 0, y: 0, width: 101, height: 40 }, 20)).toEqual({ w: 6, h: 2 });
  });

  it('dims exactly the area outside the spotlights', () => {
    const area = { x: 0, y: 0, width: 100, height: 100 };
    const holes = [
      { x: 10, y: 10, width: 30, height: 30 },
      { x: 30, y: 30, width: 30, height: 30 },
    ];
    const parts = complementRects(area, holes);
    const total = parts.reduce((n, r) => n + r.width * r.height, 0);
    // Union of the holes: 900 + 900 − 100 overlap.
    expect(total).toBe(100 * 100 - 1700);
    for (const p of parts) for (const h of holes) expect(p.x < h.x + h.width && h.x < p.x + p.width && p.y < h.y + h.height && h.y < p.y + p.height).toBe(false);
    expect(complementRects(area, [])).toEqual([area]);
  });
});

describe('private info finder', () => {
  it('finds emails, phone numbers, card numbers and keys', () => {
    const kinds = (t: string) => scanText(t).map((s) => [s.kind, t.slice(s.start, s.end)]);
    expect(kinds('Write to jane.doe@example.co.uk today')).toEqual([['email', 'jane.doe@example.co.uk']]);
    expect(kinds('Call +1 415 555 0134 now')).toEqual([['phone', '+1 415 555 0134']]);
    expect(kinds('Card 4242 4242 4242 4242 exp')).toEqual([['card', '4242 4242 4242 4242']]);
    expect(kinds('key sk-proj-abcdEFGH1234ijklMNOP5678')[0][0]).toBe('key');
    expect(kinds('AKIAIOSFODNN7EXAMPLE')).toEqual([['key', 'AKIAIOSFODNN7EXAMPLE']]);
    expect(kinds('token ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8')[0][0]).toBe('key');
  });

  it('ignores dates, short numbers and invalid card numbers', () => {
    expect(scanText('Updated 2026-11-07 at 10:30')).toEqual([]);
    expect(scanText('Order 12345')).toEqual([]);
    expect(scanText('4242 4242 4242 4241').filter((s) => s.kind === 'card')).toEqual([]);
    expect(luhn('4242424242424242')).toBe(true);
    expect(luhn('4242424242424241')).toBe(false);
  });

  it('returns boxes covering the matching words', () => {
    const words = [word('Email:', 0, 100), word('a@b.io', 60, 100), word('thanks', 120, 100)];
    const f = findSensitive(words, 0);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe('email');
    expect(f[0].rect).toEqual({ x: 60, y: 100, width: 48, height: 14 });
  });
});
