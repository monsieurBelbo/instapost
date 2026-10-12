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
 */

import type { Size } from '../geometry/fit.ts';
import type { ComposerProfile, ScreenAvail, WindowBox } from '../geometry/window-fit.ts';
import type { Preflight, ProbeReport } from '../ig-contract/contract.ts';
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

// ---------------------------------------------------------------------------------------
// Settings (storage.local, §3.3). Rate caps can only be made stricter (rate-guard.ts).

export interface Settings {
  /** "posts as …", typed by the owner; display only. */
  accountLabel: string;
  /** H1. Default ON in guarded builds, OFF in live until OD3. */
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
  | 'sw-controller-change';

export type AgentCommand =
  | { type: 'agent/probe' }
  | { type: 'agent/inject' }
  /**
   * Starts (or restarts) the agent's watch for this document: input-appeared, composer-ready
   * (C6), composer-left (C9), sw-controller-change. `readyTimeoutMs > 0` (H1): report
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
  /** tabs.get measured the frame; one windows.update to windowFit(). */
  | 'fitting'
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
}

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
  | 'refitUpdate';

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
  | (WindowedSession & { phase: 'scoping' | 'fitting' | 'navigating' | 'reloading' })
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

export type HandoffTimer = 'closeDelay' | 'inactivity' | 'navigation';

export type HandoffEvent =
  // editor (runtime.connect port 'handoff')
  | { type: 'start'; exportId: ExportId | null; mode: HandoffMode; rehearsal: boolean; screen: ScreenAvail }
  | { type: 'cancel' }
  | { type: 'outcome'; handoffId: HandoffId; posted: boolean }
  // results of effects (runner → reducer)
  | { type: 'windowCreated'; windowId: number; tabId: number }
  | { type: 'rulesInstalled' }
  /** tabs.get(tabId) width/height (inner) and the window's outer box. */
  | { type: 'tabMeasured'; inner: Size; outer: WindowBox }
  | { type: 'windowFitted' }
  /**
   * `fresh` (AM16): the agent installed itself in this document; false when the sentinel was already
   * set (a same-document `loading`: pushState, replaceState, hash). Missing counts as fresh.
   */
  | { type: 'agentInjected'; fresh?: boolean }
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
}

export type HandoffEffect =
  /** windows.create({type:'popup', url:'about:blank', focused:true, ...box}) → windowCreated. */
  | { type: 'openWindow'; box: WindowBox }
  /** updateSessionRules({removeRuleIds, addRules}) → rulesInstalled. */
  | { type: 'installRules'; removeRuleIds: number[]; addRules: DnrRule[] }
  /** tabs.get(tabId) + windows.get(windowId) → tabMeasured. */
  | { type: 'measureTab'; tabId: number; windowId: number }
  /** windows.update(windowId, box) → windowFitted. */
  | { type: 'updateWindow'; windowId: number; box: WindowBox }
  /** tabs.update(tabId, {url}). */
  | { type: 'navigate'; tabId: number; url: string }
  /** tabs.reload(tabId, {bypassCache:true}), exactly once per hand-off. */
  | { type: 'hardReload'; tabId: number }
  /** scripting.executeScript({target:{tabId, frameIds:[0]}, files:['/composer-agent.js']}) → agentInjected. */
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
}
