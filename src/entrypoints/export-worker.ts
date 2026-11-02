import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startExportWorker } from '../lib/export/export.worker';

// Dedicated Web Worker for PNG/PDF/ZIP encoding, started by the preview page.
export default defineUnlistedScript(() => startExportWorker());
