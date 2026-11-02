import { describe, expect, it } from 'vitest';
import { tesseractOptions } from '../../src/lib/ocr/config';

describe('tesseract config', () => {
  it('points every path at the extension package', () => {
    const o = tesseractOptions((p) => `chrome-extension://abc${p}`);
    for (const v of [o.workerPath, o.corePath, o.langPath]) expect(v.startsWith('chrome-extension://abc/ocr/')).toBe(true);
    expect(o.workerBlobURL).toBe(false);
    expect(o.cacheMethod).toBe('none');
    expect(JSON.stringify(o)).not.toMatch(/https?:/);
  });
});
