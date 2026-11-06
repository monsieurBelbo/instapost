/**
 * What the page takes from a GitHub Release, checked, and what it publishes next to the zip (latest.json, SHA256).
 * scripts/build-site.ts does the reading and writing. It runs in the Site job, which has no install, so this imports
 * node built-ins and .ts files only.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { INLINE_MARKUP, PAGE_URL, releaseOfTag, sectionSummary, summaryProblem } from '../package/text.ts';
import { LATEST_ZIP, type Release, type Site, zipName } from './page.ts';

export const REPO_URL = 'https://github.com/monsieurBelbo/instapost';

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * The plain summary a release body (its CHANGELOG section) opens with, for the page. `es` is the comment right after
 * it, `<!-- es: … -->`. Null when there is none to show: the raw bullets carry internal notes and never reach the page.
 */
export function summaryOf(body: string, lang: 'en' | 'es'): string | null {
  const text = body.replace(/\r\n/g, '\n').trim();
  const summary = summaryProblem(text) ? null : sectionSummary(text);
  if (!summary) return null;
  if (lang === 'en') return oneLine(summary);
  const es = /^<!--\s*es:\s*([\s\S]*?)\s*-->/.exec(text.slice(summary.length).trimStart())?.[1];
  return es && !INLINE_MARKUP.test(es) ? oneLine(es) : null;
}

/** BASE_URL with exactly one trailing slash, whichever way configure-pages hands it over. Unset: the public page. */
export function baseUrlOf(raw: string | undefined): string {
  const url = new URL(raw || PAGE_URL);
  if (!/^https?:$/.test(url.protocol) || url.search || url.hash) throw new Error(`BASE_URL is not a page: ${raw}`);
  return url.href.replace(/\/*$/, '/');
}

/** The folder to replace with the page: never the repo or anything above it, and in the repo only a `_folder`. */
export function outDirOf(out: string | undefined, repo: string): string {
  if (!out) throw new Error('usage: build-site --out DIR [--release-dir DIR]');
  const dir = resolve(repo, out);
  const fromOut = relative(dir, repo);
  const fromRepo = relative(repo, dir);
  const holdsRepo = fromOut === '' || (!fromOut.startsWith('..') && !isAbsolute(fromOut));
  const inRepo = !fromRepo.startsWith('..') && !isAbsolute(fromRepo);
  if (holdsRepo || (inRepo && !fromRepo.startsWith('_'))) throw new Error(`refusing to replace ${dir}`);
  return dir;
}

export const sha256File = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Throws unless a `sha256sum` line names this zip and this hash, so a wrong file never deploys. */
export function checkSha256Line(line: string, name: string, actual: string): void {
  const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
  if (m?.[2] !== name) throw new Error(`${name}.sha256 is not a sha256sum line for ${name}: ${line.trim()}`);
  if (m[1] !== actual) throw new Error(`${name}: SHA-256 is ${actual}, its .sha256 says ${m[1]}`);
}

/** A release tag without its v. The page may be built from a newer commit, so any version goes, not just package.json's. */
export function labelOfTag(tag: string): string {
  const label = releaseOfTag(tag, /^v([\d.]+)/.exec(tag)?.[1] ?? '')?.label;
  if (!label) throw new Error(`${tag} is not a release tag`);
  return label;
}

/** `gh release view --json tagName,isPrerelease,publishedAt,body`, and the zip as measured, as the page's release. */
export function parseRelease(json: string, tag: string, zip: { sizeBytes: number; sha256: string }): Release {
  const label = labelOfTag(tag);
  const gh = JSON.parse(json) as { tagName?: unknown; isPrerelease?: unknown; publishedAt?: unknown; body?: unknown };
  if (gh.tagName !== tag) throw new Error(`release.json is for ${String(gh.tagName)}, not ${tag}`);
  if (typeof gh.isPrerelease !== 'boolean') throw new Error('release.json has no isPrerelease');
  const published = new Date(typeof gh.publishedAt === 'string' ? gh.publishedAt : Number.NaN);
  if (Number.isNaN(published.getTime())) throw new Error(`release.json has no publishedAt: ${String(gh.publishedAt)}`);
  const body = typeof gh.body === 'string' ? gh.body : '';
  const en = summaryOf(body, 'en');
  return {
    label,
    prerelease: gh.isPrerelease,
    date: published.toISOString(),
    sizeBytes: zip.sizeBytes,
    sha256: zip.sha256,
    summary: en ? { en, es: summaryOf(body, 'es') } : null,
  };
}

/** downloads/latest.json, with absolute URLs. The extension never reads it. */
export function latestJson(r: Release, site: Site): string {
  const name = zipName(r.label);
  const downloads = `${site.baseUrl}downloads/`;
  const json = {
    name,
    version: r.label,
    tag: `v${r.label}`,
    prerelease: r.prerelease,
    released: r.date,
    size: r.sizeBytes,
    sha256: r.sha256,
    zip: `${downloads}${name}`,
    latest: `${downloads}${LATEST_ZIP}`,
    notes: `${site.repo}/releases/tag/v${r.label}`,
  };
  return `${JSON.stringify(json, null, 2)}\n`;
}

/** downloads/SHA256: both names of the one zip, so `shasum -a 256 -c SHA256` works in that folder. */
export const sha256Sums = (r: Release): string =>
  [zipName(r.label), LATEST_ZIP].map((name) => `${r.sha256}  ${name}\n`).join('');
