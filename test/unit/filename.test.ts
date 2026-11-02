import { describe, expect, it } from 'vitest';
import { buildFilename, slug } from '../../src/lib/export/filename';

describe('filenames', () => {
  const date = new Date(2026, 10, 1, 14, 32);
  it('follows the default template', () => {
    expect(buildFilename('{title}_{date}_{time}_{part}', { title: 'Page Title', date, part: 1, total: 4, ext: 'png' })).toBe('page-title_2026-11-01_1432_part-01-of-04.png');
  });
  it('drops the part for single files', () => {
    expect(buildFilename('{title}_{date}_{time}_{part}', { title: 'Page Title', date, part: 1, total: 1, ext: 'pdf' })).toBe('page-title_2026-11-01_1432.pdf');
  });
  it('sanitises unsafe characters', () => {
    expect(slug('a/b\\c:d*e?"<>| ..')).toBe('a-b-c-d-e');
    expect(slug('')).toBe('capture');
  });
});
