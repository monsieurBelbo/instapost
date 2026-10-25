/**
 * Puts a live-key build into one stable folder that any Chromium browser (Arc, Dia, Chrome…) loads unpacked,
 * so switching builds never needs Remove + Load unpacked: load the folder once, then click ↻ after each switch.
 *
 *   pnpm run unpacked live [--build] [--open arc]   .output/chrome-mv3-live (the product; "inpage" too)
 *   pnpm run unpacked <dir> [--open arc]            any built extension folder
 *
 * The target folder (INSTAPOST_UNPACKED_DIR, default .unpacked/ in the repo, gitignored) is only ever wiped
 * when it is empty or carries this script's marker. Several browsers can load the same folder.
 * The copy's manifest gets version_name "<version> (<stamp>)", so the extensions page shows which build is loaded.
 * --open arc opens arc://extensions in Arc; other browsers have no scripting hook, so open their extensions page by hand.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extIdForMode } from '../tools/chrome/ext-id.ts';
import { fail, isLiveSource, REPO, readShareable, resolveSource, syncInto } from './lib/extension-build.ts';

const TOOL = 'unpacked';
const args = process.argv.slice(2);
const openIndex = args.indexOf('--open');
const open = openIndex >= 0 ? args[openIndex + 1] : undefined;
if (openIndex >= 0 && open !== 'arc') fail(TOOL, '--open only supports arc');
const which = args.find((a, i) => !a.startsWith('--') && (openIndex < 0 || i !== openIndex + 1));
if (!which) fail(TOOL, 'usage: pnpm run unpacked <live|dir> [--build] [--open arc]');

if (args.includes('--build')) {
  if (!isLiveSource(which)) fail(TOOL, '--build only applies to the live build');
  execFileSync('pnpm', ['run', 'build:live'], { stdio: 'inherit', cwd: REPO });
}

const source = resolveSource(which);
const manifest = readShareable(TOOL, source, isLiveSource(which) ? ' (run with --build, or pnpm run build:live)' : '');
const target = resolve(process.env.INSTAPOST_UNPACKED_DIR ?? join(REPO, '.unpacked'));
syncInto(TOOL, source, target, '.instapost-unpacked.json', {
  name: manifest.name,
  version: manifest.version,
  copiedAt: new Date().toISOString(),
});

// Stamp the copy (never the source build) so the extensions page shows which build is loaded.
const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
const versionName = `${manifest.version ?? '0.0.0'} (${stamp})`;
const targetManifest = join(target, 'manifest.json');
writeFileSync(
  targetManifest,
  `${JSON.stringify({ ...JSON.parse(readFileSync(targetManifest, 'utf8')), version_name: versionName }, null, 2)}\n`,
);

console.log(`${TOOL}: "${manifest.name}" ${versionName} -> ${target}`);
console.log(`         extension id ${extIdForMode('live')}`);
console.log(
  'First time: chrome://extensions (Arc: arc://extensions) -> Developer mode -> Load unpacked -> that folder.',
);
console.log('After that: click the reload icon (↻) on instapost there.');

if (open === 'arc') {
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
