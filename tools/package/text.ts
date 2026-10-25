/**
 * The texts `pnpm run package` writes into a shared build (scripts/package.ts): INSTALL.txt and BUILD.txt, and
 * the checks the staged folder must pass before it is zipped. Pure, so they are tested (text.test.ts).
 *
 * - RS-4: nothing in the shared folder names a path on the owner's Mac (their username, the project layout):
 *   BUILD.txt names the build (`live`) or a folder relative to the repo, never an absolute path.
 * - RL-2 / RL-10 / RL-3: INSTALL.txt says to reload an Instagram tab that was already open, where to set the
 *   shortcut when it does nothing, and names the third-party software with its licences.
 * - RL-20 / RS-10: the browser version it needs; detectability, the shared folder's trust, reloading after a
 *   sync, and what Details contain.
 * - RS-9: BUILD.txt says which commit the build came from (`git describe --always --dirty`, so uncommitted
 *   changes show), its branch, when it was built and when it was packaged, and whether check-bundle passed.
 */
import { basename, isAbsolute, relative } from 'node:path';
import { LIBHEIF_SOURCES, LICENSE_FILES } from '../bundle/licenses.ts';

/** RS-4: how BUILD.txt names the build's source: the build's name, else its folder relative to the repo. */
export function sourceLabel(which: string, source: string, repo: string, named: boolean): string {
  if (named) return which;
  const rel = relative(repo, source);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel : basename(source);
}

export interface BuildFacts {
  versionName: string;
  /** `git describe --always --dirty` (a `-dirty` suffix: uncommitted changes were in the tree). */
  describe: string;
  branch: string;
  label: string;
  /** The build's own time (its manifest.json) and the packaging time, ISO. */
  builtAt: string;
  packagedAt: string;
  /** check-bundle passed on this build (false: a folder packaged with --unchecked). */
  checked: boolean;
}

export function buildText(f: BuildFacts): string {
  return [
    f.versionName,
    `commit ${f.describe} on ${f.branch}`,
    `source ${f.label}`,
    `built ${f.builtAt}`,
    `packaged ${f.packagedAt}`,
    `check-bundle ${f.checked ? 'passed' : 'not run (--unchecked)'}`,
    '',
  ].join('\n');
}

/** RS-9: `YYYYMMDD-HHMM` in local time. */
export function stampOf(t: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}`;
}

/**
 * RS-9: the files that make a build, newer than the build itself (its manifest.json): a stale build. `files` are
 * repo-relative paths with their modification times; only the build's inputs count.
 */
export const BUILD_INPUTS = ['src/', 'entrypoints/', 'public/', 'wxt.config.ts', 'package.json'] as const;
export function staleInputs(files: readonly { path: string; mtimeMs: number }[], builtMs: number): string[] {
  return files
    .filter((f) => BUILD_INPUTS.some((p) => (p.endsWith('/') ? f.path.startsWith(p) : f.path === p)))
    .filter((f) => !/\.test\.tsx?$|\.browser\.test\.tsx?$|__screenshots__\//.test(f.path))
    .filter((f) => f.mtimeMs > builtMs)
    .map((f) => f.path)
    .sort();
}

/** RS-4: the local paths a shared text must not contain (the repo, the home folder), as found in `text`. */
export function localPathLeaks(text: string, paths: readonly string[]): string[] {
  return paths.filter((p) => p.length > 1 && text.includes(p));
}

/**
 * INSTALL.txt. RL-20: names the browser version the manifest requires (`minChrome`, its minimum_chrome_version),
 * so a browser a release behind is told where to update instead of failing Load unpacked. RS-10: says that
 * Instagram can detect instapost, that the shared folder must be written only by whoever shares the build (it
 * runs inside the friend's logged-in Instagram), to reload after every sync and never post mid-sync, and that
 * Details carry the Instagram username.
 */
export function installText(name: string, build: string, minChrome: string | null): string {
  const needs = minChrome
    ? `Needs Chrome or Arc ${minChrome} or later. To update: chrome://settings/help
(in Arc: Arc menu -> Check for Updates), then relaunch the browser.

`
    : '';
  return `${name} — build ${build}

A personal Chrome/Arc extension for posting Instagram stories from your desktop
browser. It is not in the Chrome Web Store, so it is installed "unpacked".

${needs}INSTALL (once)
1. Put this "instapost" folder somewhere permanent (not Downloads).
   If it came in a shared iCloud/Dropbox folder, leave it there.
2. Open chrome://extensions (Arc: arc://extensions).
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked" and choose this folder.
5. Open instagram.com in a normal tab, logged in (reload any Instagram tab
   that was already open). Use "New story" in Instagram's left sidebar (or
   press Option+Shift+S; if that does nothing, set a shortcut for instapost
   at chrome://extensions/shortcuts, in Arc arc://extensions/shortcuts).

UPDATE
- Replace this folder's contents with the new build (a shared folder updates
  by itself). Wait until it has finished syncing, then click the reload icon
  on instapost in chrome://extensions and reload your Instagram tab. Do this
  after every update. Your settings are kept.
- Don't post while an update is still syncing: the browser reads instapost's
  pages straight from this folder, so a half-synced folder can mix old and
  new code until you reload.

READ THIS FIRST
- This extension makes Instagram's mobile site run inside the desktop page
  and taps its buttons for you. To do that it changes how your browser
  identifies itself to Instagram for that page and removes/changes some of
  Instagram's security headers for that one frame. That is outside
  Instagram's terms of use: your account is at your own risk. Try it on a
  secondary account first.
- Instagram can tell that instapost is installed and running: its own page
  code can see instapost's button on every page and, during a post, the
  phone-sized frame inside the page. A post made this way also looks unusual
  to Instagram's servers.
- If this folder is shared with you (iCloud, Dropbox), it must be view-only
  for you and changed only by whoever gave you this build: anyone who can
  change its files can run code inside your logged-in Instagram.
- It only posts when you press "Post story", one story at a time, and never
  retries a post on its own.
- instapost is not affiliated with, endorsed or sponsored by Instagram or
  Meta. It is provided as is, without warranty (MIT licence, see LICENSE in
  the source repository).
- If something goes wrong, open the result's "Details", copy them and send
  them to whoever gave you this build, and to no one else: they include your
  Instagram username and facts about the run.

THIRD-PARTY SOFTWARE
- HEIC photos are converted with libheif and libde265 (GNU LGPL version 3),
  shipped unmodified as separate files. Notice: ${LICENSE_FILES.notice};
  licence texts (LGPL-3.0 and GPL-3.0): ${LICENSE_FILES.libheif}.
  Source: ${LIBHEIF_SOURCES.libheif} and
  ${LIBHEIF_SOURCES.libde265}.
`;
}
