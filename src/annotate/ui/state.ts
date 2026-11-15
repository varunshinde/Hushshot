import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { updateCapture } from '../../lib/storage/db';
import type { CaptureRecord } from '../../lib/types';
import { canRedo, canUndo, redo, startHistory, undo, type History } from '../history';
import { MAX_HISTORY } from '../history';
import { emptyDoc, isEmptyDoc, newAnnotationId, renumberSteps, translate, type Annotation, type EditDoc, type Kind, type RedactMode } from '../model';

export type AnnTool = 'select' | Exclude<Kind, never>;

export interface Style {
  color: string;
  /** Stroke width, CSS px (scaled by the capture's quality when drawn). */
  width: number;
  /** Font / marker size, CSS px. */
  size: number;
  opacity: number;
  fill: boolean;
  redact: RedactMode;
  stamp: string;
}

export const DEFAULT_STYLE: Style = { color: '#e5383b', width: 4, size: 20, opacity: 1, fill: false, redact: 'pixelate', stamp: '✅' };

const STYLE_KEY = 'annotateStyle';

export const TOOL_KEYS: Record<string, AnnTool> = {
  v: 'select',
  a: 'arrow',
  l: 'line',
  r: 'rect',
  o: 'ellipse',
  p: 'pen',
  h: 'highlighter',
  t: 'text',
  n: 'step',
  k: 'callout',
  e: 'stamp',
  b: 'redact',
  s: 'spotlight',
};

/**
 * Editor state for one capture: the edit document with undo/redo, the active
 * tool, selection and style. Changes are saved to the capture (debounced), so
 * annotations stay editable after closing the tab.
 */
export function useAnnotations(rec: CaptureRecord | null | undefined) {
  const [hist, setHist] = useState<History<EditDoc> | null>(null);
  const [tool, setTool] = useState<AnnTool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [style, setStyleState] = useState<Style>(DEFAULT_STYLE);
  /** Document before the gesture in progress (drag, typing, slider), for one undo step per gesture. */
  const gesture = useRef<EditDoc | null>(null);
  const histRef = useRef(hist);
  histRef.current = hist;

  useEffect(() => {
    if (rec && !hist) setHist(startHistory(rec.edits ?? emptyDoc()));
  }, [rec?.id, !!rec]);

  useEffect(() => {
    chrome.storage.local.get(STYLE_KEY).then((v) => v[STYLE_KEY] && setStyleState({ ...DEFAULT_STYLE, ...(v[STYLE_KEY] as Partial<Style>) }));
  }, []);

  // Save edits with the capture, a moment after the last change.
  const doc = hist?.present ?? null;
  useEffect(() => {
    if (!rec || !doc) return;
    const t = setTimeout(() => updateCapture(rec.id, (r) => void (r.edits = isEmptyDoc(doc) ? undefined : doc)), 250);
    return () => clearTimeout(t);
  }, [doc]);

  /** Apply a change as its own undo step. */
  const apply = useCallback((fn: (d: EditDoc) => EditDoc) => {
    setHist((h) => {
      if (!h) return h;
      const next = fn(h.present);
      if (next === h.present) return h;
      const before = gesture.current ?? h.present;
      gesture.current = null;
      const past = [...h.past, before];
      if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY);
      return { past, present: next, future: [] };
    });
  }, []);

  /** Change the document while a gesture is in progress, without an undo step yet. */
  const live = useCallback((fn: (d: EditDoc) => EditDoc) => {
    setHist((h) => {
      if (!h) return h;
      gesture.current ??= h.present;
      return { ...h, present: fn(h.present) };
    });
  }, []);

  /** Finish a gesture: one undo step from where it started (none if nothing changed). */
  const end = useCallback(() => {
    setHist((h) => {
      const before = gesture.current;
      gesture.current = null;
      if (!h || !before) return h;
      if (sameDoc(before, h.present)) return { ...h, present: before };
      const past = [...h.past, before];
      if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY);
      return { past, present: h.present, future: [] };
    });
  }, []);

  const setStyle = (patch: Partial<Style>) => {
    setStyleState((s) => {
      const next = { ...s, ...patch };
      chrome.storage.local.set({ [STYLE_KEY]: next });
      return next;
    });
  };

  const update = (id: string, fn: (a: Annotation) => Annotation) => apply((d) => ({ ...d, items: d.items.map((a) => (a.id === id ? fn(a) : a)) }));
  const add = (a: Annotation) => {
    apply((d) => ({ ...d, items: [...d.items, a] }));
    setSelected(a.id);
  };
  const remove = (id: string) => {
    apply((d) => ({ ...d, items: renumberSteps(d.items.filter((a) => a.id !== id)) }));
    if (selected === id) setSelected(null);
    if (editingText === id) setEditingText(null);
  };

  const doUndo = () => {
    gesture.current = null;
    setEditingText(null);
    setHist((h) => (h ? undo(h) : h));
  };
  const doRedo = () => {
    gesture.current = null;
    setEditingText(null);
    setHist((h) => (h ? redo(h) : h));
  };

  /** Keyboard shortcuts while annotating. Returns true when the key was used. */
  const onKey = (e: KeyboardEvent, scale: number): boolean => {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      e.shiftKey ? doRedo() : doUndo();
      return true;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      doRedo();
      return true;
    }
    if (mod && k === 'd' && selected) {
      e.preventDefault();
      const a = doc?.items.find((x) => x.id === selected);
      if (a) add(renumberOne(translate({ ...a, id: newAnnotationId() }, 12 * scale, 12 * scale), doc!));
      return true;
    }
    if (mod || e.altKey) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      remove(selected);
      return true;
    }
    if (e.key.startsWith('Arrow') && selected) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) * scale;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      update(selected, (a) => translate(a, dx, dy));
      return true;
    }
    if (e.key === 'Escape') {
      if (selected) setSelected(null);
      else if (tool !== 'select') setTool('select');
      else return false;
      return true;
    }
    const t = TOOL_KEYS[k];
    if (t && !e.shiftKey) {
      setTool(t);
      if (t !== 'select') setSelected(null);
      return true;
    }
    return false;
  };

  return {
    doc,
    ready: !!hist,
    canUndo: !!hist && canUndo(hist),
    canRedo: !!hist && canRedo(hist),
    undoDepth: hist?.past.length ?? 0,
    tool,
    setTool,
    selected,
    setSelected,
    editingText,
    setEditingText,
    style,
    setStyle,
    apply,
    live,
    end,
    update,
    add,
    remove,
    undo: doUndo,
    redo: doRedo,
    onKey,
  };
}

/** Same content, so a gesture that ended where it started adds no undo step. */
function sameDoc(a: EditDoc, b: EditDoc) {
  return a === b || (a.beautify === b.beautify && a.rotate === b.rotate && a.scale === b.scale && a.items.length === b.items.length && a.items.every((x, i) => x === b.items[i]));
}

function renumberOne(a: Annotation, d: EditDoc): Annotation {
  return a.kind === 'step' ? { ...a, n: d.items.filter((x) => x.kind === 'step').length + 1 } : a;
}

export type Editor = ReturnType<typeof useAnnotations>;
