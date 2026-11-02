/**
 * Tesseract.js paths, all inside the extension package. tesseract.js falls
 * back to jsDelivr for any path left unset, so every one is set explicitly
 * and checked by a unit test.
 */
export function tesseractOptions(getURL: (path: string) => string) {
  return {
    workerPath: getURL('/ocr/worker.min.js'),
    // A .js path is loaded directly (no CDN, no feature-detected variant lookup).
    corePath: getURL('/ocr/core/tesseract-core-simd-lstm.wasm.js'),
    langPath: getURL('/ocr/lang'),
    workerBlobURL: false,
    cacheMethod: 'none',
    gzip: true,
  } as const;
}
