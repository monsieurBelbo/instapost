/**
 * The one flags builder for every sealed browser (strategy §7.4, SG1, SG10).
 *
 * Every value is a single argv element and contains no shell quotes. Both launchers
 * (`wxt` dev through web-ext, and Playwright) take their arguments from here, and every
 * launch path calls `assertSealed()` first.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { certStatus } from '../fake-ig/cert.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const FAKE_PORT = 8443;

/**
 * Allow-list resolver rules: map the two fake hosts to the local fake, everything else
 * to NOTFOUND. Exclusions are evaluated before mappings and the first matching MAP wins,
 * so `MAP *` must be the last MAP (whether CfT 155 honours this ordering is checked in S3/E1).
 */
export const RESOLVER_RULES = [
  `MAP www.instagram.com 127.0.0.1:${FAKE_PORT}`,
  `MAP i.instagram.com 127.0.0.1:${FAKE_PORT}`,
  'MAP * ~NOTFOUND',
  'EXCLUDE localhost',
  'EXCLUDE 127.0.0.1',
].join(',');

/**
 * Empty by decision of spike S3 (2026-10-11, CfT 155.0.8059.39 and Chromium 156.0.8078.4, headed
 * and headless): no Local Network Access prompt and no blocked request on any path we use. Fake
 * pages are themselves served from 127.0.0.1, so their requests are loopback to loopback; the
 * extension SW and the dev editor (modules from http://localhost:3000) are not blocked either.
 * The permission names exist (`local-network-access`, `loopback-network` report "prompt") but are
 * never requested. Do not add `--disable-features=...` here: it would replace, not merge with, the
 * launchers' own `--disable-features` lists (Chrome keeps the last value of a switch).
 */
export const LNA_ARGS: string[] = [];

/**
 * Headless E2E only (spike S8). Headless Chrome's virtual screen is 800x600 at DPR 1, so every
 * popup is clamped to 600 px tall and windowFit() would return SCREEN_TOO_SMALL. This emulates
 * the owner's display (3024x1964 physical = 1512x982 pt at DPR 2, 33 pt menu bar): with it,
 * screen, availTop/availHeight, DPR, popup clamping, frame delta (0, 32) and the fitted inner size
 * (511x909) match a headed run exactly. Values are physical pixels. Never used for headed runs.
 */
export const HEADLESS_SCREEN_ARGS: readonly string[] = [
  '--screen-info={0,0 3024x1964 devicePixelRatio=2 workAreaTop=66}',
];

/**
 * Headless E2E only: the owner's two displays at the first live run (2026-10-12). Spike S11 (CfT
 * 155.0.8059.39 and Playwright's Chromium, headless): `--screen-info` takes several screens as
 * consecutive `{…}` groups, and negative origins; a label needs quotes, which the seal forbids, so
 * none is given. The MacBook is primary (as HEADLESS_SCREEN_ARGS); the 3440x1440 @1 ultrawide sits at
 * (1512,-428) and loses 30 px of work area at the bottom. A window moved onto the ultrawide then reads
 * screen.avail* = 1512,-428 3440x1410, exactly what the owner's editor reported.
 */
export const HEADLESS_DUAL_SCREEN_ARGS: readonly string[] = [
  '--screen-info={0,0 3024x1964 devicePixelRatio=2 workAreaTop=66}{1512,-428 3440x1440 devicePixelRatio=1 workAreaBottom=30}',
];

/** Which emulated screens a headless launch gets. */
export type HeadlessScreens = 'owner' | 'ownerDual';

/** Persistent profile for manual dev under `wxt` (never logged in anywhere, SG2). */
export const DEV_PROFILE_DIR = resolve(ROOT, '.profiles/dev-fake');

export const sealedArgs = (spki: string): string[] => [
  `--host-resolver-rules=${RESOLVER_RULES}`,
  `--ignore-certificate-errors-spki-list=${spki}`,
  '--no-proxy-server',
  '--disable-quic',
  '--no-first-run',
  '--no-default-browser-check',
  ...LNA_ARGS,
];

/**
 * web-ext path (WXT docs pattern, research §8.2). `{ headless: true }` when chrome-launcher runs
 * headless (`HEADLESS=1 pnpm run dev`): the emulated owner screen, as for Playwright (S8, AM26).
 */
export const sealedWebExtArgs = (spki: string, opts: { headless?: boolean } = {}): string[] => [
  ...sealedArgs(spki),
  `--user-data-dir=${DEV_PROFILE_DIR}`,
  ...(opts.headless ? HEADLESS_SCREEN_ARGS : []),
];

/**
 * Playwright path. Never put --user-data-dir here: launchPersistentContext takes the
 * profile directory as a parameter and rejects the flag. Pass `{ headless: true }` whenever the
 * launch is headless, so popups get the emulated owner screen (HEADLESS_SCREEN_ARGS, spike S8), or
 * with `screens: 'ownerDual'` the owner's two displays (HEADLESS_DUAL_SCREEN_ARGS, spike S11).
 */
export const sealedPlaywrightArgs = (
  spki: string,
  extDir: string,
  opts: { headless?: boolean; screens?: HeadlessScreens } = {},
): string[] => [
  ...sealedArgs(spki),
  `--disable-extensions-except=${extDir}`,
  `--load-extension=${extDir}`,
  ...(opts.headless ? (opts.screens === 'ownerDual' ? HEADLESS_DUAL_SCREEN_ARGS : HEADLESS_SCREEN_ARGS) : []),
];

const SPKI_RE = /^[A-Za-z0-9+/]{43}=$/;

/** Flags that would bypass or widen the seal. Matched as `--flag` or `--flag=...`. */
const FORBIDDEN_FLAGS = [
  '--proxy-server',
  '--proxy-pac-url',
  '--proxy-auto-detect',
  '--proxy-bypass-list',
  '--host-rules',
  '--ignore-certificate-errors',
] as const;

/**
 * Throws unless `args` is sealed:
 * - no argument contains a quote character;
 * - exactly one `--host-resolver-rules`, equal to RESOLVER_RULES;
 * - `--no-proxy-server` and `--disable-quic` present;
 * - exactly one `--ignore-certificate-errors-spki-list` holding one SHA-256 SPKI hash;
 * - none of FORBIDDEN_FLAGS (proxies, `--host-rules`, blanket certificate bypass).
 */
export function assertSealed(args: readonly string[]): void {
  const fail = (why: string): never => {
    throw new Error(`instapost: browser arguments are not sealed: ${why}`);
  };
  for (const a of args) {
    if (typeof a !== 'string') fail(`non-string argument ${String(a)}`);
    if (/["'`]/.test(a)) fail(`argument contains a quote: ${a}`);
  }
  const valuesOf = (flag: string) => args.filter((a) => a === flag || a.startsWith(`${flag}=`));
  const rules = valuesOf('--host-resolver-rules');
  if (rules.length !== 1) fail(`expected exactly one --host-resolver-rules, got ${rules.length}`);
  if (rules[0] !== `--host-resolver-rules=${RESOLVER_RULES}`) fail(`unexpected resolver rules: ${rules[0]}`);
  if (!args.includes('--no-proxy-server')) fail('--no-proxy-server missing');
  if (!args.includes('--disable-quic')) fail('--disable-quic missing');
  const spki = valuesOf('--ignore-certificate-errors-spki-list');
  if (spki.length !== 1) fail(`expected exactly one --ignore-certificate-errors-spki-list, got ${spki.length}`);
  const hash = (spki[0] ?? '').slice('--ignore-certificate-errors-spki-list='.length);
  if (!SPKI_RE.test(hash)) fail(`SPKI list must hold exactly one base64 SHA-256 hash, got "${hash}"`);
  for (const flag of FORBIDDEN_FLAGS) {
    const hit = valuesOf(flag);
    if (hit.length > 0) fail(`forbidden flag ${hit[0]}`);
  }
}

/**
 * The fake certificate's SPKI hash from `.fake-ig/spki.txt`, or null when the certificate
 * is missing, unreadable, does not match spki.txt, or expires within 3 days. Callers fail
 * closed on null (`wxt` dev opens no browser; E2E aborts in globalSetup).
 */
export function readSpki(now: number = Date.now()): string | null {
  const status = certStatus(now);
  return status.ok ? status.spki : null;
}
