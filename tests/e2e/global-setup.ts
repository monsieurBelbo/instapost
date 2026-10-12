/**
 * E2E global setup (strategy §7.9, SG1, SG10): aborts the whole run unless
 *
 * 1. the fake's certificate is valid (missing, mismatched or expiring within 3 days fails);
 * 2. both artifacts exist and their manifests match their modes: name, the mode's committed
 *    key, and the guarded build's static ruleset present only in mock;
 * 3. the seal precheck passes on every browser binary the configured projects use (the bundled
 *    Chromium, and CfT 155 when it is installed): a sealed browser with no extension must fail
 *    `https://www.facebook.com/` with ERR_NAME_NOT_RESOLVED and load the fake's health page over
 *    `https://www.instagram.com/` with `fake: true` and no interstitial;
 * 4. the fake that answers is built from the working tree (§11 AM26, FID-7): its health reports the
 *    source hash it started with, and it must equal fakeSourceHash() now. `reuseExistingServer`
 *    would otherwise run the suite against a fake started earlier (e.g. by `pnpm run dev`) that
 *    predates an edit of tools/fake-ig or the contract.
 *
 * Playwright starts the `webServer` (the fake) before this runs, or reuses a running one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { keyPath } from '../../tools/chrome/ext-id.ts';
import { assertSealed, HEADLESS_SCREEN_ARGS, readSpki, sealedArgs } from '../../tools/chrome/flags.ts';
import { fakeSourceHash } from '../../tools/fake-ig/source-hash.ts';
import { ARTIFACTS, type ArtifactMode, MANIFEST_NAMES } from './helpers/artifacts.ts';
import { createFakeClient } from './helpers/fake-client.ts';

const fail = (why: string): never => {
  throw new Error(`e2e global setup: ${why}`);
};

function checkArtifacts(): void {
  for (const [mode, dir] of Object.entries(ARTIFACTS) as [ArtifactMode, string][]) {
    const manifestPath = resolve(dir, 'manifest.json');
    if (!existsSync(manifestPath)) fail(`${dir} is missing (pnpm run build:all)`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string;
      key?: string;
      declarative_net_request?: unknown;
    };
    if (manifest.name !== MANIFEST_NAMES[mode])
      fail(`${dir} is named "${manifest.name}", not "${MANIFEST_NAMES[mode]}"`);
    if (manifest.key !== readFileSync(keyPath(mode), 'utf8').trim()) fail(`${dir} does not carry keys/${mode}.pub.b64`);
    const guarded = manifest.declarative_net_request !== undefined;
    if (guarded !== (mode === 'mock')) fail(`${dir}: static write-block ruleset ${guarded ? 'present' : 'missing'}`);
  }
}

async function sealPrecheck(spki: string, executablePath: string | undefined): Promise<void> {
  const label = executablePath ? `CfT ${executablePath}` : 'bundled Chromium';
  const args = [...sealedArgs(spki), ...HEADLESS_SCREEN_ARGS];
  assertSealed(args);
  const userDataDir = await mkdtemp(join(tmpdir(), 'instapost-seal-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: true,
    viewport: null,
    args,
  });
  try {
    // A failed navigation commits an error page later; each navigation gets its own page.
    const outside = await (await context.newPage()).goto('https://www.facebook.com/').then(
      () => 'loaded',
      (err: Error) => err.message,
    );
    if (!outside.includes('net::ERR_NAME_NOT_RESOLVED')) {
      fail(`${label}: www.facebook.com did not fail with ERR_NAME_NOT_RESOLVED (${outside.split('\n')[0]})`);
    }
    const res = await (await context.newPage()).goto('https://www.instagram.com/__fake__/health');
    if (res?.status() !== 200) fail(`${label}: the fake health page answered ${res?.status() ?? 'nothing'}`);
    const body = (await res?.json().catch(() => null)) as { fake?: unknown } | null;
    if (body?.fake !== true) fail(`${label}: www.instagram.com is not the fake (health ${JSON.stringify(body)})`);
    const security = await res?.securityDetails();
    if (security?.subjectName !== 'instapost fake instagram') {
      fail(`${label}: unexpected certificate subject ${security?.subjectName ?? 'none'}`);
    }
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
}

/** The fake that answers must have been started from the sources in the working tree. */
async function checkFakeFresh(): Promise<void> {
  const health = await createFakeClient().health();
  const want = fakeSourceHash();
  if (health.sourceHash !== want) {
    fail(
      `stale fake running on 127.0.0.1:8443 (built from ${health.sourceHash ?? 'unknown sources'}, the working tree is ${want}): ` +
        'stop pnpm run dev or the fake, then rerun',
    );
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const spki = readSpki();
  if (!spki) fail('no valid fake certificate (pnpm run fake:cert)');
  checkArtifacts();
  await checkFakeFresh();
  const browsers = new Set<string | undefined>([undefined]);
  for (const project of config.projects) {
    const exe = (project.use as { executablePath?: string }).executablePath;
    // A project whose browser is not installed fails at launch in its fixture instead.
    if (exe && existsSync(exe)) browsers.add(exe);
  }
  for (const exe of browsers) await sealPrecheck(spki as string, exe);
}
