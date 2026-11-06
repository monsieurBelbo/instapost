/**
 * Playwright config of the site's screenshots (tools/site/capture.spec.ts), kept apart from the E2E suite: the
 * root config's testDir is tests/e2e and Vitest only takes `*.test.ts`, so neither run ever picks this up.
 *
 *   pnpm run build:all
 *   SITE_SHOTS_DIR=/some/folder pnpm exec playwright test -c tools/site/playwright.capture.config.ts
 *
 * Run it from the repo's root (the artifact and the global setup's paths are relative to it). The same sealed
 * fixtures, global setup and fake as the E2E suite; the live artifact, so the composer shows no "Test build" badge.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import type { InstapostE2eOptions } from '../../playwright.config.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig<InstapostE2eOptions>({
  testDir: '.',
  testMatch: /capture\.spec\.ts$/,
  outputDir: '../../test-results/site-capture',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  reporter: 'list',
  globalSetup: '../../tests/e2e/global-setup.ts',
  use: { headless: true, artifact: '.output/chrome-mv3-live', executablePath: undefined, actionTimeout: 15_000 },
  webServer: {
    command: 'node tools/fake-ig/server.ts',
    cwd: ROOT,
    url: 'https://127.0.0.1:8443/__fake__/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
  },
  projects: [{ name: 'capture' }],
});
