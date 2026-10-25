/**
 * Vitest projects (strategy §7.8). Deviation: the browser project launches Chromium with the
 * sealed arguments (tools/chrome/flags.ts) like every other browser in this repo; without a
 * valid fake certificate the project is left out, so `pnpm run test:browser` fails closed.
 * Its pages are served from localhost, which the resolver rules exclude from the seal.
 */
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { assertSealed, readSpki, sealedArgs } from './tools/chrome/flags.ts';

const spki = readSpki();
const browserArgs = spki ? sealedArgs(spki) : null;
if (browserArgs) assertSealed(browserArgs);
else console.warn('[vitest] no valid fake certificate (pnpm run fake:cert): the browser project is disabled');

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [WxtVitest()],
        test: {
          name: 'unit',
          environment: 'node',
          setupFiles: ['tests/setup/unit.ts'],
          include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
          exclude: ['**/*.browser.test.ts'],
        },
      },
      ...(browserArgs
        ? [
            {
              // B6 mounts the fake's React 19 components. Pre-bundle React up front: a dependency
              // discovered mid-run re-optimises and leaves two React copies (null dispatcher). The same for
              // Preact, since B26 (docs/repost.md) mounts the editor's Stage.
              optimizeDeps: {
                include: [
                  'react',
                  'react/jsx-runtime',
                  'react-dom',
                  'react-dom/client',
                  'preact',
                  'preact/hooks',
                  'preact/jsx-runtime',
                  '@preact/signals',
                ],
              },
              test: {
                name: 'browser',
                include: ['src/**/*.browser.test.ts'],
                browser: {
                  enabled: true,
                  provider: playwright({ launchOptions: { args: browserArgs } }),
                  headless: true,
                  instances: [{ browser: 'chromium' as const }],
                },
              },
            },
          ]
        : []),
    ],
  },
});
