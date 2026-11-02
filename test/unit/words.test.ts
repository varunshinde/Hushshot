import { describe, expect, it } from 'vitest';
import { mergeWords, toMarkdown, toPlainText, wordsInRect } from '../../src/lib/text/words';
import type { Word } from '../../src/lib/types';

const w = (text: string, x: number, y: number, line: number, block: number, extra: Partial<Word> = {}): Word =>
  ({ text, x, y, w: text.length * 8, h: 16, source: 'dom', conf: 100, line, block, ...extra });

describe('words', () => {
  const dom = [w('Title', 0, 0, 1, 1, { tag: 'h1' }), w('Hello', 0, 40, 2, 2, { tag: 'p' }), w('world', 50, 40, 2, 2, { tag: 'p' }), w('again', 0, 60, 3, 2, { tag: 'p' })];

  it('produces plain text with line and block breaks', () => {
    expect(toPlainText(dom)).toBe('Title\n\nHello world\nagain\n');
  });

  it('produces markdown headings', () => {
    expect(toMarkdown(dom)).toBe('# Title\n\nHello world\nagain\n');
  });

  it('drops OCR words overlapping DOM words and inserts the rest by position', () => {
    const ocr = [
      { ...w('Hello', 1, 41, 100, 100), source: 'ocr' as const },
      { ...w('Caption', 0, 20, 101, 101), source: 'ocr' as const },
    ];
    expect(mergeWords(dom, ocr).map((x) => x.text)).toEqual(['Title', 'Caption', 'Hello', 'world', 'again']);
  });

  it('selects words by rectangle', () => {
    expect(wordsInRect(dom, { x: 40, y: 30, width: 100, height: 30 }).map((x) => x.text)).toEqual(['world']);
  });
});
