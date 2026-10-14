/**
 * Puts a live-key build into one stable folder that Arc loads unpacked, so switching builds
 * never needs Remove + Load unpacked: load the folder once, then click ↻ after each switch.
 *
 *   pnpm run arc:use live [--build] [--no-open]   .output/chrome-mv3-live
 *   pnpm run arc:use spike [--no-open]            .spikes/inpage-build/chrome-mv3-live-spike
 *   pnpm run arc:use <dir> [--no-open]            any built extension folder
 *
 * Only builds signed with keys/live.pub.b64 are accepted (guarded dev/mock builds never go into
 * a real browser, strategy §5 SG2), so the extension ID and its stored data stay the same across
 * switches and two builds can never be loaded side by side. The target folder (INSTAPOST_ARC_DIR,
 * default .arc/ in the repo, gitignored) is only ever wiped when it is empty or carries this script's marker.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extIdForMode, keyPath } from '../tools/chrome/ext-id.ts';

const MARKER = '.instapost-arc.json';
const SOURCES: Record<string, string> = {
  live: '.output/chrome-mv3-live',
  spike: '.spikes/inpage-build/chrome-mv3-live-spike',
};

interface Manifest {
  name?: string;
  version?: string;
  key?: string;
}

function fail(message: string): never {
  console.error(`arc:use: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith('--'));
if (!which) fail('usage: pnpm run arc:use <live|spike|dir> [--build] [--no-open]');
const build = args.includes('--build');
const open = !args.includes('--no-open');

if (build) {
  if (which !== 'live') fail('--build only applies to "live"');
  execFileSync('pnpm', ['run', 'build:live'], { stdio: 'inherit' });
}

const source = resolve(SOURCES[which] ?? which);
const manifestPath = join(source, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail(`${source} has no manifest.json${which === 'live' ? ' (run with --build, or pnpm run build:live)' : ''}`);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
const liveKey = readFileSync(keyPath('live'), 'utf8').trim();
if (manifest.key !== liveKey)
  fail(`${manifest.name ?? source} is not signed with the live key; refusing to put it in Arc`);
if (/\b(DEV|MOCK)\b/.test(manifest.name ?? '')) fail(`${manifest.name} is a guarded build; refusing to put it in Arc`);

const target = resolve(process.env.INSTAPOST_ARC_DIR ?? join(import.meta.dirname, '..', '.arc'));
if (existsSync(target)) {
  const entries = readdirSync(target);
  if (entries.length > 0 && !entries.includes(MARKER)) {
    fail(`${target} is not empty and was not created by arc:use; pick another folder with INSTAPOST_ARC_DIR`);
  }
  rmSync(target, { recursive: true, force: true });
}
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true, filter: (path) => !path.includes('/_metadata') });
writeFileSync(
  join(target, MARKER),
  `${JSON.stringify({ source, name: manifest.name, version: manifest.version, copiedAt: new Date().toISOString() }, null, 2)}\n`,
);

console.log(`arc:use: "${manifest.name}" ${manifest.version ?? ''} -> ${target}`);
console.log(`         extension id ${extIdForMode('live')}`);
console.log('First time: arc://extensions -> Developer mode -> Load unpacked -> pick that folder.');
console.log('After that: click the reload icon (↻) on instapost in arc://extensions.');

if (open) {
  try {
    execFileSync('osascript', [
      '-e',
      'tell application "Arc" to activate',
      '-e',
      'tell application "Arc" to tell front window to make new tab with properties {URL:"arc://extensions"}',
    ]);
  } catch {
    console.log('(Could not open arc://extensions automatically; open it by hand.)');
  }
}
