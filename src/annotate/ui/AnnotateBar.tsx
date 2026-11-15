import type { JSX } from 'preact';
import { COLORS, STAMPS, type Annotation, type RedactMode } from '../model';
import type { AnnTool, Editor, Style } from './state';
import {
  IconArrow,
  IconCallout,
  IconEllipse,
  IconHighlighter,
  IconLine,
  IconPen,
  IconPointer,
  IconRect,
  IconRedact,
  IconRedo,
  IconShield,
  IconSpotlight,
  IconStamp,
  IconStep,
  IconTextTool,
  IconTrash,
  IconUndo,
} from './icons';

const TOOLS: { t: AnnTool; label: string; key: string; Icon: (p: { size?: number }) => JSX.Element }[] = [
  { t: 'select', label: 'Select and move', key: 'V', Icon: IconPointer },
  { t: 'arrow', label: 'Arrow', key: 'A', Icon: IconArrow },
  { t: 'line', label: 'Line', key: 'L', Icon: IconLine },
  { t: 'rect', label: 'Rectangle', key: 'R', Icon: IconRect },
  { t: 'ellipse', label: 'Ellipse', key: 'O', Icon: IconEllipse },
  { t: 'pen', label: 'Pen', key: 'P', Icon: IconPen },
  { t: 'highlighter', label: 'Highlighter', key: 'H', Icon: IconHighlighter },
  { t: 'text', label: 'Text', key: 'T', Icon: IconTextTool },
  { t: 'step', label: 'Numbered step', key: 'N', Icon: IconStep },
  { t: 'callout', label: 'Callout', key: 'K', Icon: IconCallout },
  { t: 'stamp', label: 'Stamp', key: 'E', Icon: IconStamp },
  { t: 'redact', label: 'Redact', key: 'B', Icon: IconRedact },
  { t: 'spotlight', label: 'Spotlight', key: 'S', Icon: IconSpotlight },
];

const REDACT_MODES: { m: RedactMode; label: string }[] = [
  { m: 'pixelate', label: 'Pixelate' },
  { m: 'blur', label: 'Blur' },
  { m: 'box', label: 'Black box' },
];

/** Which style controls apply to a tool or a selected annotation. */
function controlsFor(kind: string) {
  return {
    color: kind !== 'redact' && kind !== 'spotlight' && kind !== 'stamp',
    width: ['arrow', 'line', 'rect', 'ellipse', 'pen', 'highlighter'].includes(kind),
    size: ['text', 'step', 'callout', 'stamp'].includes(kind),
    opacity: kind !== 'redact' && kind !== 'spotlight',
    fill: kind === 'rect' || kind === 'ellipse' || kind === 'text',
    redact: kind === 'redact',
    stamp: kind === 'stamp',
  };
}

interface Props {
  editor: Editor;
  /** Capture scale (image px per CSS px). */
  scale: number;
  onFindPrivate: () => void;
}

export function AnnotateBar({ editor: ed, scale, onFindPrivate }: Props) {
  const sel = ed.selected ? ed.doc?.items.find((a) => a.id === ed.selected) : undefined;
  const kind = sel?.kind ?? ed.tool;
  const c = controlsFor(kind);
  const st = ed.style;

  /** Change the style for new annotations and, if one is selected, for it too. */
  const setStyle = (patch: Partial<Style>) => {
    ed.setStyle(patch);
    if (!sel) return;
    ed.update(sel.id, (a): Annotation => {
      const n = { ...a } as Annotation & Record<string, unknown>;
      if (patch.color !== undefined && 'color' in n) n.color = patch.color;
      if (patch.opacity !== undefined) n.opacity = a.kind === 'highlighter' ? Math.min(patch.opacity, 0.45) : patch.opacity;
      if (patch.width !== undefined) n.width = Math.max(1, patch.width * scale * (a.kind === 'highlighter' ? 4 : 1));
      if (patch.size !== undefined && 'size' in n) n.size = patch.size * scale * (a.kind === 'step' ? 1.4 : a.kind === 'stamp' ? 2 : 1);
      if (patch.fill !== undefined && a.kind === 'text') n.bg = patch.fill;
      if (patch.fill !== undefined && (a.kind === 'rect' || a.kind === 'ellipse')) n.fill = patch.fill;
      if (patch.redact !== undefined && a.kind === 'redact') n.mode = patch.redact;
      if (patch.stamp !== undefined && a.kind === 'stamp') n.glyph = patch.stamp;
      return n as Annotation;
    });
  };

  return (
    <div class="ann-bar">
      <div class="ann-row">
        <div class="seg ann-tools" role="radiogroup" aria-label="Annotation tool">
          {TOOLS.map(({ t, label, key, Icon }) => (
            <button
              key={t}
              role="radio"
              aria-checked={ed.tool === t}
              aria-pressed={ed.tool === t}
              aria-label={label}
              title={`${label} (${key})`}
              onClick={() => (ed.setTool(t), t !== 'select' && ed.setSelected(null))}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
        <button class="icon-only" disabled={!ed.canUndo} onClick={ed.undo} aria-label="Undo" title="Undo (⌘Z)">
          <IconUndo />
        </button>
        <button class="icon-only" disabled={!ed.canRedo} onClick={ed.redo} aria-label="Redo" title="Redo (⌘⇧Z)">
          <IconRedo />
        </button>
        <button onClick={onFindPrivate} title="Find email addresses, phone numbers, card numbers and keys to hide">
          <IconShield /> Find private info
        </button>
      </div>
      <div class="ann-row ann-style" aria-label="Style">
        {c.color && (
          <div class="swatches" role="radiogroup" aria-label="Colour">
            {COLORS.map((col) => (
              <button
                key={col}
                role="radio"
                aria-checked={st.color === col}
                aria-label={`Colour ${col}`}
                class={`swatch${st.color === col ? ' on' : ''}`}
                style={{ background: col }}
                onClick={() => setStyle({ color: col })}
              />
            ))}
            <input type="color" aria-label="Custom colour" value={st.color} onChange={(e) => setStyle({ color: e.currentTarget.value })} />
          </div>
        )}
        {c.width && (
          <label class="inline">
            Width
            <input type="range" min={1} max={24} value={st.width} onInput={(e) => ed.setStyle({ width: Number(e.currentTarget.value) })} onChange={(e) => setStyle({ width: Number(e.currentTarget.value) })} />
          </label>
        )}
        {c.size && (
          <label class="inline">
            Size
            <input type="range" min={10} max={96} value={st.size} onInput={(e) => ed.setStyle({ size: Number(e.currentTarget.value) })} onChange={(e) => setStyle({ size: Number(e.currentTarget.value) })} />
          </label>
        )}
        {c.opacity && (
          <label class="inline">
            Opacity
            <input
              type="range"
              min={10}
              max={100}
              value={Math.round(st.opacity * 100)}
              onInput={(e) => ed.setStyle({ opacity: Number(e.currentTarget.value) / 100 })}
              onChange={(e) => setStyle({ opacity: Number(e.currentTarget.value) / 100 })}
            />
          </label>
        )}
        {c.fill && (
          <label class="inline">
            <input type="checkbox" checked={st.fill} onChange={(e) => setStyle({ fill: e.currentTarget.checked })} />
            {kind === 'text' ? 'Background' : 'Filled'}
          </label>
        )}
        {c.redact && (
          <div class="seg" role="radiogroup" aria-label="Redaction style">
            {REDACT_MODES.map(({ m, label }) => (
              <button key={m} role="radio" aria-checked={st.redact === m} aria-pressed={st.redact === m} onClick={() => setStyle({ redact: m })}>
                {label}
              </button>
            ))}
          </div>
        )}
        {c.stamp && (
          <div class="stamps" role="radiogroup" aria-label="Stamp">
            {STAMPS.map((g) => (
              <button key={g} role="radio" aria-checked={st.stamp === g} class={st.stamp === g ? 'on' : ''} onClick={() => setStyle({ stamp: g })}>
                {g}
              </button>
            ))}
          </div>
        )}
        {kind === 'redact' && <span class="muted small">Hidden pixels and text are removed from every download.</span>}
        {kind === 'spotlight' && <span class="muted small">Dims everything outside the boxes you draw.</span>}
        {sel && (
          <button onClick={() => ed.remove(sel.id)} aria-label="Delete annotation" title="Delete (⌫)">
            <IconTrash /> Delete
          </button>
        )}
      </div>
    </div>
  );
}
