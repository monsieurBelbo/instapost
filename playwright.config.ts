/**
 * Playwright E2E (strategy §7.9). Fixtures (tests/e2e/fixtures.ts) launch every browser with
 * sealedPlaywrightArgs() after assertSealed(); globalSetup (tests/e2e/global-setup.ts) aborts
 * the run unless the certificate, both artifacts and the seal precheck pass.
 */
import { defineConfig } from '@playwright/test';
import { cftExecutable } from './tools/chrome/versions.ts';

/** Custom per-project options read by tests/e2e/fixtures.ts. */
export interface InstapostE2eOptions {
  /** Unpacked extension directory under .output/. */
  artifact: string;
  /** CfT binary for the @smoke projects; undefined = Playwright's bundled Chromium. */
  executablePath: string | undefined;
}

export default defineConfig<InstapostE2eOptions>({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  globalSetup: './tests/e2e/global-setup.ts',
  // Spike S8 (docs/contract.md): headless is the default. Headed and headless behaved identically
  // in S3-S8 on CfT 155 and Chromium 156 once the headless screen is emulated, so fixtures must
  // launch with `headless` from this option and `sealedPlaywrightArgs(spki, dir, { headless })`,
  // plus `viewport: null` (a Playwright viewport overrides popup sizes: 1280x720, landscape).
  // Run headed with `--headed` (pnpm exec playwright test --headed) when watching a flow.
  use: { headless: true },
  webServer: {
    command: 'node tools/fake-ig/server.ts',
    url: 'https://127.0.0.1:8443/__fake__/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'mock', use: { artifact: '.output/chrome-mv3-mock' } },
    { name: 'live', use: { artifact: '.output/chrome-mv3-live' } },
    {
      name: 'cft155-mock',
      grep: /@smoke/,
      use: { artifact: '.output/chrome-mv3-mock', executablePath: cftExecutable() },
    },
    {
      name: 'cft155-live',
      grep: /@smoke/,
      use: { artifact: '.output/chrome-mv3-live', executablePath: cftExecutable() },
    },
  ],
});
