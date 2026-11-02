import { defineConfig } from '@playwright/test';

export const FIXTURE_PORT = 4517;
export const PROXY_PORT = 4518;

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  globalSetup: './test/e2e/global-setup.ts',
  webServer: {
    command: 'node test/server.mjs',
    url: `http://127.0.0.1:${FIXTURE_PORT}/index.html`,
    reuseExistingServer: false,
    env: { FIXTURE_PORT: String(FIXTURE_PORT), PROXY_PORT: String(PROXY_PORT) },
  },
});
