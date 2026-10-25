/**
 * The in-page kill switch's classification (docs/inpage.md §3.14). Pure.
 *
 * Three questions, three functions:
 *
 * - **Did the engine frame open?** (`frameLoadVerdict`) In this order, so a missing or failed rule 1020 is
 *   never mistaken for an off-host kill: an off-host redirect seen → KILLED_OFFHOST (lock); a security page
 *   → KILLED_CHALLENGE (lock); a login page → NOT_LOGGED_IN (stop); then FRAME_REFUSED (close, no lock) for a
 *   network error (`net::ERR_BLOCKED_BY_RESPONSE` when XFO or `frame-ancestors` refused it), a 4xx or 5xx
 *   document, a load whose document the content script cannot read (Chromium's error page is cross-origin),
 *   or no load within the budget; else the frame is open.
 * - **Where did the frame go?** (`frameUrlVerdict`) The window lane's classifyComposerUrl, unchanged, for
 *   every later URL of the frame (a full navigation seen by webRequest, a pushState seen by the content
 *   script). An unreadable frame after a readable one is off host.
 * - **Where did the page go?** (`pageUrlVerdict`) F8: msite moves `window.top` itself to a checkpoint or a
 *   login page, and the owner may navigate too: a security page (PAGE_CHALLENGE_PATH_PREFIXES, a short
 *   explicit list: RL-1) → KILLED_CHALLENGE (lock, whoever navigated), a login page → NOT_LOGGED_IN, any
 *   other host → PAGE_LEFT (no lock: the owner typed a URL), any other www page → nothing (a same-document
 *   route change, Settings included; a new document ends the run through the content script's port instead).
 */
import { classifyComposerUrl, igPath } from '../ig-contract/urls.ts';

export type FrameStopCode = 'FRAME_REFUSED' | 'NOT_LOGGED_IN' | 'PAGE_LEFT' | 'UNEXPECTED_PAGE';
export type FrameKillCode = 'KILLED_CHALLENGE' | 'KILLED_OFFHOST';

export type FrameVerdict =
  | { kind: 'ok' }
  /** Close, remove the rules, no lock. */
  | { kind: 'stop'; code: FrameStopCode; detail: string }
  /** Close, remove the rules, lock the lane for 7 days (the unchanged kill switch). */
  | { kind: 'kill'; code: FrameKillCode; detail: string };

const OK: FrameVerdict = { kind: 'ok' };

/** What the background saw of the engine frame's first document. */
export interface FrameLoadFacts {
  /** The content script reported the iframe's `load` event. */
  loaded: boolean;
  /** At that load, the content script could read the frame's location (same origin, www). */
  readable: boolean;
  /** The pathname it read, when readable. */
  path: string | null;
  /** The document's final HTTP status (webRequest), null when none was seen. */
  status: number | null;
  /** webRequest onErrorOccurred's error, e.g. `net::ERR_BLOCKED_BY_RESPONSE`. */
  error: string | null;
  /** Every URL the document request went to (onBeforeRequest and redirect targets), in order. */
  urls: readonly string[];
  /** The load budget ran out (30 s). */
  timedOut: boolean;
}

/** Order matters (§3.14): what Instagram sent wins over how Chromium rendered it. */
export function frameLoadVerdict(f: FrameLoadFacts): FrameVerdict {
  for (const url of f.urls) {
    const v = classifyComposerUrl(url);
    if (v.kind === 'kill' && v.code === 'KILLED_OFFHOST')
      return { kind: 'kill', code: v.code, detail: 'redirected off Instagram' };
  }
  for (const url of f.urls) {
    const v = classifyComposerUrl(url);
    if (v.kind === 'kill') return { kind: 'kill', code: v.code, detail: `security page ${igPath(url) ?? '?'}` };
  }
  for (const url of f.urls) {
    if (classifyComposerUrl(url).kind === 'stop') return { kind: 'stop', code: 'NOT_LOGGED_IN', detail: 'login page' };
  }
  if (f.error !== null) return { kind: 'stop', code: 'FRAME_REFUSED', detail: f.error.slice(0, 80) };
  if (f.status !== null && f.status >= 400) return { kind: 'stop', code: 'FRAME_REFUSED', detail: `HTTP ${f.status}` };
  if (f.timedOut && !f.loaded) return { kind: 'stop', code: 'FRAME_REFUSED', detail: 'no load within 30 s' };
  if (f.loaded && !f.readable) return { kind: 'stop', code: 'FRAME_REFUSED', detail: 'the frame shows an error page' };
  if (!f.loaded) return { kind: 'stop', code: 'FRAME_REFUSED', detail: 'not loaded' };
  if (f.path !== null) return framePathVerdict(f.path);
  return OK;
}

/** A frame pathname on www (from the content script): the window lane's rules. */
export function framePathVerdict(path: string): FrameVerdict {
  return frameUrlVerdict(`https://www.instagram.com${path.startsWith('/') ? path : `/${path}`}`);
}

/** A later URL of the engine frame (`undefined`: unreadable, i.e. it left www). */
export function frameUrlVerdict(url: string | undefined): FrameVerdict {
  const v = classifyComposerUrl(url);
  switch (v.kind) {
    case 'ok':
    case 'composer-left':
      return OK;
    case 'stop':
      return { kind: 'stop', code: 'NOT_LOGGED_IN', detail: 'login page in the frame' };
    case 'kill':
      return {
        kind: 'kill',
        code: v.code,
        detail: v.code === 'KILLED_OFFHOST' ? 'the frame left Instagram' : `security page ${igPath(url ?? '') ?? '?'}`,
      };
    case 'unknown-left':
      return { kind: 'stop', code: 'UNEXPECTED_PAGE', detail: `frame on ${igPath(url ?? '') ?? '?'}` };
  }
}

/**
 * RL-1: the desktop page's own security routes. Unlike the frame (msite, which instapost drives and which has
 * no business anywhere but home and the story composer), the desktop page is the owner's: Settings, Edit
 * profile and the other settings routes live under /accounts too, and the owner may open them mid-run
 * ("Uploading — browse freely"). So only these count as a security check there: Instagram's challenge,
 * checkpoint and code-entry flows, and the /accounts interstitials of a suspended, disabled or re-logged-in
 * account (AM17's list). Compared case-insensitively.
 */
export const PAGE_CHALLENGE_PATH_PREFIXES = [
  '/challenge',
  '/checkpoint',
  '/auth_platform',
  '/accounts/suspended',
  '/accounts/disabled',
  '/accounts/onetap',
  '/accounts/password/reset',
] as const;
/** The desktop page's logged-out routes. */
export const PAGE_LOGIN_PATH_PREFIXES = ['/accounts/login', '/accounts/emailsignup'] as const;

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

/**
 * The desktop page's own URL during a run (tabs.onUpdated, or tabs.get after its document went away); null
 * when it changes nothing: every other www route, /accounts/edit and the other settings routes included.
 */
export function pageUrlVerdict(url: string | undefined): FrameVerdict | null {
  const path = url === undefined ? null : igPath(url);
  if (path === null) return { kind: 'stop', code: 'PAGE_LEFT', detail: 'the page left Instagram' };
  const lower = path.toLowerCase();
  if (PAGE_LOGIN_PATH_PREFIXES.some((p) => under(lower, p))) {
    return { kind: 'stop', code: 'NOT_LOGGED_IN', detail: 'the page went to the login page' };
  }
  if (PAGE_CHALLENGE_PATH_PREFIXES.some((p) => under(lower, p))) {
    return { kind: 'kill', code: 'KILLED_CHALLENGE', detail: `the page went to ${path}` };
  }
  return null;
}
