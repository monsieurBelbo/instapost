/**
 * In-memory esbuild bundle of the fake's React client (strategy §6.2, §7.6): Node's type
 * stripping runs the server's .ts files but not TSX, so the client is bundled at server start
 * (`jsx: 'automatic'`, `format: 'esm'`, React production build).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { CoreAssets } from './core.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');

export const CLIENT_ENTRY = resolve(HERE, 'client/main.tsx');
export const SW_FILES = {
  claimOnRegister: resolve(HERE, 'sw/claim-on-register.js'),
  desktopShell: resolve(HERE, 'sw/desktop-shell.js'),
  claimLate: resolve(HERE, 'sw/claim-late.js'),
} as const;

export async function bundleClient(): Promise<string> {
  const result = await build({
    entryPoints: [CLIENT_ENTRY],
    absWorkingDir: ROOT,
    tsconfig: resolve(HERE, 'client/tsconfig.json'),
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    jsxImportSource: 'react',
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
    logLevel: 'silent',
  });
  const out = result.outputFiles[0];
  if (!out) throw new Error('fake-ig: esbuild produced no output');
  return out.text;
}

/** The client bundle plus the three service-worker scripts, as core.ts serves them. */
export async function loadAssets(): Promise<CoreAssets> {
  return {
    clientJs: await bundleClient(),
    sw: {
      claimOnRegister: readFileSync(SW_FILES.claimOnRegister, 'utf8'),
      desktopShell: readFileSync(SW_FILES.desktopShell, 'utf8'),
      claimLate: readFileSync(SW_FILES.claimLate, 'utf8'),
    },
  };
}
