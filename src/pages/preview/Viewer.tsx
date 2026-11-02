import { useEffect, useRef, useState } from 'preact/hooks';
import { autoScrollSpeed, dragCrop, HANDLES, isWholeImage, rectFromPoints, type Handle } from '../../lib/geometry/view';
import type { CaptureRecord, Rect, Word } from '../../lib/types';

export type Tool = 'pan' | 'select' | 'crop';

interface Props {
  rec: CaptureRecord;
  urls: string[];
  /** CSS px per image px. */
  zoom: number;
  /** Part of the image on show: the crop once applied, otherwise the whole image. */
  view: Rect;
  tool: Tool;
  /** Crop box while editing a crop (image px), or null. */
  cropBox: Rect | null;
  onCropBox: (r: Rect) => void;
  /** Page breaks, relative to `view`. */
  cuts: number[];
  overlap: number;
  selection: Word[];
  selectRect: Rect | null;
  onCutsChange: (cuts: number[]) => void;
  onSelectRect: (r: Rect | null, final: boolean) => void;
  viewportRef: { current: HTMLDivElement | null };
}

const MIN_SEGMENT = 50;

type Drag =
  | { kind: 'pan'; x0: number; y0: number; sl: number; st: number }
  | { kind: 'select'; ax: number; ay: number }
  | { kind: 'cut'; i: number }
  | { kind: 'crop'; handle: Handle; start: Rect; px: number; py: number }
  | { kind: 'crop-new'; ax: number; ay: number };

/**
 * Pixel-exact viewer. Tiles are shown as positioned <img> crops at explicit
 * sizes (no CSS transforms), with nearest-neighbour sampling at ≥100%, so
 * every image pixel maps to whole device pixels.
 */
export function Viewer(p: Props) {
  const { rec, zoom: z, view } = p;
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [cutDraft, setCutDraft] = useState<{ i: number; y: number } | null>(null);
  const crisp = z * window.devicePixelRatio >= 1;
  const bounds = { width: rec.width, height: rec.height };

  /** Pointer position in image px, kept inside the part on show. */
  const toImage = (cx: number, cy: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(view.x, Math.min(view.x + view.width, (cx - r.left) / z + view.x)),
      y: Math.max(view.y, Math.min(view.y + view.height, (cy - r.top) / z + view.y)),
    };
  };

  // Latest move handler, so the auto-scroll loop always sees current props.
  const move = useRef<(cx: number, cy: number) => void>(() => {});
  move.current = (cx, cy) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const vp = p.viewportRef.current!;
      vp.scrollLeft = d.sl - (cx - d.x0);
      vp.scrollTop = d.st - (cy - d.y0);
      return;
    }
    const pt = toImage(cx, cy);
    if (d.kind === 'cut') {
      const lo = (d.i > 0 ? p.cuts[d.i - 1] : 0) + MIN_SEGMENT;
      const hi = (d.i + 1 < p.cuts.length ? p.cuts[d.i + 1] : view.height) - MIN_SEGMENT;
      setCutDraft({ i: d.i, y: Math.round(Math.max(lo, Math.min(hi, pt.y - view.y))) });
    } else if (d.kind === 'select') {
      const r = rectFromPoints(d.ax, d.ay, pt.x, pt.y, bounds);
      setDraft(r);
      p.onSelectRect(r, false);
    } else if (d.kind === 'crop') {
      p.onCropBox(dragCrop(d.start, d.handle, pt.x - d.px, pt.y - d.py, bounds));
    } else {
      p.onCropBox(rectFromPoints(d.ax, d.ay, pt.x, pt.y, bounds));
    }
  };

  // While dragging near the viewport's edge, scroll it so boxes can grow past what's on screen.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const d = drag.current;
      const vp = p.viewportRef.current;
      if (!d || d.kind === 'pan' || !last.current || !vp) return;
      const r = vp.getBoundingClientRect();
      const sx = autoScrollSpeed(last.current.x, r.left, r.right);
      const sy = autoScrollSpeed(last.current.y, r.top, r.bottom);
      if (!sx && !sy) return;
      const before = [vp.scrollLeft, vp.scrollTop];
      vp.scrollLeft += sx;
      vp.scrollTop += sy;
      if (vp.scrollLeft !== before[0] || vp.scrollTop !== before[1]) move.current(last.current.x, last.current.y);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
    const pt = toImage(e.clientX, e.clientY);
    if (p.tool === 'crop' && p.cropBox) {
      let handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as Handle | undefined;
      // A box covering everything can't move; dragging inside it draws a new one instead.
      if (handle === 'move' && isWholeImage(p.cropBox, bounds)) handle = undefined;
      drag.current = handle ? { kind: 'crop', handle, start: p.cropBox, px: pt.x, py: pt.y } : { kind: 'crop-new', ax: pt.x, ay: pt.y };
      if (!handle) p.onCropBox({ x: pt.x, y: pt.y, width: 0, height: 0 });
      return;
    }
    const cut = target.dataset.cut;
    if (cut !== undefined) {
      drag.current = { kind: 'cut', i: Number(cut) };
      return;
    }
    if (p.tool === 'pan') {
      const vp = p.viewportRef.current!;
      drag.current = { kind: 'pan', x0: e.clientX, y0: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
      return;
    }
    drag.current = { kind: 'select', ax: pt.x, ay: pt.y };
    setDraft({ x: pt.x, y: pt.y, width: 0, height: 0 });
  };

  const onMove = (e: PointerEvent) => {
    if (!drag.current) return;
    last.current = { x: e.clientX, y: e.clientY };
    move.current(e.clientX, e.clientY);
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    last.current = null;
    if (!d) return;
    if (d.kind === 'cut' && cutDraft) {
      const next = [...p.cuts];
      next[cutDraft.i] = cutDraft.y;
      p.onCutsChange(next);
    } else if (d.kind === 'select' && draft) {
      p.onSelectRect(draft.width > 2 && draft.height > 2 ? draft : null, true);
    } else if (d.kind === 'crop-new' && p.cropBox && (p.cropBox.width < 8 || p.cropBox.height < 8)) {
      // A click without a drag: keep a usable box around the click instead of a sliver.
      p.onCropBox(dragCrop({ ...p.cropBox, width: 0, height: 0 }, 'se', 200 / z, 200 / z, bounds));
    }
    setDraft(null);
    setCutDraft(null);
  };

  useEffect(() => {
    if (p.tool !== 'select') setDraft(null);
  }, [p.tool]);

  const L = (x: number) => (x - view.x) * z;
  const T = (y: number) => (y - view.y) * z;
  const cuts = p.cuts.map((c, i) => (cutDraft?.i === i ? cutDraft.y : c));
  const showRect = draft ?? (p.tool === 'select' ? p.selectRect : null);
  const box = p.tool === 'crop' ? p.cropBox : null;
  const visible = rec.placements
    .map((pl, i) => ({ pl, i }))
    .filter(({ pl }) => pl.dx < view.x + view.width && pl.dx + pl.w > view.x && pl.dy < view.y + view.height && pl.dy + pl.h > view.y);

  return (
    <div
      ref={canvasRef}
      class={`canvas tool-${p.tool}${box ? '' : ' clip'}`}
      style={{ width: `${view.width * z}px`, height: `${view.height * z}px` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {visible.map(({ pl, i }) => {
        const t = rec.tiles[pl.tile];
        return (
          <div key={i} class="tile" style={{ left: `${L(pl.dx)}px`, top: `${T(pl.dy)}px`, width: `${pl.w * z}px`, height: `${pl.h * z}px` }}>
            <img
              src={p.urls[pl.tile]}
              alt=""
              draggable={false}
              style={{
                left: `${-pl.sx * z}px`,
                top: `${-pl.sy * z}px`,
                width: `${t.width * z}px`,
                height: `${t.height * z}px`,
                imageRendering: crisp ? 'pixelated' : 'auto',
              }}
            />
          </div>
        );
      })}

      {!box && p.overlap > 0 &&
        cuts.map((c, i) => <div key={`o${i}`} class="overlap" style={{ left: 0, width: '100%', top: `${(c - p.overlap) * z}px`, height: `${p.overlap * z}px` }} />)}
      {!box &&
        cuts.map((c, i) => (
          <div
            key={`c${i}`}
            class="cut"
            data-cut={i}
            role="slider"
            aria-label={`Page break ${i + 1}`}
            aria-valuenow={c}
            tabIndex={0}
            style={{ left: 0, width: '100%', top: `${c * z - 6}px` }}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
              if (!d) return;
              e.preventDefault();
              const next = [...p.cuts];
              next[i] = c + d * (e.shiftKey ? 10 : 1);
              p.onCutsChange(next);
            }}
          >
            <span data-cut={i}>
              {i + 1} | {i + 2}
            </span>
          </div>
        ))}

      {p.selection.map((w, i) => (
        <div key={`w${i}`} class="hit" style={{ left: `${L(w.x)}px`, top: `${T(w.y)}px`, width: `${w.w * z}px`, height: `${w.h * z}px` }} />
      ))}
      {showRect && <div class="rect select" style={{ left: `${L(showRect.x)}px`, top: `${T(showRect.y)}px`, width: `${showRect.width * z}px`, height: `${showRect.height * z}px` }} />}

      {box && (
        <div
          class="crop-box"
          data-handle="move"
          aria-label="Crop area"
          style={{ left: `${L(box.x)}px`, top: `${T(box.y)}px`, width: `${box.width * z}px`, height: `${box.height * z}px` }}
        >
          <span class="crop-size">
            {Math.round(box.width).toLocaleString()} × {Math.round(box.height).toLocaleString()}
          </span>
          {HANDLES.map((h) => (
            <i key={h} class={`handle h-${h}`} data-handle={h} />
          ))}
        </div>
      )}
    </div>
  );
}
