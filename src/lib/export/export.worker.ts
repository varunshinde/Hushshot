/// <reference lib="webworker" />
import { zipSync } from 'fflate';
import { encodePng } from '../image/png';
import { buildPdf, type PdfMeta, type PdfPageInput } from '../pdf/build';
import { flateRgbImage } from '../pdf/image';

/** Heavy encoding (PNG, Flate, PDF, ZIP) off the UI thread. */
export type ExportJob =
  | { op: 'png'; rgba: ArrayBuffer; width: number; height: number; dpi: number }
  | { op: 'flate'; rgba: ArrayBuffer; width: number; height: number }
  | { op: 'pdf'; pages: PdfPageInput[]; meta: PdfMeta }
  | { op: 'zip'; files: Record<string, Uint8Array> };

export function startExportWorker() {
  self.onmessage = async (e: MessageEvent<{ id: number; job: ExportJob }>) => {
  const { id, job } = e.data;
  try {
    let out: Uint8Array;
    switch (job.op) {
      case 'png':
        out = encodePng(new Uint8Array(job.rgba), job.width, job.height, { dpi: job.dpi });
        break;
      case 'flate':
        out = flateRgbImage(new Uint8Array(job.rgba), job.width, job.height).data;
        break;
      case 'pdf':
        out = await buildPdf(job.pages, job.meta);
        break;
      case 'zip':
        out = zipSync(job.files, { level: 0 });
        break;
    }
    (self as unknown as Worker).postMessage({ id, ok: true, bytes: out }, [out.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
}
