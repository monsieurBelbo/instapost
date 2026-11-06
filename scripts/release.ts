/**
 * RS-11: `pnpm run release <version>` prepares a stable release (tools/package/release-plan.ts). On a clean main that
 * matches origin/main, it bumps package.json if needed, stamps CHANGELOG.md's [Unreleased] as this version with
 * today's date and prints the commands that remain. It never commits, tags or pushes: the tag is what publishes.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dayOf, planRelease } from '../tools/package/release-plan.ts';
import { fail, REPO } from './lib/extension-build.ts';

const TOOL = 'release';
const version = process.argv.slice(2).find((a) => a !== '--');
if (!version) fail(TOOL, 'usage: pnpm run release <version>, e.g. pnpm run release 0.2.0');

const git = (...args: string[]): string | null => {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

const fetched = git('fetch', '--quiet', 'origin', 'main') !== null;
const packagePath = join(REPO, 'package.json');
const changelogPath = join(REPO, 'CHANGELOG.md');
const plan = planRelease({
  version,
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  dirty: git('status', '--porcelain') !== '',
  head: git('rev-parse', 'HEAD'),
  originMain: fetched ? git('rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main') : null,
  tagExists:
    git('rev-parse', '--verify', '--quiet', `refs/tags/v${version}`) !== null ||
    Boolean(git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`)),
  packageJson: readFileSync(packagePath, 'utf8'),
  changelog: readFileSync(changelogPath, 'utf8'),
  today: dayOf(new Date()),
});
if ('problems' in plan) fail(TOOL, `refusing to prepare ${version}:\n  ${plan.problems.join('\n  ')}`);

writeFileSync(packagePath, plan.packageJson);
writeFileSync(changelogPath, plan.changelog);
console.log(`${TOOL}: package.json and CHANGELOG.md are ready for ${version}. Nothing is committed. Next, in order:\n`);
for (const command of plan.commands) console.log(`  ${command}`);
