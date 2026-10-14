/**
 * The hand-off reducer (strategy §3.6–§3.10, docs/ux.md, AM39–AM41). Pure: no I/O, no clocks, no
 * randomness beyond ctx. `handoffReducer(state, event, ctx) → {state, effects}`.
 *
 * ## Protocol for the runner (src/handoff/runner.ts)
 *
 * - Feed events one at a time; persist `state` (storage.session) after every transition, then run
 *   `effects` **in order**, each awaited. An event that changes nothing returns the very same state
 *   object and no effects. Persisting first is what makes Share-once hold across a worker restart: the
 *   state that says `shareSent` is stored before the Share command leaves.
 * - Sample `ctx` per event: `now`, `guarded`, `chromeMajor`, `settings` (storage.local, with the
 *   background-owned keys merged in), `rate`, `uuid`, `random`, `fingerprint` (storage.local
 *   `menuFingerprint`), and in guarded builds only the E2E scales and the resize deadline.
 * - Every effect whose platform call rejects is reported back as `effectFailed`. The reducer decides;
 *   the runner never retries.
 * - Answers: openWindow → windowCreated; installRules → rulesInstalled; measureTab → tabMeasured;
 *   updateWindow → windowFitted; readSize → windowSized; injectAgent → agentInjected (fresh, orientation);
 *   verifyTestRules → rulesVerified. Agent messages arrive only after acceptAgentMessage().
 *
 * ## Sequence (ux.md §3)
 *
 *   start (queued while the 60 s spacing runs, K11) → opening → scoping → fitting (docked right, verified)
 *   [→ resizing] → navigating → reloading (hard reload, kill switch armed) → probing (shim + agent, probe,
 *   the one wait for a late story input or account link) → the account decision (awaitingAccount when it
 *   asks) → openingEntry (dwell, + → Story: the agent arms the story input) → inserting (dwell, the photo
 *   into the armed input; the SPA navigation to /create/story is a document check, AM16) → composeReady
 *   (the photo drawn, one Share control settled; a test ends here; a Share test verifies its write-block
 *   rules; dwell) → sharing (the Share command, once) → confirmingUpload (the outcome rules on Instagram's
 *   upload and publish requests, outcome.ts) → finished (closes on its schedule, or is held) → closing → idle.
 *
 * ## Invariants (U19)
 *
 * - Share once: `agent/drive share` is emitted only from composeReady, in `post` or (rules verified)
 *   `shareTest`, with the account confirmed, the compose facts valid and C3b passing, and only while
 *   `shareSent` is false; `shareSent` is set in the same transition. Nothing ever retries a publish.
 * - At most one openWindow, installRules, navigate, hardReload, open-entry, insert and serveFile per
 *   hand-off; at most two measureTab and three updateWindow (the fit, its retry, the single refit).
 * - Nothing is tapped before the account decision: no open-entry while the account prompt waits.
 * - Stop is honoured until the Share command; after it the run cannot be stopped, a closed window is
 *   Couldn't confirm, and every error is Couldn't confirm unless the outcome rules decided.
 * - "Posted" only from outcome.ts O1. A kill after O1 keeps Posted and locks; before it, Couldn't
 *   confirm (after Share) or Not posted (before), and locks.
 * - Closing emits `closeWindow` first (after the editor refocus, never for a kill) and removes the rules
 *   only once the window is gone.
 */
import type { Size } from '../geometry/fit.ts';
import {
  type FrameDelta,
  firstGuess,
  frameDeltaOf,
  isUsableInner,
  maxMsiteInnerW,
  type ScreenAvail,
  type WindowBox,
  windowFit,
  zoomOf,
} from '../geometry/window-fit.ts';
import { accountDecision, isValidHandle, promptOf, sameHandle } from '../ig-contract/account.ts';
import { isBrandedFlavour } from '../ig-contract/browser-flavour.ts';
import { type CheckResult, type PageOrientation, type ProbeReport, preflightOf } from '../ig-contract/contract.ts';
import { isChromeMajor, uaRule } from '../ig-contract/device-profile.ts';
import { composerMayReadLandscape, evaluateProbe } from '../ig-contract/probe-eval.ts';
import { rehearsalRules, SESSION_RULE_IDS } from '../ig-contract/rules.ts';
import { COMPOSER_URL, classifyComposerUrl, igPath, isComposerUrl, type UrlVerdict } from '../ig-contract/urls.ts';
import { newId } from '../model/ids.ts';
import { type DwellKind, dwellMs } from './dwell.ts';
import {
  classifyEntry,
  decide,
  decideLate,
  normalizePath,
  nothingPosted,
  type OutcomeBudgets,
  sawWrite,
  scaledBudgets,
} from './outcome.ts';
import {
  ACCOUNT_PROMPT_MS,
  type AccountFacts,
  type ActiveState,
  type AgentEventName,
  type AgentFact,
  type Alarm,
  CLOSE_DELAY_MS,
  CLOSING_BACKSTOP_MS,
  CONFIRM_TICK_MS,
  type ComposeFact,
  ENTRY_BUDGET_MS,
  type EntryFact,
  ERROR_EFFECT,
  type ErrorCode,
  type Evidence,
  FIT_RETRY_DELAY_MS,
  HANDOFF_TIMERS,
  type HandoffCtx,
  type HandoffEffect,
  type HandoffEvent,
  type HandoffOutcome,
  type HandoffRecord,
  type HandoffState,
  type HandoffStatus,
  type HandoffTimer,
  HIDDEN_WAIT_MS,
  HOME_CLOSE_MS,
  HOME_READY_MS,
  type IdleState,
  INPUT_WAIT_MS,
  INSERT_BUDGET_MS,
  isArmed,
  MANUAL_DEADLINE_MS,
  MAX_OTHER_NET_ENTRIES,
  MAX_WINDOW_UPDATES,
  MAX_WRITE_NET_ENTRIES,
  MSITE_LOCK_MS,
  NAVIGATION_TIMEOUT_MS,
  type NetEntry,
  OFFER_MANUAL_MS,
  type PhaseLogEntry,
  POSTED_CLOSE_MS,
  PRE_SHARE_CAP_MS,
  type QueuedState,
  RELOAD_BUDGET_MS,
  RESIZE_POLL_MS,
  RESIZE_TIMEOUT_MS,
  type ResultKind,
  type RunResult,
  type RunStep,
  type SessionBase,
  SHARE_ACK_MS,
  type ShareRefusal,
  type StartRequest,
  type UnknownWhy,
  UPLOAD_HOLD_MS,
  type WindowDiagnostics,
  type WindowedSession,
  type WindowUpdateDiag,
} from './state.ts';

export interface Transition {
  state: HandoffState;
  effects: HandoffEffect[];
}

type Opening = Extract<ActiveState, { phase: 'opening' }>;
type Closing = Extract<ActiveState, { phase: 'closing' }>;
/** Every state that owns a popup window. */
type Windowed = Exclude<ActiveState, Opening | Closing>;
type Probing = Extract<ActiveState, { phase: 'probing' }>;
type Fitting = Extract<ActiveState, { phase: 'fitting' }>;
type Resizing = Extract<ActiveState, { phase: 'resizing' }>;
type AwaitingAccount = Extract<ActiveState, { phase: 'awaitingAccount' }>;
type OpeningEntry = Extract<ActiveState, { phase: 'openingEntry' }>;
type Inserting = Extract<ActiveState, { phase: 'inserting' }>;
type ComposeReady = Extract<ActiveState, { phase: 'composeReady' }>;
type Sharing = Extract<ActiveState, { phase: 'sharing' }>;
type Confirming = Extract<ActiveState, { phase: 'confirmingUpload' }>;
type Manual = Extract<ActiveState, { phase: 'manual' }>;
type Finished = Extract<ActiveState, { phase: 'finished' }>;
type TabUpdated = Extract<HandoffEvent, { type: 'tabUpdated' }>;
type StartEvent = Extract<HandoffEvent, { type: 'start' }>;
type KillCode = 'KILLED_CHALLENGE' | 'KILLED_OFFHOST' | 'TEST_LEAK';

const none = (state: HandoffState): Transition => ({ state, effects: [] });

export function handoffReducer(state: HandoffState, event: HandoffEvent, ctx: HandoffCtx): Transition {
  const out = dispatch(state, event, ctx);
  const s = out.state;
  if (s !== state && s.phase !== 'idle' && s.phase !== 'queued' && event.type !== 'timer') {
    return { state: { ...s, lastEventAt: ctx.now }, effects: out.effects };
  }
  return out;
}

function dispatch(state: HandoffState, event: HandoffEvent, ctx: HandoffCtx): Transition {
  if (event.type === 'startup') return onStartup(state, ctx);
  if (event.type === 'mark') return onMark(state, event);
  if (state.phase === 'idle') return onIdle(state, event, ctx);
  if (state.phase === 'queued') return onQueued(state, event, ctx);
  if (event.type === 'start') return refuse(state, 'HANDOFF_BUSY');
  if (state.phase === 'opening') return onOpening(state, event, ctx);
  if (state.phase === 'closing') return onClosing(state, event, ctx);
  return onWindowed(state, event, ctx);
}

// ---------------------------------------------------------------------------------------
// Small builders.

const isId = (n: number): boolean => Number.isInteger(n) && n >= 0;
const removeRules = (): HandoffEffect => ({ type: 'removeRules', ruleIds: [...SESSION_RULE_IDS] });
const clearTimers = (keep: readonly HandoffTimer[] = []): HandoffEffect[] =>
  HANDOFF_TIMERS.filter((t) => !keep.includes(t)).map((timer) => ({ type: 'clearTimer', timer }));
const arm = (timer: HandoffTimer, ms: number): HandoffEffect => ({ type: 'armTimer', timer, ms: Math.max(0, ms) });
const clear = (timer: HandoffTimer): HandoffEffect => ({ type: 'clearTimer', timer });
const send = (s: Windowed, command: Extract<HandoffEffect, { type: 'sendAgent' }>['command']): HandoffEffect => ({
  type: 'sendAgent',
  tabId: s.tabId,
  command,
});
const probeCmd = (s: Windowed): HandoffEffect[] => [send(s, { type: 'agent/probe' })];

function logPhase(s: SessionBase, phase: PhaseLogEntry['phase'], now: number): PhaseLogEntry[] {
  return s.phaseLog.at(-1)?.phase === phase ? s.phaseLog : [...s.phaseLog, { phase, t: now }];
}

function base(s: SessionBase): SessionBase {
  return {
    handoffId: s.handoffId,
    nonce: s.nonce,
    mode: s.mode,
    exportId: s.exportId,
    exportSha256: s.exportSha256,
    docHash: s.docHash,
    exportSample: s.exportSample,
    writeBlocked: s.writeBlocked,
    chMode: s.chMode,
    chromeMajor: s.chromeMajor,
    screen: s.screen,
    browser: s.browser,
    win: s.win,
    startedAt: s.startedAt,
    lastEventAt: s.lastEventAt,
    phaseLog: s.phaseLog,
    preShareUntil: s.preShareUntil,
    preShareLeft: s.preShareLeft,
  };
}

/** The fields every windowed phase shares, without the phase-specific ones. */
function common(s: Windowed): WindowedSession {
  return {
    ...base(s),
    windowId: s.windowId,
    tabId: s.tabId,
    frameDelta: s.frameDelta,
    refitUsed: s.refitUsed,
    probe: s.probe,
    readyProbe: s.readyProbe,
    fakeBanner: s.fakeBanner,
    offhostSeen: s.offhostSeen,
    hardReloadSent: s.hardReloadSent,
    loadsSinceReload: s.loadsSinceReload,
    composerReached: s.composerReached,
    route: s.route,
    url: s.url,
    inputWaitUsed: s.inputWaitUsed,
    inputWaitUntil: s.inputWaitUntil,
    swControllerChanges: s.swControllerChanges,
    c4Reached: s.c4Reached,
    pageOrientation: s.pageOrientation,
    composerEntered: s.composerEntered === true,
    decided: s.decided,
    docCheck: s.docCheck,
    account: s.account,
    entry: s.entry,
    entrySent: s.entrySent,
    insertSent: s.insertSent,
    fileServed: s.fileServed,
    compose: s.compose,
    shareSent: s.shareSent,
    shareSentAt: s.shareSentAt,
    shareRefused: s.shareRefused,
    sharedAt: s.sharedAt,
    sharedBy: s.sharedBy,
    net: s.net,
    netElapsedMs: s.netElapsedMs,
    netElapsedAt: s.netElapsedAt,
    ui: s.ui,
    alarms: s.alarms,
    raisedForVisibility: s.raisedForVisibility,
    hidden: s.hidden,
    testRulesVerified: s.testRulesVerified,
    steps: s.steps,
    written: s.written,
  };
}

const isWindowed = (s: ActiveState): s is Windowed => s.phase !== 'opening' && s.phase !== 'closing';

/** Share was pressed, or may have been: the command went out and the agent did not refuse it, or the owner shared. */
const afterShare = (s: WindowedSession): boolean => (s.shareSent && s.shareRefused === null) || s.sharedBy !== null;

/** ux.md §4.6: Stop is honoured until the Share command (and, by hand, until anything was shared). */
function canStop(s: ActiveState): boolean {
  if (s.phase === 'opening') return true;
  if (s.phase === 'closing' || s.phase === 'finished' || s.phase === 'sharing' || s.phase === 'confirmingUpload') {
    return false;
  }
  return !afterShare(s) && (s.phase !== 'manual' || nothingPosted(s));
}

/** The run view's step: by phase while running, by what was established once the result is known. */
function stepOf(s: ActiveState): RunStep {
  switch (s.phase) {
    case 'opening':
    case 'scoping':
    case 'fitting':
    case 'resizing':
    case 'navigating':
    case 'reloading':
      return 'instagram';
    case 'probing':
      return s.decided ? 'account' : 'instagram';
    case 'awaitingAccount':
      return 'account';
    case 'openingEntry':
    case 'inserting':
    case 'composeReady':
      return 'story';
    case 'sharing':
      return 'share';
    case 'confirmingUpload':
      return 'confirm';
    case 'manual':
      return s.needs === 'share' ? 'share' : 'story';
    case 'finished':
      return progressStep(s);
    case 'closing':
      return 'instagram';
  }
}

function progressStep(s: WindowedSession): RunStep {
  if (s.sharedAt !== null) return 'confirm';
  if (s.shareSent && s.shareRefused === null) return 'share';
  if (s.compose?.drawn && s.compose.controls === 1) return 'share';
  if (s.steps.account !== undefined || s.entrySent) return 'story';
  if (s.decided) return 'account';
  return 'instagram';
}

/** ux.md §4.13: what decided the result, with normalised paths. */
function evidenceOf(s: WindowedSession): Evidence {
  return {
    sharedAt: s.sharedAt,
    sharedBy: s.sharedBy,
    net: s.net.map((e) => ({ ...e, path: normalizePath(e.path) })),
    ui: s.ui,
    alarms: s.alarms,
  };
}

function status(s: ActiveState, extra: Partial<HandoffStatus> = {}): HandoffStatus {
  const w = isWindowed(s) ? s : null;
  return {
    handoffId: s.handoffId,
    phase: s.phase,
    mode: s.mode,
    step: s.phase === 'closing' ? 'instagram' : stepOf(s),
    canStop: canStop(s),
    startedAt: s.startedAt,
    steps: w ? w.steps : { opened: s.startedAt },
    ...(w?.fakeBanner ? { banner: 'FAKE_INSTAGRAM' as const } : {}),
    ...(w?.route ? { route: w.route } : {}),
    ...(w && w.win.attempts > 0 ? { window: w.win } : {}),
    ...(w ? { account: w.account } : {}),
    ...(w?.entry ? { entry: w.entry } : {}),
    ...(w?.compose ? { compose: w.compose } : {}),
    ...(w?.raisedForVisibility ? { raised: true } : {}),
    ...(w?.shareSent ? { shareSent: true } : {}),
    ...(w && (w.shareSent || w.sharedBy !== null) ? { evidence: evidenceOf(w) } : {}),
    ...(s.phase === 'awaitingAccount'
      ? {
          accountPrompt: { kind: s.prompt, detected: s.account.detected, expected: s.account.expected, until: s.until },
        }
      : {}),
    ...(s.phase === 'manual' ? { manual: { needs: s.needs, until: s.until } } : {}),
    ...(s.phase === 'finished'
      ? { result: s.result, closeAt: s.closeAt, ...(s.hold !== 'none' ? { held: s.hold } : {}) }
      : {}),
    ...(s.phase === 'closing' ? { result: s.result } : {}),
    ...extra,
  };
}

const notify = (s: ActiveState, extra?: Partial<HandoffStatus>): HandoffEffect => ({
  type: 'notifyEditor',
  status: status(s, extra),
});

function result(ctx: HandoffCtx, kind: ResultKind, more: Partial<RunResult> = {}): RunResult {
  return { kind, alarms: [], at: ctx.now, ...more };
}

/** The record outcome for a result (HandoffOutcome literals). */
export function outcomeOf(r: RunResult): HandoffOutcome {
  if (r.killed && r.kind !== 'posted') return `killed:${r.killed}`;
  switch (r.kind) {
    case 'posted':
      return 'posted';
    case 'notPosted':
      return `failed:${r.code ?? 'UPLOAD_FAILED'}`;
    case 'unknown':
      return 'unknown';
    case 'tested':
      return 'tested';
    case 'shareTested':
      return 'share-tested';
    case 'checked':
      return 'checked';
    case 'stopped':
      return 'cancelled';
  }
}

function record(
  s: SessionBase & Partial<WindowedSession>,
  phaseLog: PhaseLogEntry[],
  r: RunResult,
  now: number,
  detail?: string,
): HandoffRecord {
  const probe = s.probe ?? null;
  const ready = s.readyProbe ?? null;
  const c4Reached = s.c4Reached ?? true;
  const why = detail ?? r.detail;
  return {
    id: s.handoffId,
    exportId: s.exportId,
    mode: s.mode,
    chMode: s.chMode,
    phaseLog,
    ...(probe ? { probe, preflight: preflightOf(probe, s.url ?? undefined, s.route ?? null, ready, c4Reached) } : {}),
    ...(ready ? { readyProbe: ready } : {}),
    ...(s.route ? { route: s.route } : {}),
    ...(why ? { detail: why } : {}),
    window: s.win,
    browser: s.browser,
    ...(s.swControllerChanges ? { swControllerChanges: s.swControllerChanges } : {}),
    outcome: outcomeOf(r),
    startedAt: s.startedAt,
    endedAt: now,
    result: r,
    ...(s.account ? { account: s.account } : {}),
    ...(s.entry ? { entry: s.entry } : {}),
    ...(s.compose ? { compose: s.compose } : {}),
    ...(s.shareSent || s.sharedBy ? { evidence: evidenceOf(s as WindowedSession) } : {}),
    steps: s.steps ?? { opened: s.startedAt },
    durationMs: now - s.startedAt,
    ...(s.exportSha256 ? { exportSha256: s.exportSha256 } : {}),
    ...(s.docHash ? { docHash: s.docHash } : {}),
  };
}

/** The badge for a result (ux.md §4.1): ✓ after a post or a passed test, ! after a failure, ? when unknown. */
function badgeFor(r: RunResult): HandoffEffect {
  switch (r.kind) {
    case 'posted':
    case 'tested':
    case 'shareTested':
    case 'checked':
      return { type: 'setBadge', text: '✓', color: '#1f8f4e' };
    case 'notPosted':
      return { type: 'setBadge', text: '!', color: '#c0392b' };
    case 'unknown':
      return { type: 'setBadge', text: r.killed ? '!' : '?', color: r.killed ? '#c0392b' : '#b7791f' };
    case 'stopped':
      return { type: 'setBadge', text: '', color: null };
  }
}

const RUNNING_BADGE: HandoffEffect = { type: 'setBadge', text: '…', color: '#4a6fd1' };

/** The effects that publish a result beyond the status: the badge and storage.local `lastResult`. */
function resultEffects(s: SessionBase, r: RunResult, now: number): HandoffEffect[] {
  return [
    badgeFor(r),
    {
      type: 'writeLastResult',
      last: {
        handoffId: s.handoffId,
        mode: s.mode,
        result: r,
        exportId: s.exportId,
        exportSha256: s.exportSha256,
        docHash: s.docHash,
        startedAt: s.startedAt,
        durationMs: now - s.startedAt,
      },
    },
  ];
}

/**
 * A refused start never touches the state: a busy session carries on, an idle one stays idle.
 * `handoffId: null` marks the status as describing the refused start, not the active session.
 */
function refuse(state: HandoffState, error: ErrorCode, extra: Partial<HandoffStatus> = {}): Transition {
  return { state, effects: [{ type: 'notifyEditor', status: { handoffId: null, phase: 'idle', error, ...extra } }] };
}

// ---------------------------------------------------------------------------------------
// idle, queued and the start

function onIdle(s: IdleState, e: HandoffEvent, ctx: HandoffCtx): Transition {
  switch (e.type) {
    case 'start':
      return start(s, e, ctx, null);
    case 'windowRemoved':
    case 'tabRemoved':
      return { state: s, effects: [removeRules()] };
    case 'windowCreated':
      // A popup whose session already ended while windows.create was pending.
      return isId(e.windowId) ? { state: s, effects: [{ type: 'closeWindow', windowId: e.windowId }] } : none(s);
    default:
      return none(s);
  }
}

/** History's mark: any record may be asked; the runner applies it only to a Couldn't confirm one. */
function onMark(s: HandoffState, e: Extract<HandoffEvent, { type: 'mark' }>): Transition {
  if (typeof e.handoffId !== 'string' || e.handoffId === '') return none(s);
  return { state: s, effects: [{ type: 'markRecord', handoffId: e.handoffId, posted: e.posted === true }] };
}

function validScreen(sc: ScreenAvail): boolean {
  return [sc.availLeft, sc.availTop, sc.availWidth, sc.availHeight].every(Number.isFinite);
}

function requestOf(e: StartEvent | StartRequest): StartRequest {
  return {
    exportId: e.exportId,
    mode: e.mode,
    screen: { ...e.screen },
    browser: e.browser,
    ...(e.exportSample ? { exportSample: e.exportSample } : {}),
    ...(e.exportSha256 ? { exportSha256: e.exportSha256 } : {}),
    ...(e.docHash ? { docHash: e.docHash } : {}),
  };
}

function start(s: HandoffState, e: StartEvent, ctx: HandoffCtx, queuedId: string | null): Transition {
  // AM23 (SG4, network-free): a guarded build in a branded browser profile is the G6 mistake.
  if (ctx.guarded && (ctx.brandedBrowser || isBrandedFlavour(e.browser))) {
    return refuse(s, 'BRANDED_BROWSER', isBrandedFlavour(e.browser) ? { detail: `browser ${e.browser}` } : {});
  }
  const lockedUntil = ctx.settings.msiteLockedUntil;
  if (lockedUntil !== null && ctx.now < lockedUntil) return refuse(s, 'MSITE_LOCKED', { freeAt: lockedUntil });
  // Every mode but the check puts a photo in the composer.
  if (e.mode !== 'check' && e.exportId === null) {
    return refuse(s, 'AGENT_UNREACHABLE', { detail: `${e.mode} without an export` });
  }
  if (!ctx.rate.ok) {
    // K10/K11: blocked only by the 60 s spacing, the post waits and starts by itself.
    if (e.queue && ctx.rate.rule === 'spacing' && queuedId === null) return toQueued(e, ctx.rate.freeAt, ctx);
    return refuse(s, 'RATE_LIMITED', { freeAt: ctx.rate.freeAt, detail: ctx.rate.rule });
  }
  if (!isChromeMajor(ctx.chromeMajor)) {
    return refuse(s, 'AGENT_UNREACHABLE', { detail: `invalid chromeMajor ${ctx.chromeMajor}` });
  }
  const guess = validScreen(e.screen) ? firstGuess(e.screen, ctx.settings.composerProfile) : null;
  if (!guess?.ok) return refuse(s, 'SCREEN_TOO_SMALL');

  const now = ctx.now;
  const next: Opening = {
    phase: 'opening',
    handoffId: queuedId ?? newId('handoff', ctx.uuid),
    nonce: ctx.uuid(),
    mode: e.mode,
    exportId: e.mode === 'check' ? null : e.exportId,
    exportSha256: e.exportSha256 ?? null,
    docHash: e.docHash ?? null,
    exportSample: e.exportSample ?? null,
    // ux.md §7: every test blocks writes; a guarded build's static ruleset blocks them for posts too.
    writeBlocked: e.mode !== 'post' || ctx.guarded,
    chMode: ctx.settings.chMode,
    chromeMajor: ctx.chromeMajor,
    screen: { ...e.screen },
    browser: e.browser,
    win: {
      screen: { ...e.screen },
      requested: { ...guess.outer },
      created: null,
      createdTab: null,
      frameDelta: null,
      updates: [],
      attempts: 0,
      manualResize: false,
      finalTab: null,
      zoom: null,
      docked: true,
    },
    startedAt: now,
    lastEventAt: now,
    phaseLog: [{ phase: 'opening', t: now }],
    preShareUntil: now + PRE_SHARE_CAP_MS,
    preShareLeft: null,
  };
  return {
    state: next,
    effects: [
      ...(queuedId !== null ? [clear('queue')] : []),
      { type: 'noteOpen', t: now },
      { type: 'openWindow', box: guess.outer },
      arm('preShareCap', PRE_SHARE_CAP_MS),
      RUNNING_BADGE,
      notify(next),
    ],
  };
}

function toQueued(e: StartEvent, freeAt: number, ctx: HandoffCtx): Transition {
  const next: QueuedState = {
    phase: 'queued',
    handoffId: newId('handoff', ctx.uuid),
    request: requestOf(e),
    startAt: freeAt,
    queuedAt: ctx.now,
  };
  return {
    state: next,
    effects: [
      arm('queue', freeAt - ctx.now),
      RUNNING_BADGE,
      {
        type: 'notifyEditor',
        status: {
          handoffId: next.handoffId,
          phase: 'queued',
          mode: e.mode,
          queuedUntil: freeAt,
          canStop: true,
          startedAt: ctx.now,
        },
      },
    ],
  };
}

function onQueued(s: QueuedState, e: HandoffEvent, ctx: HandoffCtx): Transition {
  switch (e.type) {
    case 'start':
      return refuse(s, 'HANDOFF_BUSY');
    case 'cancel':
      return dropQueue(s, { result: result(ctx, 'stopped', { stoppedBy: 'owner' }) });
    case 'timer': {
      if (e.timer !== 'queue') return none(s);
      if (!ctx.rate.ok) {
        // Another run took the lane meanwhile (another tab), or a cap applies now: refuse as a click would.
        return dropQueue(s, { error: 'RATE_LIMITED', freeAt: ctx.rate.freeAt, detail: ctx.rate.rule });
      }
      const t = start(IDLE_STATE, { type: 'start', queue: false, ...s.request }, ctx, s.handoffId);
      if (t.state.phase === 'idle') {
        // A guard refused (a lock written meanwhile, a smaller screen): end the queue with that refusal.
        const refused = t.effects.find((x) => x.type === 'notifyEditor');
        const err = refused?.type === 'notifyEditor' ? refused.status : null;
        return dropQueue(s, {
          ...(err?.error ? { error: err.error } : {}),
          ...(err?.freeAt ? { freeAt: err.freeAt } : {}),
          ...(err?.detail ? { detail: err.detail } : {}),
        });
      }
      return t;
    }
    default:
      return none(s);
  }
}

const IDLE_STATE: IdleState = { phase: 'idle', last: null };

function dropQueue(s: QueuedState, extra: Partial<HandoffStatus>): Transition {
  return {
    state: { phase: 'idle', last: null },
    effects: [
      clear('queue'),
      { type: 'setBadge', text: '', color: null },
      {
        type: 'notifyEditor',
        status: { handoffId: s.handoffId, phase: 'idle', mode: s.request.mode, startedAt: s.queuedAt, ...extra },
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------
// startup and the ends of a session

function onStartup(s: HandoffState, ctx: HandoffCtx): Transition {
  if (s.phase === 'idle') return { state: s, effects: [removeRules(), ...clearTimers()] };
  if (s.phase === 'queued') {
    const t = dropQueue(s, { result: result(ctx, 'stopped', { stoppedBy: 'owner' }) });
    return { state: t.state, effects: [removeRules(), ...clearTimers(), ...t.effects.slice(1)] };
  }
  const windowId = s.phase === 'opening' ? null : s.windowId;
  const close: HandoffEffect[] = windowId !== null ? [{ type: 'closeWindow', windowId }] : [];
  let r: RunResult;
  if (s.phase === 'closing' || s.phase === 'finished') r = s.result;
  else if (s.phase !== 'opening' && afterShare(s)) r = unknownResult(s, 'agent-lost', ctx, 'browser restarted');
  else r = result(ctx, 'notPosted', { code: 'AGENT_UNREACHABLE', detail: 'browser restarted' });
  return endNow(s, r, ctx, close);
}

/**
 * Ends a session at once (the window is gone, never opened, or is being closed by `pre`): remove the
 * rules, clear the timers, write the record unless it exists (or patch it with a new result), go idle.
 */
function endNow(
  s: ActiveState,
  r0: RunResult,
  ctx: HandoffCtx,
  pre: HandoffEffect[] = [],
  detail?: string,
): Transition {
  const keep = s.phase === 'closing' || s.phase === 'finished';
  const r = s.phase === 'closing' || s.phase === 'finished' ? s.result : r0;
  const phaseLog = logPhase(s, 'idle', ctx.now);
  const effects: HandoffEffect[] = [...pre, removeRules(), ...clearTimers(), { type: 'forgetWindow' }];
  const written = s.phase === 'closing' || (isWindowed(s) && s.written);
  if (!written) {
    effects.push({ type: 'writeRecord', record: record(s, phaseLog, r, ctx.now, detail) });
    effects.push(...resultEffects(s, r, ctx.now));
  } else if (!keep && isWindowed(s)) {
    effects.push(patch(s, r, ctx));
    effects.push(...resultEffects(s, r, ctx.now));
  }
  effects.push({
    type: 'notifyEditor',
    status: {
      handoffId: s.handoffId,
      phase: 'idle',
      mode: s.mode,
      result: r,
      startedAt: s.startedAt,
      ...(r.code && r.kind !== 'posted' ? { error: r.code } : {}),
      ...(detail ? { detail } : r.detail ? { detail: r.detail } : {}),
      ...(isWindowed(s) ? { steps: s.steps, account: s.account } : {}),
      ...(isWindowed(s) && (s.shareSent || s.sharedBy) ? { evidence: evidenceOf(s) } : {}),
    },
  });
  return {
    state: { phase: 'idle', last: { handoffId: s.handoffId, outcome: outcomeOf(r), endedAt: ctx.now, result: r } },
    effects,
  };
}

/** A later result for a record already written (its phases since the first write included). */
function patch(s: Windowed, r: RunResult, ctx: HandoffCtx): HandoffEffect {
  return {
    type: 'patchRecordOutcome',
    handoffId: s.handoffId,
    outcome: outcomeOf(r),
    result: r,
    patch: {
      phaseLog: s.phaseLog,
      ...(s.entry ? { entry: s.entry } : {}),
      ...(s.compose ? { compose: s.compose } : {}),
      ...(s.shareSent || s.sharedBy ? { evidence: evidenceOf(s) } : {}),
      steps: s.steps,
      endedAt: ctx.now,
      durationMs: ctx.now - s.startedAt,
      ...(r.detail ? { detail: r.detail } : {}),
    },
  };
}

/**
 * Closes the popup: the editor refocus (not for a kill), closeWindow, then (kill) the lock, the status,
 * and the record (written now, or patched when it exists and the result changed).
 */
function close(s: Windowed, r: RunResult, ctx: HandoffCtx, extra: Partial<HandoffStatus> = {}): Transition {
  const now = ctx.now;
  const killed = r.killed !== undefined;
  const phaseLog = logPhase(s, 'closing', now);
  const next: Closing = {
    ...base(s),
    phase: 'closing',
    phaseLog,
    windowId: s.windowId,
    tabId: s.tabId,
    result: r,
    outcome: outcomeOf(r),
  };
  const effects: HandoffEffect[] = [];
  if (!killed) effects.push({ type: 'focusEditor', ifFocused: s.windowId });
  effects.push({ type: 'closeWindow', windowId: s.windowId });
  if (r.killed !== undefined) effects.push({ type: 'lockMsite', until: now + MSITE_LOCK_MS, reason: r.killed });
  effects.push(...clearTimers(), arm('stepDeadline', CLOSING_BACKSTOP_MS));
  const banner = s.fakeBanner ? { banner: 'FAKE_INSTAGRAM' as const } : {};
  const code = r.kind !== 'posted' ? r.code : undefined;
  effects.push(
    notify(next, {
      ...banner,
      steps: s.steps,
      account: s.account,
      ...(s.entry ? { entry: s.entry } : {}),
      ...(s.compose ? { compose: s.compose } : {}),
      ...(s.shareSent || s.sharedBy ? { evidence: evidenceOf(s) } : {}),
      ...(code ? { error: code } : {}),
      ...(r.detail ? { detail: r.detail } : {}),
      ...extra,
    }),
  );
  const changed = s.phase !== 'finished' || outcomeOf(s.result) !== outcomeOf(r) || killed;
  if (!s.written) {
    effects.push({ type: 'writeRecord', record: record(s, phaseLog, r, now, extra.detail) });
    effects.push(...resultEffects(s, r, now));
  } else if (changed) {
    effects.push(patch(s, r, ctx));
    effects.push(...resultEffects(s, r, now));
  }
  return { state: next, effects };
}

/**
 * The result is known: the window stays until its close time (or is held). Writes the record (or patches
 * it after Finish by hand, or a late answer), the badge and `lastResult`.
 */
function finish(
  s: Windowed,
  r: RunResult,
  hold: Finished['hold'],
  closeMs: number,
  ctx: HandoffCtx,
  extra: Partial<HandoffStatus> = {},
): Transition {
  const now = ctx.now;
  const phaseLog = logPhase(s, 'finished', now);
  const next: Finished = {
    ...common(s),
    phase: 'finished',
    phaseLog,
    result: r,
    hold,
    closeAt: now + closeMs,
    homeClose: false,
    written: true,
    preShareUntil: null,
    preShareLeft: null,
  };
  const timer: HandoffTimer = hold === 'upload' ? 'uploadHold' : hold === 'offerManual' ? 'offerManual' : 'closeDelay';
  const effects: HandoffEffect[] = [
    ...clearTimers([timer]),
    arm(timer, closeMs),
    notify(next, { ...(r.code && r.kind !== 'posted' ? { error: r.code } : {}), ...extra }),
  ];
  if (s.written) effects.push(patch(next, r, ctx));
  else effects.push({ type: 'writeRecord', record: record(next, phaseLog, r, now, extra.detail) });
  effects.push(...resultEffects(s, r, now));
  return { state: next, effects };
}

function closeFinished(s: Finished, ctx: HandoffCtx): Transition {
  return close(s, s.result, ctx);
}

/** ux.md §5: what an error before Share does (ERROR_EFFECT); after Share, Couldn't confirm. */
function fail(s: Windowed, code: ErrorCode, ctx: HandoffCtx, extra: Partial<HandoffStatus> = {}): Transition {
  if (afterShare(s)) return unknownNow(s, whyAfterShare(code), ctx, extra.detail ?? code);
  const effect = ERROR_EFFECT[code];
  if (effect === 'kill') return killNow(s, code as KillCode, ctx);
  const r = result(ctx, 'notPosted', {
    code,
    ...(extra.detail ? { detail: extra.detail } : {}),
    account: s.account.detected,
  });
  // §4.9: Finish by hand is a way to post; a test or a check has nothing to finish, so its window closes.
  if (effect === 'offer-manual' && s.phase !== 'manual' && s.mode === 'post') {
    return finish(s, r, 'offerManual', OFFER_MANUAL_MS, ctx, extra);
  }
  return close(s, r, ctx, { error: code, ...extra });
}

function whyAfterShare(code: ErrorCode): UnknownWhy {
  if (code === 'UNEXPECTED_PAGE' || code === 'NOT_LOGGED_IN') return 'unexpected-page';
  return 'agent-lost';
}

function unknownResult(s: WindowedSession, why: UnknownWhy, ctx: HandoffCtx, detail?: string, held = false): RunResult {
  return result(ctx, 'unknown', {
    code: 'OUTCOME_UNKNOWN',
    why,
    ...(detail ? { detail } : {}),
    alarms: s.alarms,
    ...(held ? { held: true } : {}),
    ...(s.compose?.fbAuto ? { facebook: true } : {}),
    account: s.account.detected,
  });
}

/** Couldn't confirm: held while an upload may still run (§6.4), else closed in 3 s. */
function unknownNow(s: Windowed, why: UnknownWhy, ctx: HandoffCtx, detail?: string, mayRun = false): Transition {
  const r = unknownResult(s, why, ctx, detail, mayRun);
  return mayRun ? finish(s, r, 'upload', UPLOAD_HOLD_MS, ctx) : finish(s, r, 'none', CLOSE_DELAY_MS, ctx);
}

/**
 * The kill switch (and TEST_LEAK): close at once and lock. A result already decided keeps its kind (a Posted
 * stays Posted, IR12); after Share it is Couldn't confirm; before it, Not posted. TEST_LEAK is always its own
 * Couldn't confirm, also when it replaces a held one (a late leak, AP-2): a run whose writes are blocked is
 * never Posted.
 */
function killNow(s: Windowed, code: KillCode, ctx: HandoffCtx, detail?: string): Transition {
  let r: RunResult;
  if (code === 'TEST_LEAK') {
    r = result(ctx, 'unknown', {
      code: 'TEST_LEAK',
      killed: code,
      alarms: s.alarms,
      account: s.account.detected,
      ...(detail ? { detail } : {}),
      ...(s.phase === 'finished' ? { late: true } : {}),
      ...(s.compose?.fbAuto ? { facebook: true } : {}),
    });
  } else if (s.phase === 'finished') r = { ...s.result, killed: code };
  else if (afterShare(s)) r = { ...unknownResult(s, 'unexpected-page', ctx, detail), killed: code };
  else r = result(ctx, 'notPosted', { code, killed: code, account: s.account.detected, ...(detail ? { detail } : {}) });
  return close(s, r, ctx, { error: code });
}

// ---------------------------------------------------------------------------------------
// opening (no window yet) and closing (window close requested)

function freshWindowed(s: Opening, windowId: number, tabId: number, ctx: HandoffCtx): WindowedSession {
  return {
    ...base(s),
    phaseLog: logPhase(s, 'scoping', ctx.now),
    windowId,
    tabId,
    frameDelta: null,
    refitUsed: false,
    probe: null,
    readyProbe: null,
    fakeBanner: false,
    offhostSeen: false,
    hardReloadSent: false,
    loadsSinceReload: 0,
    composerReached: false,
    route: null,
    url: null,
    inputWaitUsed: false,
    inputWaitUntil: null,
    swControllerChanges: 0,
    c4Reached: false,
    pageOrientation: null,
    composerEntered: false,
    decided: false,
    docCheck: null,
    account: { detected: null, candidates: 0, expected: null, decision: null, confirmedBy: null },
    entry: null,
    entrySent: false,
    insertSent: false,
    fileServed: false,
    compose: null,
    shareSent: false,
    shareSentAt: null,
    shareRefused: null,
    sharedAt: null,
    sharedBy: null,
    net: [],
    netElapsedMs: 0,
    netElapsedAt: null,
    ui: { progressSeen: false, toast: 'none', wentHomeAt: null },
    alarms: [],
    raisedForVisibility: false,
    hidden: false,
    testRulesVerified: false,
    steps: { opened: s.startedAt },
    written: false,
  };
}

function onOpening(s: Opening, e: HandoffEvent, ctx: HandoffCtx): Transition {
  switch (e.type) {
    case 'windowCreated': {
      if (!isId(e.windowId) || !isId(e.tabId)) {
        const pre: HandoffEffect[] = isId(e.windowId) ? [{ type: 'closeWindow', windowId: e.windowId }] : [];
        const detail = `windowCreated: invalid ids ${e.windowId}/${e.tabId}`;
        return endNow(s, result(ctx, 'notPosted', { code: 'AGENT_UNREACHABLE', detail }), ctx, pre, detail);
      }
      const next: Windowed = { ...freshWindowed(s, e.windowId, e.tabId, ctx), phase: 'scoping' };
      // Installed while the tab is still about:blank, before the first navigation (§3.6 step 2). Every
      // test blocks Instagram's write requests for this tab (and service workers, tabId -1).
      const addRules = [
        uaRule(e.tabId, s.chromeMajor, s.chMode),
        ...(s.mode !== 'post' ? rehearsalRules(e.tabId) : []),
      ];
      return {
        state: next,
        effects: [
          { type: 'installRules', removeRuleIds: [...SESSION_RULE_IDS], addRules },
          // AM22: survives an extension reload, which clears storage.session and the rules.
          { type: 'rememberWindow', windowId: e.windowId, tabId: e.tabId, handoffId: s.handoffId },
          notify(next),
        ],
      };
    }
    case 'effectFailed':
      if (e.effect !== 'openWindow') return none(s);
      return endNow(
        s,
        result(ctx, 'notPosted', { code: 'AGENT_UNREACHABLE', detail: `openWindow: ${e.message}`.slice(0, 300) }),
        ctx,
      );
    case 'cancel': {
      // The window does not exist yet: wait in `closing` for windowCreated, then close it.
      const phaseLog = logPhase(s, 'closing', ctx.now);
      const r = result(ctx, 'stopped', { stoppedBy: 'owner' });
      const next: Closing = {
        ...base(s),
        phase: 'closing',
        phaseLog,
        windowId: null,
        tabId: null,
        result: r,
        outcome: outcomeOf(r),
      };
      return {
        state: next,
        effects: [
          notify(next),
          { type: 'writeRecord', record: record(s, phaseLog, r, ctx.now) },
          ...resultEffects(s, r, ctx.now),
          ...clearTimers(),
          arm('stepDeadline', CLOSING_BACKSTOP_MS),
        ],
      };
    }
    case 'timer':
      if (e.timer !== 'preShareCap' && e.timer !== 'stepDeadline') return none(s);
      return endNow(s, result(ctx, 'notPosted', { code: 'TIMEOUT', detail: 'instagram window' }), ctx);
    default:
      return none(s);
  }
}

function onClosing(s: Closing, e: HandoffEvent, ctx: HandoffCtx): Transition {
  switch (e.type) {
    case 'windowCreated':
      if (s.windowId !== null || !isId(e.windowId)) return none(s);
      return {
        state: { ...s, windowId: e.windowId, tabId: e.tabId },
        effects: [{ type: 'closeWindow', windowId: e.windowId }],
      };
    case 'windowRemoved':
      return e.windowId === s.windowId ? endNow(s, s.result, ctx) : none(s);
    case 'tabRemoved':
      return e.tabId === s.tabId ? endNow(s, s.result, ctx) : none(s);
    case 'effectFailed':
      // The window is already gone (or never came): finish the cleanup here.
      if (e.effect === 'closeWindow' || (e.effect === 'openWindow' && s.windowId === null)) {
        return endNow(s, s.result, ctx);
      }
      return none(s);
    case 'timer':
      // Backstop: windowRemoved never arrived.
      return e.timer === 'stepDeadline' ? endNow(s, s.result, ctx) : none(s);
    default:
      return none(s);
  }
}

// ---------------------------------------------------------------------------------------
// windowed phases

function onWindowed(s: Windowed, e: HandoffEvent, ctx: HandoffCtx): Transition {
  switch (e.type) {
    case 'tabUpdated':
      return e.tabId === s.tabId ? onTabUpdated(s, e, ctx) : none(s);
    case 'windowRemoved':
      return e.windowId === s.windowId ? onWindowGone(s, ctx) : none(s);
    case 'tabRemoved':
      return e.tabId === s.tabId ? onWindowGone(s, ctx) : none(s);
    case 'cancel':
      return onCancel(s, ctx);
    case 'accountChoice':
      if (s.phase !== 'awaitingAccount' || e.handoffId !== s.handoffId) return none(s);
      return onAccountChoice(s, e.proceed === true, ctx);
    case 'manual':
      if (s.phase !== 'finished' || s.hold !== 'offerManual' || e.handoffId !== s.handoffId) return none(s);
      return toManual(s, ctx);
    case 'timer':
      return onTimer(s, e.timer, ctx);
    case 'effectFailed':
      return onEffectFailed(s, e, ctx);
    case 'rulesInstalled':
      return s.phase === 'scoping' ? toFitting(s, ctx) : none(s);
    case 'tabMeasured':
      return onTabMeasured(s, e, ctx);
    case 'windowFitted':
      return onWindowFitted(s, e, ctx);
    case 'windowSized':
      return s.phase === 'resizing' ? onResized(s, e, ctx) : none(s);
    case 'boundsChanged':
      return s.phase === 'resizing' && e.windowId === s.windowId ? { state: s, effects: [readSize(s)] } : none(s);
    case 'agentInjected':
      return onAgentInjected(s, e, ctx);
    case 'rulesVerified':
      return s.phase === 'composeReady' && s.sub === 'verifyRules' ? onRulesVerified(s, e.ok === true, ctx) : none(s);
    case 'agentReport':
      return onAgentReport(s, e.probe, ctx);
    case 'agentGetFile':
      if (s.phase !== 'inserting' || s.sub !== 'sent' || s.fileServed || s.exportId === null) return none(s);
      return {
        state: { ...s, fileServed: true, sub: 'served' },
        effects: [{ type: 'serveFile', exportId: s.exportId }],
      };
    case 'agentEvent':
      return onAgentEvent(s, e.event, ctx);
    case 'agentFact':
      return onFact(s, e.fact, ctx);
    default:
      return none(s);
  }
}

/** The owner (or Arc) closed the Instagram window. */
function onWindowGone(s: Windowed, ctx: HandoffCtx): Transition {
  if (s.phase === 'finished') return endNow(s, s.result, ctx);
  if (afterShare(s) || (s.phase === 'manual' && !nothingPosted(s))) {
    return endNow(s, unknownResult(s, 'window-closed', ctx), ctx);
  }
  return endNow(s, result(ctx, 'stopped', { stoppedBy: 'window', account: s.account.detected }), ctx);
}

/** Stop (Esc): before the Share command only. In finished it closes the window now (Done). */
function onCancel(s: Windowed, ctx: HandoffCtx): Transition {
  if (s.phase === 'finished') return closeFinished(s, ctx);
  if (!canStop(s)) return none(s);
  return close(s, result(ctx, 'stopped', { stoppedBy: 'owner', account: s.account.detected }), ctx);
}

function onTimer(s: Windowed, timer: HandoffTimer, ctx: HandoffCtx): Transition {
  switch (timer) {
    case 'closeDelay':
    case 'uploadHold':
    case 'offerManual':
      return s.phase === 'finished' ? closeFinished(s, ctx) : none(s);
    case 'navigation':
      return s.phase === 'navigating' ? navigationDeadline(s, ctx) : none(s);
    case 'fitRetry':
      return s.phase === 'fitting' && s.fitStep === 'retryWait' ? fitRetry(s, ctx) : none(s);
    case 'resizeDeadline':
      return s.phase === 'resizing' ? fail(s, 'WINDOW_NOT_FITTED', ctx, { window: s.win }) : none(s);
    case 'resizePoll':
      if (s.phase !== 'resizing') return none(s);
      return { state: s, effects: [readSize(s), arm('resizePoll', RESIZE_POLL_MS)] };
    case 'inputWait': {
      // P5: the one wait ran out. Probe once more and decide on what is there now: an appeared event that
      // came while an earlier re-probe was in flight was not acted on (E12 h).
      if (s.phase !== 'probing' || s.step !== 'awaitInput' || s.probe === null) return none(s);
      const next: Probing = { ...s, step: 'awaitReport', inputWaitUntil: null };
      return { state: next, effects: probeCmd(s) };
    }
    case 'stepDeadline':
      return onStepDeadline(s, ctx);
    case 'preShareCap':
      if (s.phase === 'finished' || s.phase === 'manual' || afterShare(s) || s.shareSent) return none(s);
      return fail(s, 'TIMEOUT', ctx, { detail: `${stepOf(s)} ${PRE_SHARE_CAP_MS / 1000} s` });
    case 'dwell':
      return onDwell(s, ctx);
    case 'accountPrompt':
      return s.phase === 'awaitingAccount' ? fail(s, 'ACCOUNT_UNCONFIRMED', ctx, { detail: s.prompt }) : none(s);
    case 'hiddenWait':
      if (!s.hidden || s.phase === 'finished' || s.phase === 'manual' || s.phase === 'awaitingAccount') return none(s);
      if (afterShare(s) || s.shareSent) return none(s);
      return fail(s, 'WINDOW_HIDDEN', ctx);
    case 'shareAck':
      // O8: the Share command was sent and nothing answered: the click may have happened.
      return s.phase === 'sharing' ? unknownNow(s, 'share-not-acknowledged', ctx, undefined, true) : none(s);
    case 'confirmTick':
      return s.phase === 'confirmingUpload' ? confirm(s, ctx, true) : none(s);
    case 'manualDeadline':
      if (s.phase !== 'manual') return none(s);
      return fail(s, 'TIMEOUT', ctx, { detail: `manual ${MANUAL_DEADLINE_MS / 1000} s` });
    case 'queue':
      return none(s);
  }
}

/** The per-phase budget ran out (ux.md §10). */
function onStepDeadline(s: Windowed, ctx: HandoffCtx): Transition {
  switch (s.phase) {
    case 'reloading':
      return fail(s, 'TIMEOUT', ctx, { detail: `instagram ${RELOAD_BUDGET_MS / 1000} s` });
    case 'probing':
      return fail(s, 'TIMEOUT', ctx, { detail: `instagram ${HOME_READY_MS / 1000} s` });
    case 'openingEntry':
      return s.sub === 'sent' ? fail(s, 'TIMEOUT', ctx, { detail: `story ${ENTRY_BUDGET_MS / 1000} s` }) : none(s);
    case 'inserting':
      if (s.sub === 'dwell') return none(s);
      // The insert was made and the composer never drew it with a Share footer.
      if (s.sub === 'awaitComposer') return fail(s, 'INJECTION_IGNORED', ctx, { detail: 'composer not drawn' });
      return fail(s, 'TIMEOUT', ctx, { detail: `story ${INSERT_BUDGET_MS / 1000} s` });
    default:
      return none(s);
  }
}

// ---------------------------------------------------------------------------------------
// W2/W3: fitting the popup while it is still about:blank (Arc ignores windows.create bounds, F1)

const readSize = (s: Windowed): HandoffEffect => ({ type: 'readSize', windowId: s.windowId, tabId: s.tabId });

const updateWindow = (s: Windowed, box: WindowBox, inner: Size, reapply: boolean): HandoffEffect => ({
  type: 'updateWindow',
  windowId: s.windowId,
  tabId: s.tabId,
  box,
  inner,
  reapply,
});

function saneZoom(z: number | null | undefined): number | null {
  return typeof z === 'number' && zoomOf(z) === z ? z : null;
}

const copySize = (x: Size): Size => ({ w: x.w, h: x.h });
const copyBox = (b: WindowBox): WindowBox => ({ left: b.left, top: b.top, width: b.width, height: b.height });

function withUpdate(
  win: WindowDiagnostics,
  step: WindowUpdateDiag['step'],
  e: Extract<HandoffEvent, { type: 'windowFitted' }>,
): WindowDiagnostics {
  const entry: WindowUpdateDiag = {
    step,
    box: copyBox(e.box),
    target: copySize(e.target),
    outer: copyBox(e.outer),
    tab: copySize(e.inner),
    fitted: e.fitted === true,
    applied: typeof e.applied === 'number' && Number.isFinite(e.applied) && e.applied >= 1 ? Math.floor(e.applied) : 1,
  };
  return { ...win, updates: [...win.updates, entry].slice(-MAX_WINDOW_UPDATES), finalTab: copySize(e.inner) };
}

function toFitting(s: Windowed, ctx: HandoffCtx): Transition {
  const next: Fitting = {
    ...common(s),
    phase: 'fitting',
    fitStep: 'measure',
    phaseLog: logPhase(s, 'fitting', ctx.now),
  };
  return {
    state: next,
    effects: [{ type: 'measureTab', tabId: s.tabId, windowId: s.windowId, settle: true }, notify(next)],
  };
}

/** Pauses the pre-Share cap (resizing, awaitingAccount). */
function pauseCap(s: WindowedSession, ctx: HandoffCtx): { patch: Partial<WindowedSession>; effects: HandoffEffect[] } {
  if (s.preShareUntil === null) return { patch: {}, effects: [] };
  return {
    patch: { preShareUntil: null, preShareLeft: Math.max(0, s.preShareUntil - ctx.now) },
    effects: [clear('preShareCap')],
  };
}

/** Resumes a paused pre-Share cap. */
function resumeCap(s: WindowedSession, ctx: HandoffCtx): { patch: Partial<WindowedSession>; effects: HandoffEffect[] } {
  if (s.preShareLeft === null) return { patch: {}, effects: [] };
  return {
    patch: { preShareUntil: ctx.now + s.preShareLeft, preShareLeft: null },
    effects: [arm('preShareCap', s.preShareLeft)],
  };
}

function toNavigating(
  s: Windowed,
  win: WindowDiagnostics,
  ctx: HandoffCtx,
  extra: Partial<HandoffStatus> = {},
  pre: HandoffEffect[] = [],
): Transition {
  const cap = resumeCap(s, ctx);
  const next: Windowed = {
    ...common(s),
    ...cap.patch,
    win,
    phase: 'navigating',
    phaseLog: logPhase(s, 'navigating', ctx.now),
  };
  return {
    state: next,
    effects: [
      ...pre,
      ...cap.effects,
      { type: 'navigate', tabId: s.tabId, url: COMPOSER_URL },
      arm('navigation', NAVIGATION_TIMEOUT_MS),
      notify(next, { window: win, ...extra }),
    ],
  };
}

function resizeTimeout(ctx: HandoffCtx): number {
  const t = ctx.resizeTimeoutMs;
  const ok = ctx.guarded && typeof t === 'number' && Number.isFinite(t) && t > 0 && t < RESIZE_TIMEOUT_MS;
  return ok ? Math.round(t) : RESIZE_TIMEOUT_MS;
}

function toResizing(s: Windowed, win: WindowDiagnostics, ctx: HandoffCtx): Transition {
  const ms = resizeTimeout(ctx);
  const until = ctx.now + ms;
  const cap = pauseCap(s, ctx);
  const next: Resizing = {
    ...common(s),
    ...cap.patch,
    win,
    phase: 'resizing',
    resizeUntil: until,
    phaseLog: logPhase(s, 'resizing', ctx.now),
  };
  const tab = win.finalTab ?? { w: 0, h: 0 };
  return {
    state: next,
    effects: [
      ...cap.effects,
      arm('resizeDeadline', ms),
      arm('resizePoll', RESIZE_POLL_MS),
      notify(next, { window: win, resize: { tab, ok: false, until, maxW: maxMsiteInnerW(win.zoom) } }),
    ],
  };
}

function onResized(s: Resizing, e: Extract<HandoffEvent, { type: 'windowSized' }>, ctx: HandoffCtx): Transition {
  const tab = copySize(e.inner);
  if (!Number.isFinite(tab.w) || !Number.isFinite(tab.h)) return none(s);
  const maxW = maxMsiteInnerW(s.win.zoom);
  if (isUsableInner(tab, s.win.zoom)) {
    const win: WindowDiagnostics = { ...s.win, manualResize: true, finalTab: tab };
    return toNavigating(s, win, ctx, { resize: { tab, ok: true, until: s.resizeUntil, maxW } }, [
      clear('resizeDeadline'),
      clear('resizePoll'),
    ]);
  }
  const seen = s.win.finalTab;
  if (seen !== null && seen.w === tab.w && seen.h === tab.h) return none(s);
  const next: Resizing = { ...s, win: { ...s.win, finalTab: tab } };
  return { state: next, effects: [notify(next, { resize: { tab, ok: false, until: s.resizeUntil, maxW } })] };
}

function onTabMeasured(s: Windowed, e: Extract<HandoffEvent, { type: 'tabMeasured' }>, ctx: HandoffCtx): Transition {
  const refit = s.phase === 'probing' && s.step === 'refitMeasure';
  if (!refit && !(s.phase === 'fitting' && s.fitStep === 'measure')) return none(s);
  const delta: FrameDelta | null = frameDeltaOf(e.inner, e.outer);
  if (delta === null) return fail(s, 'SCREEN_TOO_SMALL', ctx);
  const zoom = saneZoom(e.zoom);
  const fit = windowFit(s.screen, delta, ctx.settings.composerProfile, zoom);
  if (!fit.ok) return fail(s, 'SCREEN_TOO_SMALL', ctx);
  const update = updateWindow(s, fit.outer, fit.inner, !refit);
  if (s.phase === 'probing') {
    const win: WindowDiagnostics = { ...s.win, zoom: zoom ?? s.win.zoom };
    return { state: { ...s, frameDelta: delta, win, step: 'refitUpdate' }, effects: [update] };
  }
  if (s.phase !== 'fitting') return none(s);
  const win: WindowDiagnostics = {
    ...s.win,
    created: copyBox(e.outer),
    createdTab: copySize(e.inner),
    frameDelta: delta,
    attempts: 1,
    zoom,
  };
  return { state: { ...s, frameDelta: delta, win, fitStep: 'update' }, effects: [update] };
}

function onWindowFitted(s: Windowed, e: Extract<HandoffEvent, { type: 'windowFitted' }>, ctx: HandoffCtx): Transition {
  if (s.phase === 'probing' && s.step === 'refitUpdate') {
    const win = withUpdate(s.win, 'refit', e);
    const next: Probing = { ...s, win, step: 'awaitReport' };
    return { state: next, effects: [...probeCmd(s), notify(next, { window: win })] };
  }
  if (s.phase !== 'fitting' || (s.fitStep !== 'update' && s.fitStep !== 'retry')) return none(s);
  const win = withUpdate(s.win, s.fitStep === 'update' ? 'fit' : 'retry', e);
  if (e.fitted === true) return toNavigating(s, win, ctx);
  if (s.fitStep === 'update') {
    return { state: { ...s, win, fitStep: 'retryWait' }, effects: [arm('fitRetry', FIT_RETRY_DELAY_MS)] };
  }
  if (isUsableInner(e.inner, s.win.zoom)) return toNavigating(s, win, ctx);
  return toResizing(s, win, ctx);
}

function fitRetry(s: Fitting, ctx: HandoffCtx): Transition {
  const last = s.win.updates.at(-1);
  const now = last ? frameDeltaOf(last.tab, last.outer) : null;
  const refined = now ? windowFit(s.screen, now, ctx.settings.composerProfile, s.win.zoom) : null;
  const fit = refined?.ok
    ? refined
    : windowFit(s.screen, s.frameDelta ?? { w: 0, h: 0 }, ctx.settings.composerProfile, s.win.zoom);
  if (!fit.ok) return fail(s, 'SCREEN_TOO_SMALL', ctx);
  return {
    state: { ...s, fitStep: 'retry', win: { ...s.win, attempts: 2 } },
    effects: [updateWindow(s, fit.outer, fit.inner, true)],
  };
}

// ---------------------------------------------------------------------------------------
// tabs.onUpdated: the first navigation, the hard reload, the kill switch, re-probes and document checks

/** AM17: the path an unexpected page names (query and fragment dropped). */
const pageOf = (url: string | undefined): string => (url !== undefined ? igPath(url) : null) ?? '?';

function onTabUpdated(s: Windowed, e: TabUpdated, ctx: HandoffCtx): Transition {
  if (!isArmed(s)) return s.phase === 'navigating' ? onNavigating(s, e, ctx) : none(s);

  const verdict = classifyComposerUrl(e.url);
  if (verdict.kind === 'kill') return killNow({ ...s, url: e.url ?? null }, verdict.code, ctx);
  if (verdict.kind === 'stop') {
    if (s.phase === 'finished') return closeFinished(s, ctx);
    return fail({ ...s, url: e.url ?? null }, verdict.code, ctx, { detail: `page ${pageOf(e.url)}` });
  }
  const url = e.url ?? null;
  if (s.phase === 'reloading') return onReloading(s, e, url, verdict, ctx);
  if (verdict.kind === 'unknown-left') {
    if (s.phase === 'finished') return none(s);
    const page = pageOf(e.url);
    return fail({ ...s, url }, 'UNEXPECTED_PAGE', ctx, { detail: `page ${page}` });
  }

  // On the composer, or home: still in the session.
  const home = verdict.kind === 'composer-left';
  let seen: Windowed = {
    ...s,
    url,
    composerReached: s.composerReached || verdict.kind === 'ok',
    route: home && s.route === 'direct' ? 'homeOnly' : s.route,
    composerEntered: s.composerEntered === true || entersComposer(s.url, e.url),
  };
  // C9 is corroboration only (AM40): after Share, going home is recorded.
  if (home && afterShare(s) && s.ui.wentHomeAt === null) {
    seen = { ...seen, ui: { ...seen.ui, wentHomeAt: ctx.now } };
  }
  if (seen.phase === 'probing') return onProbingLoad(seen, s, e);
  return onDocLoad(seen, s, e, ctx);
}

function onNavigating(s: Windowed, e: TabUpdated, ctx: HandoffCtx): Transition {
  if (e.url === undefined || e.url === 'about:blank') {
    if (e.url === undefined && e.status === undefined) return killNow({ ...s, url: null }, 'KILLED_OFFHOST', ctx);
    return s.offhostSeen ? none(s) : { state: { ...s, offhostSeen: true }, effects: [] };
  }
  const verdict = classifyComposerUrl(e.url);
  const seen: Windowed = { ...s, url: e.url };
  if (verdict.kind === 'kill') return killNow(seen, verdict.code, ctx);
  if (verdict.kind === 'stop') return fail(seen, verdict.code, ctx);
  if (e.status !== 'loading') return none(s);
  if (verdict.kind === 'unknown-left') return fail(seen, 'UNEXPECTED_PAGE', ctx, { detail: `page ${pageOf(e.url)}` });
  if (s.hardReloadSent) return none(s);
  const next: Windowed = {
    ...common(s),
    url: e.url,
    hardReloadSent: true,
    loadsSinceReload: 0,
    phase: 'reloading',
    phaseLog: logPhase(s, 'reloading', ctx.now),
  };
  return {
    state: next,
    effects: [
      { type: 'hardReload', tabId: s.tabId },
      clear('navigation'),
      arm('stepDeadline', RELOAD_BUDGET_MS),
      notify(next),
    ],
  };
}

function navigationDeadline(s: Windowed, ctx: HandoffCtx): Transition {
  return s.offhostSeen ? killNow(s, 'KILLED_OFFHOST', ctx) : fail(s, 'NAVIGATION_TIMEOUT', ctx);
}

function onReloading(s: Windowed, e: TabUpdated, url: string | null, verdict: UrlVerdict, ctx: HandoffCtx): Transition {
  if (verdict.kind === 'unknown-left') {
    return fail({ ...s, url }, 'UNEXPECTED_PAGE', ctx, { detail: `page ${pageOf(e.url)}` });
  }
  const entered = s.composerEntered === true || (s.loadsSinceReload >= 1 && entersComposer(s.url, e.url));
  if (e.status === 'loading') {
    return { state: { ...s, url, loadsSinceReload: s.loadsSinceReload + 1, composerEntered: entered }, effects: [] };
  }
  if (e.status !== 'complete' || s.loadsSinceReload < 1) return changed(s, { ...s, url, composerEntered: entered });
  const direct = isComposerUrl(e.url);
  const next: Probing = {
    ...common(s),
    url,
    route: direct ? 'direct' : 'homeOnly',
    composerReached: direct,
    composerEntered: entered,
    phase: 'probing',
    phaseLog: logPhase(s, 'probing', ctx.now),
    // A second commit before this `complete` is already a "later" load (AM2): strict.
    step: 'injectAgent',
    strict: s.loadsSinceReload > 1,
    amLoad: false,
  };
  return {
    state: next,
    effects: [{ type: 'injectAgent', tabId: s.tabId }, arm('stepDeadline', HOME_READY_MS), notify(next)],
  };
}

function changed(s: Windowed, next: Windowed): Transition {
  const same =
    next.url === s.url &&
    next.composerReached === s.composerReached &&
    next.composerEntered === s.composerEntered &&
    next.route === s.route &&
    next.ui === s.ui;
  return same ? none(s) : { state: next, effects: next.route !== s.route ? [notify(next)] : [] };
}

/** SH-1: this update moved the tab from another page (or none yet) onto the composer. */
function entersComposer(from: string | null, to: string | undefined): boolean {
  return !isComposerUrl(from ?? undefined) && isComposerUrl(to);
}

/** AM2/AM16 before the decision: a later load of the composer tab is re-probed (strictly when new). */
function onProbingLoad(seen: Probing, s: Windowed, e: TabUpdated): Transition {
  const routed = seen.route !== s.route;
  if (e.status === 'loading') {
    const loads = seen.loadsSinceReload + 1;
    if (seen.step === 'awaitComplete') {
      return { state: { ...seen, loadsSinceReload: loads }, effects: routed ? [notify(seen)] : [] };
    }
    const next: Probing = { ...seen, loadsSinceReload: loads, step: 'awaitComplete', amLoad: true };
    return { state: next, effects: [notify(next)] };
  }
  if (e.status === 'complete' && seen.step === 'awaitComplete') {
    const next: Probing = { ...seen, step: 'injectAgent' };
    return { state: next, effects: [{ type: 'injectAgent', tabId: seen.tabId }, ...(routed ? [notify(next)] : [])] };
  }
  return changed(s, seen);
}

/**
 * After the decision, a later load of the composer tab (the insert's SPA navigation to /create/story,
 * Instagram going home after Share, hydration's replaceState): re-inject at `complete` and learn from the
 * agent's sentinel whether the document is new (AM16). Facts keep flowing meanwhile.
 */
function onDocLoad(seen: Windowed, s: Windowed, e: TabUpdated, ctx: HandoffCtx): Transition {
  let next = seen;
  const effects: HandoffEffect[] = [];
  if (next.phase === 'finished' && next.result.kind === 'posted' && next.ui.wentHomeAt !== null && !next.homeClose) {
    // §4.6: Posted closes 2 s after Instagram went home (its own success toast shows).
    next = { ...next, homeClose: true, closeAt: Math.min(next.closeAt, ctx.now + HOME_CLOSE_MS) };
    effects.push(arm('closeDelay', Math.max(0, next.closeAt - ctx.now)));
  }
  const watched = next.phase !== 'finished' || next.hold !== 'none';
  if (watched && e.status === 'loading') {
    next = { ...next, loadsSinceReload: next.loadsSinceReload + 1, docCheck: 'awaitComplete' };
    return { state: next, effects };
  }
  if (watched && e.status === 'complete' && next.docCheck === 'awaitComplete') {
    next = { ...next, docCheck: 'injectAgent' };
    return { state: next, effects: [...effects, { type: 'injectAgent', tabId: next.tabId }] };
  }
  if (effects.length > 0) return { state: next, effects };
  return changed(s, next);
}

function onAgentInjected(
  s: Windowed,
  e: Extract<HandoffEvent, { type: 'agentInjected' }>,
  ctx: HandoffCtx,
): Transition {
  const fresh = e.fresh !== false;
  const orientation = e.orientation ?? null;
  if (s.phase === 'probing' && s.step === 'injectAgent') return onProbingInjected(s, fresh, orientation, ctx);
  if (s.docCheck === 'injectAgent') return onDocChecked(s, fresh, orientation, ctx);
  return none(s);
}

/** SH-1: the shim installed itself only after a commit had reached the composer in this document. */
function lateShim(s: WindowedSession, sameDocument: boolean, o: PageOrientation): boolean {
  return s.composerEntered === true && sameDocument && o.shim === 'installed' && isComposerUrl(s.url ?? undefined);
}

function onProbingInjected(
  s0: Probing,
  fresh: boolean,
  orientation: PageOrientation | null,
  ctx: HandoffCtx,
): Transition {
  // The reload's first injection (`!amLoad`) shares the reloaded document with the commits after it.
  const sameDoc = !(s0.amLoad && fresh);
  const reading: PageOrientation | null =
    orientation && lateShim(s0, sameDoc, orientation) ? { ...orientation, afterComposerMount: true } : orientation;
  const s: Probing = {
    ...s0,
    pageOrientation: reading ?? (fresh ? null : s0.pageOrientation),
    composerEntered: false,
  };
  if (s.amLoad && !fresh && s.inputWaitUntil !== null) return resumeInputWait(s, ctx);
  if (s.amLoad && fresh) {
    const next: Probing = { ...s, step: 'awaitReport', strict: true, inputWaitUntil: null };
    return { state: next, effects: [clear('inputWait'), ...probeCmd(s)] };
  }
  return { state: { ...s, step: 'awaitReport' }, effects: probeCmd(s) };
}

/** P5 + AM16: a same-document load interrupted the input wait: carry on with the time left. */
function resumeInputWait(s: Probing, ctx: HandoffCtx): Transition {
  const left = (s.inputWaitUntil ?? ctx.now) - ctx.now;
  if (left <= 0) return { state: { ...s, step: 'awaitReport', inputWaitUntil: null }, effects: probeCmd(s) };
  return {
    state: { ...s, step: 'awaitInput' },
    effects: [send(s, { type: 'agent/watch' }), arm('inputWait', left)],
  };
}

function onDocChecked(s: Windowed, fresh: boolean, orientation: PageOrientation | null, ctx: HandoffCtx): Transition {
  const reading: PageOrientation | null =
    orientation && lateShim(s, !fresh, orientation) ? { ...orientation, afterComposerMount: true } : orientation;
  const next: Windowed = {
    ...s,
    docCheck: null,
    pageOrientation: reading ?? (fresh ? null : s.pageOrientation),
    composerEntered: false,
  };
  if (fresh) return newDocument(next, ctx);
  // AM37 (C3b): the composer was reached (the insert's SPA navigation) while the page may read landscape.
  if (
    !afterShare(next) &&
    next.phase !== 'finished' &&
    next.phase !== 'manual' &&
    composerMayReadLandscape(next.pageOrientation, next.url ?? undefined)
  ) {
    return screenLandscape(next, ctx);
  }
  return { state: next, effects: [] };
}

/**
 * A new document after the decision (AM16, AM28): the old document's agent, its observer and anything
 * Instagram held in memory are gone.
 */
function newDocument(s: Windowed, ctx: HandoffCtx): Transition {
  switch (s.phase) {
    case 'awaitingAccount':
    case 'openingEntry':
      if (s.phase === 'openingEntry' && s.sub === 'sent') {
        return fail(s, 'STORY_ENTRY_MISSING', ctx, { detail: 'page reloaded' });
      }
      return reprobe(s, ctx);
    case 'inserting':
    case 'composeReady':
      return fail(s, 'INJECTION_IGNORED', ctx, { detail: 'page reloaded' });
    case 'sharing':
    case 'confirmingUpload':
      return unknownNow(s, 'agent-lost', ctx, 'page reloaded');
    case 'manual':
      // Finish by hand goes on in the new document: its agent observes too.
      return { state: s, effects: [send(s, { type: 'agent/observe', from: 'manual' })] };
    case 'finished':
      // A held upload went with the old document (a navigation aborts it).
      return s.hold === 'upload' ? closeFinished(s, ctx) : { state: s, effects: [] };
    default:
      return { state: s, effects: [] };
  }
}

/** Before any tap, a new document is probed again, strictly; the account is decided again. */
function reprobe(s: Windowed, ctx: HandoffCtx): Transition {
  const cap = resumeCap(s, ctx);
  const next: Probing = {
    ...common(s),
    ...cap.patch,
    decided: false,
    phase: 'probing',
    phaseLog: logPhase(s, 'probing', ctx.now),
    step: 'awaitReport',
    strict: true,
    amLoad: true,
  };
  return {
    state: next,
    effects: [
      clear('dwell'),
      clear('accountPrompt'),
      clear('hiddenWait'),
      ...cap.effects,
      ...probeCmd(s),
      arm('stepDeadline', HOME_READY_MS),
      notify(next),
    ],
  };
}

// ---------------------------------------------------------------------------------------
// the probe report and its decision (§3.6 step 7)

function decisionStatus(s: Windowed): Partial<HandoffStatus> {
  const probe = s.probe;
  if (!probe) return {};
  const c4: CheckResult = preflightOf(probe, undefined, null, null, s.c4Reached).C4;
  const path = s.url !== null ? igPath(s.url) : null;
  return { probe, c4, ...(path !== null ? { path } : {}), ...(s.route ? { route: s.route } : {}) };
}

/** AM37: the agent's report with the portrait shim's reading for that document (C3b). */
function stamped(probe: ProbeReport, orientation: PageOrientation | null): ProbeReport {
  if (!orientation) return probe;
  const { type, shim, afterComposerMount } = orientation;
  return { ...probe, orientation: afterComposerMount ? { type, shim, afterComposerMount } : { type, shim } };
}

function screenDetail(o: PageOrientation | null | undefined): string {
  const late = o?.afterComposerMount ? ' after the composer mounted' : '';
  return `screen ${o?.type ?? 'unknown'}, portrait shim ${o?.shim ?? 'unknown'}${late}`;
}

function screenLandscape(s: Windowed, ctx: HandoffCtx): Transition {
  const o = s.pageOrientation;
  const probe = s.probe && o ? stamped(s.probe, o) : s.probe;
  const readyProbe = s.readyProbe && o ? stamped(s.readyProbe, o) : s.readyProbe;
  const shown = readyProbe ?? probe;
  return fail({ ...s, probe, readyProbe }, 'SCREEN_LANDSCAPE', ctx, {
    ...(shown ? { probe: shown } : {}),
    detail: screenDetail(o),
  });
}

function onAgentReport(s: Windowed, probe: ProbeReport, ctx: HandoffCtx): Transition {
  if (s.phase === 'probing' && s.step === 'awaitReport') {
    const p = stamped(probe, s.pageOrientation);
    let next: Probing = s;
    const effects: HandoffEffect[] = [];
    // §4.6: a hidden page is raised once before anything is tapped.
    if (p.visibility === 'hidden' && !s.raisedForVisibility) {
      next = { ...s, raisedForVisibility: true, hidden: true };
      effects.push({ type: 'raiseWindow', windowId: s.windowId });
    } else if (p.visibility !== undefined && (p.visibility === 'hidden') !== s.hidden) {
      next = { ...s, hidden: p.visibility === 'hidden' };
    }
    const t = decideProbe(next, p, ctx, false);
    // A window that the decision closes is not raised first.
    const raise = t.state.phase === 'closing' || t.state.phase === 'idle' ? [] : effects;
    return { state: t.state, effects: [...t.effects, ...raise] };
  }
  // AM13: the C8 report asked for once the composer drew the photo; diagnostics only.
  if (s.decided && s.phase !== 'probing') {
    const ready = stamped(probe, s.pageOrientation);
    const next: Windowed = { ...s, readyProbe: ready };
    return { state: next, effects: [notify(next, { probe: ready })] };
  }
  return none(s);
}

/**
 * Evaluates `probe` (probe-eval.ts) and acts on the decision. `waited`: the one input wait just ran out,
 * so the probe decides as it is.
 */
function decideProbe(s: Probing, probe: ProbeReport, ctx: HandoffCtx, waited: boolean): Transition {
  const ev = evaluateProbe({
    probe,
    guarded: ctx.guarded,
    mode: s.mode,
    url: s.url ?? undefined,
    refitUsed: s.refitUsed,
    strict: s.strict,
  });
  const p: Probing = { ...s, probe, fakeBanner: s.fakeBanner || ev.banner, c4Reached: ev.c4Reached };
  const d = ev.decision;
  const needsAccount = d.kind === 'proceed' || d.kind === 'check-done';
  const inputMissing = ev.c4Reached && probe.storyInput === 'absent';
  const accountMissing = needsAccount && !isValidHandle(probe.account?.handle ?? null);
  if ((inputMissing || accountMissing) && s.inputWaitUsed && !waited && (s.inputWaitUntil ?? 0) > ctx.now) {
    // P5: what appeared was not all that was missing (the account link is there at once, the story input is
    // not): wait on for the rest of the one wait, for the watch's next event or the deadline.
    return {
      state: { ...p, c4Reached: false, step: 'awaitInput' },
      effects: [arm('inputWait', (s.inputWaitUntil ?? ctx.now) - ctx.now)],
    };
  }
  if ((inputMissing || accountMissing) && !s.inputWaitUsed && !waited) {
    // P5: on `/` msite mounts its header (+, the story input) and its navigation after hydration. The first
    // decision that reads them waits once for the watch's input-appeared / account-appeared and probes again.
    return {
      state: {
        ...p,
        c4Reached: false,
        step: 'awaitInput',
        inputWaitUsed: true,
        inputWaitUntil: ctx.now + INPUT_WAIT_MS,
      },
      effects: [send(s, { type: 'agent/watch' }), arm('inputWait', INPUT_WAIT_MS)],
    };
  }
  const decided = decisionStatus(p);
  switch (d.kind) {
    case 'fail':
      return fail(
        p,
        d.code,
        ctx,
        d.code === 'SCREEN_LANDSCAPE' ? { ...decided, detail: screenDetail(probe.orientation) } : decided,
      );
    case 'refit':
      return {
        state: { ...p, refitUsed: true, step: 'refitMeasure' },
        effects: [{ type: 'measureTab', tabId: s.tabId, windowId: s.windowId, settle: false }],
      };
    case 'check-done':
    case 'proceed':
      return toAccount(p, ctx, decided, d.kind === 'check-done');
  }
}

// ---------------------------------------------------------------------------------------
// the account (ux.md §4.8)

function toAccount(s: Probing, ctx: HandoffCtx, decided: Partial<HandoffStatus>, check: boolean): Transition {
  const raw = s.probe?.account?.handle ?? null;
  const detected = isValidHandle(raw) ? raw : null;
  const expected = ctx.settings.expectedAccount?.handle ?? null;
  const decision = accountDecision(expected, detected, ctx.settings.accountLock, s.mode);
  const prevOwner = s.account.confirmedBy === 'owner' && sameHandle(s.account.detected, detected);
  const confirmedBy: AccountFacts['confirmedBy'] = prevOwner
    ? 'owner'
    : decision === 'ok'
      ? 'match'
      : decision === 'learn'
        ? 'learned'
        : decision === 'unlocked'
          ? 'unlocked'
          : null;
  const account: AccountFacts = {
    detected,
    candidates: s.probe?.account?.candidates ?? 0,
    expected,
    decision,
    confirmedBy,
  };
  const learn: HandoffEffect[] =
    detected !== null && expected === null && (decision === 'learn' || decision === 'unlocked')
      ? [{ type: 'setExpectedAccount', account: { handle: detected, detectedAt: ctx.now } }]
      : [];
  const next: Probing = {
    ...s,
    account,
    decided: true,
    steps: { ...s.steps, instagram: s.steps.instagram ?? ctx.now },
  };
  if (check) {
    const lockedTo = decision === 'mismatch' && expected !== null ? { lockedTo: expected } : {};
    const r = result(ctx, 'checked', {
      account: detected,
      ...(detected ? {} : { detail: 'account unreadable' }),
      ...lockedTo,
    });
    const t = close({ ...next, steps: { ...next.steps, account: ctx.now } }, r, ctx, decided);
    return { state: t.state, effects: [...t.effects, ...learn] };
  }
  const prompt = promptOf(decision);
  if (prompt !== null && confirmedBy === null) return toAwaitingAccount(next, prompt, ctx, decided, learn);
  return toEntry(next, ctx, [clear('stepDeadline'), ...learn], decided);
}

function toAwaitingAccount(
  s: Probing,
  prompt: AwaitingAccount['prompt'],
  ctx: HandoffCtx,
  decided: Partial<HandoffStatus>,
  pre: HandoffEffect[],
): Transition {
  const cap = pauseCap(s, ctx);
  const next: AwaitingAccount = {
    ...common(s),
    ...cap.patch,
    phase: 'awaitingAccount',
    phaseLog: logPhase(s, 'awaitingAccount', ctx.now),
    prompt,
    until: ctx.now + ACCOUNT_PROMPT_MS,
  };
  return {
    state: next,
    effects: [
      ...pre,
      clear('stepDeadline'),
      clear('hiddenWait'),
      ...cap.effects,
      arm('accountPrompt', ACCOUNT_PROMPT_MS),
      notify(next, decided),
    ],
  };
}

function onAccountChoice(s: AwaitingAccount, proceed: boolean, ctx: HandoffCtx): Transition {
  if (!proceed) {
    return close(s, result(ctx, 'stopped', { stoppedBy: 'owner', account: s.account.detected }), ctx, {
      detail: 'account not confirmed',
    });
  }
  const detected = s.account.detected;
  const cap = resumeCap(s, ctx);
  const next: AwaitingAccount = {
    ...s,
    ...cap.patch,
    account: { ...s.account, confirmedBy: 'owner', ...(detected ? { expected: detected } : {}) },
  };
  const learn: HandoffEffect[] = detected
    ? [{ type: 'setExpectedAccount', account: { handle: detected, detectedAt: ctx.now } }]
    : [];
  return toEntry(next, ctx, [clear('accountPrompt'), ...cap.effects, ...learn]);
}

// ---------------------------------------------------------------------------------------
// the autopilot: + → Story, the insert, the composer, Share (ux.md §10)

function dwell(kind: DwellKind, ctx: HandoffCtx): number {
  return dwellMs(kind, ctx.random, ctx.guarded ? ctx.dwellScale : undefined);
}

/** §4.6: a page hidden before a tap is raised once; it must be visible again within HIDDEN_WAIT_MS. */
function hiddenEffects(s: WindowedSession): { patch: Partial<WindowedSession>; effects: HandoffEffect[] } {
  if (!s.hidden) return { patch: {}, effects: [] };
  const raise: HandoffEffect[] = s.raisedForVisibility ? [] : [{ type: 'raiseWindow', windowId: s.windowId }];
  return { patch: { raisedForVisibility: true }, effects: [...raise, arm('hiddenWait', HIDDEN_WAIT_MS)] };
}

function toEntry(
  s: Windowed,
  ctx: HandoffCtx,
  pre: HandoffEffect[] = [],
  extra: Partial<HandoffStatus> = {},
): Transition {
  const vis = hiddenEffects(s);
  const next: OpeningEntry = {
    ...common(s),
    ...vis.patch,
    phase: 'openingEntry',
    phaseLog: logPhase(s, 'openingEntry', ctx.now),
    sub: 'dwell',
    steps: { ...s.steps, account: s.steps.account ?? ctx.now },
  };
  return {
    state: next,
    effects: [...pre, ...vis.effects, arm('dwell', dwell('entry', ctx)), notify(next, extra)],
  };
}

function onDwell(s: Windowed, ctx: HandoffCtx): Transition {
  if (s.phase === 'openingEntry' && s.sub === 'dwell') {
    if (s.entrySent) return none(s);
    const next: OpeningEntry = { ...s, sub: 'sent', entrySent: true };
    return {
      state: next,
      effects: [
        send(s, { type: 'agent/drive', step: 'open-entry', fingerprint: ctx.fingerprint }),
        arm('stepDeadline', ENTRY_BUDGET_MS),
      ],
    };
  }
  if (s.phase === 'inserting' && s.sub === 'dwell') {
    if (s.insertSent) return none(s);
    const next: Inserting = { ...s, sub: 'sent', insertSent: true };
    return {
      state: next,
      effects: [send(s, { type: 'agent/drive', step: 'insert' }), arm('stepDeadline', INSERT_BUDGET_MS)],
    };
  }
  if (s.phase === 'composeReady' && s.sub === 'dwell') {
    // AP-5: never send Share to a hidden page: raise it (once) and send Share when it shows, or fail
    // WINDOW_HIDDEN when hiddenWait runs out. The agent's own visibility wait is then only a backstop.
    if (s.hidden && !s.shareSent) {
      const vis = hiddenEffects(s);
      const next: ComposeReady = { ...s, ...vis.patch, sub: 'awaitVisible' };
      return { state: next, effects: [...vis.effects, notify(next)] };
    }
    return toSharing(s, ctx);
  }
  return none(s);
}

function entryCode(r: EntryFact['result']): ErrorCode {
  switch (r) {
    case 'SESSION_NOT_STARTED':
      return 'LANDSCAPE';
    case 'ACTIVATION_ACTIVE':
      return 'WINDOW_IN_USE';
    case 'HIDDEN':
      return 'WINDOW_HIDDEN';
    default:
      return 'STORY_ENTRY_MISSING';
  }
}

/** The detail an entry failure carries (exported for U30: copy must word every one of them). */
export function entryDetail(f: Pick<EntryFact, 'result' | 'menuCount'>): string {
  switch (f.result) {
    case 'ENTRY_MISSING':
      return 'no + entry beside the story input';
    case 'MENU_MISSING':
      return 'no menu after +';
    case 'MENU_DRIFT':
      return `menu ${f.menuCount ?? '?'} items`;
    case 'WRONG_ITEM':
      return 'neither menu item started a story';
    case 'NOT_ARMED':
      return 'story input not armed';
    case 'SESSION_NOT_STARTED':
      return 'story session refused';
    case 'ACTIVATION_ACTIVE':
      return 'window in use';
    case 'HIDDEN':
      return 'window hidden';
    case 'REFUSED':
      return 'tap refused';
    case 'armed':
      return 'armed';
  }
}

function onEntry(s: OpeningEntry, f: EntryFact, ctx: HandoffCtx): Transition {
  const { kind: _k, ...facts } = f;
  const seen: OpeningEntry = { ...s, entry: facts };
  if (f.result !== 'armed') return fail(seen, entryCode(f.result), ctx, { detail: entryDetail(f) });
  const fp = ctx.fingerprint;
  const learned: HandoffEffect[] =
    f.storyIndex !== null &&
    f.glyph !== null &&
    f.menuCount !== null &&
    (fp === null || fp.storyIndex !== f.storyIndex || fp.glyph !== f.glyph || fp.count !== f.menuCount)
      ? [
          {
            type: 'storeFingerprint',
            fingerprint: { count: f.menuCount, storyIndex: f.storyIndex, glyph: f.glyph, savedAt: ctx.now },
          },
        ]
      : [];
  const next: Inserting = {
    ...common(seen),
    phase: 'inserting',
    phaseLog: logPhase(s, 'inserting', ctx.now),
    sub: 'dwell',
    steps: { ...s.steps, armed: ctx.now },
  };
  return {
    state: next,
    effects: [clear('stepDeadline'), ...learned, arm('dwell', dwell('insert', ctx)), notify(next)],
  };
}

function onInserted(s: Inserting): Transition {
  const next: Inserting = { ...s, sub: 'awaitComposer' };
  return {
    state: next,
    effects: [
      send(s, { type: 'agent/drive', step: 'compose', sample: s.exportSample }),
      arm('stepDeadline', INSERT_BUDGET_MS),
      notify(next),
    ],
  };
}

/** The account was decided and not refused (IR11). */
const accountOk = (s: WindowedSession): boolean => s.account.confirmedBy !== null;

function composeValid(c: WindowedSession['compose']): boolean {
  return c?.onComposer === true && c.drawn && !c.landscape && c.controls === 1;
}

function onCompose(s: Windowed, f: ComposeFact, ctx: HandoffCtx): Transition {
  const { kind: _k, ...facts } = f;
  if (s.phase === 'manual') {
    const needs = facts.drawn && facts.onComposer ? 'share' : s.needs;
    const next: Manual = { ...s, compose: facts, needs };
    return { state: next, effects: next.needs !== s.needs ? [notify(next)] : [] };
  }
  const inInsert = s.phase === 'inserting' && s.sub !== 'dwell';
  if (!inInsert && s.phase !== 'composeReady') return none(s);
  const seen: Windowed = { ...s, compose: facts };
  if (!f.onComposer || !f.drawn) return fail(seen, 'INJECTION_IGNORED', ctx, { detail: 'composer not drawn' });
  if (f.landscape) {
    return fail(seen, 'SCREEN_LANDSCAPE', ctx, { detail: `rotate snackbar shown; ${screenDetail(s.pageOrientation)}` });
  }
  if (composerMayReadLandscape(s.pageOrientation, s.url ?? undefined)) return screenLandscape(seen, ctx);
  if (f.controls !== 1) return fail(seen, 'SHARE_MISSING', ctx, { detail: `${f.controls} Share controls` });
  if (s.phase === 'composeReady') return { state: seen, effects: [] };

  const steps = { ...s.steps, composer: ctx.now };
  if (s.mode === 'test') {
    // ux.md §7: a Test run passes here, before Share; it closes at once.
    const r = result(ctx, 'tested', { account: s.account.detected, ...(f.fbAuto ? { facebook: true } : {}) });
    const t = close({ ...seen, steps }, r, ctx);
    return { state: t.state, effects: [...t.effects, { type: 'setLastTestPass', at: ctx.now }] };
  }
  const shareTest = s.mode === 'shareTest';
  const next: ComposeReady = {
    ...common(seen),
    phase: 'composeReady',
    phaseLog: logPhase(s, 'composeReady', ctx.now),
    sub: shareTest ? 'verifyRules' : 'dwell',
    steps,
  };
  return {
    state: next,
    effects: [
      clear('stepDeadline'),
      // AM13: one more probe of the drawn composer, for C8.
      ...probeCmd(s),
      shareTest ? { type: 'verifyTestRules', tabId: s.tabId } : arm('dwell', dwell('share', ctx)),
      notify(next),
    ],
  };
}

function onRulesVerified(s: ComposeReady, ok: boolean, ctx: HandoffCtx): Transition {
  if (!ok) return fail(s, 'AGENT_UNREACHABLE', ctx, { detail: 'write-block rules not installed' });
  const next: ComposeReady = { ...s, testRulesVerified: true, sub: 'dwell' };
  return { state: next, effects: [arm('dwell', dwell('share', ctx))] };
}

/**
 * IR11, Share once: the command goes out only from here, once per hand-off, with every condition holding;
 * `shareSent` is set in the same transition (persisted before the effect runs).
 */
function toSharing(s: ComposeReady, ctx: HandoffCtx): Transition {
  if (s.shareSent) return none(s);
  if (s.mode === 'test' || s.mode === 'check') return none(s);
  if (s.mode === 'shareTest' && !s.testRulesVerified) {
    return fail(s, 'AGENT_UNREACHABLE', ctx, { detail: 'write-block rules not verified' });
  }
  if (!accountOk(s)) return fail(s, 'ACCOUNT_UNCONFIRMED', ctx, { detail: 'account not confirmed' });
  if (!composeValid(s.compose)) return fail(s, 'SHARE_MISSING', ctx, { detail: 'compose facts invalid' });
  if (composerMayReadLandscape(s.pageOrientation, s.url ?? undefined)) return screenLandscape(s, ctx);
  const next: Sharing = {
    ...common(s),
    phase: 'sharing',
    phaseLog: logPhase(s, 'sharing', ctx.now),
    sentAt: ctx.now,
    shareSent: true,
    shareSentAt: ctx.now,
    preShareUntil: null,
    preShareLeft: null,
  };
  return {
    state: next,
    effects: [
      clear('preShareCap'),
      clear('hiddenWait'),
      send(s, { type: 'agent/drive', step: 'share' }),
      arm('shareAck', SHARE_ACK_MS),
      notify(next),
    ],
  };
}

function onShareDone(s: Sharing, ctx: HandoffCtx): Transition {
  const next: Confirming = {
    ...common(s),
    phase: 'confirmingUpload',
    phaseLog: logPhase(s, 'confirmingUpload', ctx.now),
    t0At: ctx.now,
    sharedAt: ctx.now,
    sharedBy: 'autopilot',
    steps: { ...s.steps, share: ctx.now },
  };
  // The evidence may already decide (entries that ended before share-done arrived): its end clears every timer.
  const t = confirm(next, ctx, false);
  if (t.state !== next) return t;
  return { state: next, effects: [clear('shareAck'), arm('confirmTick', CONFIRM_TICK_MS), notify(next), ...t.effects] };
}

function shareRefusalCode(why: ShareRefusal): ErrorCode {
  switch (why) {
    case 'landscape':
      return 'SCREEN_LANDSCAPE';
    case 'activation':
      return 'WINDOW_IN_USE';
    case 'hidden':
      return 'WINDOW_HIDDEN';
    default:
      return 'SHARE_MISSING';
  }
}

function onShareRefused(s: Sharing, why: ShareRefusal, ctx: HandoffCtx): Transition {
  // Nothing was clicked: the failure is a before-Share one (Nothing was posted).
  const next: Sharing = { ...s, shareRefused: why };
  const t = fail(next, shareRefusalCode(why), ctx, { detail: `share refused: ${why}` });
  // Closing or finishing clears every timer, shareAck included.
  return t;
}

/**
 * AP-5: the agent's refusal came after the shareAck timer had already held the run as Couldn't confirm
 * (`share-not-acknowledged`). Nothing was pressed and no request was seen, so it is the same before-Share
 * failure as a timely refusal, and the held window and lane are let go.
 */
function onLateShareRefused(s: Finished, why: ShareRefusal, ctx: HandoffCtx): Transition {
  const held = s.hold === 'upload' && s.result.kind === 'unknown' && s.result.why === 'share-not-acknowledged';
  if (!held || !s.shareSent || s.shareRefused !== null || s.sharedBy !== null || sawWrite(s.net)) return none(s);
  return fail({ ...s, shareRefused: why }, shareRefusalCode(why), ctx, { detail: `share refused late: ${why}` });
}

/** The elapsed time since Share as the evidence has it (the agent's clock, carried forward by ours). */
function elapsedSinceShare(s: WindowedSession, ctx: HandoffCtx): number {
  const agent = s.netElapsedAt !== null ? s.netElapsedMs + Math.max(0, ctx.now - s.netElapsedAt) : 0;
  const ours = s.sharedAt !== null ? Math.max(0, ctx.now - s.sharedAt) : 0;
  return Math.max(agent, ours);
}

function mergeAlarms(a: readonly Alarm[], b: readonly Alarm[]): Alarm[] {
  return [...new Set([...a, ...b])];
}

/** The outcome rules (outcome.ts) on the evidence so far. */
function confirm(s: Confirming, ctx: HandoffCtx, tick: boolean): Transition {
  const budgets = scaledBudgets(ctx.guarded ? ctx.budgetScale : undefined);
  const d = decide(s.net, elapsedSinceShare(s, ctx), s.writeBlocked, budgets);
  const alarms = mergeAlarms(s.alarms, d.alarms);
  const seen: Confirming = alarms.length !== s.alarms.length ? { ...s, alarms } : s;
  const fb = seen.compose?.fbAuto ? { facebook: true } : {};
  const account = seen.account.detected;
  switch (d.kind) {
    case 'pending': {
      const effects = tick ? [arm('confirmTick', CONFIRM_TICK_MS)] : [];
      return seen === s && effects.length === 0 ? none(s) : { state: seen, effects };
    }
    case 'posted': {
      const steps = { ...seen.steps, confirmed: ctx.now };
      const home = seen.ui.wentHomeAt !== null;
      const r = result(ctx, 'posted', { alarms, detail: d.detail, account, ...fb });
      const t = finish({ ...seen, steps }, r, 'none', home ? HOME_CLOSE_MS : POSTED_CLOSE_MS, ctx);
      return home && t.state.phase === 'finished' ? { state: { ...t.state, homeClose: true }, effects: t.effects } : t;
    }
    case 'notPosted': {
      const r = result(ctx, 'notPosted', { code: 'UPLOAD_FAILED', detail: d.detail, alarms, account, ...fb });
      return finish({ ...seen, steps: { ...seen.steps, confirmed: ctx.now } }, r, 'none', CLOSE_DELAY_MS, ctx);
    }
    case 'unknown':
      return unknownNow(seen, d.why, ctx, d.detail, d.mayRun);
    case 'shareTested': {
      const r = result(ctx, 'shareTested', { detail: d.detail, alarms, account, ...fb });
      return finish({ ...seen, steps: { ...seen.steps, confirmed: ctx.now } }, r, 'none', CLOSE_DELAY_MS, ctx);
    }
    case 'testLeak':
      return killNow(seen, 'TEST_LEAK', ctx, d.detail);
  }
}

/**
 * §6.4: a later answer while a Couldn't confirm is held. With writes blocked (a Share test, a guarded post) the
 * O9/O10 rules decide it instead: a late leak is TEST_LEAK (kill and lock), a late blocked upload passes the
 * Share test, and nothing is ever Posted or Not posted (AP-2).
 */
function lateAnswer(s: Finished, ctx: HandoffCtx): Transition {
  const budgets = scaledBudgets(ctx.guarded ? ctx.budgetScale : undefined);
  if (s.writeBlocked) return lateBlocked(s, budgets, ctx);
  const d = decideLate(s.net, budgets);
  if (d === null) return none(s);
  const alarms = mergeAlarms(s.alarms, d.alarms);
  const fb = s.compose?.fbAuto ? { facebook: true } : {};
  const r =
    d.kind === 'posted'
      ? result(ctx, 'posted', { alarms, detail: d.detail, late: true, account: s.account.detected, ...fb })
      : result(ctx, 'notPosted', {
          code: 'UPLOAD_FAILED',
          detail: d.detail,
          alarms,
          late: true,
          account: s.account.detected,
          ...fb,
        });
  const steps = { ...s.steps, confirmed: ctx.now };
  const closeMs = d.kind === 'posted' ? (s.ui.wentHomeAt !== null ? HOME_CLOSE_MS : POSTED_CLOSE_MS) : CLOSE_DELAY_MS;
  return finish({ ...s, steps, alarms }, r, 'none', closeMs, ctx);
}

function lateBlocked(s: Finished, budgets: OutcomeBudgets, ctx: HandoffCtx): Transition {
  const d = decide(s.net, LATE_ELAPSED_MS, true, budgets);
  const alarms = mergeAlarms(s.alarms, d.alarms);
  const fb = s.compose?.fbAuto ? { facebook: true } : {};
  switch (d.kind) {
    case 'testLeak':
      return killNow({ ...s, alarms }, 'TEST_LEAK', ctx, d.detail);
    case 'shareTested': {
      const r = result(ctx, 'shareTested', {
        detail: d.detail,
        alarms,
        late: true,
        account: s.account.detected,
        ...fb,
      });
      return finish({ ...s, alarms, steps: { ...s.steps, confirmed: ctx.now } }, r, 'none', CLOSE_DELAY_MS, ctx);
    }
    default:
      return none(s);
  }
}

/** A late answer has no clock left to run: every budget has passed. */
const LATE_ELAPSED_MS = Number.MAX_SAFE_INTEGER / 2;

/**
 * AP-1: the entries a `net` fact adds. Instagram's upload and publish entries decide the result, so they are
 * never crowded out: they are kept up to MAX_WRITE_NET_ENTRIES whatever came before them, and only the
 * 'other' entries (GraphQL, logging) are capped. In Finish by hand, before the owner shares, only write
 * entries are kept: they are what shows that the owner shared.
 */
function keepNet(kept: readonly NetEntry[], incoming: readonly NetEntry[], writesOnly: boolean): NetEntry[] {
  let writes = kept.filter((e) => classifyEntry(e) !== 'other').length;
  let others = kept.length - writes;
  const added: NetEntry[] = [];
  for (const e of incoming) {
    if (classifyEntry(e) !== 'other') {
      if (writes < MAX_WRITE_NET_ENTRIES) {
        added.push(e);
        writes++;
      }
    } else if (!writesOnly && others < MAX_OTHER_NET_ENTRIES) {
      added.push(e);
      others++;
    }
  }
  return added;
}

function onNet(s: Windowed, f: Extract<AgentFact, { kind: 'net' }>, ctx: HandoffCtx): Transition {
  const live =
    s.phase === 'sharing' ||
    s.phase === 'confirmingUpload' ||
    s.phase === 'manual' ||
    (s.phase === 'finished' && s.hold === 'upload');
  if (!live) return none(s);
  const added = keepNet(s.net, f.entries, s.phase === 'manual');
  const elapsed = Math.max(s.netElapsedMs, f.elapsedMs);
  if (added.length === 0 && elapsed === s.netElapsedMs && s.netElapsedAt !== null) {
    return s.phase === 'confirmingUpload' ? confirm(s, ctx, false) : none(s);
  }
  const next: Windowed = { ...s, net: [...s.net, ...added], netElapsedMs: elapsed, netElapsedAt: ctx.now };
  switch (next.phase) {
    case 'confirmingUpload':
      return confirm(next, ctx, false);
    case 'finished':
      return lateAnswer(next, ctx);
    case 'manual':
      // The owner's Share click was missed, but Instagram is uploading: it was shared by hand.
      return sawWrite(added) ? toOwnerConfirm(next, ctx, false) : { state: next, effects: [] };
    default:
      return { state: next, effects: [] };
  }
}

function onUi(s: Windowed, f: Extract<AgentFact, { kind: 'ui' }>, ctx: HandoffCtx): Transition {
  if (!(s.shareSent || s.sharedBy !== null || s.phase === 'manual')) return none(s);
  const rank = { none: 0, plain: 1, action: 2 } as const;
  const ui = {
    progressSeen: s.ui.progressSeen || f.progressSeen === true,
    toast: rank[f.toast] > rank[s.ui.toast] ? f.toast : s.ui.toast,
    wentHomeAt: s.ui.wentHomeAt ?? (f.wentHome && afterShare(s) ? ctx.now : null),
  };
  if (ui.progressSeen === s.ui.progressSeen && ui.toast === s.ui.toast && ui.wentHomeAt === s.ui.wentHomeAt) {
    return none(s);
  }
  const next: Windowed = { ...s, ui };
  if (next.phase === 'finished' && next.result.kind === 'posted' && ui.wentHomeAt !== null && !next.homeClose) {
    const closeAt = Math.min(next.closeAt, ctx.now + HOME_CLOSE_MS);
    return { state: { ...next, homeClose: true, closeAt }, effects: [arm('closeDelay', closeAt - ctx.now)] };
  }
  return { state: next, effects: [] };
}

function onVisibility(s: Windowed, hidden: boolean, ctx: HandoffCtx): Transition {
  if (hidden === s.hidden) return none(s);
  const next: Windowed = { ...s, hidden };
  // After Share, and while the owner answers in the editor or taps by hand, visibility no longer matters.
  const watched =
    !afterShare(s) &&
    !s.shareSent &&
    s.phase !== 'finished' &&
    s.phase !== 'manual' &&
    s.phase !== 'awaitingAccount' &&
    s.decided;
  if (!watched) return { state: next, effects: [] };
  if (!hidden) {
    if (next.phase === 'composeReady' && next.sub === 'awaitVisible') {
      // AP-5: the page shows again: Share goes out now (toSharing re-checks every condition).
      const t = toSharing({ ...next, sub: 'dwell' }, ctx);
      return { state: t.state, effects: [clear('hiddenWait'), ...t.effects] };
    }
    return { state: next, effects: [clear('hiddenWait')] };
  }
  const vis = hiddenEffects(next);
  return { state: { ...next, ...vis.patch }, effects: vis.effects };
}

function onFact(s: Windowed, f: AgentFact, ctx: HandoffCtx): Transition {
  switch (f.kind) {
    case 'visibility':
      return onVisibility(s, f.hidden === true, ctx);
    case 'entry':
      return s.phase === 'openingEntry' && s.sub === 'sent' ? onEntry(s, f, ctx) : none(s);
    case 'inserted':
      return s.phase === 'inserting' && (s.sub === 'sent' || s.sub === 'served') && s.fileServed
        ? onInserted(s)
        : none(s);
    case 'insert-failed':
      if (s.phase !== 'inserting' || (s.sub !== 'sent' && s.sub !== 'served')) return none(s);
      return fail(s, f.why === 'accept-drift' ? 'ACCEPT_DRIFT' : 'INJECTION_IGNORED', ctx, {
        detail: `insert ${f.why}`,
      });
    case 'compose':
      return onCompose(s, f, ctx);
    case 'share-done':
      return s.phase === 'sharing' ? onShareDone(s, ctx) : none(s);
    case 'share-refused':
      if (s.phase === 'sharing') return onShareRefused(s, f.why, ctx);
      return s.phase === 'finished' ? onLateShareRefused(s, f.why, ctx) : none(s);
    case 'net':
      return onNet(s, f, ctx);
    case 'ui':
      return onUi(s, f, ctx);
    case 'owner-share':
      return s.phase === 'manual' ? toOwnerConfirm(s, ctx, true) : none(s);
  }
}

// ---------------------------------------------------------------------------------------
// Finish by hand (ux.md §4.9): the owner taps, instapost observes

function toManual(s: Finished, ctx: HandoffCtx): Transition {
  const needs: Manual['needs'] = s.compose?.drawn && s.compose.onComposer ? 'share' : 'pick';
  const next: Manual = {
    ...common(s),
    phase: 'manual',
    phaseLog: logPhase(s, 'manual', ctx.now),
    needs,
    since: ctx.now,
    until: ctx.now + MANUAL_DEADLINE_MS,
    preShareUntil: null,
    preShareLeft: null,
  };
  return {
    state: next,
    effects: [
      clear('offerManual'),
      { type: 'raiseWindow', windowId: s.windowId },
      send(s, { type: 'agent/observe', from: 'manual' }),
      arm('manualDeadline', MANUAL_DEADLINE_MS),
      notify(next),
    ],
  };
}

/**
 * The owner shared by hand (their click on Share was seen, or Instagram's upload was): the same outcome
 * rules decide. `rebase`: the agent re-bases its clock at the owner's click, so earlier entries are dropped.
 */
function toOwnerConfirm(s: Manual, ctx: HandoffCtx, rebase: boolean): Transition {
  const next: Confirming = {
    ...common(s),
    phase: 'confirmingUpload',
    phaseLog: logPhase(s, 'confirmingUpload', ctx.now),
    t0At: ctx.now,
    sharedAt: ctx.now,
    sharedBy: 'owner',
    steps: { ...s.steps, share: ctx.now },
    ...(rebase ? { net: s.net.filter((e) => e.start >= 0 && sawWrite([e])), netElapsedMs: 0, netElapsedAt: null } : {}),
  };
  const t = confirm(next, ctx, false);
  if (t.state !== next) return t;
  return {
    state: next,
    effects: [clear('manualDeadline'), arm('confirmTick', CONFIRM_TICK_MS), notify(next), ...t.effects],
  };
}

// ---------------------------------------------------------------------------------------
// agent events

function interceptedByWatch(s: Windowed, ctx: HandoffCtx): Transition {
  const probe: ProbeReport | null = s.probe ? { ...s.probe, swIntercepted: true } : null;
  const readyProbe: ProbeReport | null = s.readyProbe ? { ...s.readyProbe, swIntercepted: true } : null;
  const shown = readyProbe ?? probe;
  return fail({ ...s, probe, readyProbe }, 'SW_INTERCEPTS', ctx, shown ? { probe: shown } : {});
}

function onAgentEvent(s: Windowed, event: AgentEventName, ctx: HandoffCtx): Transition {
  if (event === 'sw-controller-change') {
    return { state: { ...s, swControllerChanges: s.swControllerChanges + 1 }, effects: [] };
  }
  // P3: a worker handled page requests, which then left without rule 1001. After Share nothing is cut off.
  if (event === 'sw-intercepted') {
    return s.phase === 'finished' || afterShare(s) || s.shareSent ? none(s) : interceptedByWatch(s, ctx);
  }
  // P5: the story input (or the account link) mounted after hydration: probe once more. The wait's deadline
  // stays: if something is still missing, decideProbe waits on for the rest of it.
  if (s.phase === 'probing' && s.step === 'awaitInput') {
    return {
      state: { ...s, step: 'awaitReport' },
      effects: [clear('inputWait'), ...probeCmd(s)],
    };
  }
  return none(s);
}

// ---------------------------------------------------------------------------------------
// failed effects: flow effects end the run (AGENT_UNREACHABLE, or Couldn't confirm after Share)

function onEffectFailed(s: Windowed, e: Extract<HandoffEvent, { type: 'effectFailed' }>, ctx: HandoffCtx): Transition {
  const step = s.phase === 'probing' ? s.step : null;
  const detail = `${e.effect}: ${e.message}`.slice(0, 300);
  let live: boolean;
  switch (e.effect) {
    case 'installRules':
      live = s.phase === 'scoping';
      break;
    case 'measureTab':
      live = (s.phase === 'fitting' && s.fitStep === 'measure') || step === 'refitMeasure';
      break;
    case 'updateWindow':
      live = (s.phase === 'fitting' && (s.fitStep === 'update' || s.fitStep === 'retry')) || step === 'refitUpdate';
      break;
    case 'navigate':
      live = s.phase === 'navigating';
      break;
    case 'hardReload':
      live = s.phase === 'reloading';
      break;
    case 'injectAgent':
      live = step === 'injectAgent' || s.docCheck === 'injectAgent';
      break;
    case 'sendAgent':
      // The C8 probe and the observe of a held window are diagnostics; anything that drives the run is not.
      live =
        step === 'awaitReport' ||
        step === 'awaitInput' ||
        (s.phase === 'openingEntry' && s.sub === 'sent') ||
        (s.phase === 'inserting' && s.sub !== 'dwell') ||
        s.phase === 'sharing' ||
        s.phase === 'manual';
      if (s.phase === 'sharing') return unknownNow(s, 'share-not-acknowledged', ctx, detail);
      break;
    case 'serveFile':
      return s.phase === 'inserting' ? fail(s, 'INJECTION_IGNORED', ctx, { detail: 'export missing' }) : none(s);
    case 'verifyTestRules':
      return s.phase === 'composeReady' && s.sub === 'verifyRules' ? onRulesVerified(s, false, ctx) : none(s);
    default:
      live = false;
  }
  return live ? fail(s, 'AGENT_UNREACHABLE', ctx, { detail }) : none(s);
}

// ---------------------------------------------------------------------------------------
// The status an editor sees when it connects (or reconnects) mid-run.

/**
 * The current status of any state: idle with the last result (none before the first hand-off), the queue,
 * or the active session as its own transitions describe it (the guided resize with the size last read).
 */
export function statusOf(s: HandoffState): HandoffStatus {
  if (s.phase === 'idle') {
    const last = s.last;
    if (!last) return { handoffId: null, phase: 'idle' };
    const r = last.result;
    return {
      handoffId: last.handoffId,
      phase: 'idle',
      ...(r ? { result: r } : {}),
      ...(r?.code && r.kind !== 'posted' ? { error: r.code } : {}),
      ...(r?.detail ? { detail: r.detail } : {}),
    };
  }
  if (s.phase === 'queued') {
    return {
      handoffId: s.handoffId,
      phase: 'queued',
      mode: s.request.mode,
      queuedUntil: s.startAt,
      canStop: true,
      startedAt: s.queuedAt,
    };
  }
  if (s.phase === 'resizing') {
    const tab = s.win.finalTab ?? { w: 0, h: 0 };
    return status(s, {
      window: s.win,
      resize: { tab, ok: isUsableInner(tab, s.win.zoom), until: s.resizeUntil, maxW: maxMsiteInnerW(s.win.zoom) },
    });
  }
  if (s.phase === 'closing') {
    return status(s, s.result.code && s.result.kind !== 'posted' ? { error: s.result.code } : {});
  }
  const extra: Partial<HandoffStatus> = {};
  if (isWindowed(s) && s.probe) Object.assign(extra, decisionStatus(s));
  if (s.phase === 'finished' && s.result.code && s.result.kind !== 'posted') extra.error = s.result.code;
  if (s.phase === 'finished' && s.result.detail) extra.detail = s.result.detail;
  return status(s, extra);
}
