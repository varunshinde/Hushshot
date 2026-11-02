export type Quality = 1 | 2 | 3 | 4;
export type EngineSetting = 'auto' | 'cdp' | 'scroll';
export type StickyMode = 'once' | 'hide' | 'asis';
export type PaperSize = 'a4' | 'letter' | 'legal' | 'continuous';

export interface Settings {
  quality: Quality;
  engine: EngineSetting;
  /** CDP tiling: scroll the page per tile (faithful) or render beyond the viewport. */
  cdpStrategy: 'scroll' | 'beyond';
  maxTileHeight: number;
  stickyMode: StickyMode;
  hideCookieBanners: boolean;
  hideChatWidgets: boolean;
  cookieSelectors: string;
  chatSelectors: string;
  /** CDP only: emulate prefers-color-scheme. */
  colorScheme: 'asis' | 'light' | 'dark';
  lazyPrepass: boolean;
  maxWaitMs: number;
  maxHeightCss: number;
  fullWidth: boolean;
  maxSegmentHeight: number;
  segmentOverlap: 0 | 40 | 80;
  multiPart: 'separate' | 'zip';
  imageFormat: 'png' | 'jpeg' | 'webp';
  lossyQuality: number;
  pdfPaper: PaperSize;
  pdfMargins: 'none' | 'small' | 'normal';
  pdfOrientation: 'auto' | 'portrait' | 'landscape';
  pdfSmaller: boolean;
  ocrMode: 'auto' | 'demand';
  ocrLanguages: string[];
  ocrThreshold: boolean;
  ocrWholeImage: 'auto' | 'always' | 'never';
  filenameTemplate: string;
  downloadFolder: string;
  openPreview: boolean;
}

export const DEFAULT_COOKIE_SELECTORS = [
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '#CybotCookiebotDialog',
  '.cc-window',
  '.cookie-banner',
  '#cookie-banner',
  '[id*="cookie-consent" i]',
  '[class*="cookie-consent" i]',
  '[aria-label*="cookie" i][role="dialog"]',
  '.fc-consent-root',
  '#usercentrics-root',
].join('\n');

export const DEFAULT_CHAT_SELECTORS = [
  '#intercom-container',
  '.intercom-lightweight-app',
  '#hubspot-messages-iframe-container',
  '#drift-widget-container',
  '.crisp-client',
  '#launcher',
  'iframe[title*="chat" i]',
  '[class*="chat-widget" i]',
  '#zsiq_float',
  '.zopim',
].join('\n');

export const DEFAULT_SETTINGS: Settings = {
  quality: 2,
  engine: 'auto',
  cdpStrategy: 'scroll',
  maxTileHeight: 8192,
  stickyMode: 'once',
  hideCookieBanners: false,
  hideChatWidgets: false,
  cookieSelectors: DEFAULT_COOKIE_SELECTORS,
  chatSelectors: DEFAULT_CHAT_SELECTORS,
  colorScheme: 'asis',
  lazyPrepass: true,
  maxWaitMs: 3000,
  maxHeightCss: 30000,
  fullWidth: false,
  maxSegmentHeight: 8000,
  segmentOverlap: 0,
  multiPart: 'separate',
  imageFormat: 'png',
  lossyQuality: 0.92,
  pdfPaper: 'a4',
  pdfMargins: 'none',
  pdfOrientation: 'auto',
  pdfSmaller: false,
  ocrMode: 'auto',
  ocrLanguages: ['eng'],
  ocrThreshold: false,
  ocrWholeImage: 'auto',
  filenameTemplate: '{title}_{date}_{time}_{part}',
  downloadFolder: 'LocalFullPageCapture',
  openPreview: true,
};

/** Language packs shipped in /ocr/lang. Add more by dropping *.traineddata.gz there and rebuilding. */
export const BUNDLED_OCR_LANGUAGES = ['eng'];

const pick = <T>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback: string, maxLen = 4000): string =>
  typeof v === 'string' ? v.slice(0, maxLen) : fallback;

/** Coerce untrusted input (storage, imported JSON) into valid settings. */
export function sanitizeSettings(input: unknown): Settings {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const langs = Array.isArray(i.ocrLanguages)
    ? i.ocrLanguages.filter((l): l is string => typeof l === 'string' && BUNDLED_OCR_LANGUAGES.includes(l))
    : d.ocrLanguages;
  return {
    quality: pick(i.quality, [1, 2, 3, 4] as const, d.quality),
    engine: pick(i.engine, ['auto', 'cdp', 'scroll'] as const, d.engine),
    cdpStrategy: pick(i.cdpStrategy, ['scroll', 'beyond'] as const, d.cdpStrategy),
    maxTileHeight: num(i.maxTileHeight, 1024, 16384, d.maxTileHeight),
    stickyMode: pick(i.stickyMode, ['once', 'hide', 'asis'] as const, d.stickyMode),
    hideCookieBanners: bool(i.hideCookieBanners, d.hideCookieBanners),
    hideChatWidgets: bool(i.hideChatWidgets, d.hideChatWidgets),
    cookieSelectors: str(i.cookieSelectors, d.cookieSelectors),
    chatSelectors: str(i.chatSelectors, d.chatSelectors),
    colorScheme: pick(i.colorScheme, ['asis', 'light', 'dark'] as const, d.colorScheme),
    lazyPrepass: bool(i.lazyPrepass, d.lazyPrepass),
    maxWaitMs: num(i.maxWaitMs, 0, 30000, d.maxWaitMs),
    maxHeightCss: num(i.maxHeightCss, 1000, 200000, d.maxHeightCss),
    fullWidth: bool(i.fullWidth, d.fullWidth),
    maxSegmentHeight: num(i.maxSegmentHeight, 500, 16000, d.maxSegmentHeight),
    segmentOverlap: pick(i.segmentOverlap, [0, 40, 80] as const, d.segmentOverlap),
    multiPart: pick(i.multiPart, ['separate', 'zip'] as const, d.multiPart),
    imageFormat: pick(i.imageFormat, ['png', 'jpeg', 'webp'] as const, d.imageFormat),
    lossyQuality:
      typeof i.lossyQuality === 'number' && i.lossyQuality >= 0.5 && i.lossyQuality <= 1 ? i.lossyQuality : d.lossyQuality,
    pdfPaper: pick(i.pdfPaper, ['a4', 'letter', 'legal', 'continuous'] as const, d.pdfPaper),
    pdfMargins: pick(i.pdfMargins, ['none', 'small', 'normal'] as const, d.pdfMargins),
    pdfOrientation: pick(i.pdfOrientation, ['auto', 'portrait', 'landscape'] as const, d.pdfOrientation),
    pdfSmaller: bool(i.pdfSmaller, d.pdfSmaller),
    ocrMode: pick(i.ocrMode, ['auto', 'demand'] as const, d.ocrMode),
    ocrLanguages: langs.length ? langs : d.ocrLanguages,
    ocrThreshold: bool(i.ocrThreshold, d.ocrThreshold),
    ocrWholeImage: pick(i.ocrWholeImage, ['auto', 'always', 'never'] as const, d.ocrWholeImage),
    filenameTemplate: str(i.filenameTemplate, d.filenameTemplate, 200) || d.filenameTemplate,
    downloadFolder: str(i.downloadFolder, d.downloadFolder, 100).replace(/[\\:*?"<>|]/g, '').replace(/^\/+|\/+$/g, ''),
    openPreview: bool(i.openPreview, d.openPreview),
  };
}

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY);
  return sanitizeSettings(got[KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = sanitizeSettings({ ...(await loadSettings()), ...patch });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}
