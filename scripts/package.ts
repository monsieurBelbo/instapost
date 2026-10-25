/**
 * Packages a live-key build for sharing outside the Chrome Web Store.
 *
 *   pnpm run package [live] [--build] [--to <shared folder>] [--allow-dirty]
 *   pnpm run package <dir> --unchecked [--to <shared folder>] [--allow-dirty]
 *
 * - Always writes dist/instapost-<version>-<stamp>.zip (dist/ is gitignored): the extension folder with an
 *   INSTALL.txt, for sending as a file.
 * - With --to, also syncs the unpacked extension into that folder (e.g. a shared iCloud Drive or Dropbox
 *   folder). The friend loads that folder once with Load unpacked; after each new package they click ↻.
 *   The folder is only ever wiped when it is empty or was created by this script.
 * - The manifest gets a version_name with the build stamp, so chrome://extensions shows which build is
 *   loaded. The key is unchanged, so the extension ID (and the friend's stored data) survive updates.
 *
 * Default source: the live build (.output/chrome-mv3-live: the in-page lane, with the window lane as its
 * fallback). --build rebuilds both artifacts first (pnpm run build:all, which check-bundle's T5 needs); it does
 * not apply to a folder path.
 *
 * RS-9: only a checked, current, traceable build goes out:
 * - the live build must be newer than every build input (src/, entrypoints/, public/, wxt.config.ts,
 *   package.json; tests aside), else it is refused (run with --build), and check-bundle (T1–T5) must pass on it;
 * - a folder build cannot be checked: it is packaged only with --unchecked, and BUILD.txt says so;
 * - a tree with uncommitted changes (untracked files included) is refused unless --allow-dirty; BUILD.txt and
 *   the --to marker record `git describe --always --dirty` and the branch either way;
 * - the version_name stamp is the build's own time (its manifest.json); BUILD.txt has both times.
 *
 * The texts (INSTALL.txt, BUILD.txt) are tools/package/text.ts. Before zipping, the staged folder must ship
 * libheif's licences (RL-3, tools/bundle/licenses.ts) and no text file in it may name a path on this Mac (RS-4:
 * BUILD.txt and the --to marker name the build, e.g. `live`, never the repo or the staging folder).
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { licenseProblems } from '../tools/bundle/licenses.ts';
import {
  BUILD_INPUTS,
  buildText,
  installText,
  localPathLeaks,
  sourceLabel,
  staleInputs,
  stampOf,
} from '../tools/package/text.ts';
import {
  fail,
  isLiveSource,
  type Manifest,
  REPO,
  readShareable,
  resolveSource,
  syncInto,
} from './lib/extension-build.ts';

const TOOL = 'package';
const MARKER = '.instapost-package.json';

const args = process.argv.slice(2);
const toIndex = args.indexOf('--to');
const to = toIndex >= 0 ? args[toIndex + 1] : undefined;
if (toIndex >= 0 && (!to || to.startsWith('--'))) fail(TOOL, '--to needs a folder');
const which = args.find((a, i) => !a.startsWith('--') && (toIndex < 0 || i !== toIndex + 1)) ?? 'live';
const live = isLiveSource(which);
const unchecked = args.includes('--unchecked');
if (live && unchecked) fail(TOOL, '--unchecked is for a folder build; the live build is always checked');
if (!live && !unchecked) {
  fail(TOOL, `${which} is not the live build, so check-bundle cannot check it; pass --unchecked to package it anyway`);
}

const git = (...a: string[]): string | null => {
  try {
    return execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
};
// RS-9: which commit, on which branch, and whether the tree had changes (untracked files count too).
const dirty = (git('status', '--porcelain') ?? '') !== '';
const described = git('describe', '--always', '--dirty') ?? 'unknown';
const describe = dirty && !described.endsWith('-dirty') ? `${described}-dirty` : described;
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') ?? 'unknown';
if (dirty && !args.includes('--allow-dirty')) {
  fail(TOOL, `the tree has uncommitted changes (${describe} on ${branch}); commit first, or pass --allow-dirty`);
}

if (args.includes('--build')) {
  if (!live) fail(TOOL, '--build only applies to the live build');
  execFileSync('pnpm', ['run', 'build:all'], { stdio: 'inherit', cwd: REPO });
}

const source = resolveSource(which);
const manifest = readShareable(TOOL, source, live ? ' (run with --build)' : '');
const builtAt = new Date(statSync(join(source, 'manifest.json')).mtimeMs);

if (live) {
  // RS-9: the build must be newer than everything it is built from.
  const tracked = (git('ls-files', '-co', '--exclude-standard', '--', ...BUILD_INPUTS) ?? '').split('\n');
  const files = tracked
    .filter((f) => f !== '' && existsSync(join(REPO, f)))
    .map((f) => ({ path: f, mtimeMs: statSync(join(REPO, f)).mtimeMs }));
  const stale = staleInputs(files, builtAt.getTime());
  if (stale.length > 0) {
    const shown = stale.slice(0, 5).join(', ') + (stale.length > 5 ? `, … (${stale.length} files)` : '');
    fail(TOOL, `the live build is older than its sources (${shown}); run with --build`);
  }
  // RS-9: check-bundle's T1–T5 on the build that goes out (T5 needs both artifacts: --build makes both).
  try {
    execFileSync('node', ['scripts/check-bundle.ts'], { stdio: 'inherit', cwd: REPO });
  } catch {
    fail(TOOL, 'check-bundle failed on this build; refusing to package (pnpm run build:all, then try again)');
  }
}

const now = new Date();
const stamp = stampOf(builtAt);
const version = manifest.version ?? '0.0.0';
const versionName = `${version} (${stamp})`;

// Stage a copy so the source build is never modified.
const stage = mkdtempSync(join(tmpdir(), 'instapost-package-'));
const ext = join(stage, 'instapost');
cpSync(source, ext, { recursive: true, filter: (path) => !path.includes('/_metadata') });
const stagedManifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8')) as Manifest;
stagedManifest.version_name = versionName;
writeFileSync(join(ext, 'manifest.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`);
writeFileSync(
  join(ext, 'INSTALL.txt'),
  installText(manifest.name ?? 'instapost', versionName, manifest.minimum_chrome_version ?? null),
);
// RS-4: the build's name (or its folder relative to the repo), never an absolute path on this Mac.
const label = sourceLabel(which, source, REPO, live);
writeFileSync(
  join(ext, 'BUILD.txt'),
  buildText({
    versionName,
    describe,
    branch,
    label,
    builtAt: builtAt.toISOString(),
    packagedAt: now.toISOString(),
    checked: live,
  }),
);

// What goes out: libheif's licences (RL-3), and no path of this Mac in any text file (RS-4).
const staged = (function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [relative(ext, join(dir, e.name)).split('\\').join('/')],
  );
})(ext);
const outProblems = licenseProblems(staged, (f) => readFileSync(join(ext, f), 'utf8'));
for (const f of staged.filter((x) => /\.(txt|json|html|js|css)$/.test(x))) {
  for (const leak of localPathLeaks(readFileSync(join(ext, f), 'utf8'), [REPO, homedir()])) {
    outProblems.push(`${f} names the local path ${leak}`);
  }
}
if (outProblems.length > 0) {
  rmSync(stage, { recursive: true, force: true });
  fail(TOOL, `refusing to package:\n  ${outProblems.join('\n  ')}`);
}

const dist = join(REPO, 'dist');
mkdirSync(dist, { recursive: true });
const zipPath = join(dist, `instapost-${version}-${stamp}.zip`);
if (existsSync(zipPath)) rmSync(zipPath);
execFileSync('zip', ['-r', '-X', '-q', zipPath, 'instapost'], { cwd: stage });
console.log(`${TOOL}: "${manifest.name}" ${versionName} -> ${zipPath}`);

if (to) {
  const target = resolve(to);
  // RS-4: the marker names the build, not the staging folder's path.
  syncInto(TOOL, ext, target, MARKER, {
    source: label,
    name: manifest.name,
    versionName,
    commit: describe,
    branch,
    builtAt: builtAt.toISOString(),
    checked: live,
    copiedAt: now.toISOString(),
  });
  console.log(`${TOOL}: synced to ${target}`);
  console.log('         Friend, first time: Developer mode -> Load unpacked -> that folder. Later: click ↻.');
}
rmSync(stage, { recursive: true, force: true });
