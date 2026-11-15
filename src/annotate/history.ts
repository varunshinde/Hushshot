/**
 * Undo/redo over immutable snapshots. Documents share unchanged annotations
 * between snapshots, so a long history stays cheap.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const MAX_HISTORY = 500;

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > MAX_HISTORY) past.splice(0, past.length - MAX_HISTORY);
  return { past, present: next, future: [] };
}

/** Replace the present without a new undo step (e.g. while a drag is in progress). */
export const replace = <T>(h: History<T>, next: T): History<T> => ({ ...h, present: next });

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;
