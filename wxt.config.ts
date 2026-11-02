import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { OPTIONAL_PERMISSIONS, PERMISSIONS } from './src/lib/manifest-permissions';

/**
 * E2E builds (`wxt build --mode e2e`) differ from production only in the
 * manifest: Playwright cannot press extension shortcuts or click the toolbar
 * icon, so activeTab is never granted. The test build therefore adds
 * `<all_urls>` (fixtures are served from 127.0.0.1 only). Permissions are
 * otherwise identical; see PERMISSIONS.md.
 */
export default defineConfig({
  srcDir: 'src',
  outDir: 'dist',
  imports: false,
  vite: () => ({
    plugins: [preact()],
    build: { target: 'chrome120', sourcemap: false },
    worker: { format: 'es' },
  }),
  manifest: ({ mode }) => {
    const e2e = mode === 'e2e';
    return {
      name: e2e ? 'LocalFullPageCapture (E2E)' : 'LocalFullPageCapture',
      description: 'Private, offline screenshots with searchable PDF export and on-device OCR. No network, no telemetry.',
      minimum_chrome_version: '120',
      permissions: PERMISSIONS,
      ...(OPTIONAL_PERMISSIONS.length ? { optional_permissions: OPTIONAL_PERMISSIONS } : {}),
      // captureVisibleTab needs activeTab or <all_urls>; tests can't grant activeTab.
      host_permissions: e2e ? ['<all_urls>'] : [],
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      },
      icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
      action: {
        default_title: 'LocalFullPageCapture',
        default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png' },
      },
      commands: {
        'capture-visible': { suggested_key: { default: 'Alt+Shift+S' }, description: 'Capture visible area' },
        'capture-full': { suggested_key: { default: 'Alt+Shift+F' }, description: 'Capture full page' },
        'capture-region': { suggested_key: { default: 'Alt+Shift+R' }, description: 'Capture a region' },
        'capture-element': { suggested_key: { default: 'Alt+Shift+E' }, description: 'Capture an element' },
      },
    };
  },
  hooks: {
    // Bundle the OCR engine, worker and language data so nothing is fetched at runtime.
    'build:publicAssets': (_wxt, files) => {
      const nm = resolve(import.meta.dirname, 'node_modules');
      files.push(
        { absoluteSrc: resolve(nm, 'tesseract.js/dist/worker.min.js'), relativeDest: 'ocr/worker.min.js' },
        { absoluteSrc: resolve(nm, 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), relativeDest: 'ocr/core/tesseract-core-simd-lstm.wasm.js' },
        { absoluteSrc: resolve(nm, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), relativeDest: 'ocr/lang/eng.traineddata.gz' },
      );
    },
  },
});
