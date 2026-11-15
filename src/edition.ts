import { renderEdited } from './annotate/apply';
import type { TileSource } from './lib/image/render';
import type { CaptureRecord, Rect } from './lib/types';

/**
 * Edition hooks for exporting. This is the free edition: annotations and
 * redactions are drawn into every export, and there are no composed images
 * (backgrounds, rotation and resizing are part of Hushshot Pro).
 */

/** Whether image exports become one composed picture instead of parts. */
export const composes = (_rec: CaptureRecord): boolean => false;

/** The single image used for "Copy image". */
export const renderComposed = (tiles: TileSource, rec: CaptureRecord, area: Rect): Promise<OffscreenCanvas> => renderEdited(tiles, rec, area);

/** Whether a composed image fits on the clipboard; null when the export isn't composed. */
export const composedFits = (_rec: CaptureRecord, _area: Rect): boolean | null => null;
