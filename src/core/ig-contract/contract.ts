/**
 * The versioned msite composer contract C1–C9 (strategy §3.9) and the structures that
 * carry it: the agent's ProbeReport and baseline.json.
 *
 * No probe matches visible text or ARIA labels: the owner may use a Spanish UI and the
 * fake runs `en` and `es`. docs/contract.md gives each item's evidence and last-verified date.
 */
import type { ChMode } from './device-profile.ts';
import { type ComposerRoute, classifyComposerUrl } from './urls.ts';

export const CONTRACT_VERSION = 1;

/** `C3` is C3a since AM37 (2026-10-12): the viewport at the story session start; `C3b` the screen orientation. */
export type ContractId =
  | 'C1'
  | 'C2'
  | 'C3'
  | 'C3b'
  | 'C4'
  | 'C5'
  | 'C6'
  | 'C7'
  | 'C8'
  | 'C9'
  | 'C10'
  | 'C11'
  | 'C12'
  | 'C13'
  | 'C14';

export interface ContractItem {
  id: ContractId;
  item: string;
  probe: string;
  /** Who evaluates it. */
  by: 'agent' | 'background';
  /** false = diagnostics only, never drives a decision (C7). */
  decides: boolean;
  /** Stored on every Handoff record by the preflight (C1–C5, C8). */
  preflight: boolean;
}

export const CONTRACT: readonly ContractItem[] = [
  {
    id: 'C1',
    item: 'InstagramUserAgent.is_mobile === true',
    probe:
      'First script[type="application/json"] containing "InstagramUserAgent", then "is_mobile"\\s*:\\s*(true|false); missing = unknown (ua-json.ts)',
    by: 'agent',
    decides: true,
    preflight: true,
  },
  {
    id: 'C2',
    item: 'Logged in',
    probe: 'Final URL is not a login pattern (urls.ts)',
    by: 'background',
    decides: true,
    preflight: true,
  },
  {
    id: 'C3',
    item: 'C3a: portrait viewport, the check msite makes at + → Story (startStoryCreationSession)',
    probe: 'innerHeight >= innerWidth',
    by: 'agent',
    decides: true,
    preflight: true,
  },
  {
    id: 'C3b',
    item: 'C3b: the composer page reads a portrait screen (PolarisStoryCreationPage isLandscape, AM37)',
    probe:
      'screen.orientation.type as the page reads it after the MAIN-world portrait shim (its executeScript result); on /create/story a landscape type, an unreadable reading, or a shim installed only after the composer mounted → SCREEN_LANDSCAPE',
    by: 'background',
    decides: true,
    preflight: true,
  },
  {
    id: 'C4',
    item: 'Story input',
    probe: 'An input[type=file] whose accept list, split on commas and trimmed, set-equals STORY_ACCEPT',
    by: 'agent',
    decides: true,
    preflight: true,
  },
  {
    id: 'C5',
    item: '/create/story/ reachable directly',
    probe: 'Final URL',
    by: 'background',
    decides: true,
    preflight: true,
  },
  {
    id: 'C6',
    item: 'Composer ready',
    probe: 'A visible <canvas> with CSS area >= 50% of the viewport and backing size > 0',
    by: 'agent',
    decides: true,
    preflight: false,
  },
  {
    id: 'C7',
    item: 'Error toasts',
    probe: 'Diagnostics only (text-dependent)',
    by: 'agent',
    decides: false,
    preflight: false,
  },
  {
    id: 'C8',
    item: 'Canvas geometry',
    probe: 'Backing size, CSS rect, DPR, inner size',
    by: 'agent',
    decides: true,
    preflight: true,
  },
  {
    id: 'C9',
    item: 'Composer left (diagnostic since AM39: going home after Share is corroboration only)',
    probe: 'URL leaves /create/story',
    by: 'background',
    decides: false,
    preflight: false,
  },
  {
    id: 'C10',
    item: 'The + entry and its menu (ux.md §10, unverified L18)',
    probe:
      'The story input (C4), its form[role=presentation], the sibling post form and the single svg pressable in the previous sibling box; after its tap a new [role=dialog] with exactly two outermost pressables',
    by: 'agent',
    decides: true,
    preflight: false,
  },
  {
    id: 'C11',
    item: 'The story session armed by Story (startStoryCreationSession, then input.click())',
    probe: 'The story input receives a click within 3 s of the Story tap (a capture listener)',
    by: 'agent',
    decides: true,
    preflight: false,
  },
  {
    id: 'C12',
    item: 'The composer drew the photo and shows one Share control',
    probe:
      'canvas._aa3c with width > 0, header._aa3d, no ._aa3b snackbar, one visible footer (not _aa3k) with one button (v1) or [role=button] (v2), quiet for 1.5 s',
    by: 'agent',
    decides: true,
    preflight: false,
  },
  {
    id: 'C13',
    item: 'The outcome: Instagram’s upload and publish requests after Share (ux.md §6)',
    probe:
      'Resource timing entries: i.instagram.com/rupload_igphoto/fb_uploader_<n>, /api/v1/media/configure_to_story/ (status, content type, redirect)',
    by: 'background',
    decides: true,
    preflight: false,
  },
  {
    id: 'C14',
    item: 'The logged-in account',
    probe: 'The one navigation link to /<username>/ holding an img or svg (feed links ignored)',
    by: 'agent',
    decides: true,
    preflight: false,
  },
];

/** C4: the story input's accept set (research §2 fn 5). */
export const STORY_ACCEPT = ['image/avif', 'image/jpeg', 'image/png'] as const;
/** C6: minimum share of the viewport's CSS area covered by the composer canvas. */
export const C6_MIN_VIEWPORT_AREA = 0.5;
/** C9: how long the C6 canvas may be gone before the composer counts as left. */
export const C9_CANVAS_GONE_MS = 2000;

/** SG4: guarded builds hand off only when the agent sees `<meta name=FAKE_MARKER_META>`. A DOM read, never a network probe. */
export const FAKE_MARKER_META = 'instapost-fake-instagram';

/**
 * F3 (2026-10-12, logged-out reading of production msite): msite renders the mobile header, with
 * the + → Story entry and its hidden story input, only while the viewport is at most this many CSS
 * px wide (IGDS `nav-bottom-screen-max`). At 768 px and more there is no create entry at all, so
 * the composer window must stay at or below it (window-fit.ts, probe-eval.ts row 5).
 */
export const MSITE_MAX_CSS_WIDTH = 767;

/**
 * AM37 (2026-10-12, live in Arc and Instagram's public bundles): msite makes two different
 * orientation checks. (1) `startStoryCreationSession`, at + → Story before the file chooser opens:
 * `innerHeight < innerWidth` → a "Rotate your device" toast and no chooser (C3a, the viewport).
 * (2) `PolarisStoryCreationPage`, once the composer is mounted with the photo: `isLandscape` from
 * `screen.orientation.type` (else `window.orientation`, else the viewport), read at mount and on
 * every `resize`; landscape shows the same text as a snackbar and hides the header and the Share
 * footer (C3b, the screen). A desktop with a landscape monitor is therefore always "landscape" to
 * the composer, whatever the window. The portrait shim (src/agent/portrait-shim.ts) makes the page
 * read a portrait screen; these are what it reports from the page's MAIN world.
 *
 * - `installed`: the screen read landscape, and the shim installed its own `type`/`angle` getters on
 *   this document's ScreenOrientation instance just now;
 * - `present`: the shim's getters were already there (an earlier injection into the same document);
 * - `portrait`: the screen already reads portrait: nothing to do, nothing installed;
 * - `absent`: the page has no `screen.orientation` (Instagram then falls back further): not installed;
 * - `failed`: the getters could not be defined, another own `type` was already on the instance, the
 *   shim threw in the page (its type then null unless it could still be read: SH-2), or its result was
 *   malformed (`{type: null}`, protocol.ts toPageOrientation);
 * - `off`: a guarded build's E2E flag switched the shim off (it only read the type).
 */
export const ORIENTATION_SHIM_STATES = ['installed', 'present', 'portrait', 'absent', 'failed', 'off'] as const;
export type OrientationShimState = (typeof ORIENTATION_SHIM_STATES)[number];

/** AM37: the screen orientation as the composer page reads it, and what the portrait shim did there. */
export interface PageOrientation {
  /**
   * `screen.orientation.type` as the page's own scripts read it, after the shim; null when the page has
   * no `screen.orientation` (`absent`) or when the reading could not be had (`failed`: the shim threw, or
   * its result was malformed).
   */
  type: string | null;
  shim: OrientationShimState;
  /**
   * SH-1 (2026-10-13): set by the background, never by the page (toPageOrientation drops it). The shim
   * installed itself (`installed`) on the composer, which a commit of the same document had reached
   * since the previous injection (the pick's SPA navigation, or one after the reload's own commit): the
   * composer page mounted, and read the landscape screen, before the shim was there. Instagram reads it
   * again only on `resize`, so the composer keeps its rotate snackbar although the page now reads
   * portrait. C3b fails and, on the composer, SCREEN_LANDSCAPE ends the hand-off.
   */
  afterComposerMount?: true;
}

/** What the shim's getter returns for `screen.orientation.type` (its `angle` returns 0). */
export const PORTRAIT_ORIENTATION_TYPE = 'portrait-primary';

/** C3b: an orientation type the composer treats as landscape (`landscape-primary`, `landscape-secondary`). */
export function isLandscapeType(type: string | null): boolean {
  return type?.startsWith('landscape') === true;
}

/**
 * SH-2: a reading that says nothing about the screen: the shim failed (it threw in the page, or its
 * result was malformed) before it could read a type. The page's real `screen.orientation.type` still
 * exists, and on a landscape monitor it is landscape, so this never counts as portrait.
 */
export function isUnreadableOrientation(o: PageOrientation): boolean {
  return o.shim === 'failed' && o.type === null;
}

/**
 * C3b (AM37, SH-1, SH-2) from the shim's reading: `fail` when the page reads a landscape type, or the
 * shim went in only after the composer had mounted; `unknown` without a reading or with an unreadable
 * one; `pass` otherwise (a portrait type, or no `screen.orientation` at all: Instagram then falls back
 * to `window.orientation`, absent on desktop, and to the viewport, portrait in the fitted window).
 */
export function c3bOf(o: PageOrientation | null | undefined): CheckResult {
  if (!o) return 'unknown';
  if (isLandscapeType(o.type) || o.afterComposerMount === true) return 'fail';
  return isUnreadableOrientation(o) ? 'unknown' : 'pass';
}

/** An accept list that names image types only. */
export function isImageOnlyAccept(accept: string): boolean {
  const list = accept
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return list.length > 0 && list.every((t) => /^image\//i.test(t));
}

/**
 * C4/C10: the post input's accept set, beside the story input (PolarisMobileCreationNavItem passes
 * `["image/jpeg"]`, logged-out reading 2026-10-13). It names an image type only, so the candidate rule
 * excludes it by its exact set; otherwise a page without the story input would read as ACCEPT_DRIFT
 * instead of INPUT_MISSING.
 */
export const POST_ACCEPT = ['image/jpeg'] as const;

/** C4 candidate rule: an image-only accept list that is not the post input's (`image/jpeg` alone). */
export function isStoryCandidateAccept(accept: string): boolean {
  return isImageOnlyAccept(accept) && !acceptSetEquals(accept, POST_ACCEPT);
}

/** PerformanceNavigationTiming.type of the probed document; `unknown` when it cannot be read. */
export const NAV_TYPES = ['navigate', 'reload', 'back_forward', 'prerender', 'unknown'] as const;
export type NavType = (typeof NAV_TYPES)[number];

/** C4 set equality: split on commas, trim, ignore empties and order; case-sensitive. */
export function acceptSetEquals(accept: string, expected: readonly string[] = STORY_ACCEPT): boolean {
  const seen = new Set(
    accept
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  );
  return seen.size === new Set(expected).size && expected.every((e) => seen.has(e));
}

/** What the agent reports for `agent/probe` (strategy §3.5). Structural facts only. */
export interface ProbeReport {
  /** SG4 fake marker present. */
  marker: boolean;
  /** C1. */
  isMobile: true | false | 'unknown';
  /** C3/C8: window.innerWidth/innerHeight. */
  inner: { w: number; h: number };
  dpr: number;
  /** C3. */
  portrait: boolean;
  /**
   * navigator.serviceWorker.controller !== null, as seen from the isolated world. Diagnostics only
   * (P1, 2026-10-12): Instagram re-registers its root worker on every logged-in load and the new
   * worker claims the page within about 1 s (F2), so a controlled composer is normal. What matters is
   * whether the worker intercepts requests (`swIntercepted`).
   */
  swControlled: boolean | 'unknown';
  /**
   * P3 tripwire: a www/i.instagram.com PerformanceResourceTiming entry with `workerStart > 0`, or a
   * navigation entry with `workerStart > 0` whose type is not `reload`: a service worker handled the
   * page's requests, so they left without the tab-scoped rule 1001 (SW_INTERCEPTS). `unknown` when the
   * performance timeline cannot be read.
   */
  swIntercepted: boolean | 'unknown';
  /** The navigation entry's type (`reload` after the hard reload), for the record. */
  navType: NavType;
  /**
   * C4: a candidate story input exists, i.e. an input[type=file] whose accept list names only
   * image types (the post input also accepts video, so it never counts). `absent` → INPUT_MISSING.
   * src/agent/probes.ts owns the exact rule (B6).
   */
  storyInput: 'present' | 'absent';
  /** C4: the candidate's accept list set-equals STORY_ACCEPT. `false` with `present` → ACCEPT_DRIFT. */
  acceptOk: boolean;
  /** The accept lists seen, for drift diagnostics. */
  acceptSeen?: string[];
  /** C8: the largest visible canvas, if any. */
  canvas?: { w: number; h: number; css: { x: number; y: number; w: number; h: number } };
  /** document language (html[lang]). */
  lang: string;
  /**
   * C3b (AM37): the screen orientation the page reads after the portrait shim, and the shim's state in
   * that document. The background sets it from the shim injection's result when the report arrives;
   * the agent cannot see it (an isolated world reads the native getter) and any value it sends is
   * dropped (normalizeProbeReport). Absent on records of earlier builds.
   */
  orientation?: PageOrientation;
  /**
   * ux.md C14 (IA5): the account Instagram's navigation names (the one link to `/<username>/`), or null
   * when none or several were found (`candidates` counts the distinct handles seen). Absent on records of
   * earlier builds.
   */
  account?: { handle: string | null; candidates: number };
  /** ux.md C10 (IA5): the + entry beside the story input was found structurally. */
  entryFound?: boolean;
  /** ux.md §10 (IA5): navigator.userActivation as the page has it (the owner clicking in the window). */
  activation?: { isActive: boolean; hasBeenActive: boolean };
  /** ux.md §4.6 (IA5): the page's visibilityState (Instagram throttles hidden pages). */
  visibility?: 'visible' | 'hidden';
}

export type CheckResult = 'pass' | 'fail' | 'unknown';

/**
 * The preflight stored on every Handoff record (§3.9 item 1): C1–C5, C8 and the service-worker
 * state, judged from one probe. The settings page shows the last 20. Structural facts only.
 */
export interface Preflight {
  contractVersion: number;
  /** is_mobile: true → pass, false → fail, missing → unknown. */
  C1: CheckResult;
  /** Logged in: the tab URL is not a login URL (unknown without a URL). */
  C2: CheckResult;
  /** C3a (AM37): a portrait viewport, as msite's story session start requires. */
  C3: CheckResult;
  /**
   * C3b (AM37): the page reads a portrait (not landscape) screen orientation after the portrait shim,
   * and the shim was there before the composer mounted (SH-1); `unknown` when the probe carries no
   * orientation or an unreadable one (SH-2). c3bOf. Absent on records of earlier builds.
   */
  C3b?: CheckResult;
  /**
   * A story input whose accept list set-equals STORY_ACCEPT. `unknown` when the decision never
   * reached C4 (it stopped at the guard, login, desktop-shell, service-worker or layout rows, or a
   * refit followed), since the page was not in the shape that has the input (U1, 2026-10-12).
   */
  C4: CheckResult;
  /** /create/story/ was the final URL after the hard reload (route 'direct'). */
  C5: CheckResult;
  C8: { inner: { w: number; h: number }; dpr: number; canvas: ProbeReport['canvas'] | null };
  /** Diagnostics only (P1). */
  swControlled: boolean | 'unknown';
  /** P3: the tripwire's reading in the deciding probe. */
  swIntercepted: boolean | 'unknown';
}

/**
 * Summarises a probe as C1–C5 and C8 (pure). `route` is C5's final-URL verdict, null if not known.
 * `ready` is the report taken once the composer was ready (C6, §11 AM13): when given, C8 comes
 * from it, because only then does a canvas exist; C1–C5 always come from the deciding `probe`.
 * `c4Reached`: the decision got as far as C4 (probe-eval.ts `c4Reached`); otherwise C4 is `unknown`.
 */
export function preflightOf(
  probe: ProbeReport,
  url: string | undefined,
  route: ComposerRoute | null,
  ready: ProbeReport | null = null,
  c4Reached = true,
): Preflight {
  const pass = (b: boolean): CheckResult => (b ? 'pass' : 'fail');
  const geo = ready ?? probe;
  return {
    contractVersion: CONTRACT_VERSION,
    C1: probe.isMobile === 'unknown' ? 'unknown' : pass(probe.isMobile),
    C2: url === undefined ? 'unknown' : pass(classifyComposerUrl(url).kind !== 'stop'),
    C3: pass(probe.portrait),
    C3b: c3bOf(probe.orientation),
    C4: c4Reached ? pass(probe.storyInput === 'present' && probe.acceptOk) : 'unknown',
    C5: route === null ? 'unknown' : pass(route === 'direct'),
    C8: {
      inner: { ...geo.inner },
      dpr: geo.dpr,
      canvas: geo.canvas ? { w: geo.canvas.w, h: geo.canvas.h, css: { ...geo.canvas.css } } : null,
    },
    swControlled: probe.swControlled,
    swIntercepted: probe.swIntercepted,
  };
}

/**
 * baseline.json (strategy §7.7): structural facts from L4/L5, or the pre-L4 assumptions.
 * Never HTML, cookies, tokens, user IDs or usernames. The fake derives its default knobs
 * from it (U16).
 */
export interface Baseline {
  /** ISO date of the live capture, or "pre-L4" while the values are assumptions. */
  capturedAt: string;
  chromeVersion: string;
  uaProfile: 'android-reduced';
  chMode: ChMode;
  /** C1's key (research §5.1 curl); `unknown` until L2/L4 confirm it logged in. */
  isMobileKeyFound: boolean | 'unknown';
  /** C5 (A8): `unknown` until L4. */
  route: 'direct' | 'homeOnly' | 'unknown';
  /** C4 before + → Story: `unknown` until L4. */
  storyInputBeforeTap: boolean | 'unknown';
  accept: string[];
  /** L6 (A5/R7, AM26): whether the composer accepts an `isTrusted:false` insert. */
  untrustedInsertAccepted: boolean | 'unknown';
  /** L6 (AM26): the event the composer reads the file from. */
  fileEvent: 'change' | 'drop' | 'unknown';
  /**
   * The composer page is controlled by a service worker once the hard reload settled. true since the
   * 2026-10-12 live run (swControlled at the probe): Instagram's worker claims the page (F2).
   */
  swControlledAfterHardReload: boolean | 'unknown';
  /** A worker answered the first (pre-reload) load. false since F2: the worker has no fetch handler. */
  firstLoadServedBySw: boolean | 'unknown';
  /**
   * F2 (2026-10-12): every logged-in load re-registers the root worker at a URL that changes
   * (enableAddToHomeScreen, zenon_device_id); the new worker calls skipWaiting() and clients.claim().
   */
  swClaimsOnLoad: boolean | 'unknown';
  /** F2: whether that worker has a fetch handler (it would then handle the page's requests: SW_INTERCEPTS). */
  swFetchHandler: boolean | 'unknown';
  /** F3: msite renders its header (+ → Story and the story input) only up to this many CSS px wide. */
  msiteMaxCssWidth: number;
  /**
   * AM37 (2026-10-12): what the composer page's landscape gate reads. `screen`: `screen.orientation.type`
   * (else `window.orientation`, else the viewport), so a landscape monitor blocks Share in any window;
   * `viewport`: `innerWidth > innerHeight` only (the earlier assumption). The + → Story session start
   * checks the viewport either way (C3a).
   */
  composerLandscapeCheck: 'screen' | 'viewport' | 'unknown';
  geometry: {
    model: 'viewportDpr' | 'source' | `fixed:${number}x${number}` | `cssFixed:${number}x${number}`;
    insets: [number, number];
    saveExposed: boolean | 'unknown';
  };
  /**
   * C10 (ux.md §10, unverified until L18): the order of the two items in the + menu (`storyPost`: Story
   * first). The menu module is not readable logged out; the fake models both orders.
   */
  menuOrder?: 'postStory' | 'storyPost' | 'unknown';
  /** C10 (L18): how many outermost pressables the + menu holds (2 per PolarisMobileCreationNavItem's props). */
  menuItemCount?: number | 'unknown';
  /**
   * C12 (L18): the Share footer this account's composer shows: `v1` (PolarisStoryCreationShareFooter, a
   * button) or `v2` (ShareFooterV2, a role=button with the avatar: a linked Facebook destination).
   */
  shareFooter?: 'v1' | 'v2' | 'unknown';
  /** C13 (L20): the content type of the publish request's 2xx answer (`application/json` expected). */
  configureContentType?: string;
  /**
   * Where each non-default fact comes from (a live run, a code reading, research), e.g.
   * `"route": "live run 2026-10-12 …"`. Documentation only; nothing reads it.
   */
  provenance?: Record<string, string>;
}
