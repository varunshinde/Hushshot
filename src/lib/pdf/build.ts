import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFFont, type PDFRef } from 'pdf-lib';
import type { Word } from '../types';
import { groupLines } from '../text/words';
import { buildGlyphlessFont, encodeCids, GLYPH_ADVANCE, identityToUnicodeCMap } from './glyphless';
import type { PaperSize } from '../settings';

/**
 * Searchable PDF builder: each page is a lossless (Flate) or JPEG image with
 * an invisible (render mode 3) text layer placed word by word over it.
 */

export type PdfImage =
  /** `data` = PNG-filtered RGB scanlines, zlib-compressed (FlateDecode + Predictor 15). */
  | { kind: 'flate-rgb'; width: number; height: number; data: Uint8Array }
  | { kind: 'jpeg'; width: number; height: number; data: Uint8Array };

export interface PdfPageInput {
  image: PdfImage;
  /** Words in image pixel coordinates. */
  words: Word[];
  widthPt: number;
  heightPt: number;
  /** Image placement in points, origin bottom-left. */
  box: { x: number; y: number; w: number; h: number };
  /** Visible footer line (page address on the left, date and page number on the right). */
  footer?: { left: string; right: string };
}

export interface PdfMeta {
  title: string;
  subject: string;
  created: Date;
}

export const PAPER_PT: Record<Exclude<PaperSize, 'continuous'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};

export const MARGIN_PT = { none: 0, small: 18, normal: 36 } as const;
/** PDF viewers cap pages at 200 inches. */
export const MAX_PAGE_PT = 14400;
/** Height of the footer band reserved below the image when a footer is printed. */
export const FOOTER_PT = 18;
const FOOTER_FONT_PT = 7.5;

export interface PageLayoutOptions {
  paper: PaperSize;
  margins: keyof typeof MARGIN_PT;
  orientation: 'auto' | 'portrait' | 'landscape';
  dpi: number;
  /** Reserve a footer band for the page address and date. */
  footer?: boolean;
}

export interface FitLayout {
  pageW: number;
  pageH: number;
  margin: number;
  /** Points per image pixel. */
  k: number;
  /** Image rows that fit on one page. */
  rowsPerPage: number;
}

/** Fit-to-width layout on a fixed paper size. */
export function fitLayout(imageW: number, imageH: number, o: PageLayoutOptions): FitLayout {
  const [pw, ph] = PAPER_PT[o.paper === 'continuous' ? 'a4' : o.paper];
  const landscape = o.orientation === 'landscape' || (o.orientation === 'auto' && imageW > imageH);
  const pageW = landscape ? ph : pw;
  const pageH = landscape ? pw : ph;
  const margin = MARGIN_PT[o.margins];
  const k = (pageW - 2 * margin) / imageW;
  const footer = o.footer ? FOOTER_PT : 0;
  return { pageW, pageH, margin, k, rowsPerPage: Math.max(1, Math.floor((pageH - 2 * margin - footer) / k)) };
}

/**
 * Page geometry for one segment. `continuous` pages are the image's physical
 * size at its DPI. Paper pages use `doc`, the layout of the whole capture, so
 * a short last segment doesn't switch orientation or scale.
 */
export function pageForSegment(
  imageW: number,
  imageH: number,
  o: PageLayoutOptions,
  doc?: FitLayout,
): Pick<PdfPageInput, 'widthPt' | 'heightPt' | 'box'> {
  const margin = MARGIN_PT[o.margins];
  if (o.paper === 'continuous') {
    let k = 72 / o.dpi;
    const maxSide = Math.max(imageW, imageH) * k + 2 * margin;
    if (maxSide > MAX_PAGE_PT) k *= (MAX_PAGE_PT - 2 * margin) / (Math.max(imageW, imageH) * k);
    const w = imageW * k;
    const h = imageH * k;
    const footer = o.footer ? FOOTER_PT : 0;
    return { widthPt: w + 2 * margin, heightPt: h + 2 * margin + footer, box: { x: margin, y: margin + footer, w, h } };
  }
  const fl = doc ?? fitLayout(imageW, imageH, o);
  const w = imageW * fl.k;
  const h = imageH * fl.k;
  // Top-aligned on the page.
  return { widthPt: fl.pageW, heightPt: fl.pageH, box: { x: fl.margin, y: fl.pageH - fl.margin - h, w, h } };
}

const n = (v: number) => {
  const s = v.toFixed(3);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};

/** Content-stream operators for the invisible text layer of one page. */
export function textLayerOps(words: Word[], imageW: number, box: PdfPageInput['box']): string {
  const k = box.w / imageW;
  const top = box.y + box.h;
  const ops: string[] = ['BT', '3 Tr'];
  for (const line of groupLines(words)) {
    const ws = [...line.words].sort((a, b) => a.x - b.x);
    ws.forEach((w, i) => {
      const next = ws[i + 1];
      const text = next ? `${w.text} ` : w.text;
      const chars = [...text].length;
      if (!chars || w.h <= 0) return;
      const widthPx = next && next.x > w.x ? next.x - w.x : w.w;
      const fs = Math.max(0.5, w.h * k);
      const natural = (chars * GLYPH_ADVANCE * fs) / 1000;
      const tz = Math.max(1, Math.min(10000, (100 * widthPx * k) / natural));
      ops.push(`/F0 ${n(fs)} Tf`, `${n(tz)} Tz`, `1 0 0 1 ${n(box.x + w.x * k)} ${n(top - (w.y + w.h) * k)} Tm`, `<${encodeCids(text)}> Tj`);
    });
  }
  ops.push('ET');
  return ops.join('\n');
}

/** Helvetica can only show WinAnsi characters; anything else becomes '?'. */
function winAnsi(s: string): string {
  return s.replace(/[^\x20-\x7e\u00a0-\u00ff\u2026\u2013\u2014\u00b7]/g, '?');
}

/** Shorten `text` with an ellipsis so it fits `maxWidth` points. */
function fitText(font: PDFFont, text: string, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, FOOTER_FONT_PT) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(`${text.slice(0, mid)}\u2026`, FOOTER_FONT_PT) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}\u2026` : '';
}

/** Footer text at the bottom of the page, just inside the margin (pages are laid out with equal margins). */
function footerOps(font: PDFFont, footer: NonNullable<PdfPageInput['footer']>, p: PdfPageInput): string {
  const margin = p.box.x;
  const left = Math.max(margin, 8);
  const right = p.widthPt - left;
  const baseline = margin + 6;
  const r = fitText(font, winAnsi(footer.right), right - left);
  const rw = font.widthOfTextAtSize(r, FOOTER_FONT_PT);
  const l = fitText(font, winAnsi(footer.left), right - left - rw - 12);
  const show = (text: string, x: number) => `1 0 0 1 ${n(x)} ${n(baseline)} Tm ${font.encodeText(text).toString()} Tj`;
  return ['BT', '0 Tr', '0.42 0.45 0.5 rg', `/F1 ${n(FOOTER_FONT_PT)} Tf`, l ? show(l, left) : '', show(r, right - rw), 'ET'].filter(Boolean).join('\n');
}

export async function buildPdf(pages: PdfPageInput[], meta: PdfMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(meta.title, { showInWindowTitleBar: true });
  doc.setSubject(meta.subject);
  doc.setProducer('LocalFullPageCapture');
  doc.setCreator('LocalFullPageCapture');
  doc.setCreationDate(meta.created);
  doc.setModificationDate(meta.created);
  const ctx = doc.context;

  // Shared invisible-text font.
  const ttf = buildGlyphlessFont();
  const fontFile = ctx.register(ctx.flateStream(ttf, { Length1: ttf.length }));
  const descriptor = ctx.register(
    ctx.obj({
      Type: 'FontDescriptor',
      FontName: 'GlyphLessFont',
      Flags: 5,
      FontBBox: [0, 0, GLYPH_ADVANCE, 1000],
      ItalicAngle: 0,
      Ascent: 1000,
      // CoreGraphics (macOS Preview) rejects a zero descent; -1 as in Tesseract's PDFs.
      Descent: -1,
      CapHeight: 1000,
      StemV: 80,
      FontFile2: fontFile,
    }),
  );
  const gidMap = new Uint8Array(65536 * 2);
  for (let i = 1; i < gidMap.length; i += 2) gidMap[i] = 1;
  const cidToGid = ctx.register(ctx.flateStream(gidMap));
  const cidFont = ctx.register(
    ctx.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: 'GlyphLessFont',
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: descriptor,
      DW: GLYPH_ADVANCE,
      CIDToGIDMap: cidToGid,
    }),
  );
  const toUnicode = ctx.register(ctx.flateStream(identityToUnicodeCMap()));
  const font: PDFRef = ctx.register(
    ctx.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'GlyphLessFont',
      Encoding: 'Identity-H',
      DescendantFonts: [cidFont],
      ToUnicode: toUnicode,
    }),
  );

  // Visible footer font (one of the PDF standard 14, so nothing is embedded or fetched).
  const helvetica = pages.some((p) => p.footer) ? await doc.embedFont(StandardFonts.Helvetica) : null;

  for (const p of pages) {
    const page = doc.addPage([p.widthPt, p.heightPt]);
    const img = p.image;
    const imgDict =
      img.kind === 'flate-rgb'
        ? {
            Type: 'XObject',
            Subtype: 'Image',
            Width: img.width,
            Height: img.height,
            ColorSpace: 'DeviceRGB',
            BitsPerComponent: 8,
            Filter: 'FlateDecode',
            DecodeParms: { Predictor: 15, Colors: 3, BitsPerComponent: 8, Columns: img.width },
          }
        : {
            Type: 'XObject',
            Subtype: 'Image',
            Width: img.width,
            Height: img.height,
            ColorSpace: 'DeviceRGB',
            BitsPerComponent: 8,
            Filter: 'DCTDecode',
          };
    const imgRef = ctx.register(ctx.stream(img.data, imgDict));
    page.node.setXObject(PDFName.of('Im0'), imgRef);
    page.node.setFontDictionary(PDFName.of('F0'), font);
    const { x, y, w, h } = p.box;
    let content = `q\n${n(w)} 0 0 ${n(h)} ${n(x)} ${n(y)} cm\n/Im0 Do\nQ\n${textLayerOps(p.words, img.width, p.box)}\n`;
    if (p.footer && helvetica) {
      page.node.setFontDictionary(PDFName.of('F1'), helvetica.ref);
      content += `${footerOps(helvetica, p.footer, p)}\n`;
    }
    page.node.addContentStream(ctx.register(ctx.flateStream(content)));
  }
  return doc.save({ useObjectStreams: false });
}
