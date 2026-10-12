/**
 * T3 (strategy §7.11, SG3, SG7, SG11, §11 AM26): the forbidden patterns check-bundle.ts scans the
 * built artifacts for, as data plus pure matchers, so a self-test (patterns.test.ts) proves each one
 * fires on the code it is meant to catch and stays silent on the code the bundles must contain.
 */

export interface Pattern {
  label: string;
  re: RegExp;
}

/** Banned in every bundle file. */
export const EVERY_BUNDLE: readonly Pattern[] = [
  { label: 'signed_body', re: /signed_body/i },
  { label: 'ig_sig_key_version', re: /ig_sig_key_version/i },
  { label: 'x-ig-', re: /x-ig-/i },
  { label: 'x-csrftoken', re: /x-csrftoken/i },
  { label: 'chrome.debugger', re: /chrome\.debugger/ },
  { label: 'world:"MAIN"', re: /world["']?\s*:\s*["'`]MAIN["'`]/ },
  // The fake's readiness and ground-truth hooks (tools/fake-ig/README.md): never for the extension.
  { label: 'fakeGeometry', re: /fakeGeometry/ },
  { label: 'fakeReady', re: /fakeReady/ },
  { label: 'fakeInput', re: /fakeInput/ },
  { label: 'data-testid="fake-', re: /data-testid["']?\s*[:=]\s*["'`]fake-/ },
];

/**
 * Banned in composer-agent.js: no clicks of any kind (method, string-keyed, synthetic `click`
 * event, form submission), no synthetic pointer/keyboard/drag events, no network, no storage of
 * the page or the extension, no fake hooks (§1: the agent never clicks anything in Instagram's page).
 */
export const AGENT_ONLY: readonly Pattern[] = [
  { label: '.click', re: /\.click\b/ },
  { label: '"click"', re: /["'`]click["'`]/ },
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
];

/** Banned in background.js (SG11): the background never makes network requests of its own. */
export const BACKGROUND_ONLY: readonly Pattern[] = [
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

/** The fake's test hooks (`fake-…` test ids) in extension source. */
export const FAKE_TESTID = /testid\W{0,8}fake-/i;

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
