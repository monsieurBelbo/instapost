/**
 * Packages a live-key build for sharing outside the Chrome Web Store.
 *
 *   pnpm run package [inpage|live|<dir>] [--build] [--to <shared folder>]
 *
 * - Always writes dist/instapost-<version>-<stamp>.zip (dist/ is gitignored): the extension folder with an
 *   INSTALL.txt, for sending as a file.
 * - With --to, also syncs the unpacked extension into that folder (e.g. a shared iCloud Drive or Dropbox
 *   folder). The friend loads that folder once with Load unpacked; after each new package they click ↻.
 *   The folder is only ever wiped when it is empty or was created by this script.
 * - The manifest gets a version_name with the build stamp, so chrome://extensions shows which build is
 *   loaded. The key is unchanged, so the extension ID (and the friend's stored data) survive updates.
 *
 * Default source: the in-page build. --build only applies to "live" (pnpm run build:live).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fail, type Manifest, REPO, readShareable, resolveSource, syncInto } from './lib/extension-build.ts';

const TOOL = 'package';
const MARKER = '.instapost-package.json';

const args = process.argv.slice(2);
const toIndex = args.indexOf('--to');
const to = toIndex >= 0 ? args[toIndex + 1] : undefined;
if (toIndex >= 0 && (!to || to.startsWith('--'))) fail(TOOL, '--to needs a folder');
const which = args.find((a, i) => !a.startsWith('--') && i !== toIndex + 1) ?? 'inpage';

if (args.includes('--build')) {
  if (which !== 'live') fail(TOOL, '--build only applies to "live"');
  execFileSync('pnpm', ['run', 'build:live'], { stdio: 'inherit', cwd: REPO });
}

const source = resolveSource(which);
const manifest = readShareable(TOOL, source, which === 'live' ? ' (run with --build)' : '');

const now = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
} catch {
  // not a git checkout: keep "unknown"
}
const version = manifest.version ?? '0.0.0';
const versionName = `${version} (${stamp})`;

// Stage a copy so the source build is never modified.
const stage = mkdtempSync(join(tmpdir(), 'instapost-package-'));
const ext = join(stage, 'instapost');
cpSync(source, ext, { recursive: true, filter: (path) => !path.includes('/_metadata') });
const stagedManifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8')) as Manifest;
stagedManifest.version_name = versionName;
writeFileSync(join(ext, 'manifest.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`);
writeFileSync(join(ext, 'INSTALL.txt'), installText(manifest.name ?? 'instapost', versionName));
writeFileSync(
  join(ext, 'BUILD.txt'),
  `${versionName}\nrepo HEAD ${commit} (the build itself may come from another branch)\nsource ${source}\n`,
);

const dist = join(REPO, 'dist');
mkdirSync(dist, { recursive: true });
const zipPath = join(dist, `instapost-${version}-${stamp}.zip`);
if (existsSync(zipPath)) rmSync(zipPath);
execFileSync('zip', ['-r', '-X', '-q', zipPath, 'instapost'], { cwd: stage });
console.log(`${TOOL}: "${manifest.name}" ${versionName} -> ${zipPath}`);

if (to) {
  const target = resolve(to);
  syncInto(TOOL, ext, target, MARKER, { name: manifest.name, versionName, commit, copiedAt: now.toISOString() });
  console.log(`${TOOL}: synced to ${target}`);
  console.log('         Friend, first time: Developer mode -> Load unpacked -> that folder. Later: click ↻.');
}
rmSync(stage, { recursive: true, force: true });

function installText(name: string, build: string): string {
  return `${name} — build ${build}

A personal Chrome/Arc extension for posting Instagram stories from your desktop
browser. It is not in the Chrome Web Store, so it is installed "unpacked".

INSTALL (once)
1. Put this "instapost" folder somewhere permanent (not Downloads).
   If it came in a shared iCloud/Dropbox folder, leave it there.
2. Open chrome://extensions (Arc: arc://extensions).
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked" and choose this folder.
5. Open instagram.com in a normal tab, logged in. Use "New story" in
   Instagram's left sidebar (or press Option+Shift+S).

UPDATE
- Replace this folder's contents with the new build (a shared folder updates
  by itself), then click the reload icon on instapost in chrome://extensions
  and reload your Instagram tab. Your settings are kept.

READ THIS FIRST
- This extension makes Instagram's mobile site run inside the desktop page
  and taps its buttons for you. To do that it changes how your browser
  identifies itself to Instagram for that page and removes/changes some of
  Instagram's security headers for that one frame. That is outside
  Instagram's terms of use: your account is at your own risk. Try it on a
  secondary account first.
- It only posts when you press "Post story", one story at a time, and never
  retries a post on its own.
- If something goes wrong, open the result's "Details", copy them and send
  them to whoever gave you this build.
`;
}
