/**
 * Static checks on the build output (strategy §7.11 T1–T5, §5 SG3/SG7/SG8/SG11, §11 AM10).
 * Run after `pnpm run build:all`: `pnpm run check:bundle` (node scripts/check-bundle.ts).
 * Offline: reads files, runs `tsc -p src/core`, never starts a browser or touches the network.
 *
 * - T1 Manifest snapshot per mode: the built manifest equals the one §5 specifies, exactly; the
 *   description's _locales (en, es; AM44) are there with the same keys.
 * - T2 The static `block_ig_writes` ruleset and the `declarative_net_request` key are present in
 *   mock and absent in live; the JSON equals blockRuleset().
 * - T3 Forbidden patterns (tools/bundle/patterns.ts, self-tested): in every bundle; in
 *   composer-agent.js (ux.md IT1: exactly one `.click()`, inside the audited tap helper, and exactly one
 *   click listener, with capture; no string-keyed or borrowed click, file chooser, focus or navigation; no
 *   synthetic events but input/change, no network, no storage, no fake hooks); in background.js (no
 *   network APIs, no clicks) and the editor chunks (no network APIs but
 *   Vite's modulepreload, no Meta-host URLs); the write-endpoint strings outside background.js and
 *   rules/*.json; and the fake's test ids in extension source. F2 (2026-10-12): no E2E hook (the
 *   window-quirk shim and its `__e2e…` storage flags, the portrait shim's off switch) in any live
 *   file, while the mock background.js must carry E2E_HOOK_MARKERS, so the live scan is known to look
 *   for code that exists. AM37: `world:"MAIN"` nowhere but background.js, and there exactly once, as
 *   the portrait shim's executeScript (top frame, injectImmediately, a func, no files); the shim's
 *   body only in background.js, in both modes (live uses the shim too). SH-4 (2026-10-13): any `world`
 *   key that is not a quoted ISOLATED counts (the ExecutionWorld enum, a variable), ExecutionWorld is
 *   named nowhere else, no bundle registers content scripts, and the agent creates no script element.
 *   SH-2: the shim's function, cut out of background.js, runs in a bare node:vm realm (a stand-in
 *   `screen` only) and must give the expected readings, so it is self-contained as executeScript needs.
 * - T4 `tsc -p src/core` passes; src/core uses no chrome./browser./document. and (AM10) imports
 *   only relative `.ts`/`.json` specifiers that stay inside src/core (tests may add `vitest`).
 * - T5 Both artifacts exist at WXT's default paths; the three key-derived extension IDs differ.
 *
 * Extra (recorded in the integrator report): no bundle embeds an absolute path of this checkout,
 * and each artifact ships only its own mode's icons. Exits 1 when anything fails.
 *
 * The in-page lane (docs/inpage.md §8.7, §13; inpage-ui-spec.md) is in every build, the window lane stays as
 * the fallback. What §5 forbade and the in-page lane needs is allowed here deliberately, one allowance at a
 * time, each pinned to an exact shape (the IN_PAGE constants below say why):
 * - T1: `content_scripts`, exactly one: `instagram-page.js`, matches `https://www.instagram.com/*` only, top
 *   frame only, at document_idle (the "New story" entry and the composer's host in the owner's own tab).
 * - T1: `web_accessible_resources`, exactly one: `composer.html` and the chunks, assets and fonts it loads,
 *   matches www only, `use_dynamic_url` (the page sees a per-session host, never the extension id; N3).
 * - T1: the permissions `webRequest` (observational frame watch, OD19; never `webRequestBlocking`) and
 *   `declarativeNetRequest` (as in the build proven live in Arc, 2026-10-14/15).
 * - T2: the frame rules 1020 (X-Frame-Options removed, owner-approved) and 1021 (forged Sec-Fetch-Dest,
 *   owner-approved) are session rules only: their builders give ids in the session range, one tab,
 *   `sub_frame` only; no static ruleset carries a session-range id or a header rule; no bundle calls
 *   `updateDynamicRules`; the two header names appear in background.js only (where the session rules are
 *   built), and must appear there (a positive control for the scan of every other file).
 * - T3: still exactly one MAIN-world call site, the portrait shim's, in background.js; its target is one
 *   frame of one tab: `frameIds:[0]` (the window lane's popup) or `frameIds:[<identifier>]` (the engine frame).
 * - T3: instagram-page.js gets the agent's bans plus no click of any kind, no dispatched event, no network
 *   API, no HTML parsing, no page storage or cookies, no postMessage, and no Meta-host URL but
 *   https://www.instagram.com/ (CONTENT_SCRIPT_ONLY, contentScriptMetaUrls).
 * - T3: the HEIC worker (`assets/heic.worker-*.js`, libheif-js, LGPL-3.0) is the one file besides the
 *   background's rules that may carry XMLHttpRequest/fetch (libheif's Emscripten glue; the worker fetches only
 *   its packaged wasm); Meta hosts stay banned there.
 * - T1 (RL-3): a build that ships libheif's wasm ships `licenses/libheif-LICENSE.txt` (LGPL-3.0 and GPL-3.0)
 *   and `licenses/THIRD-PARTY.txt` (libheif, libde265, their source); tools/bundle/licenses.ts.
 * - T3: the in-page driver's marker exactly once in background.js and nowhere else; the Developer toggles'
 *   storage key (`__e2eInpageToggles`) is an `__e2e…` name, so the live scan for E2E hooks proves it is gone.
 *
 * Repost (docs/repost.md RP-33–RP-35; strategy AM55, owner decision OD20), each pinned to an exact shape:
 * - T1: `optional_host_permissions`, exactly Instagram's image CDN (`https://*.cdninstagram.com/*`,
 *   `https://*.fna.fbcdn.net/*`), requested on the owner's click only; never in `host_permissions`; no
 *   `optional_permissions` key; FORBIDDEN_PERMISSIONS unchanged.
 * - T3: across every editor-side file (not background.js, composer-agent.js, the content script or the HEIC
 *   worker) exactly one `fetch(` besides the modulepreload polyfill: the composer's audited GET, in the same
 *   block as `instapost:cdn-fetch`, with `credentials:"omit"`, `referrerPolicy:"no-referrer"` and
 *   `redirect:"error"` (cdnFetchProblems); the marker exactly once.
 * - T3: `permissions.request` banned in background.js, composer-agent.js and the content script; in editor
 *   chunks only as `({origins:[...CDN_ORIGINS]})` (permissionRequestProblems).
 * - T3: the Meta-host URL scan of editor chunks exempts exactly the two permission patterns (withoutCdnPatterns);
 *   any other Meta URL (a CDN URL literal included) still fails. The content-script scans are unchanged.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FETCH_DEST_RULE_ID, fetchDestRule, XFO_RULE_ID, xfoRule } from '../src/core/ig-contract/frame-rules.ts';
import {
  blockRuleset,
  type DnrRule,
  FRAME_RULE_FIRST_ID,
  SESSION_RULE_IDS,
  STATIC_RULESET_ID,
  STATIC_RULESET_PATH,
} from '../src/core/ig-contract/rules.ts';
import { CDN_ORIGINS } from '../src/core/repost/cdn-url.ts';
import { licenseProblems } from '../tools/bundle/licenses.ts';
import {
  AGENT_ONLY,
  agentClickProblems,
  BACKGROUND_ONLY,
  backgroundMainWorldProblems,
  CDN_FETCH_MARKER,
  CDN_PERMISSION_PATTERNS,
  CONTENT_SCRIPT_ONLY,
  cdnFetchProblems,
  contentScriptMetaUrls,
  E2E_HOOK_MARKERS,
  E2E_HOOKS,
  EDITOR_ONLY,
  EVERY_BUNDLE,
  EXECUTION_WORLD,
  FAKE_TESTID,
  forbiddenDispatches,
  forbiddenEditorFetches,
  hits,
  MAIN_WORLD,
  PORTRAIT_SHIM_MARKER,
  permissionRequestProblems,
  portraitShimRunProblems,
  portraitShimSource,
  WRITE_STRINGS,
  withoutCdnPatterns,
} from '../tools/bundle/patterns.ts';
import { extIdForMode, KEY_MODES } from '../tools/chrome/ext-id.ts';

/** docs/inpage.md §13.7: the HEIC worker Vite emits for the in-page composer (src/raster/heic.worker.ts). */
const HEIC_WORKER = /^assets\/heic\.worker-[\w-]+\.js$/;

/** libheif's wasm, which the worker fetches from the package. */
const HEIC_WASM = /^assets\/libheif-[\w-]+\.wasm$/;

/** docs/inpage.md §10.4: the in-page driver's marker (src/inpage/driver.ts INPAGE_DRIVER_MARKER). */
const INPAGE_MARKER = 'instapost-inpage:modes=check,test,shareTest,post';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

type Mode = 'mock' | 'live';
const MODES: readonly Mode[] = ['mock', 'live'];
const ARTIFACT: Readonly<Record<Mode, string>> = { mock: '.output/chrome-mv3-mock', live: '.output/chrome-mv3-live' };
/** AM44: the manifest's locales (the description; the editor's own copy is in src/ui/catalog.*.ts). */
const LOCALES: readonly string[] = ['en', 'es'];
interface ModeInfo {
  name: string;
  icon: string;
  /** The E2E hooks and the fake guard (mock only). */
  guarded: boolean;
  /** The static write-block ruleset ships. */
  blocked: boolean;
  key: 'mock' | 'live';
}
const MODE_INFO: Readonly<Record<Mode, ModeInfo>> = {
  mock: { name: 'instapost MOCK', icon: 'mock', guarded: true, blocked: true, key: 'mock' },
  live: { name: 'instapost', icon: 'live', guarded: false, blocked: false, key: 'live' },
};

// ---- the in-page lane's allowances (docs/inpage.md §8.7, §13) ------------------------------------------

/**
 * The in-page content script: the entry ("New story") and the composer's host, in the owner's desktop
 * Instagram tab. www only (never i. or any other host), the top frame only (never the engine frame or
 * another site's frame), at document_idle; an unlisted script, so WXT adds no page-visible hello (R25).
 */
const CONTENT_SCRIPT = 'instagram-page.js';
const IN_PAGE_CONTENT_SCRIPTS = [
  { matches: ['https://www.instagram.com/*'], js: [CONTENT_SCRIPT], run_at: 'document_idle', all_frames: false },
];
/**
 * The composer page the content script frames, plus what it loads (its chunks, the HEIC worker and wasm,
 * the fonts). www only; `use_dynamic_url`, so Instagram's page sees a per-session host, never the extension
 * id, and cannot fetch the files by the fixed id (N3).
 */
const COMPOSER_PAGE = 'composer.html';
const IN_PAGE_WEB_ACCESSIBLE = [
  {
    resources: [COMPOSER_PAGE, 'chunks/*', 'assets/*', 'fonts/*'],
    matches: ['https://www.instagram.com/*'],
    use_dynamic_url: true,
  },
];
/**
 * `webRequest`: the engine frame's id, URLs, redirects, status and errors, observed only (OD19: without it a
 * refused first load cannot be told from an off-host one). `declarativeNetRequest`: carried over from the
 * build proven live in Arc (2026-10-14/15); `declarativeNetRequestWithHostAccess` may cover every rule the
 * lane installs, so drop it only after a live check.
 */
const IN_PAGE_PERMISSIONS = ['declarativeNetRequest', 'webRequest'];
/**
 * docs/repost.md RP-33 (AM55, OD20): Instagram's image CDN, an optional host permission the composer requests
 * on the owner's click, for its one audited GET of a picture the page already shows. Pinned twice: the
 * constant the build uses (src/core/repost/cdn-url.ts) must equal the patterns check-bundle knows.
 */
const REPOST_OPTIONAL_HOSTS = [...CDN_PERMISSION_PATTERNS];
/** The two headers the frame rules 1020 and 1021 touch (session rules, one tab, www sub_frame only). */
const FRAME_RULE_HEADERS: readonly RegExp[] = [/x-frame-options/i, /sec-fetch-dest/i];

// ---- reporting --------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(id: string, what: string, problems: string[]): void {
  if (problems.length === 0) {
    passed++;
    console.log(`PASS ${id} ${what}`);
    return;
  }
  failed++;
  console.log(`FAIL ${id} ${what}`);
  for (const p of problems) console.log(`     - ${p}`);
}

// ---- helpers ----------------------------------------------------------------------------

/** Every file under `dir` (relative paths, `/`-separated). Chrome's own `_metadata/` is skipped. */
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(base, full).split('\\').join('/');
    if (rel === '_metadata') continue; // written by Chrome when it loads the unpacked extension
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(rel);
  }
  return out.sort();
}

/** Deep equality for JSON values; returns the first differing path, or null. */
function jsonDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: array vs ${typeof (Array.isArray(a) ? b : a)}`;
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = jsonDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    const missing = kb.filter((k) => !ka.includes(k));
    const extra = ka.filter((k) => !kb.includes(k));
    if (missing.length || extra.length) return `${path}: missing [${missing}] extra [${extra}]`;
    for (const k of ka) {
      const d = jsonDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(a, b) ? null : `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

const TEXT_EXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.txt', '.map']);

// ---- T5 ---------------------------------------------------------------------------------

function t5(): Mode[] {
  const problems: string[] = [];
  const present = MODES.filter((m) => existsSync(resolve(ROOT, ARTIFACT[m], 'manifest.json')));
  for (const m of MODES) if (!present.includes(m)) problems.push(`${ARTIFACT[m]} missing (pnpm run build:all)`);
  const ids = KEY_MODES.map((m) => extIdForMode(m));
  if (new Set(ids).size !== ids.length) problems.push(`key-derived IDs collide: ${ids.join(', ')}`);
  check('T5', 'artifacts at .output/chrome-mv3-{mock,live}; dev/mock/live IDs distinct', problems);
  return present;
}

// ---- T1 ---------------------------------------------------------------------------------

function expectedManifest(m: Mode): Record<string, unknown> {
  const { name, icon, guarded, blocked, key } = MODE_INFO[m];
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { version: string };
  const icons = Object.fromEntries([16, 32, 48, 128].map((s) => [String(s), `icons/${icon}/${s}.png`]));
  return {
    manifest_version: 3,
    name,
    default_locale: 'en',
    description: '__MSG_extDescription__',
    version: pkg.version,
    icons,
    key: readFileSync(resolve(ROOT, 'keys', `${key}.pub.b64`), 'utf8').trim(),
    minimum_chrome_version: '155',
    permissions: [
      'storage',
      'unlimitedStorage',
      'scripting',
      'downloads',
      'declarativeNetRequestWithHostAccess',
      'declarativeNetRequest',
      ...(guarded ? ['declarativeNetRequestFeedback'] : []),
      'webRequest',
    ],
    host_permissions: ['https://www.instagram.com/*', 'https://i.instagram.com/*'],
    optional_host_permissions: REPOST_OPTIONAL_HOSTS,
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
    action: { default_title: name, default_icon: icons },
    commands: { _execute_action: { suggested_key: { default: 'Alt+Shift+S' } } },
    ...(blocked
      ? {
          declarative_net_request: {
            rule_resources: [{ id: STATIC_RULESET_ID, enabled: true, path: STATIC_RULESET_PATH }],
          },
        }
      : {}),
    content_scripts: IN_PAGE_CONTENT_SCRIPTS,
    web_accessible_resources: IN_PAGE_WEB_ACCESSIBLE,
    background: { service_worker: 'background.js' },
  };
}

/**
 * Keys and permissions §5 lists as absent in every mode (a readable second line of defence), less the in-page
 * lane's allowances above: `content_scripts` and `web_accessible_resources` must equal their IN_PAGE shapes
 * exactly, and `webRequest` is observational (`webRequestBlocking` stays banned).
 */
const FORBIDDEN_KEYS = [
  'side_panel',
  'options_page',
  'devtools_page',
  'externally_connectable',
  'sandbox',
  // RP-34: the CDN origins are the only optional permissions, and host ones.
  'optional_permissions',
];
const FORBIDDEN_PERMISSIONS = ['tabs', 'cookies', 'debugger', '<all_urls>', 'webRequestBlocking', 'activeTab'];

function t1(m: Mode): void {
  const dir = resolve(ROOT, ARTIFACT[m]);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const problems: string[] = [];
  const diff = jsonDiff(manifest, expectedManifest(m));
  if (diff) problems.push(`manifest differs from §5: ${diff}`);
  for (const k of FORBIDDEN_KEYS) if (k in manifest) problems.push(`forbidden key ${k}`);
  const perms = [...((manifest.permissions as string[]) ?? []), ...((manifest.host_permissions as string[]) ?? [])];
  for (const p of FORBIDDEN_PERMISSIONS) if (perms.includes(p)) problems.push(`forbidden permission ${p}`);
  // The in-page allowances, spelled out again (the snapshot above already pins them).
  const cs = jsonDiff(manifest.content_scripts, IN_PAGE_CONTENT_SCRIPTS, '$.content_scripts');
  if (cs) problems.push(`content_scripts is not the one in-page script: ${cs}`);
  const war = jsonDiff(manifest.web_accessible_resources, IN_PAGE_WEB_ACCESSIBLE, '$.web_accessible_resources');
  if (war) problems.push(`web_accessible_resources is not the composer's: ${war}`);
  for (const p of IN_PAGE_PERMISSIONS) if (!perms.includes(p)) problems.push(`in-page permission ${p} missing`);
  // RP-34: the repost's optional CDN origins, exactly, and never as granted host permissions.
  const optional = jsonDiff(manifest.optional_host_permissions, REPOST_OPTIONAL_HOSTS, '$.optional_host_permissions');
  if (optional) problems.push(`optional_host_permissions is not the image CDN's two patterns: ${optional}`);
  const cdn = jsonDiff([...CDN_ORIGINS], REPOST_OPTIONAL_HOSTS, 'CDN_ORIGINS');
  if (cdn) problems.push(`src/core/repost/cdn-url.ts CDN_ORIGINS differs from check-bundle's: ${cdn}`);
  for (const h of (manifest.host_permissions as string[]) ?? []) {
    if (/cdninstagram|fbcdn/i.test(h)) problems.push(`image-CDN pattern in host_permissions: ${h}`);
  }
  // Every file the manifest names exists; only this mode's icons ship.
  const files = walk(dir);
  for (const f of Object.values(expectedManifest(m).icons as Record<string, string>)) {
    if (!files.includes(f)) problems.push(`icon ${f} missing`);
  }
  if (!files.includes('background.js')) problems.push('background.js missing');
  if (!files.includes('composer-agent.js')) problems.push('composer-agent.js missing');
  if (!files.includes('editor.html')) problems.push('editor.html missing');
  // AM44: the description's messages, en (default_locale) and es, with the same keys and no empty message.
  const messages = LOCALES.map((l) => `_locales/${l}/messages.json`);
  for (const f of messages) if (!files.includes(f)) problems.push(`${f} missing`);
  if (messages.every((f) => files.includes(f))) {
    const keys = messages.map((f) => {
      const json = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, { message?: unknown }>;
      for (const [k, v] of Object.entries(json)) {
        if (typeof v.message !== 'string' || v.message.trim() === '') problems.push(`${f}: ${k} has no message`);
      }
      return Object.keys(json).sort().join(',');
    });
    if (new Set(keys).size !== 1) problems.push(`_locales keys differ: ${keys.join(' | ')}`);
    if (!keys[0]?.split(',').includes('extDescription')) problems.push('_locales: extDescription missing');
  }
  const otherLocales = files.filter((f) => f.startsWith('_locales/') && !messages.includes(f));
  if (otherLocales.length) problems.push(`unexpected locale files: ${otherLocales.join(', ')}`);
  if (!files.includes(CONTENT_SCRIPT)) problems.push(`${CONTENT_SCRIPT} missing`);
  if (!files.includes(COMPOSER_PAGE)) problems.push(`${COMPOSER_PAGE} missing`);
  const workers = files.filter((f) => HEIC_WORKER.test(f));
  const wasm = files.filter((f) => HEIC_WASM.test(f));
  if (workers.length !== 1 || wasm.length !== 1) {
    problems.push(`expected one HEIC worker and one libheif wasm, found [${workers}] [${wasm}]`);
  }
  // RL-3: libheif (LGPL-3.0) ships with its licence texts and a notice naming it and its source.
  for (const p of licenseProblems(files, (f) => readFileSync(join(dir, f), 'utf8'))) problems.push(p);
  const foreignIcons = files.filter((f) => f.startsWith('icons/') && !f.startsWith(`icons/${MODE_INFO[m].icon}/`));
  if (foreignIcons.length) problems.push(`other modes' icons shipped: ${foreignIcons.join(', ')}`);
  check('T1', `${m} manifest snapshot (§5)`, problems);
}

// ---- T2 ---------------------------------------------------------------------------------

function t2(m: Mode): void {
  const dir = resolve(ROOT, ARTIFACT[m]);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const rulesFile = join(dir, STATIC_RULESET_PATH);
  const rulesFiles = walk(dir).filter((f) => f.startsWith('rules/'));
  const problems: string[] = [];
  if (MODE_INFO[m].blocked) {
    if (!('declarative_net_request' in manifest)) problems.push('declarative_net_request key missing');
    if (!existsSync(rulesFile)) problems.push(`${STATIC_RULESET_PATH} missing`);
    else {
      const diff = jsonDiff(JSON.parse(readFileSync(rulesFile, 'utf8')), blockRuleset());
      if (diff) problems.push(`${STATIC_RULESET_PATH} != blockRuleset(): ${diff}`);
    }
    const extra = rulesFiles.filter((f) => f !== STATIC_RULESET_PATH);
    if (extra.length) problems.push(`unexpected rules files: ${extra.join(', ')}`);
  } else {
    if ('declarative_net_request' in manifest) problems.push('declarative_net_request key present in live');
    if (rulesFiles.length) problems.push(`rules files present in live: ${rulesFiles.join(', ')}`);
  }
  // The in-page frame rules (and every other session-range rule) never ship static.
  for (const f of rulesFiles) {
    const rules = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { id?: unknown; action?: { type?: unknown } }[];
    for (const r of Array.isArray(rules) ? rules : []) {
      if (typeof r.id === 'number' && SESSION_RULE_IDS.includes(r.id)) problems.push(`${f}: session-range id ${r.id}`);
      if (r.action?.type === 'modifyHeaders') problems.push(`${f}: rule ${String(r.id)} modifies headers`);
    }
  }
  check(
    'T2',
    `${m} static write-block ruleset ${MODE_INFO[m].blocked ? 'present and = blockRuleset()' : 'absent'}`,
    problems,
  );
}

/**
 * The in-page frame rules 1020 (X-Frame-Options removed) and 1021 (Sec-Fetch-Dest forged), both approved by
 * the owner (OD15-style decisions, 2026-10-14), from their builders in src/core: frame-range ids inside the
 * session range, one tab named, www `sub_frame` requests only, the one header each, and nothing else; a
 * tab that is not a real tab throws (-1 would cover every service worker's requests).
 */
function t2FrameRules(): void {
  const problems: string[] = [];
  const tab = 7;
  const want = (rule: DnrRule, id: number, header: string, side: 'requestHeaders' | 'responseHeaders') => {
    if (rule.id !== id) problems.push(`rule ${rule.id}: expected id ${id}`);
    if (!SESSION_RULE_IDS.includes(rule.id) || rule.id < FRAME_RULE_FIRST_ID) {
      problems.push(`rule ${rule.id}: outside the frame rules' session range (${FRAME_RULE_FIRST_ID}..)`);
    }
    const c = rule.condition;
    if (jsonDiff(c.tabIds, [tab])) problems.push(`rule ${rule.id}: tabIds ${JSON.stringify(c.tabIds)}`);
    if (jsonDiff(c.resourceTypes, ['sub_frame'])) problems.push(`rule ${rule.id}: resourceTypes not [sub_frame]`);
    if (jsonDiff(c.requestDomains, ['www.instagram.com'])) problems.push(`rule ${rule.id}: not www only`);
    const a = rule.action as unknown as Record<string, unknown>;
    const other = side === 'requestHeaders' ? 'responseHeaders' : 'requestHeaders';
    const ops = (Array.isArray(a[side]) ? a[side] : []) as { header?: unknown }[];
    if (a.type !== 'modifyHeaders' || ops.length !== 1 || ops[0]?.header !== header || other in a) {
      problems.push(`rule ${rule.id}: not one ${side} op on ${header}: ${JSON.stringify(a)}`);
    }
  };
  want(xfoRule(tab), XFO_RULE_ID, 'x-frame-options', 'responseHeaders');
  want(fetchDestRule(tab), FETCH_DEST_RULE_ID, 'sec-fetch-dest', 'requestHeaders');
  const builders: [string, (tabId: number) => DnrRule][] = [
    ['xfoRule', xfoRule],
    ['fetchDestRule', fetchDestRule],
  ];
  for (const [name, build] of builders) {
    for (const bad of [-1, 1.5]) {
      try {
        build(bad);
        problems.push(`${name}(${bad}) did not throw`);
      } catch {
        // Expected: one real tab only.
      }
    }
  }
  check('T2', 'in-page frame rules 1020/1021: session ids, one tab, www sub_frame, one header each', problems);
}

// ---- T3 ---------------------------------------------------------------------------------

function t3(m: Mode): void {
  const dir = resolve(ROOT, ARTIFACT[m]);
  const files = walk(dir).filter((f) => TEXT_EXT.has(extname(f)));
  const problems: string[] = [];
  // RP-35: the audited image-CDN GETs and their markers across every editor-side file.
  let cdnSites = 0;
  let cdnMarkers = 0;
  const absRoot = ROOT.replace(/\/$/, '');
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const label of hits(text, EVERY_BUNDLE)) problems.push(`${f}: ${label}`);
    // AM37: one MAIN-world injection, the portrait shim's, in background.js; none anywhere else (SH-4:
    // however MAIN is spelled). SH-2: the shim's shipped function runs on its own in a bare realm.
    if (f === 'background.js') {
      for (const p of backgroundMainWorldProblems(text)) problems.push(`${f}: ${p}`);
      const shim = portraitShimSource(text);
      if ('problem' in shim) problems.push(`${f}: portrait shim: ${shim.problem}`);
      else for (const p of portraitShimRunProblems(shim.source)) problems.push(`${f}: portrait shim run: ${p}`);
    } else {
      for (const label of hits(text, [MAIN_WORLD, EXECUTION_WORLD])) problems.push(`${f}: ${label}`);
      if (text.includes(PORTRAIT_SHIM_MARKER)) problems.push(`${f}: the portrait shim outside background.js`);
    }
    if (f === 'composer-agent.js') {
      for (const label of hits(text, AGENT_ONLY)) problems.push(`${f}: ${label}`);
      for (const p of agentClickProblems(text)) problems.push(`${f}: ${p}`);
      for (const d of forbiddenDispatches(text)) problems.push(`${f}: dispatchEvent other than input/change: ${d}`);
    }
    if (f === 'background.js') for (const label of hits(text, BACKGROUND_ONLY)) problems.push(`${f}: ${label}`);
    // Session rules only: no bundle installs dynamic rules (they would outlive the run and the browser session).
    if (/updateDynamicRules/.test(text)) problems.push(`${f}: updateDynamicRules`);
    // The frame rules' headers: in background.js (a positive control for this scan), nowhere else.
    for (const re of FRAME_RULE_HEADERS) {
      if (f !== 'background.js' && re.test(text)) problems.push(`${f}: frame-rule header ${re.source}`);
      if (f === 'background.js' && !re.test(text)) problems.push(`${f}: frame-rule header ${re.source} missing`);
    }
    // docs/inpage.md §10.4: the in-page driver is in background.js once, and nowhere else.
    const markers = text.split(INPAGE_MARKER).length - 1;
    if (f === 'background.js' && markers !== 1) {
      problems.push(`${f}: expected the in-page driver's marker once, found ${markers}`);
    }
    if (f !== 'background.js' && markers > 0) problems.push(`${f}: the in-page driver outside background.js`);
    if (f === CONTENT_SCRIPT) {
      // docs/inpage.md §8.7: the content script reads Instagram's DOM, frames, and nothing else.
      for (const label of hits(text, CONTENT_SCRIPT_ONLY)) problems.push(`${f}: ${label}`);
      for (const url of contentScriptMetaUrls(text)) problems.push(`${f}: Meta-host URL ${url}`);
    } else if (HEIC_WORKER.test(f)) {
      // docs/inpage.md §13.7: libheif's Emscripten glue carries XMLHttpRequest and fetch (unused: the worker
      // hands it the wasm bytes), and the worker fetches its own packaged wasm. Meta hosts stay banned.
      for (const label of hits(text, EDITOR_ONLY)) if (label === 'Meta host URL') problems.push(`${f}: ${label}`);
      if (!text.includes('.wasm')) problems.push(`${f}: the HEIC worker without its packaged wasm`);
    } else if (f.endsWith('.js') && f !== 'background.js' && f !== 'composer-agent.js') {
      // RP-35: the two CDN permission patterns are the only Meta-host strings an editor chunk may hold.
      for (const label of hits(withoutCdnPatterns(text), EDITOR_ONLY)) problems.push(`${f}: ${label}`);
      for (const x of forbiddenEditorFetches(text)) {
        problems.push(`${f}: fetch other than modulepreload and the audited CDN GET: ${x}`);
      }
      const cdn = cdnFetchProblems(text);
      cdnSites += cdn.sites;
      cdnMarkers += cdn.markers;
      for (const p of cdn.problems) problems.push(`${f}: ${p}`);
      for (const p of permissionRequestProblems(text)) problems.push(`${f}: ${p}`);
    }
    const editorSide = f.endsWith('.js') && !['background.js', 'composer-agent.js', CONTENT_SCRIPT].includes(f);
    if (!editorSide && text.includes(CDN_FETCH_MARKER))
      problems.push(`${f}: the audited CDN GET outside the editor pages`);
    const writeAllowed = f === 'background.js' || (f.startsWith('rules/') && f.endsWith('.json'));
    if (!writeAllowed) for (const label of hits(text, WRITE_STRINGS)) problems.push(`${f}: ${label}`);
    if (text.includes(absRoot)) problems.push(`${f}: embeds the absolute path ${absRoot}`);
    // F2: the E2E window-quirk shim and its flags are compiled out of live.
    if (!MODE_INFO[m].guarded) for (const label of hits(text, E2E_HOOKS)) problems.push(`${f}: E2E hook ${label}`);
  }
  if (cdnSites !== 1)
    problems.push(`expected exactly one audited image-CDN GET in the editor chunks, found ${cdnSites}`);
  if (cdnMarkers !== 1)
    problems.push(`expected the ${CDN_FETCH_MARKER} marker once in the editor chunks, found ${cdnMarkers}`);
  check('T3', `${m} forbidden patterns (${files.length} files)`, problems);
  if (MODE_INFO[m].guarded) {
    // Positive control: the shim really is in the guarded build, so the live scan above means something.
    const bg = readFileSync(join(dir, 'background.js'), 'utf8');
    const missing = E2E_HOOK_MARKERS.filter((x) => !bg.includes(x));
    check(
      'T3',
      `${m} background.js carries the E2E hooks (positive control for the live scan)`,
      missing.map((x) => `missing ${x}`),
    );
  }
}

/** Extension source (src/, entrypoints/) never names the fake's test hooks; tools/ and tests/ may. */
function t3Source(): void {
  const problems: string[] = [];
  for (const top of ['src', 'entrypoints']) {
    for (const f of walk(resolve(ROOT, top))) {
      if (!/\.(ts|tsx|js|html|css)$/.test(f)) continue;
      const text = readFileSync(resolve(ROOT, top, f), 'utf8');
      text.split('\n').forEach((line, i) => {
        if (FAKE_TESTID.test(line)) problems.push(`${top}/${f}:${i + 1}: fake test id`);
      });
    }
  }
  check('T3', 'src/ and entrypoints/ name no fake- test ids', problems);
}

// ---- T4 ---------------------------------------------------------------------------------

const CORE = resolve(ROOT, 'src/core');
/** Property access on a host global (comments included: a mention in prose rarely has a member after the dot). */
const HOST_GLOBALS = /\b(chrome|browser|document)\.[A-Za-z_$]/;
const SPECIFIERS = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/g,
  /\bimport\s*(['"])([^'"]+)\1/g,
  /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
];

function t4(): void {
  const problems: string[] = [];
  try {
    execFileSync(process.execPath, [resolve(ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', CORE], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const out = `${(err as { stdout?: Buffer }).stdout ?? ''}`.trim().split('\n').slice(0, 10);
    problems.push(`tsc -p src/core failed:\n       ${out.join('\n       ')}`);
  }
  for (const f of walk(CORE).filter((x) => x.endsWith('.ts'))) {
    const file = resolve(CORE, f);
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (HOST_GLOBALS.test(line)) problems.push(`src/core/${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
    const isTest = f.endsWith('.test.ts');
    for (const re of SPECIFIERS) {
      for (const match of text.matchAll(re)) {
        const spec = match[2] ?? '';
        if (!spec.startsWith('.')) {
          if (!(isTest && spec === 'vitest')) problems.push(`src/core/${f}: bare import "${spec}"`);
          continue;
        }
        const target = resolve(dirname(file), spec);
        if (relative(CORE, target).startsWith('..')) problems.push(`src/core/${f}: "${spec}" leaves src/core`);
        else if (!/\.(ts|json)$/.test(spec))
          problems.push(`src/core/${f}: "${spec}" has no explicit .ts/.json extension`);
        else if (!existsSync(target)) problems.push(`src/core/${f}: "${spec}" does not exist`);
      }
    }
  }
  check('T4', 'src/core: tsc passes, no host globals, imports stay inside (AM10)', problems);
}

// ---- main -------------------------------------------------------------------------------

const present: Mode[] = t5();
for (const m of present) {
  t1(m);
  t2(m);
  t3(m);
}
t2FrameRules();
t3Source();
t4();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
