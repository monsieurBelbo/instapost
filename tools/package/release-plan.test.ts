/** RS-11: `pnpm run release`'s refusals, what it changes in package.json and CHANGELOG.md, and what it prints. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bumpVersion, dayOf, planRelease, type ReleaseState, stampChangelog } from './release-plan.ts';
import { changelogSection, releaseNotes } from './text.ts';

const LOG =
  '# Changelog\n\nIntro.\n\n## [Unreleased]\n\nRepost a post.\n\n<!-- es: Algo. -->\n\n### Added\n\n- A.\n\n## [0.1.1] - 2026-10-15\n\nOld.\n';
const PKG = '{\n  "name": "instapost",\n  "version": "0.1.1",\n  "private": true,\n  "x": { "version": "9" }\n}\n';

const state = (over: Partial<ReleaseState> = {}): ReleaseState => ({
  version: '0.2.0',
  branch: 'main',
  dirty: false,
  head: 'abc',
  originMain: 'abc',
  tagExists: false,
  packageJson: PKG,
  changelog: LOG,
  today: '2026-11-06',
  ...over,
});

const problemsOf = (over: Partial<ReleaseState>) => {
  const plan = planRelease(state(over));
  return 'problems' in plan ? plan.problems : [];
};

describe('planRelease', () => {
  it('bumps, stamps and prints the commands, main before the tag and never --tags', () => {
    const plan = planRelease(state());
    if ('problems' in plan) throw new Error(plan.problems.join());
    expect(JSON.parse(plan.packageJson).version).toBe('0.2.0');
    expect(plan.packageJson.replace('0.2.0', '0.1.1')).toBe(PKG);
    expect(plan.changelog).toBe(
      '# Changelog\n\nIntro.\n\n## [Unreleased]\n\n## [0.2.0] - 2026-11-06\n\nRepost a post.\n\n<!-- es: Algo. -->\n\n### Added\n\n- A.\n\n## [0.1.1] - 2026-10-15\n\nOld.\n',
    );
    expect(plan.commands).toEqual([
      'pnpm run verify',
      'git add package.json CHANGELOG.md',
      'git commit -m "Release 0.2.0"',
      'git tag -a v0.2.0 -m "instapost 0.2.0"',
      'git push origin main',
      'git push origin v0.2.0',
    ]);
  });

  it('what it stamps is what release-info accepts for the stable tag, with a fresh empty [Unreleased]', () => {
    const plan = planRelease(state());
    if ('problems' in plan) throw new Error(plan.problems.join());
    expect(releaseNotes(plan.changelog, '0.2.0', false)).toEqual({
      notes: 'Repost a post.\n\n<!-- es: Algo. -->\n\n### Added\n\n- A.',
    });
    expect(changelogSection(plan.changelog, 'Unreleased')).toBeNull();
  });

  it('a package.json already at the version stays as it is', () => {
    const plan = planRelease(state({ packageJson: bumpVersion(PKG, '0.2.0') }));
    if ('problems' in plan) throw new Error(plan.problems.join());
    expect(plan.packageJson).toBe(bumpVersion(PKG, '0.2.0'));
  });

  it.each(['v0.2.0', '0.2', '0.2.0-rc.1', '0.2.0.1', ''])('refuses %j as a version', (version) => {
    expect(problemsOf({ version })[0]).toContain('is not X.Y.Z');
  });

  it('refuses anything but a clean main that matches origin/main', () => {
    expect(problemsOf({ branch: 'feat/site' })).toEqual(['you are on feat/site, not main']);
    expect(problemsOf({ branch: null })).toEqual(['you are on no branch, not main']);
    expect(problemsOf({ dirty: true })).toEqual(['the tree has uncommitted changes']);
    expect(problemsOf({ originMain: null })).toEqual(['origin/main could not be read']);
    expect(problemsOf({ head: 'def' })).toEqual(['main (def) does not match origin/main (abc)']);
  });

  it('refuses a tag that exists, a version behind package.json, and a section that exists', () => {
    expect(problemsOf({ tagExists: true })).toEqual(['the tag v0.2.0 already exists']);
    expect(problemsOf({ version: '0.1.0' })[0]).toBe('package.json is already at 0.1.1, after 0.1.0');
    expect(problemsOf({ version: '0.1.1' })).toEqual(['CHANGELOG.md already has a [0.1.1] section']);
    expect(problemsOf({ version: '0.1.10', packageJson: bumpVersion(PKG, '0.1.9') })).toEqual([]);
    expect(problemsOf({ version: '0.1.9', packageJson: bumpVersion(PKG, '0.1.10') })[0]).toContain('already at 0.1.10');
  });

  it('refuses a changelog with no summary to publish', () => {
    expect(problemsOf({ changelog: '## [0.1.1] - 2026-10-15\n\nOld.\n' })).toEqual([
      'CHANGELOG.md has no [Unreleased] section',
    ]);
    expect(problemsOf({ changelog: '## [Unreleased]\n\n## [0.1.1] - 2026-10-15\n\nOld.\n' })).toEqual([
      "CHANGELOG.md's [Unreleased] section is empty",
    ]);
    expect(problemsOf({ changelog: '## [Unreleased]\n\n### Added\n\n- A.\n' })).toEqual([
      "CHANGELOG.md's [Unreleased] section does not open with a summary paragraph",
    ]);
    expect(problemsOf({ changelog: '## [Unreleased]\n\nVersion 0.2.0 (not released).\n' })).toEqual([
      'CHANGELOG.md\'s [Unreleased] section still says "not released"',
    ]);
  });
});

describe('stampChangelog and bumpVersion', () => {
  it('only the top-level version and the [Unreleased] heading change', () => {
    expect(JSON.parse(bumpVersion(PKG, '1.0.0')).x.version).toBe('9');
    expect(stampChangelog(LOG, '0.2.0', '2026-11-06').match(/## \[/g)).toHaveLength(3);
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('release.yml', () => {
  it('a draft on a first run stops the release: it may be a published release whose tag was deleted', () => {
    const yml = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
    const draft = yml.slice(yml.indexOf('if [ "$state" = true ]'));
    const stop = draft.indexOf('if [ "$GITHUB_RUN_ATTEMPT" = 1 ]');
    expect(stop).toBeGreaterThan(0);
    expect(draft.indexOf('exit 1')).toBeGreaterThan(stop);
    expect(draft.indexOf('gh release delete "$TAG" --yes')).toBeGreaterThan(draft.indexOf('exit 1'));
  });
});

describe('scripts/release.ts', () => {
  it('asks git only to read and fetch: it never commits, tags or pushes', () => {
    const source = readFileSync(new URL('../../scripts/release.ts', import.meta.url).pathname, 'utf8');
    const verbs = [...source.matchAll(/\bgit\('([\w-]+)'/g)].map((m) => m[1]);
    expect(new Set(verbs)).toEqual(new Set(['rev-parse', 'status', 'fetch', 'ls-remote']));
    expect(source).not.toMatch(/execFileSync\('(?!git')/);
  });
});
