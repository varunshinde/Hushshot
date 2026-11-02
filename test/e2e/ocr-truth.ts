/** Ground truth for the OCR fixture image: several fonts and sizes, light and dark backgrounds. */
export const OCR_LINES: { text: string; font: string; size: number; fg: string; bg: string }[] = [
  { text: 'The quick brown fox jumps over the lazy dog 0123456789', font: 'Arial', size: 24, fg: '#111', bg: '#fff' },
  { text: 'Pack my box with five dozen liquor jugs.', font: 'Georgia', size: 20, fg: '#222', bg: '#fff' },
  { text: 'Sphinx of black quartz, judge my vow!', font: '"Courier New", monospace', size: 18, fg: '#e8e8e8', bg: '#1e1e1e' },
  { text: 'How vexingly quick daft zebras jump.', font: 'Verdana', size: 16, fg: '#ffffff', bg: '#0b3d91' },
  { text: 'Invoice 4821 dated 2026-03-14 total $1,250.75', font: '"Times New Roman", serif', size: 22, fg: '#000', bg: '#f3f3e8' },
  { text: 'Bright vixens jump; dozy fowl quack.', font: 'Helvetica', size: 14, fg: '#333', bg: '#fff' },
  { text: 'Five boxing wizards jump quickly at dawn.', font: 'Trebuchet MS', size: 17, fg: '#f5d76e', bg: '#2b2b2b' },
];

export function ocrHtml(): string {
  const rows = OCR_LINES.map(
    (l) => `<div style="font-family:${l.font};font-size:${l.size}px;color:${l.fg};background:${l.bg};padding:10px 16px;">${l.text}</div>`,
  ).join('');
  return `<!doctype html><html><body style="margin:0;background:#fff"><div id="box" style="display:inline-block;width:640px">${rows}</div></body></html>`;
}
