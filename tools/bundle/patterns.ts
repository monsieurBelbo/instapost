/**
 * T3 (strategy §7.11, SG3, SG7, SG11, §11 AM26): the forbidden patterns check-bundle.ts scans the
 * built artifacts for, as data plus pure matchers, so a self-test (patterns.test.ts) proves each one
 * fires on the code it is meant to catch and stays silent on the code the bundles must contain.
 * portraitShimRunProblems is the one non-textual check: it runs the shim's function, as found in the
 * built background.js, in a bare node:vm realm (SH-2).
 */
import { createContext, runInContext } from 'node:vm';

export interface Pattern {
  label: string;
  re: RegExp;
}

/**
 * AM37, SH-4 (2026-10-13): any `world` key whose value is not a quoted `ISOLATED`, i.e. a MAIN-world
 * injection however MAIN is spelled: the quoted literal, the enum (`world:t.scripting.ExecutionWorld.MAIN`
 * once minified), a variable, a computed value. Banned in every bundle file except background.js, where
 * exactly one is allowed: the portrait shim's executeScript, spelled `world:"MAIN"`
 * (backgroundMainWorldProblems). The built bundles have no other `world` key (2026-10-13).
 */
export const MAIN_WORLD: Pattern = {
  label: 'world: not "ISOLATED"',
  re: /(?<![\w$])world["']?\s*:\s*(?!["'`]ISOLATED["'`])/,
};
/** SH-4: the ExecutionWorld enum's MAIN, dotted or bracketed. Banned everywhere, background.js included. */
export const EXECUTION_WORLD_MAIN: Pattern = {
  label: 'ExecutionWorld.MAIN',
  re: /ExecutionWorld\s*(?:\.\s*MAIN\b|\[\s*["'`]MAIN["'`])/,
};
/** SH-4: any reference to the ExecutionWorld enum. Banned outside background.js. */
export const EXECUTION_WORLD: Pattern = { label: 'ExecutionWorld', re: /ExecutionWorld/ };
/** The one spelling background.js may use, in the portrait shim's call. */
const MAIN_LITERAL = /world["']?\s*:\s*["'`]MAIN["'`]/;

/** Banned in every bundle file (MAIN_WORLD too, outside background.js). */
export const EVERY_BUNDLE: readonly Pattern[] = [
  { label: 'signed_body', re: /signed_body/i },
  { label: 'ig_sig_key_version', re: /ig_sig_key_version/i },
  { label: 'x-ig-', re: /x-ig-/i },
  { label: 'x-csrftoken', re: /x-csrftoken/i },
  { label: 'chrome.debugger', re: /chrome\.debugger/ },
  // The fake's readiness and ground-truth hooks (tools/fake-ig/README.md): never for the extension.
  { label: 'fakeGeometry', re: /fakeGeometry/ },
  { label: 'fakeReady', re: /fakeReady/ },
  { label: 'fakeInput', re: /fakeInput/ },
  { label: 'data-testid="fake-', re: /data-testid["']?\s*[:=]\s*["'`]fake-/ },
  // AM37: no registered content scripts, in any world (the shim is injected per document instead).
  { label: 'registerContentScripts', re: /registerContentScripts/ },
];

/**
 * Banned in composer-agent.js (ux.md IT1, AM39): no click other than the audited helper's (agentClickProblems
 * checks that one), no string-keyed or borrowed clicks, no file chooser, no focus, no navigation, no form
 * submission, no synthetic pointer/keyboard/drag events, no network, no storage of the page or the
 * extension, no fake hooks. The agent taps Instagram's own +, Story and Share through tap.ts, and nothing else.
 */
export const AGENT_ONLY: readonly Pattern[] = [
  { label: '["click"]', re: /\[\s*["'`]click["'`]\s*\]/ },
  { label: '.click.call/apply/bind', re: /\.click\s*\.\s*(?:call|apply|bind)\b/ },
  { label: 'prototype.click', re: /prototype\s*\.\s*click\b/ },
  { label: 'showPicker', re: /showPicker/ },
  { label: '.focus(', re: /\.focus\(/ },
  { label: 'location.assign/replace', re: /location\s*\.\s*(?:assign|replace)\b/ },
  { label: 'location.href=', re: /location\s*\.\s*href\s*=(?!=)/ },
  { label: 'history.pushState/replaceState', re: /history\s*\.\s*(?:pushState|replaceState)\b/ },
  { label: 'requestSubmit/submit()', re: /requestSubmit|\.submit\(/ },
  { label: 'MouseEvent', re: /MouseEvent/ },
  { label: 'PointerEvent', re: /PointerEvent/ },
  { label: 'KeyboardEvent', re: /KeyboardEvent/ },
  { label: 'DragEvent', re: /DragEvent/ },
  { label: 'TouchEvent', re: /TouchEvent/ },
  { label: 'setFileInputFiles', re: /setFileInputFiles/ },
  { label: 'fetch(', re: /fetch\(/ },
  { label: 'XMLHttpRequest', re: /XMLHttpRequest/ },
  { label: 'sendBeacon', re: /sendBeacon/ },
  { label: 'WebSocket', re: /WebSocket/ },
  { label: 'EventSource', re: /EventSource/ },
  { label: 'storage', re: /storage\.|[Ss]torage\b/ },
  { label: 'indexedDB', re: /indexedDB/ },
  { label: 'document.cookie', re: /document\.cookie/ },
  { label: 'caches.', re: /\bcaches\./ },
  { label: 'fake hooks', re: /fake[A-Z]|data-fake-|__fake__/ },
  // SH-4: the agent's realistic route into the page's MAIN world, which no world key shows.
  { label: 'createElement("script")', re: /createElement\(\s*["'`]script["'`]/i },
];

/** Banned in background.js (SG11, ux.md IT2): no network requests of its own, and no clicks. */
export const BACKGROUND_ONLY: readonly Pattern[] = [
  { label: '.click(', re: /\.click\(/ },
  { label: 'fetch(', re: /fetch\(/ },
  { label: 'XMLHttpRequest', re: /XMLHttpRequest/ },
  { label: 'sendBeacon', re: /sendBeacon/ },
  { label: 'WebSocket', re: /WebSocket/ },
  { label: 'EventSource', re: /EventSource/ },
];

/**
 * Banned in the editor's chunks (SG11): network APIs other than Vite's modulepreload polyfill
 * (`fetch(link.href, …)` on extension-local URLs), and any absolute URL on a Meta host.
 */
export const EDITOR_ONLY: readonly Pattern[] = [
  { label: 'XMLHttpRequest', re: /XMLHttpRequest/ },
  { label: 'sendBeacon', re: /sendBeacon/ },
  { label: 'WebSocket', re: /WebSocket/ },
  { label: 'EventSource', re: /EventSource/ },
  {
    label: 'Meta host URL',
    re: /https?:\/\/(?:[a-z0-9-]+\.)*(?:instagram\.com|facebook\.com|fbcdn\.net|cdninstagram\.com|threads\.net|meta\.com)\b/i,
  },
];

/** Write-endpoint strings: only background.js (rehearsal rules) and rules/*.json may hold them. */
export const WRITE_STRINGS: readonly Pattern[] = [
  { label: 'rupload_ig', re: /rupload_ig/ },
  { label: 'configure_to', re: /configure_to/ },
];

/**
 * F2 (2026-10-12): the guarded-only E2E hooks (src/platform/e2e-hooks.ts): the storage.local flags
 * `__e2eWindowQuirk` / `__e2eResizeTimeoutMs` / `__e2ePortraitShimOff` (AM37) and the window-quirk
 * names. Banned in every live bundle
 * file; the mock background must carry E2E_HOOK_MARKERS, which proves the scan would find the shim.
 */
export const E2E_HOOKS: readonly Pattern[] = [
  { label: '__e2e flag', re: /__e2e/ },
  { label: 'quirk arcLate', re: /arcLate/ },
  { label: 'quirk ignoreAll', re: /ignoreAll/ },
];
/** What the mock background.js must contain (the shim is there, so the live check is meaningful). */
export const E2E_HOOK_MARKERS: readonly string[] = [
  '__e2eWindowQuirk',
  '__e2eResizeTimeoutMs',
  '__e2ePortraitShimOff',
  '__e2eDwellScale',
  '__e2eBudgetScale',
];

/** The fake's test hooks (`fake-…` test ids) in extension source. */
export const FAKE_TESTID = /testid\W{0,8}fake-/i;

/**
 * AM37: the portrait shim's own marker key (src/agent/portrait-shim.ts, `Symbol.for('portrait-shim')`),
 * which identifies the shim's function body in a bundle.
 */
export const PORTRAIT_SHIM_MARKER = 'portrait-shim';

/** The text of the call whose `(` is at `open`, up to its matching `)`; strings are skipped. Null if unbalanced. */
function callText(text: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

/** The shape of the one allowed MAIN-world call: the portrait shim's executeScript (scripting.ts). */
const SHIM_CALL_REQUIRES: readonly Pattern[] = [
  { label: 'target:{tabId,…}', re: /target["']?\s*:\s*\{\s*["']?tabId/ },
  { label: 'frameIds:[0]', re: /frameIds["']?\s*:\s*\[\s*0\s*\]/ },
  { label: 'injectImmediately:true', re: /injectImmediately["']?\s*:\s*(?:!0|true)/ },
  { label: 'func:', re: /func["']?\s*:/ },
];
const SHIM_CALL_FORBIDS: readonly Pattern[] = [
  { label: 'files:', re: /files["']?\s*:/ },
  { label: 'allFrames', re: /allFrames/ },
  { label: 'documentIds', re: /documentIds/ },
];

/**
 * AM37, background.js only: problems with its MAIN-world injections. Exactly one non-ISOLATED `world`
 * key is allowed (SH-4: however it is spelled; the ExecutionWorld enum's MAIN never), and it must be
 * the quoted literal `world:"MAIN"`, as an argument of an `executeScript(…)` call next to the shim's
 * known marker `injectImmediately` (no other call has it), targeting one tab's top frame
 * (`frameIds:[0]`), with a `func` and no `files`, `allFrames` or `documentIds`; and the shim's body
 * (PORTRAIT_SHIM_MARKER) is in the file exactly once. An empty list means it is the portrait shim's
 * call and nothing else.
 */
export function backgroundMainWorldProblems(text: string): string[] {
  const at = [...text.matchAll(new RegExp(MAIN_WORLD.re.source, 'g'))].map((m) => m.index ?? 0);
  const problems: string[] = [];
  if (at.length !== 1) {
    problems.push(`expected exactly one non-ISOLATED world key (the portrait shim's), found ${at.length}`);
  }
  const enumMain = [...text.matchAll(new RegExp(EXECUTION_WORLD_MAIN.re.source, 'g'))].length;
  if (enumMain > 0) problems.push(`ExecutionWorld.MAIN found ${enumMain} time(s): the shim's call spells "MAIN"`);
  for (const i of at) {
    if (!MAIN_LITERAL.test(text.slice(i, i + 40))) {
      problems.push(`a world key that is not the literal "MAIN": …${text.slice(Math.max(0, i - 40), i + 60)}…`);
      continue;
    }
    const open = text.lastIndexOf('executeScript(', i);
    const call = open < 0 ? null : callText(text, open + 'executeScript'.length);
    const snippet = text.slice(Math.max(0, i - 40), i + 40);
    if (call === null || open + 'executeScript'.length + call.length < i) {
      problems.push(`world:"MAIN" outside an executeScript call: …${snippet}…`);
      continue;
    }
    for (const p of SHIM_CALL_REQUIRES)
      if (!p.re.test(call)) problems.push(`MAIN-world call lacks ${p.label}: ${call}`);
    for (const p of SHIM_CALL_FORBIDS) if (p.re.test(call)) problems.push(`MAIN-world call has ${p.label}: ${call}`);
  }
  const shims = text.split(PORTRAIT_SHIM_MARKER).length - 1;
  if (shims !== 1) problems.push(`expected the portrait shim's body (${PORTRAIT_SHIM_MARKER}) once, found ${shims}`);
  return problems;
}

/**
 * SH-2: the portrait shim's function as background.js ships it: the declaration `function <f>(…){…}`
 * of the identifier the MAIN-world call passes as `func:<f>`, the one whose body holds the shim's
 * marker. A problem instead when the bundle has another shape (an inline function, an arrow, a renamed
 * or duplicated declaration): the check then fails closed and the extractor needs a look.
 */
export function portraitShimSource(text: string): { source: string } | { problem: string } {
  const at = text.search(MAIN_LITERAL);
  const open = at < 0 ? -1 : text.lastIndexOf('executeScript(', at);
  const call = open < 0 ? null : callText(text, open + 'executeScript'.length);
  const func = call ? /func["']?\s*:\s*([A-Za-z_$][\w$]*)\s*[,}]/.exec(call)?.[1] : undefined;
  if (!func) return { problem: 'no `func:<identifier>` in the MAIN-world call' };
  const marker = text.indexOf(PORTRAIT_SHIM_MARKER);
  const decl = new RegExp(`(?<![\\w$.])function\\s+${func.replace(/\$/g, '\\$')}\\s*\\(`, 'g');
  const found: string[] = [];
  for (const m of text.matchAll(decl)) {
    const start = m.index ?? 0;
    const paramsOpen = start + m[0].length - 1;
    const params = callText(text, paramsOpen);
    if (params === null) continue;
    const bodyOpen = text.slice(paramsOpen + params.length).search(/\S/) + paramsOpen + params.length;
    if (text[bodyOpen] !== '{') continue;
    const body = callText(text, bodyOpen);
    if (body === null) continue;
    const end = bodyOpen + body.length;
    if (start < marker && marker < end) found.push(text.slice(start, end));
  }
  if (found.length !== 1 || found[0] === undefined) {
    return { problem: `expected one \`function ${func}(…)\` holding ${PORTRAIT_SHIM_MARKER}, found ${found.length}` };
  }
  return { source: found[0] };
}

/** A stand-in `screen` for portraitShimRunProblems, built inside the realm (no outer objects leak in). */
const SCREENS = {
  landscape: `class SO { get type() { return 'landscape-primary'; } get angle() { return 90; } }
    globalThis.screen = { orientation: new SO() };`,
  portrait: `class SO { get type() { return 'portrait-primary'; } get angle() { return 0; } }
    globalThis.screen = { orientation: new SO() };`,
  none: 'globalThis.screen = {};',
  throwing: `class SO { get type() { throw new Error('page tampered'); } }
    globalThis.screen = { orientation: new SO() };`,
} as const;

/**
 * SH-2: runs the shim's serialised function (portraitShimSource) the way executeScript does, with
 * `install` as its only argument, in a fresh node:vm realm that has the language's own globals and a
 * stand-in `screen`, nothing else, and checks every result. A bundler helper (`__name`, `__publicField`)
 * or any free identifier other than `screen` throws there; the shim's try/catch would turn that into a
 * `failed` reading, which these expected results never contain where it matters, so the build fails.
 */
export function portraitShimRunProblems(source: string): string[] {
  const problems: string[] = [];
  const run = (screen: keyof typeof SCREENS, script: string): unknown => {
    const ctx = createContext({});
    runInContext(SCREENS[screen], ctx, { timeout: 1000 });
    runInContext(`globalThis.__shim = (${source});`, ctx, { timeout: 1000 });
    return JSON.parse(runInContext(`JSON.stringify(${script})`, ctx, { timeout: 1000 }) as string);
  };
  const check = (what: string, screen: keyof typeof SCREENS, script: string, want: unknown): void => {
    let got: unknown;
    try {
      got = run(screen, script);
    } catch (err) {
      // The realm's own Error is not this realm's: read the message by shape.
      const message = (err as { message?: unknown } | null)?.message;
      problems.push(`${what}: threw ${typeof message === 'string' ? message : String(err)}`);
      return;
    }
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      problems.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
  };
  const installed = { type: 'portrait-primary', shim: 'installed' };
  const present = { type: 'portrait-primary', shim: 'present' };
  check('landscape screen', 'landscape', '__shim(true)', installed);
  check(
    'installed, then injected again',
    'landscape',
    '[__shim(true), __shim(true), screen.orientation.type, screen.orientation.angle, Object.keys(screen.orientation)]',
    [installed, present, 'portrait-primary', 0, ['angle', 'type']],
  );
  check('install false', 'landscape', '__shim(false)', { type: 'landscape-primary', shim: 'off' });
  check('portrait screen', 'portrait', '__shim(true)', { type: 'portrait-primary', shim: 'portrait' });
  check('no screen.orientation', 'none', '__shim(true)', { type: null, shim: 'absent' });
  check('a getter that throws', 'throwing', '__shim(true)', { type: null, shim: 'failed' });
  return problems;
}

/** ux.md IT1: the audited tap helper's marker, the string its one click is returned with. */
export const TAP_MARKER = 'instapost:tap';

/**
 * Skips a quoted string or a comment starting at `i` in `text`; returns the index after it, or `i` when
 * none starts there. Regex literals are not tracked (the agent bundle has none that contain quotes).
 */
function skipQuoted(text: string, i: number): number {
  const ch = text[i];
  if (ch === '"' || ch === "'" || ch === '`') {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === '\\') j++;
      else if (text[j] === ch) return j + 1;
    }
    return text.length;
  }
  if (ch === '/' && text[i + 1] === '/') {
    const end = text.indexOf('\n', i);
    return end < 0 ? text.length : end + 1;
  }
  if (ch === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return i;
}

/**
 * Whether `to` is inside the same block as `from` (from < to): scanning forward from `from`, no `}` closes
 * the block `from` sits in before `to` (strings and comments skipped).
 */
export function sameBlock(text: string, from: number, to: number): boolean {
  let depth = 0;
  for (let i = from; i < to; i++) {
    const skip = skipQuoted(text, i);
    if (skip !== i) {
      i = skip - 1;
      continue;
    }
    const ch = text[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return true;
}

/**
 * ux.md IT1, composer-agent.js only: exactly one `.click()` call, inside the block that returns the audited
 * helper's marker (TAP_MARKER, present once); exactly one `click` string, as the first argument of an
 * `addEventListener(` whose options set `capture`; no other occurrence of `.click` at all. An empty list
 * means the bundle's only click is tap.ts's and its only click listener is observeClick's.
 */
export function agentClickProblems(text: string): string[] {
  const problems: string[] = [];
  const calls = [...text.matchAll(/\.click\s*\(\s*\)/g)].map((m) => m.index ?? 0);
  const any = [...text.matchAll(/\.click\b/g)].length;
  if (calls.length !== 1) problems.push(`expected exactly one .click() call (the tap helper's), found ${calls.length}`);
  if (any !== calls.length) problems.push(`.click used other than as a call ${any - calls.length} time(s)`);
  const markers = text.split(TAP_MARKER).length - 1;
  if (markers !== 1) problems.push(`expected the tap helper's marker (${TAP_MARKER}) once, found ${markers}`);
  const at = calls[0];
  const marker = text.indexOf(TAP_MARKER);
  if (calls.length === 1 && at !== undefined && markers === 1 && !(marker > at && sameBlock(text, at, marker))) {
    problems.push(`the .click() is not in the tap helper (the block that returns ${TAP_MARKER})`);
  }
  const literals = [...text.matchAll(/["'`]click["'`]/g)].map((m) => m.index ?? 0);
  if (literals.length !== 1) {
    problems.push(`expected exactly one "click" string (observeClick's listener), found ${literals.length}`);
  }
  for (const i of literals) {
    const before = text.slice(Math.max(0, i - 40), i);
    const open = before.search(/addEventListener\(\s*$/);
    if (open < 0) {
      problems.push(
        `a "click" string that is not addEventListener's first argument: …${text.slice(Math.max(0, i - 40), i + 30)}…`,
      );
      continue;
    }
    const callOpen = i - (before.length - open) + 'addEventListener'.length;
    const call = callText(text, callOpen);
    if (call === null || !/capture["']?\s*:\s*(?:!0|true)/.test(call)) {
      problems.push(`the click listener does not set capture: ${call ?? text.slice(i, i + 60)}`);
    }
  }
  return problems;
}

export function hits(text: string, patterns: readonly Pattern[]): string[] {
  return patterns.filter((p) => p.re.test(text)).map((p) => p.label);
}

/** The only events the agent may dispatch: `new <realm>.Event('input' | 'change', …)` (§3.8, AM3). */
const ALLOWED_DISPATCH = /^dispatchEvent\(\s*new\s+[\w$.]*\bEvent\(\s*["'`](?:input|change)["'`]/;

/** Every `dispatchEvent(` in the agent that is not an allowed input/change Event, as snippets. */
export function forbiddenDispatches(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/dispatchEvent\(/g)) {
    const at = m.index ?? 0;
    const snippet = text.slice(at, at + 80);
    if (!ALLOWED_DISPATCH.test(snippet)) out.push(snippet.slice(0, 60));
  }
  return out;
}

/** Vite's modulepreload polyfill: `fetch(<link>.href, <init>)`. */
const PRELOAD_FETCH = /^fetch\(\s*[\w$]+\.href\s*,/;

/** Every `fetch(` in an editor chunk other than the modulepreload polyfill, as snippets. */
export function forbiddenEditorFetches(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bfetch\(/g)) {
    const at = m.index ?? 0;
    const snippet = text.slice(at, at + 60);
    if (!PRELOAD_FETCH.test(snippet)) out.push(snippet);
  }
  return out;
}
