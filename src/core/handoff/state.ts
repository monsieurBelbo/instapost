/**
 * Hand-off state machine vocabulary (strategy §3.5, §3.6, §3.10; docs/ux.md, the autopilot). The
 * reducer (reducer.ts) is pure: `(state, event, ctx) → {state, effects}`. The runner
 * (src/handoff/runner.ts) executes effects, turns platform callbacks into events and persists the
 * state in storage.session after every transition, so a service-worker restart resumes mid-flow.
 *
 * Contract history (v1–v6.1, AM2–AM38) is in docs/strategy.md §11. **v7 (2026-10-13, ux.md, AM39–AM41,
 * breaking)**: the autopilot. After the owner presses Post story nothing else needs them: instapost taps
 * Instagram's own + → Story, adds the photo to the armed story input, presses Share once, and decides the
 * result from Instagram's own publish request.
 * - Phases removed: `injecting`, `awaitingPick`, `awaitingShare` (H0 and H1 are gone; a stored session in
 *   one of them no longer parses, so the startup cleanup drops it: rules 1001–1019 removed, AM22 closes
 *   the remembered popup). They stay in `HandoffPhase` as names records of earlier builds carry.
 * - Phases added: `queued`, `awaitingAccount`, `openingEntry`, `inserting`, `composeReady`, `sharing`,
 *   `confirmingUpload`, `manual`. `finished` carries the RunResult and a hold; `closing` the result.
 * - Modes: `post`, `test` (stops at Share), `shareTest` (presses Share, writes blocked), `check` (was
 *   `probe`). Write blocking is derived (`mode !== 'post'`, or a guarded build). `rehearsal`,
 *   `assistedInsert`, `level`, the "Posted?" question (`outcome` event) and `inactivity` are gone.
 * - Errors added: STORY_ENTRY_MISSING, SHARE_MISSING, WINDOW_IN_USE, WINDOW_HIDDEN, ACCOUNT_UNCONFIRMED,
 *   UPLOAD_FAILED, OUTCOME_UNKNOWN, TEST_LEAK. Effects `degrade-h0` → `offer-manual` (and `hold`).
 * - Agent: `agent/drive` (open-entry, insert, compose, share) and `agent/observe` commands; `agent/fact`
 *   messages (entry, inserted, compose, share-done/refused, net, ui, visibility, owner-share).
 */

import type { Size } from '../geometry/fit.ts';
import type { ComposerProfile, FrameDelta, ScreenAvail, WindowBox } from '../geometry/window-fit.ts';
import type { BrowserFlavour } from '../ig-contract/browser-flavour.ts';
import type { CheckResult, PageOrientation, Preflight, ProbeReport } from '../ig-contract/contract.ts';
import type { ChMode } from '../ig-contract/device-profile.ts';
import type { DnrRule } from '../ig-contract/rules.ts';
import type { ComposerRoute } from '../ig-contract/urls.ts';
import type { ExportId, HandoffId, Nonce } from '../model/ids.ts';
import type { RateCaps, RateDecision } from './rate-guard.ts';

// ---------------------------------------------------------------------------------------
// Errors (§3.10, ux.md §5). Errors never retry a publish; every failure after the export leaves a
// copy in Downloads and offers the phone.

export const ERROR_CODES = [
  'RATE_LIMITED',
  'HANDOFF_BUSY',
  'MSITE_LOCKED',
  'GUARD_NOT_FAKE',
  'DESKTOP_SHELL',
  'NOT_LOGGED_IN',
  'LANDSCAPE',
  'SCREEN_TOO_SMALL',
  'INPUT_MISSING',
  'ACCEPT_DRIFT',
  'INJECTION_IGNORED',
  /** No longer emitted (P2, 2026-10-12). Kept so records of earlier builds still parse. */
  'SW_TOOK_CONTROL',
  'KILLED_CHALLENGE',
  'KILLED_OFFHOST',
  'AGENT_UNREACHABLE',
  'TIMEOUT',
  'EXPORT_TOO_LARGE',
  'DECODE_FAILED',
  'FONT_NOT_LOADED',
  /** AM17: the composer tab went to a www page that is neither the composer, home, login nor a security flow. */
  'UNEXPECTED_PAGE',
  /** AM23/AM28: a guarded build in a branded browser; no window opens. */
  'BRANDED_BROWSER',
  /** AM20/AM28: the first navigation never committed on www within NAVIGATION_TIMEOUT_MS. */
  'NAVIGATION_TIMEOUT',
  /** P3: a service worker handled the composer page's requests, so they left without rule 1001. */
  'SW_INTERCEPTS',
  /** W3: the popup never became narrow and tall enough (auto-fit, its retry and the guided resize). */
  'WINDOW_NOT_FITTED',
  /** P4: after the one refit the page is still wider than MSITE_MAX_CSS_WIDTH (no + → Story there). */
  'LAYOUT_TOO_WIDE',
  /** AM37 (C3b): the composer read a landscape screen orientation, so it hides Share. */
  'SCREEN_LANDSCAPE',
  /** ux.md: the + → Story menu was not where or what instapost expects (C10, C11). */
  'STORY_ENTRY_MISSING',
  /** ux.md: the photo is in the composer but there is not exactly one Share control (C12). Nothing clicked. */
  'SHARE_MISSING',
  /** ux.md: the page had user activation (the owner clicking in it) and kept it; nothing was tapped. */
  'WINDOW_IN_USE',
  /** ux.md: the Instagram window stayed hidden (Instagram throttles hidden pages); nothing was tapped. */
  'WINDOW_HIDDEN',
  /** ux.md §4.8: the account prompt was not answered within ACCOUNT_PROMPT_MS. */
  'ACCOUNT_UNCONFIRMED',
  /** ux.md §6 O2/O4: Instagram answered that the upload or the publish failed. Not posted. */
  'UPLOAD_FAILED',
  /** ux.md §6: Share was pressed and the evidence is neither a clear yes nor a clear no. */
  'OUTCOME_UNKNOWN',
  /** ux.md §6 O10: during a test with writes blocked, a publish request (or a 2xx upload) went through. */
  'TEST_LEAK',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * What each error does (§3.10, ux.md §5):
 * - `no-window`: a guard refused; nothing opened;
 * - `close`: close the popup, remove the rules, no lock;
 * - `offer-manual`: stop tapping; keep the window OFFER_MANUAL_MS so the owner may Finish by hand;
 * - `hold`: keep the window while an upload may still run (UPLOAD_HOLD_MS);
 * - `kill`: close, remove the rules, lock the msite lane for 7 days;
 * - `editor`: shown in the editor only; never reaches the reducer.
 * Before Share only. Any error after the Share command was sent is Couldn't confirm (OUTCOME_UNKNOWN)
 * unless the outcome rules decided, except a kill, which still locks.
 */
export type ErrorEffect = 'no-window' | 'close' | 'offer-manual' | 'hold' | 'kill' | 'editor';

export const ERROR_EFFECT: Readonly<Record<ErrorCode, ErrorEffect>> = {
  RATE_LIMITED: 'no-window',
  HANDOFF_BUSY: 'no-window',
  MSITE_LOCKED: 'no-window',
  GUARD_NOT_FAKE: 'close',
  DESKTOP_SHELL: 'close',
  NOT_LOGGED_IN: 'close',
  LANDSCAPE: 'close',
  SCREEN_TOO_SMALL: 'close',
  INPUT_MISSING: 'offer-manual',
  ACCEPT_DRIFT: 'offer-manual',
  INJECTION_IGNORED: 'offer-manual',
  SW_TOOK_CONTROL: 'close',
  KILLED_CHALLENGE: 'kill',
  KILLED_OFFHOST: 'kill',
  AGENT_UNREACHABLE: 'close',
  TIMEOUT: 'close',
  EXPORT_TOO_LARGE: 'editor',
  DECODE_FAILED: 'editor',
  FONT_NOT_LOADED: 'editor',
  UNEXPECTED_PAGE: 'close',
  BRANDED_BROWSER: 'no-window',
  NAVIGATION_TIMEOUT: 'close',
  SW_INTERCEPTS: 'close',
  WINDOW_NOT_FITTED: 'close',
  LAYOUT_TOO_WIDE: 'close',
  SCREEN_LANDSCAPE: 'close',
  STORY_ENTRY_MISSING: 'offer-manual',
  SHARE_MISSING: 'offer-manual',
  WINDOW_IN_USE: 'offer-manual',
  WINDOW_HIDDEN: 'close',
  ACCOUNT_UNCONFIRMED: 'close',
  UPLOAD_FAILED: 'close',
  OUTCOME_UNKNOWN: 'hold',
  TEST_LEAK: 'kill',
};

// ---------------------------------------------------------------------------------------
// Timing (§3.6, §3.8, ux.md §4.6 and §10).

export const MSITE_LOCK_MS = 7 * 24 * 60 * 60 * 1000;
/** Why desktop posting is paused: the kill switch's two triggers, or a test whose write block leaked. */
export const MSITE_LOCK_REASONS = ['KILLED_CHALLENGE', 'KILLED_OFFHOST', 'TEST_LEAK'] as const;
export type MsiteLockReason = (typeof MSITE_LOCK_REASONS)[number];
/** Default close delay of a finished session (Not posted after Share, Couldn't confirm with nothing pending). */
export const CLOSE_DELAY_MS = 3000;
/** AM20: the first navigation must commit on www within this long, else the popup closes. */
export const NAVIGATION_TIMEOUT_MS = 30_000;

// W2/W3 (Arc, 2026-10-12): fitting the popup while its tab is still about:blank.
/** The runner reads windows.get this often until two reads agree (the window has settled). */
export const FIT_SETTLE_POLL_MS = 100;
/** …for at most this long; then it measures what it has. */
export const FIT_SETTLE_MAX_MS = 1000;
/** After windows.update the runner polls tabs.get this often until the tab reaches the target… */
export const FIT_VERIFY_POLL_MS = 100;
/** …for at most this long (windowFitted.fitted false after it). */
export const FIT_VERIFY_MAX_MS = 1500;
/** The one retry of windows.update comes this long after the first attempt failed to verify. */
export const FIT_RETRY_DELAY_MS = 300;
/** W2 hardening (AM29): the same box is re-applied at these offsets while the tab is still about:blank. */
export const FIT_REAPPLY_MS: readonly number[] = [0, 150, 300, 500, 1000];
/** …and its verification counts the tab as fitted only once it still is this long after the first update. */
export const FIT_HOLD_MS = 1100;
/** W3 (ux.md §4.6: 2 minutes, was 3): how long the owner has to drag the popup narrow and tall. */
export const RESIZE_TIMEOUT_MS = 2 * 60 * 1000;
/** W3: the tab size is also polled this often while resizing (besides windows.onBoundsChanged). */
export const RESIZE_POLL_MS = 1000;
/** P5: how long a probe that found no story input (or no account) waits for the agent's watch. */
export const INPUT_WAIT_MS = 6000;
/** W5: windows.update entries kept on the record (the fit, its one retry and the single refit). */
export const MAX_WINDOW_UPDATES = 3;

// ux.md §10 budgets.
/** From the reload's `complete` to the deciding probe ("home ready"). */
export const HOME_READY_MS = 15_000;
/** From the hard reload to its `complete`. */
export const RELOAD_BUDGET_MS = 30_000;
/** agent/drive open-entry → its entry fact (activation 6 s, menu 6 s + one re-tap, armed 3 s, a trial, jitter). */
export const ENTRY_BUDGET_MS = 30_000;
/** agent/drive insert → the compose fact (insert → /create/story 10 s, drawn 10 s, footer settle cap 8 s). */
export const INSERT_BUDGET_MS = 30_000;
/** Everything before Share, paused while the owner resizes or answers the account prompt. */
export const PRE_SHARE_CAP_MS = 2 * 60 * 1000;
/** ux.md §4.8: the account prompt cancels itself after this long (ACCOUNT_UNCONFIRMED). */
export const ACCOUNT_PROMPT_MS = 60_000;
/** ux.md §4.6: a page hidden before Share is raised once; still hidden this long later → WINDOW_HIDDEN. */
export const HIDDEN_WAIT_MS = 10_000;
/** The agent's wait for visibility, and then for activation, before it touches Share (each, one after the other). */
export const SHARE_ACTIVATION_WAIT_MS = 6000;
/**
 * The Share command's answer (share-done or share-refused). The agent waits up to SHARE_ACTIVATION_WAIT_MS
 * for the page to be visible and then up to SHARE_ACTIVATION_WAIT_MS for its user activation to lapse, one
 * after the other, so this covers both waits plus a margin for the tap and the message (AP-5).
 */
export const SHARE_ACK_MS = 2 * SHARE_ACTIVATION_WAIT_MS + 3000;
/** The outcome rules re-run this often while confirming (timeouts O5/O6). */
export const CONFIRM_TICK_MS = 2000;
/** O6: no upload entry this long after Share → Couldn't confirm (no-upload-seen). */
export const UPLOAD_ENTRY_BUDGET_MS = 120_000;
/** O5: no publish request this long after a 2xx upload → Couldn't confirm (no-finalize-after-upload). */
export const PUBLISH_AFTER_UPLOAD_MS = 75_000;
/** O4/O9: an upload that ended non-2xx (or blocked) settles this long before it decides. */
export const UPLOAD_SETTLE_MS = 3000;
/** §6.4: a window whose upload may still run is held open this long (Instagram's upload has no timeout). */
export const UPLOAD_HOLD_MS = 15 * 60 * 1000;
/** §4.9: after a drift failure the window is kept this long for Finish by hand. */
export const OFFER_MANUAL_MS = 60_000;
/** §4.9: Finish by hand ends with TIMEOUT (or Couldn't confirm) after this long without a result. */
export const MANUAL_DEADLINE_MS = 5 * 60 * 1000;
/** §4.6: Posted closes this long after Instagram went home… */
export const HOME_CLOSE_MS = 2000;
/** …or this long after the confirmation if it never does. */
export const POSTED_CLOSE_MS = 8000;
/** A `closing` session whose windowRemoved never arrives ends anyway after this long. */
export const CLOSING_BACKSTOP_MS = 10_000;
/** Resource entries kept per hand-off (ux.md IR7), and per `net` fact. */
export const MAX_NET_ENTRIES = 64;
/**
 * Of those, Instagram's upload and publish entries, which decide the result: always kept, up to this many
 * (enough for O7's duplicate alarm). Only the 'other' entries share the rest (AP-1).
 */
export const MAX_WRITE_NET_ENTRIES = 8;
export const MAX_OTHER_NET_ENTRIES = MAX_NET_ENTRIES - MAX_WRITE_NET_ENTRIES;

// ---------------------------------------------------------------------------------------
// Settings (storage.local, §3.3). Rate caps can only be made stricter (rate-guard.ts).

/** ux.md §4.12: the account Instagram is logged in as, as instapost detected it. */
export interface ExpectedAccount {
  handle: string;
  detectedAt: number;
}

/**
 * ux.md §10 (C10): the + menu as a test run (or a post) found it: how many items, which one is Story, and
 * a hash of its glyph. Background-owned key `menuFingerprint`.
 */
export interface MenuFingerprint {
  count: number;
  storyIndex: number;
  glyph: string;
  savedAt: number;
}

export interface Settings {
  chMode: ChMode;
  /** Epoch ms; the msite lane is locked until then (kill switch, background-owned key). null = unlocked. */
  msiteLockedUntil: number | null;
  composerProfile: ComposerProfile | null;
  rateCaps: Partial<RateCaps>;
  /** ux.md §4.12: background-owned key `expectedAccount` (merged in); null until detected, or after Forget. */
  expectedAccount: ExpectedAccount | null;
  /** "Only post as @handle" (OD11, default on). */
  accountLock: boolean;
  /** "Also keep every posted story in Downloads/instapost" (default off; failures are always saved). */
  keepCopies: boolean;
  /** The onboarding card was dismissed (Start or Skip). */
  onboardedAt: number | null;
  /** OD10: background-owned key `lastTestPassAt` (merged in); the one-time setup test gate. */
  lastTestPassAt: number | null;
  /** AM44: the editor's language: Auto (the browser's UI language: es-* → Spanish, else English), English or Spanish. */
  lang: UiLangSetting;
}

/** AM44: the Settings choice for the extension's own UI language. */
export type UiLangSetting = 'auto' | 'en' | 'es';
export const UI_LANG_SETTINGS: readonly UiLangSetting[] = ['auto', 'en', 'es'];

export function defaultSettings(_guarded: boolean): Settings {
  return {
    chMode: 'full',
    msiteLockedUntil: null,
    composerProfile: null,
    rateCaps: {},
    expectedAccount: null,
    accountLock: true,
    keepCopies: false,
    onboardedAt: null,
    lastTestPassAt: null,
    lang: 'auto',
  };
}

// ---------------------------------------------------------------------------------------
// Agent vocabulary shared with src/shared/protocol.ts (which adds v:1, handoffId, nonce).

export type AgentEventName =
  /** P5: a story-input candidate (C4) is in the DOM. */
  | 'input-appeared'
  /** ux.md C14: exactly one account link is readable now. */
  | 'account-appeared'
  /** Diagnostics only since P2: counted on the record (Instagram's worker claims every page, F2). */
  | 'sw-controller-change'
  /** P3: the agent's watch saw a service worker handle a www/i.instagram.com request (SW_INTERCEPTS). */
  | 'sw-intercepted';

/** The open-entry outcome (ux.md §10 `armStory`). */
export const ENTRY_RESULTS = [
  'armed',
  'ENTRY_MISSING',
  'MENU_MISSING',
  'MENU_DRIFT',
  'WRONG_ITEM',
  'NOT_ARMED',
  'SESSION_NOT_STARTED',
  'ACTIVATION_ACTIVE',
  'HIDDEN',
  'REFUSED',
] as const;
export type EntryResult = (typeof ENTRY_RESULTS)[number];

/** What the agent found and did at + → Story. Structural facts only. */
export interface EntryFact {
  kind: 'entry';
  result: EntryResult;
  /** The stored fingerprint chose the Story item (no trial). */
  fpUsed: boolean;
  /** The index of the item that armed the story input (0-based), or null. */
  storyIndex: number | null;
  /** fnv1a hash of that item's glyph, or null. */
  glyph: string | null;
  /** Outermost pressables in the menu dialog, or null when no dialog appeared. */
  menuCount: number | null;
  /** Wrong items tapped before the right one (at most 1). */
  trials: number;
  /** Taps of + in this document. */
  plusTaps: number;
  /** From the Story tap to the story input's click, in ms. */
  armedMs: number | null;
}

export const INSERT_FAILURES = ['not-armed', 'no-file', 'accept-drift', 'threw'] as const;
export type InsertFailure = (typeof INSERT_FAILURES)[number];

/** ux.md §10 C12: the composer as the agent's compose watch saw it once its Share footer settled. */
export interface ComposeFact {
  kind: 'compose';
  /** The page is on /create/story. */
  onComposer: boolean;
  /** The composer's canvas has a backing store (the photo is drawn). */
  drawn: boolean;
  /** Instagram's rotate snackbar is shown (C3b failed in the page). */
  landscape: boolean;
  /** Share controls in the one visible Share footer (0 when there is none, 2+ when ambiguous). */
  controls: number;
  /** v1: a `button`; v2: a `[role=button]` with the account's avatar. */
  variant: 'v1' | 'v2' | null;
  /** v2 with Instagram's automatic Facebook cross-post badge. */
  fbAuto: boolean;
  /** The footer settled (1.5 s quiet), or the watch ran out of time. */
  settled: boolean;
  settleMs: number;
  /** The composer canvas's backing size (C8), when drawn. */
  canvas: Size | null;
  /** IA7 (diagnostic): similarity of the drawn photo to the export sample, 0..1. */
  imageScore: number | null;
}

export const SHARE_REFUSALS = [
  'controls',
  'not-drawn',
  'not-composer',
  'landscape',
  'activation',
  'hidden',
  'refused',
] as const;
export type ShareRefusal = (typeof SHARE_REFUSALS)[number];

/** One XHR/fetch resource timing entry after Share (query dropped; offsets relative to the Share click). */
export interface NetEntry {
  host: 'www' | 'i' | 'other';
  /** The URL's pathname, at most 200 characters (digits normalised to `<n>` on records). */
  path: string;
  /** responseStatus: 0 for a blocked, failed or opaque request. */
  status: number;
  /** contentType, at most 64 characters ('' when unknown). */
  type: string;
  redirected: boolean;
  /** ms after the Share click. */
  start: number;
  end: number;
}

export interface UiFacts {
  /** Instagram's "uploading" progress was seen. */
  progressSeen: boolean;
  /** A new toast after Share: none, plain, or with an action button (Retry). */
  toast: 'none' | 'plain' | 'action';
  /** The page went home (`/`) after Share, epoch ms (background clock); null before. */
  wentHomeAt: number | null;
}

export type AgentFact =
  | EntryFact
  | { kind: 'inserted' }
  | { kind: 'insert-failed'; why: InsertFailure }
  | ComposeFact
  /** The agent tapped Share. `t0Wall`: the page's Date.now() at the click (diagnostics). */
  | { kind: 'share-done'; t0Wall: number }
  /** The agent did not tap Share (nothing was clicked). */
  | { kind: 'share-refused'; why: ShareRefusal }
  /** Resource entries that ended since the last batch; `elapsedMs` since the Share click (or the observe start). */
  | { kind: 'net'; entries: NetEntry[]; elapsedMs: number }
  | { kind: 'ui'; progressSeen: boolean; toast: 'none' | 'plain' | 'action'; wentHome: boolean }
  | { kind: 'visibility'; hidden: boolean }
  /** Finish by hand: the owner's own (trusted) click on the Share control. */
  | { kind: 'owner-share'; t0Wall: number };
export type AgentFactKind = AgentFact['kind'];

export type AgentCommand =
  | { type: 'agent/probe' }
  /** Starts (or restarts) the agent's watch: input-appeared, account-appeared, sw-controller-change, sw-intercepted. */
  | { type: 'agent/watch' }
  | { type: 'agent/drive'; step: 'open-entry'; fingerprint: MenuFingerprint | null }
  | { type: 'agent/drive'; step: 'insert' }
  /** `sample`: the export's 16×16 RGBA, base64 (IA7, diagnostic), or null. */
  | { type: 'agent/drive'; step: 'compose'; sample: string | null }
  | { type: 'agent/drive'; step: 'share' }
  /** Finish by hand: stop driving for good, observe the owner's Share and the requests after it. */
  | { type: 'agent/observe'; from: 'manual' };

// ---------------------------------------------------------------------------------------
// Results (ux.md §4.7, §6).

export type HandoffMode = 'post' | 'test' | 'shareTest' | 'check';

export const RESULT_KINDS = ['posted', 'notPosted', 'unknown', 'tested', 'shareTested', 'checked', 'stopped'] as const;
export type ResultKind = (typeof RESULT_KINDS)[number];

/** Why a result is Couldn't confirm (ux.md §5 `{why}`). */
export const UNKNOWN_WHYS = [
  'no-upload-seen',
  'no-finalize-after-upload',
  'configure-5xx',
  'configure-0',
  'configure-html',
  'redirected',
  'window-closed',
  'agent-lost',
  'unexpected-page',
  'share-not-acknowledged',
  /** O9: writes were blocked, yet an upload reached Instagram (a non-zero, non-2xx status): the block failed. */
  'not-blocked',
] as const;
export type UnknownWhy = (typeof UNKNOWN_WHYS)[number];

export const ALARMS = ['DUPLICATE_UPLOAD'] as const;
export type Alarm = (typeof ALARMS)[number];

export interface RunResult {
  kind: ResultKind;
  /** notPosted: the failure; unknown: OUTCOME_UNKNOWN or TEST_LEAK; posted/unknown after a kill: absent. */
  code?: ErrorCode;
  why?: UnknownWhy;
  /** A short structural detail (`publish 400`, `menu 3 items`, a page path). */
  detail?: string;
  /** The kill switch fired (after or before the outcome); the lane is locked. */
  killed?: 'KILLED_CHALLENGE' | 'KILLED_OFFHOST' | 'TEST_LEAK';
  alarms: Alarm[];
  /** Epoch ms of the decision. */
  at: number;
  /** Instagram's automatic Facebook cross-post was on the Share control (OD12). */
  facebook?: boolean;
  /** Couldn't confirm while an upload may still run: the window is held (§6.4). */
  held?: boolean;
  /** stopped: by the owner's Stop, or by closing the Instagram window. */
  stoppedBy?: 'owner' | 'window';
  /** The account the run went to, when read. */
  account?: string | null;
  /** §6.4: a later answer replaced a Couldn't confirm. */
  late?: boolean;
  /**
   * The owner's "It posted" / "It didn't post" on a Couldn't confirm (ux.md §4.7): the kind is theirs, never
   * Instagram's answer, so no copy may say "Instagram confirmed it" (P4, AP-3).
   */
  markedBy?: 'owner';
  /**
   * checked: the account posts are locked to, when Instagram is logged in as another one (`account`). Post
   * story would stop and ask; "Use @account" makes the logged-in one the expected account (AP-4).
   */
  lockedTo?: string;
}

/**
 * IndexedDB `handoffs` outcome. v7 literals: posted, unknown, tested, share-tested, checked, cancelled,
 * not-posted and `failed:`/`killed:` with the code. `posted-confirmed` and `abandoned` are records of
 * earlier builds (still parsed and shown).
 */
export type HandoffOutcome =
  | 'posted'
  | 'unknown'
  | 'tested'
  | 'share-tested'
  | 'checked'
  | 'cancelled'
  | 'not-posted'
  | `failed:${ErrorCode}`
  | `killed:${ErrorCode}`
  | 'posted-confirmed'
  | 'abandoned';

// ---------------------------------------------------------------------------------------
// State.

/** The phases of the live state machine (statuses, stored sessions). */
export type SessionPhase =
  | 'idle'
  /** ux.md K11: a post waits for the 60 s spacing; it starts by itself. */
  | 'queued'
  /** windows.create(about:blank) issued. */
  | 'opening'
  /** Rule 1001 (+ the write-block rules for tests) being installed while the tab is still about:blank. */
  | 'scoping'
  /** W2, still at about:blank: measure, then windows.update to windowFit() docked right, verified. */
  | 'fitting'
  /** W3: auto-fit failed; the owner drags the popup narrow and tall. */
  | 'resizing'
  /** tabs.update to COMPOSER_URL issued; waiting for the first `loading` on www. */
  | 'navigating'
  /** Hard reload issued once; kill switch armed from here on; waiting for `complete`. */
  | 'reloading'
  /** Agent injected and agent/probe sent (also after the single refit, and after a new document before any tap). */
  | 'probing'
  /** ux.md §4.8: the account differs, cannot be read, or none is expected; paused before any tap. */
  | 'awaitingAccount'
  /** ux.md §10: + → Story (dwell, then agent/drive open-entry). */
  | 'openingEntry'
  /** The photo goes into the armed story input (dwell, drive insert, get-file, then the compose watch). */
  | 'inserting'
  /** The composer drew the photo and its Share footer settled; dwell (and, for a Share test, the rules check). */
  | 'composeReady'
  /** The Share command was sent once; waiting for share-done / share-refused. */
  | 'sharing'
  /** Share was pressed; the outcome rules read Instagram's upload and publish requests. */
  | 'confirmingUpload'
  /** §4.9 Finish by hand: the owner taps; instapost observes only. */
  | 'manual'
  /** The result is known; the window closes on its schedule (or is held). */
  | 'finished'
  /** Window close requested; cleanup pending until windows.onRemoved. */
  | 'closing';

/** Phase names records of earlier builds (H0/H1, before v7) carry in their phase log. */
export type LegacyPhase = 'injecting' | 'awaitingPick' | 'awaitingShare';
/** Any phase a status, a stored session or a record's phase log may name. */
export type HandoffPhase = SessionPhase | LegacyPhase;

export interface PhaseLogEntry {
  phase: HandoffPhase;
  t: number;
}

/** ux.md §4.6: the five steps of the run view. */
export type RunStep = 'instagram' | 'account' | 'story' | 'share' | 'confirm';

/** Epoch ms when each step's fact was established. */
export interface StepTimes {
  opened: number;
  instagram?: number;
  account?: number;
  armed?: number;
  composer?: number;
  share?: number;
  confirmed?: number;
}

/** W2: one windows.update and what the verification saw. Structural numbers only. */
export interface WindowUpdateDiag {
  step: 'fit' | 'retry' | 'refit';
  box: WindowBox;
  target: Size;
  outer: WindowBox;
  tab: Size;
  fitted: boolean;
  /** windows.update calls this step made (re-applies included). Absent on records of earlier builds. */
  applied?: number;
}

/** W5: how the popup was sized, for the record and Details. Structural numbers only. */
export interface WindowDiagnostics {
  screen: ScreenAvail;
  requested: WindowBox;
  created: WindowBox | null;
  createdTab: Size | null;
  frameDelta: FrameDelta | null;
  updates: WindowUpdateDiag[];
  attempts: number;
  manualResize: boolean;
  finalTab: Size | null;
  zoom: number | null;
  /** ux.md §4.6: placed at the right edge of the editor's screen (absent on records of earlier builds). */
  docked?: boolean;
}

export type AccountDecisionKind =
  | 'ok'
  | 'learn'
  | 'unlocked'
  | 'prompt-mismatch'
  | 'prompt-unreadable'
  | 'prompt-first'
  /** A check (it never prompts): the lock is on and Instagram is logged in as another account (AP-4). */
  | 'mismatch'
  /** A check: the account could not be read. */
  | 'unreadable';
export type AccountPromptKind = 'mismatch' | 'unreadable' | 'first';

/** ux.md C14: the account as read on Instagram's home, and what instapost decided. */
export interface AccountFacts {
  detected: string | null;
  /** Account link candidates seen (distinct handles when ambiguous). */
  candidates: number;
  expected: string | null;
  decision: AccountDecisionKind | null;
  confirmedBy: 'match' | 'owner' | 'learned' | 'unlocked' | null;
}

/** The entry facts kept on the session and the record (without the fact's `kind`). */
export type EntryFacts = Omit<EntryFact, 'kind'>;
export type ComposeFacts = Omit<ComposeFact, 'kind'>;

/** ux.md §4.13 Evidence: what decided the result. Paths are normalised (digits → `<n>`). */
export interface Evidence {
  sharedAt: number | null;
  sharedBy: 'autopilot' | 'owner' | null;
  net: NetEntry[];
  ui: UiFacts;
  alarms: Alarm[];
}

/** IndexedDB `handoffs` (§3.6). */
export interface HandoffRecord {
  id: HandoffId;
  exportId: ExportId | null;
  /** `probe` on records of earlier builds (now `check`). */
  mode: HandoffMode | 'probe';
  chMode: ChMode;
  phaseLog: PhaseLogEntry[];
  probe?: ProbeReport;
  preflight?: Preflight;
  readyProbe?: ProbeReport;
  route?: ComposerRoute;
  detail?: string;
  window?: WindowDiagnostics;
  browser?: BrowserFlavour;
  swControllerChanges?: number;
  outcome: HandoffOutcome;
  startedAt: number;
  endedAt: number;
  // v7
  result?: RunResult;
  account?: AccountFacts;
  entry?: EntryFacts;
  compose?: ComposeFacts;
  evidence?: Evidence;
  steps?: StepTimes;
  durationMs?: number;
  /** History's "It posted / It didn't post" on a Couldn't confirm record. */
  markedBy?: 'owner';
  exportSha256?: string;
  docHash?: string;
  // Records of earlier builds.
  level?: 'H1' | 'H0' | null;
  rehearsal?: boolean;
}

/** The start request as the queue keeps it. */
export interface StartRequest {
  exportId: ExportId | null;
  mode: HandoffMode;
  screen: ScreenAvail;
  browser: BrowserFlavour;
  exportSample?: string;
  exportSha256?: string;
  docHash?: string;
}

/** Fields every active hand-off carries. */
export interface SessionBase {
  handoffId: HandoffId;
  nonce: Nonce;
  mode: HandoffMode;
  /** null for `check` (no file). */
  exportId: ExportId | null;
  exportSha256: string | null;
  docHash: string | null;
  /** IA7: the export's 16×16 sample (base64), or null. */
  exportSample: string | null;
  /** Instagram's write requests are blocked in this session (tests, and every guarded build). */
  writeBlocked: boolean;
  chMode: ChMode;
  chromeMajor: number;
  screen: ScreenAvail;
  browser: BrowserFlavour;
  win: WindowDiagnostics;
  startedAt: number;
  lastEventAt: number;
  phaseLog: PhaseLogEntry[];
  /** The pre-Share cap's deadline while it runs; null while paused (resizing, awaitingAccount) or over. */
  preShareUntil: number | null;
  /** The pre-Share cap left while paused; null otherwise. */
  preShareLeft: number | null;
}

/** Once the popup exists. */
export interface WindowedSession extends SessionBase {
  windowId: number;
  tabId: number;
  frameDelta: Size | null;
  refitUsed: boolean;
  /** The probe report that decided the flow (the last one evaluated). */
  probe: ProbeReport | null;
  /** AM13: the report taken once the composer drew the photo, for C8. Diagnostics only. */
  readyProbe: ProbeReport | null;
  /** Live build on the fake: show the FAKE INSTAGRAM bar. */
  fakeBanner: boolean;
  /** AM20: in `navigating`, a hidden URL update was seen. */
  offhostSeen: boolean;
  /** The one hard reload was issued. */
  hardReloadSent: boolean;
  /** `status:'loading'` events since the hard reload. */
  loadsSinceReload: number;
  /** The tab showed /create/story after the reload (diagnostics). */
  composerReached: boolean;
  /** C5: set by the first `complete` after the reload. */
  route: ComposerRoute | null;
  /** tab.url of the latest tabs.onUpdated. */
  url: string | null;
  /** P5: the one wait for a late story input (or account link) was used. */
  inputWaitUsed: boolean;
  inputWaitUntil: number | null;
  swControllerChanges: number;
  c4Reached: boolean;
  /** AM37: the portrait shim's reading in the current document. */
  pageOrientation: PageOrientation | null;
  /** SH-1: since the previous injection a commit moved the tab onto /create/story. */
  composerEntered: boolean;
  /** The deciding probe passed (proceed or check): later loads are document checks, not probes. */
  decided: boolean;
  /**
   * A later load of the composer tab after the decision: re-inject the agent (`complete`) and learn from
   * its sentinel whether the document is new (AM16). null when none is pending.
   */
  docCheck: 'awaitComplete' | 'injectAgent' | null;
  account: AccountFacts;
  entry: EntryFacts | null;
  /** The one agent/drive open-entry was sent. */
  entrySent: boolean;
  /** The one agent/drive insert was sent. */
  insertSent: boolean;
  /** The export was served to the one agent/get-file. */
  fileServed: boolean;
  compose: ComposeFacts | null;
  /** Share-once (ux.md IR11): the Share command was sent. Persisted before the effect runs. */
  shareSent: boolean;
  shareSentAt: number | null;
  /** The agent answered share-refused (nothing was clicked). */
  shareRefused: ShareRefusal | null;
  sharedAt: number | null;
  sharedBy: 'autopilot' | 'owner' | null;
  /** Resource entries after Share (raw paths; normalised on the record), at most MAX_NET_ENTRIES. */
  net: NetEntry[];
  /** The agent's latest `elapsedMs` and when it arrived (background clock). */
  netElapsedMs: number;
  netElapsedAt: number | null;
  ui: UiFacts;
  alarms: Alarm[];
  /** §4.6: the page was hidden before Share and the window was raised once. */
  raisedForVisibility: boolean;
  /** The agent's latest visibility report. */
  hidden: boolean;
  /** Share test: rules 1002–1019 were verified for this tab. */
  testRulesVerified: boolean;
  steps: StepTimes;
  /** The record was written (finished); later changes patch it. */
  written: boolean;
}

/** W2: sub-steps of `fitting`. */
export type FitStep = 'measure' | 'update' | 'retryWait' | 'retry';

/** Sub-steps of `probing`, so stale effect results can be told apart. */
export type ProbeStep = 'awaitComplete' | 'injectAgent' | 'awaitReport' | 'refitMeasure' | 'refitUpdate' | 'awaitInput';

export interface IdleState {
  phase: 'idle';
  /** The previous hand-off, so a late mark can still be recorded. */
  last: { handoffId: HandoffId; outcome: HandoffOutcome; endedAt: number; result?: RunResult } | null;
}

export interface QueuedState {
  phase: 'queued';
  handoffId: HandoffId;
  request: StartRequest;
  /** When the spacing frees the lane (epoch ms). */
  startAt: number;
  queuedAt: number;
}

export type ActiveState =
  | (SessionBase & { phase: 'opening' })
  | (WindowedSession & { phase: 'scoping' | 'navigating' | 'reloading' })
  | (WindowedSession & { phase: 'fitting'; fitStep: FitStep })
  | (WindowedSession & { phase: 'resizing'; resizeUntil: number })
  | (WindowedSession & {
      phase: 'probing';
      step: ProbeStep;
      /** AM2: this probe follows a later document load, so isMobile must be exactly true. */
      strict: boolean;
      /** AM16: this probe follows a `loading` of the armed tab (same document or new, known at agentInjected). */
      amLoad: boolean;
    })
  | (WindowedSession & { phase: 'awaitingAccount'; prompt: AccountPromptKind; until: number })
  | (WindowedSession & { phase: 'openingEntry'; sub: 'dwell' | 'sent' })
  | (WindowedSession & { phase: 'inserting'; sub: 'dwell' | 'sent' | 'served' | 'awaitComposer' })
  /** awaitVisible: the Share dwell ran while the page was hidden: raised, Share waits for it to show (AP-5). */
  | (WindowedSession & { phase: 'composeReady'; sub: 'verifyRules' | 'dwell' | 'awaitVisible' })
  | (WindowedSession & { phase: 'sharing'; sentAt: number })
  | (WindowedSession & { phase: 'confirmingUpload'; t0At: number })
  | (WindowedSession & { phase: 'manual'; needs: 'pick' | 'share'; since: number; until: number })
  | (WindowedSession & {
      phase: 'finished';
      result: RunResult;
      /** upload: Couldn't confirm while an upload may run; offerManual: Finish by hand is offered. */
      hold: 'none' | 'upload' | 'offerManual';
      /** When the window closes by itself (epoch ms). */
      closeAt: number;
      /** Posted: the close was moved to HOME_CLOSE_MS after Instagram went home. */
      homeClose: boolean;
    })
  | (SessionBase & {
      phase: 'closing';
      windowId: number | null;
      tabId: number | null;
      result: RunResult;
      /** The record is already written with this outcome. */
      outcome: HandoffOutcome;
    });

export type HandoffState = IdleState | QueuedState | ActiveState;

export const IDLE: IdleState = { phase: 'idle', last: null };

/** The kill switch is armed from the hard reload until the session closes. */
export const ARMED_PHASES: readonly SessionPhase[] = [
  'reloading',
  'probing',
  'awaitingAccount',
  'openingEntry',
  'inserting',
  'composeReady',
  'sharing',
  'confirmingUpload',
  'manual',
  'finished',
];
export const isArmed = (s: HandoffState): boolean => ARMED_PHASES.includes(s.phase as SessionPhase);

// ---------------------------------------------------------------------------------------
// Events (inputs to the reducer). Agent messages arrive only after acceptAgentMessage()
// (src/shared/protocol.ts) validated sender, tab, frame, origin, ids and phase.

export type HandoffTimer =
  | 'closeDelay'
  | 'navigation'
  | 'fitRetry'
  | 'resizeDeadline'
  | 'resizePoll'
  | 'inputWait'
  /** The per-phase budget (§10); fires TIMEOUT before Share, ends `closing`. */
  | 'stepDeadline'
  /** PRE_SHARE_CAP_MS, paused during `resizing` and `awaitingAccount`. */
  | 'preShareCap'
  /** K11: the queued post starts. */
  | 'queue'
  /** The human-pace dwell before a tap, the insert or Share. */
  | 'dwell'
  | 'accountPrompt'
  | 'hiddenWait'
  | 'shareAck'
  | 'confirmTick'
  | 'uploadHold'
  | 'offerManual'
  | 'manualDeadline';

/** Every timer, so a session's end can clear them all. */
export const HANDOFF_TIMERS: readonly HandoffTimer[] = [
  'closeDelay',
  'navigation',
  'fitRetry',
  'resizeDeadline',
  'resizePoll',
  'inputWait',
  'stepDeadline',
  'preShareCap',
  'queue',
  'dwell',
  'accountPrompt',
  'hiddenWait',
  'shareAck',
  'confirmTick',
  'uploadHold',
  'offerManual',
  'manualDeadline',
];

export type HandoffEvent =
  // editor (runtime.connect port 'handoff')
  | ({ type: 'start'; queue: boolean } & StartRequest)
  /** Stop: honoured only before the Share command (and in finished, which closes the window). */
  | { type: 'cancel' }
  | { type: 'accountChoice'; handoffId: HandoffId; proceed: boolean }
  /** Finish by hand (ux.md §4.9). */
  | { type: 'manual'; handoffId: HandoffId }
  /** History's optional mark on a Couldn't confirm record. */
  | { type: 'mark'; handoffId: HandoffId; posted: boolean }
  // results of effects (runner → reducer)
  | { type: 'windowCreated'; windowId: number; tabId: number }
  | { type: 'rulesInstalled' }
  | { type: 'tabMeasured'; inner: Size; outer: WindowBox; zoom?: number | null }
  | {
      type: 'windowFitted';
      box: WindowBox;
      target: Size;
      fitted: boolean;
      inner: Size;
      outer: WindowBox;
      applied?: number;
    }
  | { type: 'windowSized'; inner: Size; outer: WindowBox }
  | { type: 'boundsChanged'; windowId: number }
  | { type: 'agentInjected'; fresh?: boolean; orientation?: PageOrientation }
  /** verifyTestRules' answer: rules 1002–1019 are installed for the composer tab. */
  | { type: 'rulesVerified'; ok: boolean }
  /** Any effect whose platform call rejected. */
  | { type: 'effectFailed'; effect: HandoffEffect['type']; message: string }
  // platform listeners
  | { type: 'tabUpdated'; tabId: number; status: 'loading' | 'complete' | undefined; url: string | undefined }
  | { type: 'windowRemoved'; windowId: number }
  | { type: 'tabRemoved'; tabId: number }
  | { type: 'startup' }
  | { type: 'timer'; timer: HandoffTimer }
  // agent (validated)
  | { type: 'agentReport'; probe: ProbeReport }
  | { type: 'agentGetFile' }
  | { type: 'agentEvent'; event: AgentEventName }
  | { type: 'agentFact'; fact: AgentFact };

// ---------------------------------------------------------------------------------------
// Effects (outputs of the reducer, executed in order by the runner).

/** Background → editor status (protocol adds v:1 and type 'handoff/status'). */
export interface HandoffStatus {
  /** null when a guard refused before a hand-off existed. */
  handoffId: HandoffId | null;
  phase: SessionPhase;
  mode?: HandoffMode;
  /** The run view's current step. */
  step?: RunStep;
  error?: ErrorCode;
  probe?: ProbeReport;
  banner?: 'FAKE_INSTAGRAM';
  /** For RATE_LIMITED and MSITE_LOCKED: when the lane frees up (epoch ms). */
  freeAt?: number;
  route?: ComposerRoute;
  detail?: string;
  /** W3 (`resizing`): the tab size now, whether it is usable, the deadline, the widest usable tab. */
  resize?: { tab: Size; ok: boolean; until: number; maxW: number };
  window?: WindowDiagnostics;
  path?: string;
  c4?: CheckResult;
  account?: AccountFacts;
  accountPrompt?: { kind: AccountPromptKind; detected: string | null; expected: string | null; until: number };
  queuedUntil?: number;
  result?: RunResult;
  compose?: ComposeFacts;
  entry?: EntryFacts;
  evidence?: Evidence;
  steps?: StepTimes;
  startedAt?: number;
  /** finished: the window is held (upload) or kept for Finish by hand (offerManual). */
  held?: 'upload' | 'offerManual';
  /** When a finished window closes by itself. */
  closeAt?: number;
  /** Stop is honoured (before the Share command). */
  canStop?: boolean;
  shareSent?: boolean;
  manual?: { needs: 'pick' | 'share'; until: number };
  /** The page was hidden and the window raised once (§4.6). */
  raised?: boolean;
}

/** ux.md §8 `lane`: what a click on Post story would do now (pushed as `handoff/lane`). */
export type LaneKind = 'ready' | 'spacing' | 'queued' | 'hourly' | 'daily' | 'paused' | 'busy';
export interface Lane {
  kind: LaneKind;
  freeAt?: number;
  /** busy/queued: the hand-off. */
  handoffId?: HandoffId;
  today: number;
  hour: number;
  caps: { hour: number; day: number };
}

/** storage.local `lastResult` (background-owned): the last run's result, for an editor opened later. */
export interface LastResult {
  handoffId: HandoffId;
  mode: HandoffMode;
  result: RunResult;
  exportId: ExportId | null;
  exportSha256: string | null;
  docHash: string | null;
  startedAt: number;
  durationMs: number;
}

export type HandoffEffect =
  /** windows.create({type:'popup', url:'about:blank', focused:true, state:'normal', ...box}) → windowCreated. */
  | { type: 'openWindow'; box: WindowBox }
  | { type: 'installRules'; removeRuleIds: number[]; addRules: DnrRule[] }
  | { type: 'measureTab'; tabId: number; windowId: number; settle: boolean }
  | { type: 'updateWindow'; windowId: number; tabId: number; box: WindowBox; inner: Size; reapply: boolean }
  | { type: 'readSize'; windowId: number; tabId: number }
  | { type: 'navigate'; tabId: number; url: string }
  | { type: 'hardReload'; tabId: number }
  /** AM37: the portrait shim, then the agent → agentInjected (fresh, orientation). */
  | { type: 'injectAgent'; tabId: number }
  | { type: 'sendAgent'; tabId: number; command: AgentCommand }
  | { type: 'serveFile'; exportId: ExportId }
  | { type: 'notifyEditor'; status: HandoffStatus }
  | { type: 'closeWindow'; windowId: number }
  | { type: 'removeRules'; ruleIds: number[] }
  | { type: 'writeRecord'; record: HandoffRecord }
  /** A later result for a written record (Finish by hand, §6.4 late answer, a kill after finished). */
  | {
      type: 'patchRecordOutcome';
      handoffId: HandoffId;
      outcome: HandoffOutcome;
      result: RunResult;
      patch?: Partial<HandoffRecord>;
    }
  /** History's mark on a Couldn't confirm record; the runner applies it only to an `unknown` record. */
  | { type: 'markRecord'; handoffId: HandoffId; posted: boolean }
  /** The kill switch or TEST_LEAK: pause desktop posting until `until`, and say why (AP-12). */
  | { type: 'lockMsite'; until: number; reason: MsiteLockReason }
  | { type: 'noteOpen'; t: number }
  | { type: 'rememberWindow'; windowId: number; tabId: number; handoffId: HandoffId }
  | { type: 'forgetWindow' }
  | { type: 'armTimer'; timer: HandoffTimer; ms: number }
  | { type: 'clearTimer'; timer: HandoffTimer }
  /** §4.6: windows.update(windowId, {focused: true}). */
  | { type: 'raiseWindow'; windowId: number }
  /** action.setBadgeText / setBadgeBackgroundColor ('' clears). */
  | { type: 'setBadge'; text: string; color: string | null }
  /** §4.6: focus the editor's window again, only if `windowId` (the composer) is the last focused one. */
  | { type: 'focusEditor'; ifFocused: number }
  /** dnr.getSessionRules: rules 1002–1019 present with `tabIds` naming the tab → rulesVerified. */
  | { type: 'verifyTestRules'; tabId: number }
  /** storage.local `menuFingerprint` (background-owned). */
  | { type: 'storeFingerprint'; fingerprint: MenuFingerprint }
  /** storage.local `expectedAccount` (background-owned). */
  | { type: 'setExpectedAccount'; account: ExpectedAccount }
  /** storage.local `lastTestPassAt` (background-owned). */
  | { type: 'setLastTestPass'; at: number }
  /** storage.local `lastResult` (background-owned). */
  | { type: 'writeLastResult'; last: LastResult };

// ---------------------------------------------------------------------------------------
// Reducer context: everything impure, sampled by the runner per event.

export interface HandoffCtx {
  now: number;
  /** MODE !== 'live'. */
  guarded: boolean;
  chromeMajor: number;
  settings: Settings;
  /** checkRate() at `now`; consulted on `start` and when the queue fires. */
  rate: RateDecision;
  uuid: () => string;
  /** [0, 1), for the human-pace dwell. */
  random: () => number;
  /** The stored menu fingerprint (storage.local `menuFingerprint`), or null. */
  fingerprint: MenuFingerprint | null;
  /** AM23: the background's navigator.userAgentData names a branded browser. */
  brandedBrowser: boolean;
  /** W3: a shorter guided-resize deadline from a guarded build's E2E flag. */
  resizeTimeoutMs?: number;
  /** Guarded E2E hook `__e2eDwellScale` (0 = no dwell); ignored in live builds. */
  dwellScale?: number;
  /** Guarded E2E hook `__e2eBudgetScale` (shrinks the 75/120 s outcome budgets); ignored in live builds. */
  budgetScale?: number;
}
