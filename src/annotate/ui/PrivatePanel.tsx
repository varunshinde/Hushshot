import { useMemo, useState } from 'preact/hooks';
import type { CaptureRecord, Rect } from '../../lib/types';
import { IconClose } from '../../pages/shared/icons';
import { findSensitive, KIND_LABEL, type Finding } from '../detect';
import { intersects, newAnnotationId } from '../model';
import type { Editor } from './state';

/** Auto-redact suggestions: private details found in the text layer, redacted on request. */
export function PrivatePanel({ rec, editor: ed, onClose, onDone }: { rec: CaptureRecord; editor: Editor; onClose: () => void; onDone: (n: number) => void }) {
  const doc = ed.doc!;
  const findings = useMemo(() => {
    const already = doc.items.filter((a) => a.kind === 'redact').map((a) => (a as { r: Rect }).r);
    return findSensitive(rec.words).filter((f) => !already.some((r) => intersects(r, f.rect) && r.x <= f.rect.x + 1 && r.y <= f.rect.y + 1 && r.x + r.width >= f.rect.x + f.rect.width - 1 && r.y + r.height >= f.rect.y + f.rect.height - 1));
  }, [rec.words, doc.items]);
  const [off, setOff] = useState<Set<number>>(new Set());
  const chosen = findings.filter((_, i) => !off.has(i));
  const redact = () => {
    const mode = ed.style.redact;
    ed.apply((d) => ({
      ...d,
      items: [...d.items, ...chosen.map((f: Finding) => ({ id: newAnnotationId(), kind: 'redact' as const, color: '#000000', width: 1, opacity: 1, r: f.rect, mode }))],
    }));
    onDone(chosen.length);
  };
  return (
    <aside class="panel" aria-label="Find private info">
      <div class="row">
        <h2 class="grow">Find private info</h2>
        <button class="icon-only" onClick={onClose} aria-label="Close">
          <IconClose />
        </button>
      </div>
      {!rec.words.length ? (
        <p class="muted small">This capture has no text to search. Use ⋯ → Read text in images first.</p>
      ) : !findings.length ? (
        <p class="muted small">Nothing found. Checked for email addresses, phone numbers, card numbers and API keys. Check the image yourself before sharing.</p>
      ) : (
        <>
          <p class="muted small">Found on this device. Choose what to hide:</p>
          <ul class="findings">
            {findings.map((f, i) => (
              <li key={i}>
                <label class="inline">
                  <input type="checkbox" checked={!off.has(i)} onChange={() => setOff((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))} />
                  <span>
                    <b>{KIND_LABEL[f.kind]}</b>
                    <code>{f.text.length > 40 ? `${f.text.slice(0, 37)}…` : f.text}</code>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button class="primary big" disabled={!chosen.length} onClick={redact}>
            Redact {chosen.length} item{chosen.length === 1 ? '' : 's'}
          </button>
          <p class="muted small">Uses the redaction style chosen in the toolbar. Text found only in images needs “Read text in images” first.</p>
        </>
      )}
    </aside>
  );
}
