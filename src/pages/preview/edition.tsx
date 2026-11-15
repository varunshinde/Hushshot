import type { JSX } from 'preact';
import type { Editor } from '../../annotate/ui/state';
import type { TileSource } from '../../lib/image/render';
import type { Settings } from '../../lib/settings';
import type { CaptureRecord, Rect } from '../../lib/types';

/** What the result page shares with edition-specific tools. */
export interface EditionCtx {
  rec: CaptureRecord;
  area: Rect;
  tiles: TileSource | null;
  editor: Editor;
  settings: Settings;
  panel: string | null;
  setPanel: (p: string | null) => void;
  closeMenu: () => void;
  guard: (label: string, fn: (progress: (p: number) => void) => Promise<void>) => Promise<void>;
  flash: (text: string, kind?: 'err') => void;
}

type Slot = (c: EditionCtx) => JSX.Element | null;

/**
 * Extra result-page tools for this edition. The free edition adds nothing;
 * Hushshot Pro fills these slots with its own toolbar buttons, menu items and panels.
 */
export function useEdition(): { toolbar: Slot; menu: Slot; panel: Slot; overlay: Slot } {
  const none: Slot = () => null;
  return { toolbar: none, menu: none, panel: none, overlay: none };
}
