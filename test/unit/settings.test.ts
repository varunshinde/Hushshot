import { describe, expect, it } from 'vitest';
import { advancedDefaults, DEFAULT_SETTINGS, GENERAL_KEYS, sanitizeSettings } from '../../src/lib/settings';

describe('settings', () => {
  it('cleans pages by default and keeps the menu on the toolbar icon', () => {
    const s = sanitizeSettings({});
    expect(s.hideCookieBanners).toBe(true);
    expect(s.hideChatWidgets).toBe(true);
    expect(s.toolbarClick).toBe('menu');
    expect(s.downloadFormat).toBe('png');
    expect(s.pdfStamp).toBe(false);
  });

  it('carries an old default image format over to the download format', () => {
    expect(sanitizeSettings({ imageFormat: 'webp' }).downloadFormat).toBe('webp');
    expect(sanitizeSettings({ imageFormat: 'webp', downloadFormat: 'pdf' }).downloadFormat).toBe('pdf');
    expect(sanitizeSettings({ downloadFormat: 'gif', toolbarClick: 'nope' })).toMatchObject({ downloadFormat: 'png', toolbarClick: 'menu' });
  });

  it('resets advanced settings without touching general ones', () => {
    const adv = advancedDefaults();
    for (const k of GENERAL_KEYS) expect(k in adv).toBe(false);
    expect(adv.maxWaitMs).toBe(DEFAULT_SETTINGS.maxWaitMs);
    const mine = { ...DEFAULT_SETTINGS, quality: 4 as const, maxWaitMs: 9000 };
    const after = sanitizeSettings({ ...mine, ...adv });
    expect(after.quality).toBe(4);
    expect(after.maxWaitMs).toBe(DEFAULT_SETTINGS.maxWaitMs);
  });
});
