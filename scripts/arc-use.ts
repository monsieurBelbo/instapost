/**
 * Puts a live-key build into one stable folder that Arc loads unpacked, so switching builds
 * never needs Remove + Load unpacked: load the folder once, then click ↻ after each switch.
 *
 *   pnpm run arc:use live [--build] [--no-open]   .output/chrome-mv3-live
 *   pnpm run arc:use inpage [--no-open]           .spikes/inpage-build/chrome-mv3-live-spike ("spike" too)
 *   pnpm run arc:use <dir> [--no-open]            any built extension folder
 *
 * The target folder (INSTAPOST_ARC_DIR, default .arc/ in the repo, gitignored) is only ever wiped
 * when it is empty or carries this script's marker.
 */
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { extIdForMode } from '../tools/chrome/ext-id.ts';
import { fail, REPO, readShareable, resolveSource, syncInto } from './lib/extension-build.ts';

const TOOL = 'arc:use';
const args = process.argv.slice(2);
const which = args.find((a) => !a.startsWith('--'));
if (!which) fail(TOOL, 'usage: pnpm run arc:use <live|inpage|dir> [--build] [--no-open]');
const open = !args.includes('--no-open');

if (args.includes('--build')) {
  if (which !== 'live') fail(TOOL, '--build only applies to "live"');
  execFileSync('pnpm', ['run', 'build:live'], { stdio: 'inherit', cwd: REPO });
}

const source = resolveSource(which);
const manifest = readShareable(TOOL, source, which === 'live' ? ' (run with --build, or pnpm run build:live)' : '');
const target = resolve(process.env.INSTAPOST_ARC_DIR ?? join(REPO, '.arc'));
syncInto(TOOL, source, target, '.instapost-arc.json', {
  name: manifest.name,
  version: manifest.version,
  copiedAt: new Date().toISOString(),
});

console.log(`${TOOL}: "${manifest.name}" ${manifest.version ?? ''} -> ${target}`);
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
