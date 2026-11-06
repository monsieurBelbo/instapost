/**
 * Builds the page into a folder: site/ + the generated HTML + the font + the newest release's files. I/O only, the
 * rest is tools/site/. It runs in the Site job, which has no install, so it imports node built-ins and .ts files only.
 *
 *   pnpm run site                                                 no release: a page with no download, for a preview
 *   TAG=v0.2.0 BASE_URL=… node scripts/build-site.ts --out _site --release-dir DIR
 *
 * DIR holds instapost-<label>.zip, its .sha256 and release.json (`gh release view`). With no TAG it is expected to be
 * empty or missing. A release that doesn't add up throws before anything is written, so nothing deploys.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { EN } from '../tools/site/copy.en.ts';
import { ES } from '../tools/site/copy.es.ts';
import { LATEST_ZIP, type Release, renderNotFound, renderPage, type Site, zipName } from '../tools/site/page.ts';
import {
  baseUrlOf,
  checkSha256Line,
  labelOfTag,
  latestJson,
  outDirOf,
  parseRelease,
  REPO_URL,
  sha256File,
  sha256Sums,
} from '../tools/site/release.ts';

const REPO = resolve(import.meta.dirname, '..');
const FONT_FILES = ['InstrumentSans-Variable.woff2', 'OFL.txt'];

/** The release in `dir`, measured and checked, with its zip's path; null when there is no release to show. */
function readRelease(dir: string | undefined, tag: string): { release: Release; zip: string } | null {
  if (!tag) {
    const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : [];
    if (files.length > 0) throw new Error(`no TAG, but ${dir} holds ${files.join(', ')}`);
    return null;
  }
  if (!dir) throw new Error(`TAG is ${tag}, but there is no --release-dir`);
  const name = zipName(labelOfTag(tag));
  const zip = join(dir, name);
  if (!existsSync(zip)) throw new Error(`${name} is not in ${dir}`);
  const measured = { sizeBytes: statSync(zip).size, sha256: sha256File(zip) };
  checkSha256Line(readFileSync(`${zip}.sha256`, 'utf8'), name, measured.sha256);
  return { release: parseRelease(readFileSync(join(dir, 'release.json'), 'utf8'), tag, measured), zip };
}

const { values } = parseArgs({ options: { out: { type: 'string' }, 'release-dir': { type: 'string' } } });
const out = outDirOf(values.out, REPO);
const site: Site = { baseUrl: baseUrlOf(process.env.BASE_URL), repo: REPO_URL };
const found = readRelease(values['release-dir'], process.env.TAG ?? '');

// Outside the repo only a missing or empty folder, which also stops a recased or symlinked path to the repo.
if (relative(REPO, out).startsWith('..') && existsSync(out) && readdirSync(out).length > 0) {
  throw new Error(`refusing to replace ${out}: it is not empty`);
}
rmSync(out, { recursive: true, force: true });
cpSync(join(REPO, 'site'), out, { recursive: true, filter: (src) => basename(src) !== '.DS_Store' });
for (const f of FONT_FILES) copyFileSync(join(REPO, 'public/fonts', f), join(out, 'assets', f));

mkdirSync(join(out, 'es'));
writeFileSync(join(out, 'index.html'), renderPage(EN, found?.release ?? null, site));
writeFileSync(join(out, 'es/index.html'), renderPage(ES, found?.release ?? null, site));
writeFileSync(join(out, '404.html'), renderNotFound(EN, ES, site));

if (found) {
  const downloads = join(out, 'downloads');
  mkdirSync(downloads);
  copyFileSync(found.zip, join(downloads, zipName(found.release.label)));
  copyFileSync(found.zip, join(downloads, LATEST_ZIP));
  writeFileSync(join(downloads, 'latest.json'), latestJson(found.release, site));
  writeFileSync(join(downloads, 'SHA256'), sha256Sums(found.release));
}

console.log(`build-site: ${out}, ${found ? `release ${found.release.label}` : 'no release'}, ${site.baseUrl}`);
