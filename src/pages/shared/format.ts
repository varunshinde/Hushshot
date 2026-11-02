export const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
export const fmtPx = (w: number, h: number) => `${Math.round(w).toLocaleString()} × ${Math.round(h).toLocaleString()} px`;
export const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
