import { useEffect, useRef, useState } from 'preact/hooks';
import type { CaptureRecord, Rect, Word } from '../../lib/types';

export type Tool = 'pan' | 'select' | 'crop';

interface Props {
  rec: CaptureRecord;
  urls: string[];
  /** CSS px per image px. */
  zoom: number;
  tool: Tool;
  /** Export area (crop or full image) and its cut rows (relative to the area). */
  area: Rect;
  cuts: number[];
  overlap: number;
  selection: Word[];
  selectRect: Rect | null;
  onCutsChange: (cuts: number[]) => void;
  onSelectRect: (r: Rect | null, final: boolean) => void;
  onCrop: (r: Rect) => void;
  viewportRef: { current: HTMLDivElement | null };
}

const MIN_SEGMENT = 50;

/**
 * Pixel-exact viewer. Tiles are shown as positioned <img> crops at explicit
 * sizes (no CSS transforms), with nearest-neighbour sampling at ≥100%, so
 * every image pixel maps to whole device pixels.
 */
export function Viewer(p: Props) {
  const { rec, zoom: z } = p;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ kind: 'rect' | 'pan' | 'cut'; x0: number; y0: number; sl?: number; st?: number; cut?: number } | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [cutDraft, setCutDraft] = useState<{ i: number; y: number } | null>(null);
  const crisp = z * window.devicePixelRatio >= 1;

  const toImage = (e: PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rec.width, (e.clientX - r.left) / z)),
      y: Math.max(0, Math.min(rec.height, (e.clientY - r.top) / z)),
    };
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const cutIndex = target.dataset.cut;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (cutIndex !== undefined) {
      setDrag({ kind: 'cut', x0: 0, y0: 0, cut: Number(cutIndex) });
      return;
    }
    if (p.tool === 'pan') {
      const vp = p.viewportRef.current!;
      setDrag({ kind: 'pan', x0: e.clientX, y0: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop });
      return;
    }
    const pt = toImage(e);
    setDrag({ kind: 'rect', x0: pt.x, y0: pt.y });
    setDraft({ x: pt.x, y: pt.y, width: 0, height: 0 });
  };

  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const vp = p.viewportRef.current!;
      vp.scrollLeft = drag.sl! - (e.clientX - drag.x0);
      vp.scrollTop = drag.st! - (e.clientY - drag.y0);
      return;
    }
    const pt = toImage(e);
    if (drag.kind === 'cut') {
      const i = drag.cut!;
      const lo = (i > 0 ? p.cuts[i - 1] : 0) + MIN_SEGMENT;
      const hi = (i + 1 < p.cuts.length ? p.cuts[i + 1] : p.area.height) - MIN_SEGMENT;
      setCutDraft({ i, y: Math.round(Math.max(lo, Math.min(hi, pt.y - p.area.y))) });
      return;
    }
    const r = { x: Math.min(drag.x0, pt.x), y: Math.min(drag.y0, pt.y), width: Math.abs(pt.x - drag.x0), height: Math.abs(pt.y - drag.y0) };
    setDraft(r);
    if (p.tool === 'select') p.onSelectRect(r, false);
  };

  const onUp = () => {
    if (!drag) return;
    if (drag.kind === 'cut' && cutDraft) {
      const next = [...p.cuts];
      next[cutDraft.i] = cutDraft.y;
      p.onCutsChange(next);
    } else if (drag.kind === 'rect' && draft) {
      if (p.tool === 'select') p.onSelectRect(draft.width > 2 && draft.height > 2 ? draft : null, true);
      if (p.tool === 'crop' && draft.width >= 8 && draft.height >= 8) {
        p.onCrop({ x: Math.round(draft.x), y: Math.round(draft.y), width: Math.round(draft.width), height: Math.round(draft.height) });
      }
    }
    setDrag(null);
    setDraft(null);
    setCutDraft(null);
  };

  useEffect(() => {
    if (p.tool !== 'select') setDraft(null);
  }, [p.tool]);

  const a = p.area;
  const cuts = p.cuts.map((c, i) => (cutDraft?.i === i ? cutDraft.y : c));
  const showRect = draft ?? (p.tool === 'select' ? p.selectRect : null);

  return (
    <div
      ref={canvasRef}
      class={`canvas tool-${p.tool}`}
      style={{ width: `${rec.width * z}px`, height: `${rec.height * z}px` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {rec.placements.map((pl, i) => {
        const t = rec.tiles[pl.tile];
        return (
          <div key={i} class="tile" style={{ left: `${pl.dx * z}px`, top: `${pl.dy * z}px`, width: `${pl.w * z}px`, height: `${pl.h * z}px` }}>
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

      {rec.crop && (
        <>
          <div class="dim" style={{ left: 0, top: 0, width: '100%', height: `${a.y * z}px` }} />
          <div class="dim" style={{ left: 0, top: `${(a.y + a.height) * z}px`, width: '100%', bottom: 0 }} />
          <div class="dim" style={{ left: 0, top: `${a.y * z}px`, width: `${a.x * z}px`, height: `${a.height * z}px` }} />
          <div class="dim" style={{ left: `${(a.x + a.width) * z}px`, top: `${a.y * z}px`, right: 0, height: `${a.height * z}px` }} />
        </>
      )}

      {p.overlap > 0 &&
        cuts.map((c, i) => (
          <div key={`o${i}`} class="overlap" style={{ left: `${a.x * z}px`, width: `${a.width * z}px`, top: `${(a.y + c - p.overlap) * z}px`, height: `${p.overlap * z}px` }} />
        ))}
      {cuts.map((c, i) => (
        <div
          key={`c${i}`}
          class="cut"
          data-cut={i}
          role="slider"
          aria-label={`Split line ${i + 1}`}
          aria-valuenow={c}
          tabIndex={0}
          style={{ left: `${a.x * z}px`, width: `${a.width * z}px`, top: `${(a.y + c) * z - 6}px` }}
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
        <div key={`w${i}`} class="hit" style={{ left: `${w.x * z}px`, top: `${w.y * z}px`, width: `${w.w * z}px`, height: `${w.h * z}px` }} />
      ))}
      {showRect && (
        <div
          class={`rect ${p.tool}`}
          style={{ left: `${showRect.x * z}px`, top: `${showRect.y * z}px`, width: `${showRect.width * z}px`, height: `${showRect.height * z}px` }}
        />
      )}
    </div>
  );
}
