/**
 * Shared by arc:use and package: resolving a built extension folder, refusing anything that must not
 * leave the sealed environment, and syncing a build into a folder this tooling owns.
 *
 * Only builds signed with keys/live.pub.b64 are accepted (guarded dev/mock builds never go into a real
 * browser, strategy §5 SG2), so the extension ID, and the data stored under it, stay the same everywhere.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { keyPath } from '../../tools/chrome/ext-id.ts';

export const REPO = resolve(import.meta.dirname, '..', '..');

/** Named builds; anything else is taken as a folder path. */
export const SOURCES: Record<string, string> = {
  live: '.output/chrome-mv3-live',
  inpage: '.spikes/inpage-build/chrome-mv3-live-spike',
  spike: '.spikes/inpage-build/chrome-mv3-live-spike',
};

export interface Manifest {
  name?: string;
  version?: string;
  version_name?: string;
  key?: string;
}

export function fail(tool: string, message: string): never {
  console.error(`${tool}: ${message}`);
  process.exit(1);
}

export function resolveSource(which: string): string {
  const rel = SOURCES[which];
  return rel ? join(REPO, rel) : resolve(which);
}

/** Reads the build's manifest and refuses guarded or foreign-key builds. */
export function readShareable(tool: string, source: string, hint = ''): Manifest {
  const manifestPath = join(source, 'manifest.json');
  if (!existsSync(manifestPath)) fail(tool, `${source} has no manifest.json${hint}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const liveKey = readFileSync(keyPath('live'), 'utf8').trim();
  if (manifest.key !== liveKey) fail(tool, `${manifest.name ?? source} is not signed with the live key; refusing`);
  if (/\b(DEV|MOCK)\b/.test(manifest.name ?? '')) fail(tool, `${manifest.name} is a guarded build; refusing`);
  return manifest;
}

/**
 * Replaces `target`'s contents with `source` (Chrome's own `_metadata` is skipped) and leaves a marker.
 * `target` is only ever wiped when it is empty or already carries `marker`.
 */
export function syncInto(tool: string, source: string, target: string, marker: string, info: object): void {
  if (existsSync(target)) {
    const entries = readdirSync(target).filter((e) => e !== '.DS_Store');
    if (entries.length > 0 && !entries.includes(marker)) {
      fail(tool, `${target} is not empty and was not created by ${tool}; pick another folder`);
    }
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, filter: (path) => !path.includes('/_metadata') });
  writeFileSync(join(target, marker), `${JSON.stringify({ source, ...info }, null, 2)}\n`);
}
