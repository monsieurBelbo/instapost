/**
 * Hand-off state machine vocabulary (strategy §3.5, §3.6, §3.10). The reducer
 * (reducer.ts) is pure: `(state, event, ctx) → {state, effects}`. The runner
 * (src/handoff/runner.ts) executes effects, turns platform callbacks into events and
 * persists the state in storage.session after every transition, so a service-worker
 * restart resumes mid-flow.
 *
 * Contract version 1 of this file: later streams may add phases, events, effects or fields;
 * they must not rename or repurpose existing ones without updating every user.
 * v1 (stream B2, additive): WindowedSession bookkeeping (level, degradedFrom, hardReloadSent,
 * injectSent, fileServed, loadsSinceReload, composerReached, route, url); the probing member's
 * `step`/`strict`/`resumeFrom` (AM2 re-probes); `outcome` on finished/closing and `level` on
 * closing; HandoffStatus `route`/`detectedPosted`/`detail`; HandoffRecord `route`/`preflight`/`detail`.
 * v2 (integrator, additive, §11 AM13): WindowedSession and HandoffRecord `readyProbe`, the report
 * taken once the composer is ready (C6), so C8 carries the canvas on a real hand-off.
 * v3 (review fixes, additive, §11 AM16–AM24): error UNEXPECTED_PAGE; timer `navigation`; WindowedSession
 * `offhostSeen`; probing `amLoad`/`pending`; finished `holdOpen`; agentInjected `fresh`; effects
 * rememberWindow/forgetWindow; HandoffStatus `rehearsal`/`assistedInsert`/`holdOpen`; ctx `brandedBrowser`.
 * v4 (review fixes, additive, §11 AM28): errors BRANDED_BROWSER, NAVIGATION_TIMEOUT; agent event
 * `inject-unconfirmed`; WindowedSession `insertDispatched`; finished `postedUnknown`/`unexpectedPage`;
 * HandoffStatus `postedUnknown`.
 * v5 (first live run in Arc, 2026-10-12: W1–W5, P1–P6, U1–U2): phase `resizing`; `fitting` gains
 * `fitStep`; probing step `awaitInput`; errors SW_INTERCEPTS, WINDOW_NOT_FITTED, LAYOUT_TOO_WIDE
 * (SW_TOOK_CONTROL is no longer emitted); agent event `sw-intercepted`; events `windowFitted`
 * (now with the verification), `windowSized`, `boundsChanged`; `tabMeasured.zoom`; effects
 * `updateWindow` (now with `tabId` and the target `inner`), `readSize`; timers `fitRetry`,
 * `resizeDeadline`, `resizePoll`, `inputWait`; SessionBase `browser`/`win`; WindowedSession
 * `inputWaitUsed`, `inputWaitUntil`, `swControllerChanges`, `c4Reached`, `injectAt`; HandoffStatus
 * `resize`, `window`, `path`, `c4`; HandoffRecord `window`, `browser`, `swControllerChanges`; ctx
 * `resizeTimeoutMs`; start `browser`.
 * v5.1 (Arc hardening, additive): updateWindow `reapply`; windowFitted and WindowUpdateDiag `applied`.
 * v5.2 (review of the Arc changes): measureTab `settle` (false for the refit: one read, AL-3); the
 * `resize` status gains `maxW` (the zoom-aware width limit its ✓ uses, AF-8); probing `awaitInput`
 * now also serves the probe mode and H0 with H1 off (AL-1/AF-1).
 * v6 (AM37, second live run in Arc, 2026-10-12, additive): error SCREEN_LANDSCAPE; `injectAgent` first
 * injects the MAIN-world portrait shim; `agentInjected.orientation`; WindowedSession `pageOrientation`.
 * v6.1 (review of AM37, 2026-10-13, additive): WindowedSession `composerEntered` (SH-1);
 * PageOrientation `afterComposerMount`.
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
// Errors (§3.10). Errors never retry; every error leaves the image in Downloads and offers
// the phone lane.

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
  /**
   * No longer emitted (P2, 2026-10-12): Instagram's worker claims every logged-in page (F2), so a
   * `controllerchange` is counted on the record instead. Kept so records of earlier builds still parse.
   */
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
  /** AM23/AM28: a guarded build in a branded browser (Google Chrome, Microsoft Edge); no window opens. */
  'BRANDED_BROWSER',
  /** AM20/AM28: the first navigation never committed on www within NAVIGATION_TIMEOUT_MS. */
  'NAVIGATION_TIMEOUT',
  /**
   * P3: a service worker handled the composer page's requests (resource or navigation timing with
   * `workerStart > 0`), so they left without the tab-scoped UA rule 1001.
   */
  'SW_INTERCEPTS',
  /** W3: the popup never became narrow and tall enough (auto-fit, its retry and RESIZE_TIMEOUT_MS of guided resize). */
  'WINDOW_NOT_FITTED',
  /** P4: after the one refit the composer is still wider than MSITE_MAX_CSS_WIDTH (no + → Story entry there). */
  'LAYOUT_TOO_WIDE',
  /**
   * AM37 (C3b): the composer was reached and the page still read a landscape screen orientation (the
   * portrait shim off, failed or absent), so Instagram's composer hides Share there.
   */
  'SCREEN_LANDSCAPE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * What each error does (§3.10):
 * - `no-window`: a guard refused; nothing opened;
 * - `close`: close the popup, remove the rules, no lock;
 * - `degrade-h0`: stay in the same window and fall back to H0 (manual pick);
 * - `kill`: close, remove the rules, lock the msite lane for 7 days;
 * - `editor`: shown in the editor only; never reaches the reducer.
 */
export type ErrorEffect = 'no-window' | 'close' | 'degrade-h0' | 'kill' | 'editor';

export const ERROR_EFFECT: Readonly<Record<ErrorCode, ErrorEffect>> = {
  RATE_LIMITED: 'no-window',
  HANDOFF_BUSY: 'no-window',
  MSITE_LOCKED: 'no-window',
  GUARD_NOT_FAKE: 'close',
  DESKTOP_SHELL: 'close',
  NOT_LOGGED_IN: 'close',
  LANDSCAPE: 'close',
  SCREEN_TOO_SMALL: 'close',
  INPUT_MISSING: 'degrade-h0',
  ACCEPT_DRIFT: 'degrade-h0',
  INJECTION_IGNORED: 'degrade-h0',
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
};

// ---------------------------------------------------------------------------------------
// Timing (§3.6, §3.8).

export const MSITE_LOCK_MS = 7 * 24 * 60 * 60 * 1000;
/** H1: wait for C6 (composer ready) after the insert. */
export const INJECT_READY_TIMEOUT_MS = 10_000;
/** Inactivity before the popup is closed with TIMEOUT. */
export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
/** After `finished`, the popup closes this much later (unless it is held open for an upload, AM19). */
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
/**
 * W2 hardening (Arc research, 2026-10-12: Arc often ignores the first windows.update, and may re-place
 * a new popup up to about 1 s after windows.create). While the tab is still about:blank, so Instagram
 * sees none of it, an updateWindow re-applies the same box at these offsets (ms after its first
 * windows.update) whenever the tab is not fitted at that moment. Never after the navigation.
 */
export const FIT_REAPPLY_MS: readonly number[] = [0, 150, 300, 500, 1000];
/**
 * …and its verification counts the tab as fitted only once it still is this long after the first
 * windows.update, so a late re-placement lands inside it and is re-applied (at most FIT_VERIFY_MAX_MS).
 */
export const FIT_HOLD_MS = 1100;
/** W3: how long the owner has to drag the popup narrow and tall before WINDOW_NOT_FITTED. */
export const RESIZE_TIMEOUT_MS = 3 * 60 * 1000;
/** W3: the tab size is also polled this often while resizing (besides windows.onBoundsChanged). */
export const RESIZE_POLL_MS = 1000;
/** P5: how long a probe that found no story input waits for the agent's `input-appeared` (hydration). */
export const INPUT_WAIT_MS = 6000;
/** W5: windows.update entries kept on the record (the fit, its one retry and the single refit). */
export const MAX_WINDOW_UPDATES = 3;

// ---------------------------------------------------------------------------------------
// Settings (storage.local, §3.3). Rate caps can only be made stricter (rate-guard.ts).

export interface Settings {
  /** "posts as …", typed by the owner; display only. */
  accountLabel: string;
  /**
   * H1. Default ON in guarded builds, OFF in live until OD3. AM37: the insert also skips msite's story
   * session start (its session id stays null), a second reason to keep it off in live; Settings says so.
   */
  assistedInsert: boolean;
  /** Rehearsal rules 1002–1019. Default ON in every build; the owner switches it off from L8. */
  rehearsal: boolean;
  chMode: ChMode;
  /** Epoch ms; the msite lane is locked until then (kill switch). null = unlocked. */
  msiteLockedUntil: number | null;
  composerProfile: ComposerProfile | null;
  rateCaps: Partial<RateCaps>;
}

export function defaultSettings(guarded: boolean): Settings {
  return {
    accountLabel: '',
    assistedInsert: guarded,
    rehearsal: true,
    chMode: 'full',
    msiteLockedUntil: null,
    composerProfile: null,
    rateCaps: {},
  };
}

// ---------------------------------------------------------------------------------------
// Agent vocabulary shared with src/shared/protocol.ts (which adds v:1, handoffId, nonce).

export type AgentEventName =
  | 'input-appeared'
  | 'composer-ready'
  | 'composer-left'
  /** The insert could not be made (no input, no file, the assignment threw). */
  | 'inject-ignored'
  /** AM28: the insert was dispatched but C6 did not hold within the ready deadline. */
  | 'inject-unconfirmed'
  /** Diagnostics only since P2: counted on the record (Instagram's worker claims every page, F2). */
  | 'sw-controller-change'
  /** P3: the agent's watch saw a service worker handle a www/i.instagram.com request (SW_INTERCEPTS). */
  | 'sw-intercepted';

export type AgentCommand =
  | { type: 'agent/probe' }
  | { type: 'agent/inject' }
  /**
   * Starts (or restarts) the agent's watch for this document: input-appeared, composer-ready
   * (C6), composer-left (C9), sw-controller-change, sw-intercepted. `readyTimeoutMs > 0` (H1): report
   * `inject-unconfirmed` if C6 does not hold that long after the insert (AM28). `0` (H0): no deadline.
   */
  | { type: 'agent/watch'; readyTimeoutMs: number };

// ---------------------------------------------------------------------------------------
// State.

export type HandoffMode = 'post' | 'probe';
export type HandoffLevel = 'H1' | 'H0';

export type HandoffPhase =
  | 'idle'
  /** windows.create(about:blank) issued. */
  | 'opening'
  /** Rule 1001 (+ rehearsal rules) being installed while the tab is still about:blank. */
  | 'scoping'
  /**
   * W2, still at about:blank: the settled window is measured, then windows.update({state:'normal'})
   * to windowFit() is verified against the tab size; one retry 300 ms later (`fitStep`).
   */
  | 'fitting'
  /**
   * W3: auto-fit failed; the owner drags the popup narrow and tall (live size in the editor). Goes
   * on by itself once the tab is usable (isUsableInner), else WINDOW_NOT_FITTED after 3 min.
   */
  | 'resizing'
  /** tabs.update to COMPOSER_URL issued; waiting for the first `loading` on www. */
  | 'navigating'
  /** Hard reload issued once; kill switch armed from here on; waiting for `complete`. */
  | 'reloading'
  /** Agent injected and agent/probe sent (also after the single landscape refit). */
  | 'probing'
  /** H1: agent/inject sent; agent/get-file is accepted only here. */
  | 'injecting'
  /** H0: the owner taps + → Story and picks the file. */
  | 'awaitingPick'
  /** Composer ready (C6); the owner reviews and taps Share. */
  | 'awaitingShare'
  /** Composer left (C9); the editor asks "Posted?"; the popup closes after CLOSE_DELAY_MS. */
  | 'finished'
  /** Window close requested; cleanup pending until windows.onRemoved. */
  | 'closing';

export interface PhaseLogEntry {
  phase: HandoffPhase;
  t: number;
}

export type HandoffOutcome =
  | 'posted-confirmed'
  | 'not-posted'
  | 'abandoned'
  | `failed:${ErrorCode}`
  | `killed:${ErrorCode}`;

/** W2: one windows.update and what the verification saw. Structural numbers only. */
export interface WindowUpdateDiag {
  /** `fit` and `retry` (its one retry) in `fitting`; `refit` for the single P4/landscape refit while probing. */
  step: 'fit' | 'retry' | 'refit';
  /** The outer box asked for. */
  box: WindowBox;
  /** The inner size it should give. */
  target: Size;
  /** The window and its tab when the verification ended. */
  outer: WindowBox;
  tab: Size;
  /** The tab reached the target within FIT_TOLERANCE_PX. */
  fitted: boolean;
  /**
   * windows.update calls this step made: 1, or more when the pre-navigation verification re-applied
   * the box (FIT_REAPPLY_MS). Absent on records of earlier builds.
   */
  applied?: number;
}

/** W5: how the popup was sized, for the record and the panel. Structural numbers only. */
export interface WindowDiagnostics {
  /** screen.avail* the editor sent. */
  screen: ScreenAvail;
  /** The box windows.create was asked for (firstGuess). */
  requested: WindowBox;
  /** The window once it settled after windows.create (Arc ignores the create bounds, F1); null before. */
  created: WindowBox | null;
  /** Its tab (inner) size then. */
  createdTab: Size | null;
  /** Outer minus tab size of the settled window. */
  frameDelta: FrameDelta | null;
  /** Every windows.update with its verification, in order (at most MAX_WINDOW_UPDATES). */
  updates: WindowUpdateDiag[];
  /** windows.update calls in `fitting` (1, or 2 with the one retry). */
  attempts: number;
  /** W3: the owner resized the popup by hand. */
  manualResize: boolean;
  /** The tab size when the navigation started (while resizing: the latest size read). */
  finalTab: Size | null;
  /** tabs.getZoom at the latest measurement (about:blank, then the composer page at a refit). */
  zoom: number | null;
}

/** IndexedDB `handoffs` (§3.6). */
export interface HandoffRecord {
  id: HandoffId;
  exportId: ExportId | null;
  mode: HandoffMode;
  level: HandoffLevel | null;
  rehearsal: boolean;
  chMode: ChMode;
  phaseLog: PhaseLogEntry[];
  probe?: ProbeReport;
  /**
   * C1–C5 and the SW state from the deciding probe, C8 from `readyProbe` when the composer got
   * that far (§3.9 item 1, AM13). Present with `probe`.
   */
  preflight?: Preflight;
  /** AM13: the report taken when the composer became ready (C6); its canvas is C8. */
  readyProbe?: ProbeReport;
  /** C5: where the tab landed after the hard reload. */
  route?: ComposerRoute;
  /**
   * Platform error text when an effect failed (AGENT_UNREACHABLE); the page of an UNEXPECTED_PAGE
   * (`UNEXPECTED_PAGE /x/`, query dropped); why a finished outcome was not pre-answered (AM28).
   */
  detail?: string;
  /** W5: how the popup was sized (absent on records of earlier builds). */
  window?: WindowDiagnostics;
  /** P6: the browser the editor detected. */
  browser?: BrowserFlavour;
  /** P2: `controllerchange` events the agent saw (a worker claiming the page is normal on Instagram). */
  swControllerChanges?: number;
  outcome: HandoffOutcome;
  startedAt: number;
  endedAt: number;
}

/** Fields every active hand-off carries. */
export interface SessionBase {
  handoffId: HandoffId;
  nonce: Nonce;
  mode: HandoffMode;
  /** null for `probe` (no file). */
  exportId: ExportId | null;
  rehearsal: boolean;
  /** Snapshot of settings at start. */
  assistedInsert: boolean;
  chMode: ChMode;
  chromeMajor: number;
  screen: ScreenAvail;
  /** P6: the browser the editor detected (record only; a guarded build refused the branded ones). */
  browser: BrowserFlavour;
  /** W5: the popup's sizing so far. */
  win: WindowDiagnostics;
  startedAt: number;
  lastEventAt: number;
  phaseLog: PhaseLogEntry[];
}

/** Once the popup exists. */
export interface WindowedSession extends SessionBase {
  windowId: number;
  tabId: number;
  /** Measured in `fitting`; null before. */
  frameDelta: Size | null;
  /** The single landscape refit has been used. */
  refitUsed: boolean;
  /** The probe report that decided the flow (the last one evaluated). */
  probe: ProbeReport | null;
  /**
   * AM13: the report taken once the composer was ready (C6), for C8. Diagnostics only: it never
   * drives a decision, and the deciding `probe` is kept as it was.
   */
  readyProbe: ProbeReport | null;
  /** Live build on the fake: show the FAKE INSTAGRAM banner. */
  fakeBanner: boolean;
  /** Level decided by the first passing probe; null before. Re-probes never upgrade H0 to H1. */
  level: HandoffLevel | null;
  /** Why H0 replaced H1, if it did (INPUT_MISSING, ACCEPT_DRIFT, INJECTION_IGNORED). */
  degradedFrom: ErrorCode | null;
  /**
   * AM20: in `navigating`, an update with a hidden URL (about:blank's own load, or an off-host
   * commit) was seen. If the navigation deadline passes with no www commit, the popup is killed.
   */
  offhostSeen: boolean;
  /** The one hard reload was issued (AM2: never a second one per hand-off). */
  hardReloadSent: boolean;
  /** The one agent/inject was sent (§3.8: never a second one per handoffId). */
  injectSent: boolean;
  /** The export was served to the one agent/get-file. */
  fileServed: boolean;
  /**
   * AM28: the agent dispatched the insert in this document but C6 never confirmed it
   * (`inject-unconfirmed`), so the file may be in the composer and Share may be tapped from H0.
   * Cleared when a new document is detected (AM16).
   */
  insertDispatched: boolean;
  /** `status:'loading'` events (document commits) since the hard reload; the first is the reload's own. */
  loadsSinceReload: number;
  /**
   * The tab showed a /create/story URL after the reload. Diagnostics only since AM18: C9 counts once
   * the composer is engaged (a file reached it), see reducer.ts `engaged()`.
   */
  composerReached: boolean;
  /** C5: set by the first `complete` after the reload ('homeOnly' when it landed elsewhere on www). */
  route: ComposerRoute | null;
  /** tab.url of the latest tabs.onUpdated (probe evaluation and the preflight). */
  url: string | null;
  /** P5: the one wait for a story input that mounts after hydration was used. */
  inputWaitUsed: boolean;
  /**
   * P5: while that wait runs, its deadline (epoch ms); null otherwise. A same-document load
   * (hydration's replaceState) that interrupts it resumes the wait instead of ending it (AM16).
   */
  inputWaitUntil: number | null;
  /** P2: `sw-controller-change` events seen (diagnostics). */
  swControllerChanges: number;
  /** The deciding probe's decision reached C4 (probe-eval.ts); else the preflight's C4 is `unknown`. */
  c4Reached: boolean;
  /**
   * Where the one H1 insert was made: on the composer (`/create/story`), or on home (P5: msite's
   * header input, whose insert starts the story session and SPA-navigates to the composer; it becomes
   * `composer` once the tab shows /create/story). AM18's "the composer went away" applies only to
   * `composer`. null before the insert.
   */
  injectAt: 'composer' | 'home' | null;
  /**
   * AM37: the portrait shim's reading in the current document (the screen orientation as the page reads
   * it, and what the shim did), from the latest injection; null before the first. Each agent report is
   * stamped with it (ProbeReport.orientation), and a load that reaches the composer with a landscape
   * reading ends the session with SCREEN_LANDSCAPE.
   */
  pageOrientation: PageOrientation | null;
  /**
   * SH-1 (2026-10-13): since the previous injection, a commit moved the tab from another page onto
   * /create/story (the pick's or the insert's SPA navigation; in `reloading`, only a commit after the
   * reload's own one). The composer page then mounted before the next injection's shim could run, so
   * a shim that installs itself there (`installed`) came too late: the reading gets
   * `afterComposerMount`. Consumed (reset) by every agentInjected. Absent on stored sessions of earlier
   * builds (read as false).
   */
  composerEntered: boolean;
}

/** W2: sub-steps of `fitting`. */
export type FitStep =
  /** measureTab issued: the runner lets the window settle, then reads it and its tab. */
  | 'measure'
  /** updateWindow (attempt 1) issued, with its verification. */
  | 'update'
  /** Attempt 1 did not verify: the `fitRetry` timer is pending. */
  | 'retryWait'
  /** updateWindow (attempt 2, the one retry) issued. */
  | 'retry';

/** Sub-steps of `probing`, so stale effect results can be told apart. */
export type ProbeStep =
  /** A later document load started (AM2): waiting for its `complete`. */
  | 'awaitComplete'
  /** injectAgent issued: waiting for agentInjected. */
  | 'injectAgent'
  /** agent/probe sent: waiting for agentReport. */
  | 'awaitReport'
  /** Landscape refit: measureTab issued. */
  | 'refitMeasure'
  /** Landscape refit: updateWindow issued. */
  | 'refitUpdate'
  /**
   * P5: the first probe that reached C4 found no story input (on `/` the input may mount after
   * hydration), in a post (H1 or H0) or in probe mode (AL-1/AF-1): agent/watch is running and
   * `inputWait` is armed; `input-appeared` re-probes once, the deadline decides on the probe as it is.
   */
  | 'awaitInput';

/** How a session ended; decides the record outcome and the cleanup. */
export type SessionResult =
  | { kind: 'probe-done' }
  | { kind: 'finished'; detectedPosted: boolean }
  | { kind: 'cancelled' }
  | { kind: 'failed'; code: ErrorCode }
  | { kind: 'killed'; code: 'KILLED_CHALLENGE' | 'KILLED_OFFHOST' };

export interface IdleState {
  phase: 'idle';
  /** The previous hand-off, so a late `handoff/outcome` can still be recorded. */
  last: { handoffId: HandoffId; outcome: HandoffOutcome; endedAt: number } | null;
}

export type ActiveState =
  | (SessionBase & { phase: 'opening' })
  | (WindowedSession & { phase: 'scoping' | 'navigating' | 'reloading' })
  | (WindowedSession & { phase: 'fitting'; fitStep: FitStep })
  | (WindowedSession & {
      phase: 'resizing';
      /** Epoch ms of the WINDOW_NOT_FITTED deadline (for the editor's countdown). */
      resizeUntil: number;
    })
  | (WindowedSession & {
      phase: 'probing';
      step: ProbeStep;
      /** AM2: this probe follows a later document load, so isMobile must be exactly true. */
      strict: boolean;
      /** The post-probe phase a later document load interrupted; null for the first probe. */
      resumeFrom: 'injecting' | 'awaitingPick' | 'awaitingShare' | null;
      /**
       * AM16: this probe follows a `loading` of the armed tab. Whether it is a new document is known
       * only at `agentInjected` (`fresh`): the same document resumes `resumeFrom` without a probe.
       */
      amLoad: boolean;
      /** AM16: agent events that arrived while the same document might still resume (replayed then). */
      pending: AgentEventName[];
    })
  | (WindowedSession & { phase: 'injecting'; level: 'H1' })
  | (WindowedSession & { phase: 'awaitingPick'; level: 'H0'; degradedFrom: ErrorCode | null })
  | (WindowedSession & { phase: 'awaitingShare'; level: HandoffLevel })
  | (WindowedSession & {
      phase: 'finished';
      level: HandoffLevel | null;
      detectedPosted: boolean;
      /**
       * AM28: whether Share was tapped cannot be told, so "Posted?" has no pre-answer: an unknown
       * page after Share (AM17), or C9 after an unconfirmed insert.
       */
      postedUnknown: boolean;
      /** AM17: the path of the unknown www page that ended the session (UNEXPECTED_PAGE); else null. */
      unexpectedPage: string | null;
      /** The outcome written to the record (detection, then the owner's answer). */
      outcome: HandoffOutcome;
      /**
       * AM19: C9 followed Share in a post with rehearsal off, so an upload may still be running in the
       * popup: no 3 s close; it closes on the owner's "Posted?" answer, a cancel or inactivity. AM28:
       * also after an unconfirmed insert (any rehearsal setting), so an H0 retry is not cut off.
       */
      holdOpen: boolean;
    })
  | (SessionBase & {
      phase: 'closing';
      windowId: number | null;
      tabId: number | null;
      result: SessionResult;
      level: HandoffLevel | null;
      /** The record is already written with this outcome. */
      outcome: HandoffOutcome;
    });

export type HandoffState = IdleState | ActiveState;

export const IDLE: IdleState = { phase: 'idle', last: null };

/** The kill switch is armed from the hard reload until the session closes. */
export const ARMED_PHASES: readonly HandoffPhase[] = [
  'reloading',
  'probing',
  'injecting',
  'awaitingPick',
  'awaitingShare',
  'finished',
];
export const isArmed = (s: HandoffState): boolean => ARMED_PHASES.includes(s.phase);

// ---------------------------------------------------------------------------------------
// Events (inputs to the reducer). Agent events arrive only after acceptAgentMessage()
// (src/shared/protocol.ts) validated sender, tab, frame, origin, ids and phase.

export type HandoffTimer =
  | 'closeDelay'
  | 'inactivity'
  | 'navigation'
  /** W2: the one windows.update retry, FIT_RETRY_DELAY_MS after the first attempt did not verify. */
  | 'fitRetry'
  /** W3: RESIZE_TIMEOUT_MS (shorter in guarded test runs) → WINDOW_NOT_FITTED. */
  | 'resizeDeadline'
  /** W3: read the tab size every RESIZE_POLL_MS, besides windows.onBoundsChanged. */
  | 'resizePoll'
  /** P5: INPUT_WAIT_MS for `input-appeared` before the probe's INPUT_MISSING stands. */
  | 'inputWait';

/** Every timer, so a session's end can clear them all. */
export const HANDOFF_TIMERS: readonly HandoffTimer[] = [
  'closeDelay',
  'inactivity',
  'navigation',
  'fitRetry',
  'resizeDeadline',
  'resizePoll',
  'inputWait',
];

export type HandoffEvent =
  // editor (runtime.connect port 'handoff')
  | {
      type: 'start';
      exportId: ExportId | null;
      mode: HandoffMode;
      rehearsal: boolean;
      screen: ScreenAvail;
      /** P6: the editor's detection. */
      browser: BrowserFlavour;
    }
  | { type: 'cancel' }
  | { type: 'outcome'; handoffId: HandoffId; posted: boolean }
  // results of effects (runner → reducer)
  | { type: 'windowCreated'; windowId: number; tabId: number }
  | { type: 'rulesInstalled' }
  /**
   * tabs.get(tabId) width/height (inner) and the window's outer box once it settled (two equal
   * windows.get reads FIT_SETTLE_POLL_MS apart, at most FIT_SETTLE_MAX_MS); `zoom` = tabs.getZoom.
   */
  | { type: 'tabMeasured'; inner: Size; outer: WindowBox; zoom?: number | null }
  /**
   * W2: updateWindow's verification. `fitted`: the tab came within FIT_TOLERANCE_PX of `target`
   * within FIT_VERIFY_MAX_MS (and, with `reapply`, still was FIT_HOLD_MS after the first update).
   * `inner`/`outer`: the tab and window when it stopped. `box`/`target` echo the effect. `applied`:
   * the windows.update calls made (re-applies included).
   */
  | {
      type: 'windowFitted';
      box: WindowBox;
      target: Size;
      fitted: boolean;
      inner: Size;
      outer: WindowBox;
      applied?: number;
    }
  /** W3: readSize's answer: the tab and window right now. */
  | { type: 'windowSized'; inner: Size; outer: WindowBox }
  /** W3: windows.onBoundsChanged for the composer window. */
  | { type: 'boundsChanged'; windowId: number }
  /**
   * `fresh` (AM16): the agent installed itself in this document; false when the sentinel was already
   * set (a same-document `loading`: pushState, replaceState, hash). Missing counts as fresh.
   * `orientation` (AM37): the portrait shim's result in that document (injected just before the agent).
   */
  | { type: 'agentInjected'; fresh?: boolean; orientation?: PageOrientation }
  /** Any effect whose platform call rejected. */
  | { type: 'effectFailed'; effect: HandoffEffect['type']; message: string }
  // platform listeners
  /** tabs.onUpdated for the composer tab. `url` is tab.url: undefined for hosts without permission. */
  | { type: 'tabUpdated'; tabId: number; status: 'loading' | 'complete' | undefined; url: string | undefined }
  | { type: 'windowRemoved'; windowId: number }
  | { type: 'tabRemoved'; tabId: number }
  /** runtime.onStartup / onInstalled: idempotent cleanup of rules and state. */
  | { type: 'startup' }
  | { type: 'timer'; timer: HandoffTimer }
  // agent (validated)
  | { type: 'agentReport'; probe: ProbeReport }
  | { type: 'agentGetFile' }
  | { type: 'agentEvent'; event: AgentEventName };

// ---------------------------------------------------------------------------------------
// Effects (outputs of the reducer, executed in order by the runner).

/** Background → editor status (protocol adds v:1 and type 'handoff/status'). */
export interface HandoffStatus {
  /** null when a guard refused before a hand-off existed. */
  handoffId: HandoffId | null;
  phase: HandoffPhase;
  level: HandoffLevel | null;
  error?: ErrorCode;
  probe?: ProbeReport;
  banner?: 'FAKE_INSTAGRAM';
  /** For RATE_LIMITED and MSITE_LOCKED: when the lane frees up (epoch ms). */
  freeAt?: number;
  /** C5 once known. `homeOnly`: the H0 text must say "tap + → Story". */
  route?: ComposerRoute;
  /** `finished` only: the pre-answer for "Posted?" (C9 left from awaitingShare). */
  detectedPosted?: boolean;
  /** `finished` only (AM28): no pre-answer; whether Share was tapped cannot be told. */
  postedUnknown?: boolean;
  /** Which platform call failed (AGENT_UNREACHABLE), or the page UNEXPECTED_PAGE went to (`page /x/`). */
  detail?: string;
  /**
   * AM21: the open session's own switches (snapshot at start), on every status of an active hand-off.
   * The panel shows these, not the stored settings, while a hand-off runs.
   */
  rehearsal?: boolean;
  assistedInsert?: boolean;
  /** `finished` only (AM19): the popup stays open until the owner answers "Posted?". */
  holdOpen?: boolean;
  /**
   * W3 (`resizing`, and the status that leaves it): the tab size now, whether it is usable
   * (isUsableInner), the WINDOW_NOT_FITTED deadline, and `maxW`, the widest usable tab in window px
   * (MSITE_MAX_CSS_WIDTH × the tab zoom: maxMsiteInnerW), which the instruction names (AF-8).
   */
  resize?: { tab: Size; ok: boolean; until: number; maxW: number };
  /** W5: the popup's sizing, on the status that ends `fitting`/`resizing` and after a refit. */
  window?: WindowDiagnostics;
  /** U1: the composer tab's path (query dropped), with the deciding probe. */
  path?: string;
  /** U1: the preflight's C4 for the deciding probe (`unknown`: the decision never reached the input). */
  c4?: CheckResult;
}

export type HandoffEffect =
  /** windows.create({type:'popup', url:'about:blank', focused:true, state:'normal', ...box}) → windowCreated (W1). */
  | { type: 'openWindow'; box: WindowBox }
  /** updateSessionRules({removeRuleIds, addRules}) → rulesInstalled. */
  | { type: 'installRules'; removeRuleIds: number[]; addRules: DnrRule[] }
  /**
   * W2: windows.get(windowId) until two reads FIT_SETTLE_POLL_MS apart agree (at most
   * FIT_SETTLE_MAX_MS), then tabs.get(tabId) and tabs.getZoom(tabId) → tabMeasured. `settle` is true
   * for the new popup in `fitting` only; the refit (kill switch armed, the window not new) reads the
   * window once, so the event queue is never held up (AL-3).
   */
  | { type: 'measureTab'; tabId: number; windowId: number; settle: boolean }
  /**
   * windows.update(windowId, {state:'normal', ...box}), then tabs.get every FIT_VERIFY_POLL_MS until
   * the tab is within FIT_TOLERANCE_PX of `inner`, for at most FIT_VERIFY_MAX_MS → windowFitted.
   * `reapply` (W2, `fitting` only, the tab still about:blank): the box is re-applied at FIT_REAPPLY_MS
   * while the tab is not fitted, and the fit must hold until FIT_HOLD_MS. false for the refit after
   * the navigation: one windows.update, no hold, and the verification runs beside the event queue
   * (its windowFitted is queued when it ends), so a kill-switch update is never held up (AL-3).
   */
  | { type: 'updateWindow'; windowId: number; tabId: number; box: WindowBox; inner: Size; reapply: boolean }
  /** W3: tabs.get(tabId) + windows.get(windowId), no waiting → windowSized. */
  | { type: 'readSize'; windowId: number; tabId: number }
  /** tabs.update(tabId, {url}). */
  | { type: 'navigate'; tabId: number; url: string }
  /** tabs.reload(tabId, {bypassCache:true}), exactly once per hand-off. */
  | { type: 'hardReload'; tabId: number }
  /**
   * AM37: first the portrait shim, scripting.executeScript({target:{tabId, frameIds:[0]}, world:'MAIN',
   * injectImmediately:true, func}) (src/agent/portrait-shim.ts; read-only when a guarded build's E2E flag
   * switches it off), then scripting.executeScript({target:{tabId, frameIds:[0]}, files:['/composer-agent.js']})
   * → agentInjected with the shim's `orientation`. Emitted for every document of the composer tab after
   * the hard reload (AM2/AM16), and only for that tab.
   */
  | { type: 'injectAgent'; tabId: number }
  /** tabs.sendMessage(tabId, {v:1, ...command, handoffId, nonce}, {frameId:0}). */
  | { type: 'sendAgent'; tabId: number; command: AgentCommand }
  /** Answer the pending agent/get-file with the export's bytes (base64). */
  | { type: 'serveFile'; exportId: ExportId }
  | { type: 'notifyEditor'; status: HandoffStatus }
  | { type: 'closeWindow'; windowId: number }
  /** Always the full 1001..1019 range on cleanup. */
  | { type: 'removeRules'; ruleIds: number[] }
  | { type: 'writeRecord'; record: HandoffRecord }
  /** A late "Posted?" answer for an already written record. */
  | { type: 'patchRecordOutcome'; handoffId: HandoffId; outcome: HandoffOutcome }
  /** settings.msiteLockedUntil = until. */
  | { type: 'lockMsite'; until: number }
  /** Append to the rate-guard open log. */
  | { type: 'noteOpen'; t: number }
  /**
   * AM22: storage.local `composerWindow` = this popup, so a reloaded or re-enabled extension (whose
   * storage.session is gone) can still close it.
   */
  | { type: 'rememberWindow'; windowId: number; tabId: number; handoffId: HandoffId }
  /** Clears storage.local `composerWindow`. */
  | { type: 'forgetWindow' }
  /** Replaces any pending timer of the same name; fires `{type:'timer', timer}` after `ms`. */
  | { type: 'armTimer'; timer: HandoffTimer; ms: number }
  /** No-op when none is pending. */
  | { type: 'clearTimer'; timer: HandoffTimer };

// ---------------------------------------------------------------------------------------
// Reducer context: everything impure, sampled by the runner per event.

export interface HandoffCtx {
  now: number;
  /** MODE !== 'live'. */
  guarded: boolean;
  /** From the background's navigator.userAgent. */
  chromeMajor: number;
  settings: Settings;
  /** checkRate() at `now`; consulted on `start` only. */
  rate: RateDecision;
  /** crypto.randomUUID. */
  uuid: () => string;
  /**
   * AM23: the background's navigator.userAgentData names a branded browser (Google Chrome, Microsoft
   * Edge). Sealed browsers (CfT, Playwright's Chromium) do not, so a guarded build refuses at once.
   */
  brandedBrowser: boolean;
  /**
   * W3: a shorter guided-resize deadline from a guarded build's E2E flag (storage.local
   * `__e2eResizeTimeoutMs`). Ignored in live builds and when not below RESIZE_TIMEOUT_MS.
   */
  resizeTimeoutMs?: number;
}
