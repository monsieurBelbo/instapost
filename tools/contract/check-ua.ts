/**
 * Logged-out UA check (strategy §3.9 item 4; also L2 and L11). Manual, at most weekly:
 *   pnpm run contract:check            (refuses to run again within 24 h)
 *   pnpm run contract:check -- --force
 *
 * Sends exactly one logged-out GET of https://www.instagram.com/ per UA: the extension's Android
 * reduced UA and a Mac Chrome UA, both for the pinned Chrome major. It parses `is_mobile` with the
 * same ua-json.ts the agent uses and prints the result.
 *
 * - No cookies, no credentials, redirects are not followed.
 * - The HTML is never written anywhere: it is held in memory only to be parsed. The only file
 *   written is `.cache/contract-check-last.json` (a timestamp, for the 24 h guard).
 * - This is the only script in the repo that talks to the real Instagram. Tests, CI and agents
 *   never run it; the owner runs it by hand (it refuses to run when CI is set).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { androidReducedUa } from '../../src/core/ig-contract/device-profile.ts';
import { type IsMobile, parseIsMobile, UA_JSON_KEY } from '../../src/core/ig-contract/ua-json.ts';
import { IG_ORIGIN } from '../../src/core/ig-contract/urls.ts';
import { CFT_BUILD } from '../chrome/versions.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LAST_RUN_FILE = resolve(ROOT, '.cache/contract-check-last.json');
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PAUSE_BETWEEN_MS = 3000;
const TIMEOUT_MS = 15_000;

export const macChromeUa = (major: number) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;

interface Probe {
  label: string;
  ua: string;
  expected: boolean;
}

interface ProbeResult {
  label: string;
  status: number | null;
  /** Redirect target (origin + path only), when the server redirected. */
  location: string | null;
  keyFound: boolean;
  isMobile: IsMobile | `error: ${string}`;
  expected: boolean;
  bytes: number;
}

function redirectTarget(location: string | null): string | null {
  if (!location) return null;
  try {
    const u = new URL(location, IG_ORIGIN);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(unparseable)';
  }
}

async function probe(p: Probe): Promise<ProbeResult> {
  const res = await fetch(`${IG_ORIGIN}/`, {
    method: 'GET',
    redirect: 'manual',
    credentials: 'omit',
    headers: {
      'user-agent': p.ua,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const location = redirectTarget(res.headers.get('location'));
  let html = await res.text();
  const result: ProbeResult = {
    label: p.label,
    status: res.status,
    location,
    keyFound: html.includes(`"${UA_JSON_KEY}"`),
    isMobile: 'unknown',
    expected: p.expected,
    bytes: html.length,
  };
  try {
    result.isMobile = parseIsMobile(html);
  } catch (err) {
    result.isMobile = `error: ${(err as Error).message}`;
  }
  html = ''; // never kept, never written
  return result;
}

function guard(force: boolean, now: number): void {
  if (process.env.CI) throw new Error('contract:check is manual only; refusing to run with CI set');
  if (force || !existsSync(LAST_RUN_FILE)) return;
  try {
    const last = Date.parse((JSON.parse(readFileSync(LAST_RUN_FILE, 'utf8')) as { at: string }).at);
    if (now - last < MIN_INTERVAL_MS) {
      throw new Error(
        `contract:check ran at ${new Date(last).toISOString()}; at most once a day (strategy §3.9). Use --force to override.`,
      );
    }
  } catch (err) {
    if ((err as Error).message.startsWith('contract:check ran')) throw err;
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const majorArg = args.find((a) => a.startsWith('--major='));
  const major = Number.parseInt(majorArg?.slice('--major='.length) ?? CFT_BUILD.split('.')[0] ?? '', 10);
  if (!Number.isInteger(major) || major < 100) throw new Error(`invalid Chrome major ${major}`);
  const now = Date.now();
  guard(args.includes('--force'), now);

  const probes: Probe[] = [
    { label: 'android-reduced', ua: androidReducedUa(major), expected: true },
    { label: 'mac-chrome', ua: macChromeUa(major), expected: false },
  ];
  console.log(
    `contract:check ${new Date(now).toISOString()}: one logged-out GET of ${IG_ORIGIN}/ per UA (Chrome ${major})`,
  );
  mkdirSync(dirname(LAST_RUN_FILE), { recursive: true });
  writeFileSync(LAST_RUN_FILE, `${JSON.stringify({ at: new Date(now).toISOString() })}\n`);

  const results: ProbeResult[] = [];
  for (const [i, p] of probes.entries()) {
    if (i > 0) await new Promise((ok) => setTimeout(ok, PAUSE_BETWEEN_MS));
    try {
      results.push(await probe(p));
    } catch (err) {
      console.error(`  ${p.label.padEnd(16)} request failed: ${(err as Error).message}`);
      return 2;
    }
  }

  let ok = true;
  for (const r of results) {
    const match = r.isMobile === r.expected;
    ok &&= match;
    console.log(
      [
        `  ${r.label.padEnd(16)}`,
        `HTTP ${r.status}`,
        r.location ? `→ ${r.location}` : '',
        `is_mobile=${String(r.isMobile)}`,
        `(expected ${r.expected})`,
        `key ${r.keyFound ? 'found' : 'MISSING'}`,
        `${Math.round(r.bytes / 1024)} KB`,
        match ? 'OK' : 'DRIFT',
      ]
        .filter(Boolean)
        .join('  '),
    );
  }
  console.log(
    ok
      ? 'verdict: OK, the server still classifies by the User-Agent header (C1).'
      : 'verdict: DRIFT. Do not hand off; record it in docs/contract.md and re-check C1 against the fake (§3.9).',
  );
  return ok ? 0 : 1;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error((err as Error).message);
      process.exit(2);
    },
  );
}
