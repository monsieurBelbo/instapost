/**
 * RS-11: runs first in release.yml, before anything is installed, so it imports node built-ins and .ts files only.
 * Refuses a tag this commit cannot be released under, a stable tag without its own dated CHANGELOG section, and a
 * section with no opening summary or a "not released" one (a candidate may use [Unreleased]). Writes the release
 * notes to dist/notes.md and prints `label=` and `prerelease=` for $GITHUB_OUTPUT.
 *
 *   node scripts/release-info.ts v0.2.0 >> "$GITHUB_OUTPUT"
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseNotes, releaseOfTag } from '../tools/package/text.ts';
import { fail, REPO } from './lib/extension-build.ts';

const TOOL = 'release-info';
const tag = process.argv[2] ?? fail(TOOL, 'usage: release-info <tag>');
const { version } = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version: string };
const release = releaseOfTag(tag, version);
if (!release) fail(TOOL, `${tag} is not v${version} or v${version}-rc.N (package.json says ${version})`);
const result = releaseNotes(readFileSync(join(REPO, 'CHANGELOG.md'), 'utf8'), version, release.prerelease);
if ('problem' in result) fail(TOOL, `${result.problem}; fix it before tagging ${tag}`);
mkdirSync(join(REPO, 'dist'), { recursive: true });
writeFileSync(join(REPO, 'dist', 'notes.md'), `${result.notes}\n`);
console.log(`label=${release.label}\nprerelease=${release.prerelease}`);
