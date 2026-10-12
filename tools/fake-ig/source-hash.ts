/**
 * A fingerprint of everything the running fake is built from (§11 AM26, FID-7): its own sources
 * (server, core, client, service workers) and the src/core contract files it imports. The server
 * computes it once at start and reports it on /__fake__/health; the E2E global setup recomputes it
 * from the working tree and refuses to run against a fake started before the sources changed
 * (`reuseExistingServer` would otherwise test a stale fake, e.g. the one `pnpm run dev` keeps).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Directories (and files) the fake is built from, relative to the repo root. */
export const FAKE_SOURCES: readonly string[] = ['tools/fake-ig', 'src/core/ig-contract', 'tools/chrome/flags.ts'];

const SOURCE_FILE = /\.(ts|tsx|js|json)$/;
const isSource = (rel: string): boolean => SOURCE_FILE.test(rel) && !/\.test\.tsx?$/.test(rel);

function files(root: string, rel: string): string[] {
  const full = resolve(root, rel);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return isSource(rel) ? [rel] : [];
  return readdirSync(full)
    .sort()
    .flatMap((name) => files(root, join(rel, name)));
}

/** SHA-256 (hex) over the sorted source files' repo-relative paths and contents. */
export function fakeSourceHash(root: string = ROOT): string {
  const hash = createHash('sha256');
  const all = FAKE_SOURCES.flatMap((s) => files(root, s))
    .map((f) => relative(root, resolve(root, f)).split('\\').join('/'))
    .sort();
  for (const f of all) {
    hash.update(`${f}\0`);
    hash.update(readFileSync(resolve(root, f)));
    hash.update('\0');
  }
  return hash.digest('hex');
}
