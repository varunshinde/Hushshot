import type { ExportJob } from './export.worker';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();

function get(): Worker {
  if (!worker) {
    // Built as its own bundle (src/entrypoints/export-worker.ts) and loaded from the extension package.
    worker = new Worker(chrome.runtime.getURL('/export-worker.js'));
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Export worker failed'));
      pending.clear();
      worker = null;
    };
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; bytes?: Uint8Array; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.bytes!);
      else p.reject(new Error(e.data.error));
    };
  }
  return worker;
}

export function runExportJob(job: ExportJob, transfer: Transferable[] = []): Promise<Uint8Array> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    get().postMessage({ id, job }, transfer);
  });
}
