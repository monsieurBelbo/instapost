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
 * - RS-11: what a release tag means, which CHANGELOG section is its notes, and the INSTALL.txt of a public download.
 *
 * Imported before install by scripts/release-info.ts: node built-ins and .ts files only.
 */
import { basename, isAbsolute, relative } from 'node:path';
import { LIBHEIF_SOURCES, LICENSE_FILES } from '../bundle/licenses.ts';

/**
 * RS-11: what a release tag means. `v<version>` is a release, `v<version>-rc.N` a release candidate of it; anything
 * else, or another version, cannot be released from this package.json. `label` names the zip and is its
 * version_name (Chrome's manifest `version` takes digits and dots only, so it stays `version`).
 */
export function releaseOfTag(tag: string, version: string): { label: string; prerelease: boolean } | null {
  const m = /^v(\d+\.\d+\.\d+)(-rc\.[1-9]\d*)?$/.exec(tag);
  return m?.[1] === version ? { label: tag.slice(1), prerelease: m[2] !== undefined } : null;
}

/** RS-11: a version's section of CHANGELOG.md (`## [<heading>]` up to the next `## [`), or null if missing or empty. */
export function changelogSection(changelog: string, heading: string): string | null {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${heading}]`));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## ['));
  return (
    lines
      .slice(start + 1, end < 0 ? undefined : end)
      .join('\n')
      .trim() || null
  );
}

/** Markdown a summary must not carry: the page escapes its text and would print the marks. */
export const INLINE_MARKUP = /\*\*|`|\]\(/;

/**
 * RS-11: a section's opening summary (its first paragraph), or null if it opens with anything else, or runs straight
 * into a bullet or comment with no blank line: the page shows this text, and raw bullets must never reach it.
 */
export function sectionSummary(section: string): string | null {
  const [first = ''] = section.trim().split(/\n\s*\n/);
  const notPlain = first === '' || first.includes('<!--') || INLINE_MARKUP.test(first);
  return notPlain || first.split('\n').some((l) => /^\s*(#|[-*+] |\d+\. |>|\||```|•|=+\s*$|-+\s*$)/.test(l))
    ? null
    : first;
}

/** A bare @name in release notes: GitHub links it as a mention, lists that account under Contributors and may notify it. */
const BARE_MENTION = /(?<![a-z\d])@[a-z\d][\w/-]*/i;

/**
 * RS-11: why a section cannot be published (it needs a summary, not the "not released" placeholder, and no bare @name
 * anywhere in it), or null.
 */
export function summaryProblem(section: string | null): string | null {
  if (!section) return 'is empty';
  const summary = sectionSummary(section);
  if (!summary) return 'does not open with a summary paragraph';
  if (/not\s+released|unreleased/i.test(summary)) return 'still says "not released"';
  const mention = BARE_MENTION.exec(section.replace(/`[^`\n]*`/g, ''))?.[0];
  return mention
    ? `has a bare ${mention}: GitHub treats it as a mention of that account, so put it in backticks`
    : null;
}

/**
 * RS-11: the notes of a release. A stable tag needs its own dated section (`## [1.2.3] - 2026-11-06`). A candidate
 * uses that section if there is one, else [Unreleased], since it ships before the version is dated.
 */
export function releaseNotes(
  changelog: string,
  version: string,
  prerelease: boolean,
): { notes: string } | { problem: string } {
  if (!prerelease && !changelog.split('\n').some((l) => isDatedHeading(l, version))) {
    return { problem: `CHANGELOG.md has no dated [${version}] section (## [${version}] - YYYY-MM-DD)` };
  }
  const own = changelogSection(changelog, version);
  const heading = prerelease && !own ? 'Unreleased' : version;
  const notes = own ?? (prerelease ? changelogSection(changelog, 'Unreleased') : null);
  const problem = summaryProblem(notes);
  return notes && !problem ? { notes } : { problem: `CHANGELOG.md's [${heading}] section ${problem}` };
}

function isDatedHeading(line: string, version: string): boolean {
  const m = /^## \[(.+)\] - \d{4}-\d{2}-\d{2}\s*$/.exec(line);
  return m?.[1] === version;
}

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

/** RS-11: the public page, where a release's INSTALL.txt sends people for new versions. */
export const PAGE_URL = 'https://monsieurbelbo.github.io/instapost/';
const ISSUES_URL = 'https://github.com/monsieurBelbo/instapost/issues';

const needsText = (minChrome: string | null): string =>
  minChrome
    ? `Needs Chrome ${minChrome} or later, or Arc on Chromium ${minChrome} or later.
To update: chrome://settings/help (in Arc: Arc menu -> Check for Updates), then
relaunch the browser.

`
    : '';

const WHAT_IT_DOES = `- This extension makes Instagram's mobile site run inside the desktop page
  and taps its buttons for you. To do that it changes how your browser
  identifies itself to Instagram for that page and removes/changes some of
  Instagram's security headers for that one frame. That is outside
  Instagram's terms of use: your account is at your own risk. Try it on a
  secondary account first.
- Instagram can tell that instapost is installed and running: its own page
  code can see instapost's button on every page and, during a post or test,
  the phone-sized frame inside the page. A post made this way also looks
  unusual to Instagram's servers.`;

const THIRD_PARTY = `THIRD-PARTY SOFTWARE
- HEIC photos are converted with libheif and libde265 (GNU LGPL version 3),
  shipped unmodified as separate files. Notice: ${LICENSE_FILES.notice};
  licence texts (LGPL-3.0 and GPL-3.0): ${LICENSE_FILES.libheif}.
  Source: ${LIBHEIF_SOURCES.libheif} and
  ${LIBHEIF_SOURCES.libde265}.
- instapost's scripts include Preact, @preact/signals and WXT's small browser
  helpers (MIT) and idb (ISC). Their licences are in ${LICENSE_FILES.notice}.
`;

/**
 * INSTALL.txt. RL-20: names the browser version the manifest requires (`minChrome`, its minimum_chrome_version),
 * so a browser a release behind is told where to update instead of failing Load unpacked. RS-10: says that
 * Instagram can detect instapost, that the shared folder must be written only by whoever shares the build (it
 * runs inside the friend's logged-in Instagram), to reload after every sync and never post mid-sync, and that
 * Details carry the Instagram username.
 */
export function installText(name: string, build: string, minChrome: string | null): string {
  return `${name} — build ${build}

A personal Chrome/Arc extension for posting Instagram stories from your desktop
browser. It is not in the Chrome Web Store, so it is installed "unpacked".

${needsText(minChrome)}INSTALL (once)
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
${WHAT_IT_DOES}
- If this folder is shared with you (iCloud, Dropbox), it must be view-only
  for you and changed only by whoever gave you this build: anyone who can
  change its files can run code inside your logged-in Instagram.
- It only posts when you press "Post story", one story at a time, and never
  retries a post on its own.
- instapost is not affiliated with, endorsed or sponsored by Instagram or
  Meta. It is provided as is, without warranty (MIT licence, see LICENSE in
  this folder).
- If something goes wrong, open the result's "Details", copy them and send
  them to whoever gave you this build, and to no one else: they include your
  Instagram username and facts about the run.

${THIRD_PARTY}`;
}

/**
 * RS-11: INSTALL.txt of a release, the zip anyone downloads from the page: the same install and warnings as
 * installText, for one person with their own folder. No shared folder and no one who gave it to you.
 */
export function releaseInstallText(name: string, label: string, minChrome: string | null): string {
  return `${name} ${label}

A free browser extension for posting Instagram stories from your computer, in
Chrome or Arc. It is not in the Chrome Web Store, so you load it by hand.
Page: ${PAGE_URL}

${needsText(minChrome)}INSTALL (once)
1. Put this "instapost" folder somewhere it can stay (not Downloads). The
   browser reads it from there every time, so don't move or delete it. If you
   move it, repeat step 4.
2. Open chrome://extensions (Arc: arc://extensions).
3. Turn on "Developer mode" (top right). Leave it on.
4. Click "Load unpacked" and choose this folder, the one that directly holds
   manifest.json.
5. Open instagram.com in a normal window, not Incognito, logged in to a
   secondary account if you have one (reload any Instagram tab that was
   already open). Use "New story" in Instagram's left sidebar. Not there? On
   Instagram, click instapost's icon in the extensions menu, or press
   Option (Alt)+Shift+S (if that does nothing, set a shortcut for instapost at
   chrome://extensions/shortcuts, in Arc arc://extensions/shortcuts).
   Add a photo, press "Run setup test" and stay on that tab. It takes about 20
   seconds and posts nothing. After that, "Post story" posts.

UPDATE
Nothing updates by itself: new versions are on the page above.
- Replace this folder's contents with the new version, click the reload icon
  on instapost on the extensions page and reload your Instagram tab. Your
  settings are kept.
- If Arc holds on to the old version, use Remove and Load unpacked again. That
  wipes your settings, drafts, recent photos and history.

REMOVE
Remove on the extensions page deletes what instapost stored in the browser:
settings, drafts, recent photos and history. Copies saved to
Downloads/instapost stay. Then delete this folder.

BEFORE YOU USE IT
${WHAT_IT_DOES}
- Tried on real Instagram only in Arc on a Mac, with a secondary account.
- Anyone who can change the files in this folder can run code inside your
  logged-in Instagram. Get it from the page above and keep it where only you
  can change it.
- It only posts after you press "Post story", one story at a time, and never
  retries a post on its own.
- instapost is not affiliated with, endorsed or sponsored by Instagram or
  Meta. It is provided as is, without warranty (MIT licence, see LICENSE in
  this folder).
- If something goes wrong, you can report it at
  ${ISSUES_URL}
  The result's "Details" include your Instagram username, the @handle of
  anyone you reposted and facts about the run, so read them before you paste
  them anywhere.

${THIRD_PARTY}`;
}
