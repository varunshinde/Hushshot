/**
 * A tiny TrueType font for the PDF's invisible text layer, similar in spirit
 * to Tesseract's "GlyphLessFont": every character id maps to one glyph with a
 * fixed 500-unit advance. The text is drawn with render mode 3 (invisible), so
 * glyph shapes don't matter. Combined with an identity ToUnicode CMap this
 * gives selectable, searchable text in any script without embedding a real font.
 */

const UNITS_PER_EM = 1000;
export const GLYPH_ADVANCE = 500;

class Writer {
  private bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 0xff); return this; }
  u16(v: number) { return this.u8(v >> 8).u8(v); }
  i16(v: number) { return this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v: number) { return this.u16(v >>> 16).u16(v & 0xffff); }
  tag(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  zeros(n: number) { for (let i = 0; i < n; i++) this.u8(0); return this; }
  raw(b: ArrayLike<number>) { for (let i = 0; i < b.length; i++) this.u8(b[i]); return this; }
  get length() { return this.bytes.length; }
  done() { return Uint8Array.from(this.bytes); }
}

function checksum(b: Uint8Array): number {
  let sum = 0;
  const padded = new Uint8Array(Math.ceil(b.length / 4) * 4);
  padded.set(b);
  const dv = new DataView(padded.buffer);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
  return sum;
}

function nameTable(): Uint8Array {
  const names: [number, string][] = [
    [1, 'GlyphLessFont'],
    [2, 'Regular'],
    [3, 'LocalCapture:GlyphLessFont'],
    [4, 'GlyphLessFont'],
    [5, 'Version 1.0'],
    [6, 'GlyphLessFont'],
  ];
  const strings = names.map(([, s]) => {
    const w = new Writer();
    for (const ch of s) w.u16(ch.charCodeAt(0));
    return w.done();
  });
  const w = new Writer();
  w.u16(0).u16(names.length).u16(6 + names.length * 12);
  let off = 0;
  names.forEach(([id], i) => {
    w.u16(3).u16(1).u16(0x409).u16(id).u16(strings[i].length).u16(off);
    off += strings[i].length;
  });
  strings.forEach((s) => w.raw(s));
  return w.done();
}

export function buildGlyphlessFont(): Uint8Array {
  const head = new Writer()
    .u32(0x00010000).u32(0x00010000).u32(0) // version, revision, checkSumAdjustment (patched below)
    .u32(0x5f0f3cf5).u16(0x000b).u16(UNITS_PER_EM)
    .zeros(16) // created, modified
    .i16(0).i16(0).i16(GLYPH_ADVANCE).i16(UNITS_PER_EM)
    .u16(0).u16(3).i16(2).i16(0).i16(0) // macStyle, lowestRecPPEM, direction, short loca, glyphDataFormat
    .done();
  const hhea = new Writer()
    .u32(0x00010000).i16(UNITS_PER_EM).i16(-1).i16(0)
    .u16(GLYPH_ADVANCE).i16(0).i16(0).i16(GLYPH_ADVANCE)
    .i16(1).i16(0).i16(0).zeros(8).i16(0).u16(2)
    .done();
  const maxp = new Writer()
    .u32(0x00010000).u16(2).u16(4).u16(1).u16(0).u16(0).u16(2)
    .zeros(16)
    .done();
  const hmtx = new Writer().u16(GLYPH_ADVANCE).i16(0).u16(GLYPH_ADVANCE).i16(0).done();
  // Glyph 0: empty .notdef. Glyph 1: a rectangle filling the advance box.
  const glyph1 = new Writer()
    .i16(1).i16(0).i16(0).i16(GLYPH_ADVANCE).i16(UNITS_PER_EM)
    .u16(3).u16(0)
    .u8(1).u8(1).u8(1).u8(1)
    .i16(0).i16(GLYPH_ADVANCE).i16(0).i16(-GLYPH_ADVANCE)
    .i16(0).i16(0).i16(UNITS_PER_EM).i16(0);
  while (glyph1.length % 4) glyph1.u8(0);
  const glyf = glyph1.done();
  const loca = new Writer().u16(0).u16(0).u16(glyf.length / 2).done();
  const cmap = new Writer()
    .u16(0).u16(1).u16(3).u16(1).u32(12)
    .u16(4).u16(24).u16(0).u16(2).u16(2).u16(0).u16(0)
    .u16(0xffff).u16(0).u16(0xffff).i16(1).u16(0)
    .done();
  const post = new Writer().u32(0x00030000).u32(0).i16(0).i16(0).u32(1).zeros(16).done();
  const os2 = new Writer()
    .u16(3).i16(GLYPH_ADVANCE).u16(400).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(50).i16(250)
    .i16(0).zeros(10).zeros(16).tag('NONE').u16(0x40).u16(0).u16(0xffff)
    .i16(UNITS_PER_EM).i16(-1).i16(0).u16(UNITS_PER_EM).u16(1)
    .u32(1).u32(0).i16(GLYPH_ADVANCE).i16(UNITS_PER_EM).u16(0).u16(32).u16(0)
    .done();

  const tables: [string, Uint8Array][] = (
    [
      ['OS/2', os2], ['cmap', cmap], ['glyf', glyf], ['head', head], ['hhea', hhea],
      ['hmtx', hmtx], ['loca', loca], ['maxp', maxp], ['name', nameTable()], ['post', post],
    ] as [string, Uint8Array][]
  ).sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const n = tables.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  const dir = new Writer().u32(0x00010000).u16(n).u16(searchRange).u16(entrySelector).u16(n * 16 - searchRange);
  let offset = 12 + n * 16;
  const body = new Writer();
  for (const [tag, data] of tables) {
    dir.tag(tag).u32(checksum(data)).u32(offset).u32(data.length);
    body.raw(data);
    let len = data.length;
    while (len % 4) { body.u8(0); len++; }
    offset += len;
  }
  const font = new Uint8Array(dir.length + body.length);
  font.set(dir.done());
  font.set(body.done(), dir.length);
  // head.checkSumAdjustment
  const headOffset = new DataView(font.buffer).getUint32(12 + tables.findIndex(([t]) => t === 'head') * 16 + 8);
  new DataView(font.buffer).setUint32(headOffset + 8, (0xb1b0afba - checksum(font)) >>> 0);
  return font;
}

/** ToUnicode CMap mapping each 2-byte CID to the same UTF-16 code unit. */
export function identityToUnicodeCMap(): string {
  const ranges: string[] = [];
  for (let hi = 0; hi < 256; hi++) {
    if (hi >= 0xd8 && hi <= 0xdf) continue; // surrogates
    const h = hi.toString(16).padStart(2, '0').toUpperCase();
    ranges.push(`<${h}00> <${h}FF> <${h}00>`);
  }
  const chunks: string[] = [];
  for (let i = 0; i < ranges.length; i += 100) {
    const part = ranges.slice(i, i + 100);
    chunks.push(`${part.length} beginbfrange\n${part.join('\n')}\nendbfrange`);
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...chunks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

/** Encode text as 2-byte CIDs (UTF-16 code units; astral characters become U+FFFD). */
export function encodeCids(text: string): string {
  let hex = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const unit = cp > 0xffff || (cp >= 0xd800 && cp <= 0xdfff) ? 0xfffd : cp;
    hex += unit.toString(16).padStart(4, '0').toUpperCase();
  }
  return hex;
}
