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
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blockRuleset, STATIC_RULESET_ID, STATIC_RULESET_PATH } from '../src/core/ig-contract/rules.ts';
import {
  AGENT_ONLY,
  agentClickProblems,
  BACKGROUND_ONLY,
  backgroundMainWorldProblems,
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
  portraitShimRunProblems,
  portraitShimSource,
  WRITE_STRINGS,
} from '../tools/bundle/patterns.ts';
import { extIdForMode, KEY_MODES } from '../tools/chrome/ext-id.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

type Mode = 'mock' | 'live';
const MODES: readonly Mode[] = ['mock', 'live'];
const ARTIFACT: Readonly<Record<Mode, string>> = { mock: '.output/chrome-mv3-mock', live: '.output/chrome-mv3-live' };
/** AM44: the manifest's locales (the description; the editor's own copy is in src/ui/catalog.*.ts). */
const LOCALES: readonly string[] = ['en', 'es'];
const MODE_INFO: Readonly<Record<Mode, { name: string; icon: string; guarded: boolean }>> = {
  mock: { name: 'instapost MOCK', icon: 'mock', guarded: true },
  live: { name: 'instapost', icon: 'live', guarded: false },
};

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
  const { name, icon, guarded } = MODE_INFO[m];
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as { version: string };
  const icons = Object.fromEntries([16, 32, 48, 128].map((s) => [String(s), `icons/${icon}/${s}.png`]));
  return {
    manifest_version: 3,
    name,
    default_locale: 'en',
    description: '__MSG_extDescription__',
    version: pkg.version,
    icons,
    key: readFileSync(resolve(ROOT, 'keys', `${m}.pub.b64`), 'utf8').trim(),
    minimum_chrome_version: '155',
    permissions: [
      'storage',
      'unlimitedStorage',
      'scripting',
      'downloads',
      'declarativeNetRequestWithHostAccess',
      ...(guarded ? ['declarativeNetRequest', 'declarativeNetRequestFeedback'] : []),
    ],
    host_permissions: ['https://www.instagram.com/*', 'https://i.instagram.com/*'],
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
    action: { default_title: name, default_icon: icons },
    commands: { _execute_action: { suggested_key: { default: 'Alt+Shift+S' } } },
    ...(guarded
      ? {
          declarative_net_request: {
            rule_resources: [{ id: STATIC_RULESET_ID, enabled: true, path: STATIC_RULESET_PATH }],
          },
        }
      : {}),
    background: { service_worker: 'background.js' },
  };
}

/** Keys and permissions §5 lists as absent in every mode (a readable second line of defence). */
const FORBIDDEN_KEYS = ['content_scripts', 'web_accessible_resources', 'side_panel', 'options_page', 'devtools_page'];
const FORBIDDEN_PERMISSIONS = ['tabs', 'cookies', 'webRequest', 'debugger', '<all_urls>', 'webRequestBlocking'];

function t1(m: Mode): void {
  const dir = resolve(ROOT, ARTIFACT[m]);
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const problems: string[] = [];
  const diff = jsonDiff(manifest, expectedManifest(m));
  if (diff) problems.push(`manifest differs from §5: ${diff}`);
  for (const k of FORBIDDEN_KEYS) if (k in manifest) problems.push(`forbidden key ${k}`);
  const perms = [...((manifest.permissions as string[]) ?? []), ...((manifest.host_permissions as string[]) ?? [])];
  for (const p of FORBIDDEN_PERMISSIONS) if (perms.includes(p)) problems.push(`forbidden permission ${p}`);
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
  if (MODE_INFO[m].guarded) {
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
  check(
    'T2',
    `${m} static write-block ruleset ${MODE_INFO[m].guarded ? 'present and = blockRuleset()' : 'absent'}`,
    problems,
  );
}

// ---- T3 ---------------------------------------------------------------------------------

function t3(m: Mode): void {
  const dir = resolve(ROOT, ARTIFACT[m]);
  const files = walk(dir).filter((f) => TEXT_EXT.has(extname(f)));
  const problems: string[] = [];
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
    if (f.endsWith('.js') && f !== 'background.js' && f !== 'composer-agent.js') {
      for (const label of hits(text, EDITOR_ONLY)) problems.push(`${f}: ${label}`);
      for (const x of forbiddenEditorFetches(text)) problems.push(`${f}: fetch other than modulepreload: ${x}`);
    }
    const writeAllowed = f === 'background.js' || (f.startsWith('rules/') && f.endsWith('.json'));
    if (!writeAllowed) for (const label of hits(text, WRITE_STRINGS)) problems.push(`${f}: ${label}`);
    if (text.includes(absRoot)) problems.push(`${f}: embeds the absolute path ${absRoot}`);
    // F2: the E2E window-quirk shim and its flags are compiled out of live.
    if (!MODE_INFO[m].guarded) for (const label of hits(text, E2E_HOOKS)) problems.push(`${f}: E2E hook ${label}`);
  }
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

const present = t5();
for (const m of present) {
  t1(m);
  t2(m);
  t3(m);
}
t3Source();
t4();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
