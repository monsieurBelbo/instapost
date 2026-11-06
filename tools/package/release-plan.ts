/**
 * RS-11: what `pnpm run release <version>` does, pure so it is tested (release-plan.test.ts); scripts/release.ts only
 * reads the state and writes the files. It prepares a stable release on a clean main: the version in package.json and
 * the date in CHANGELOG.md. The commit, the tag and the pushes stay yours: it prints them and runs none.
 */
import { changelogSection, stampOf, summaryProblem } from './text.ts';

export interface ReleaseState {
  version: string;
  branch: string | null;
  /** `git status --porcelain` found anything, untracked files included. */
  dirty: boolean;
  head: string | null;
  /** origin/main after a fetch; null when it could not be read. */
  originMain: string | null;
  tagExists: boolean;
  packageJson: string;
  changelog: string;
  /** The date that goes on the section, YYYY-MM-DD. */
  today: string;
}

export interface ReleasePlan {
  packageJson: string;
  changelog: string;
  commands: string[];
}

/** A date as CHANGELOG.md writes it, YYYY-MM-DD, local. */
export const dayOf = (t: Date): string => stampOf(t).replace(/^(\d{4})(\d{2})(\d{2})-.*$/, '$1-$2-$3');

const parts = (version: string) => version.split('.').map(Number);

/** Whether `a` comes after `b` (both digits and dots). */
function isAfter(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** package.json's text with its top-level version replaced, the rest byte for byte. */
export function bumpVersion(packageJson: string, version: string): string {
  return packageJson.replace(/^(\s*"version":\s*")[^"]*(")/m, `$1${version}$2`);
}

/** [Unreleased] becomes `## [<version>] - <today>`, with a fresh empty [Unreleased] above it. */
export function stampChangelog(changelog: string, version: string, today: string): string {
  return changelog.replace(/^## \[Unreleased\][^\n]*$/m, `## [Unreleased]\n\n## [${version}] - ${today}`);
}

export function planRelease(s: ReleaseState): { problems: string[] } | ReleasePlan {
  if (!/^\d+\.\d+\.\d+$/.test(s.version)) {
    return { problems: [`${s.version} is not X.Y.Z (a candidate needs no release step: see README, Release)`] };
  }
  const problems: string[] = [];
  if (s.branch !== 'main') problems.push(`you are on ${s.branch ?? 'no branch'}, not main`);
  if (s.dirty) problems.push('the tree has uncommitted changes');
  if (!s.originMain) problems.push('origin/main could not be read');
  else if (s.head !== s.originMain) problems.push(`main (${s.head}) does not match origin/main (${s.originMain})`);
  if (s.tagExists) problems.push(`the tag v${s.version} already exists`);
  const current = (JSON.parse(s.packageJson) as { version: string }).version;
  if (isAfter(current, s.version)) problems.push(`package.json is already at ${current}, after ${s.version}`);
  if (s.changelog.includes(`## [${s.version}]`)) problems.push(`CHANGELOG.md already has a [${s.version}] section`);
  if (!s.changelog.split('\n').some((l) => l.startsWith('## [Unreleased]'))) {
    problems.push('CHANGELOG.md has no [Unreleased] section');
  } else {
    const problem = summaryProblem(changelogSection(s.changelog, 'Unreleased'));
    if (problem) problems.push(`CHANGELOG.md's [Unreleased] section ${problem}`);
  }
  if (problems.length > 0) return { problems };
  const tag = `v${s.version}`;
  return {
    packageJson: bumpVersion(s.packageJson, s.version),
    changelog: stampChangelog(s.changelog, s.version, s.today),
    commands: [
      'pnpm run verify',
      'git add package.json CHANGELOG.md',
      `git commit -m "Release ${s.version}"`,
      `git tag -a ${tag} -m "instapost ${s.version}"`,
      'git push origin main',
      `git push origin ${tag}`,
    ],
  };
}
