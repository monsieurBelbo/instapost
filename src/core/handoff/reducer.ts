/**
 * The hand-off reducer (strategy §3.6–§3.10, §11 AM2/AM3, U9). Pure: no I/O, no clocks, no
 * randomness beyond ctx. `handoffReducer(state, event, ctx) → {state, effects}`.
 *
 * ## Protocol for the runner (src/handoff/runner.ts)
 *
 * - Feed events one at a time; persist `state` (storage.session) after every transition, then
 *   run `effects` **in order**, each awaited. An event that changes nothing returns the very
 *   same state object and no effects, so the runner may skip the write.
 * - Sample `ctx` per event: `now`, `guarded`, `chromeMajor` (chromeMajorFromUa of the
 *   background's UA), `settings` (storage.local), `rate` = checkRate(log, now, effectiveCaps(…)),
 *   `uuid` = crypto.randomUUID.
 * - Every effect whose platform call rejects is reported back as
 *   `{type:'effectFailed', effect: <effect type>, message}`. The reducer decides; the runner
 *   never retries. Failures of bookkeeping effects (notifyEditor, writeRecord, lockMsite, …)
 *   are ignored here and only logged by the runner.
 * - Events that answer effects: openWindow → `windowCreated`; installRules → `rulesInstalled`;
 *   measureTab → `tabMeasured` (tabs.get inner size + windows.get outer box); updateWindow →
 *   `windowFitted`; injectAgent → `agentInjected` with `fresh` (false when the agent's sentinel was
 *   already set in that document, AM16). navigate, hardReload, sendAgent, serveFile, closeWindow,
 *   removeRules and the bookkeeping effects (incl. rememberWindow/forgetWindow) answer nothing.
 * - `tabUpdated`: forward every tabs.onUpdated for the composer tab with
 *   `status = changeInfo.status` and `url = tab.url` (undefined without host permission).
 *   Do not filter: the kill switch (urls.ts) runs here, on every update after arming.
 * - `windowRemoved` / `tabRemoved`: forward at least those for the composer window/tab. In idle
 *   every forwarded one emits `removeRules` (idempotent cleanup); in a session, others are ignored.
 * - `startup`: on runtime.onStartup and onInstalled.
 * - Agent messages arrive only after acceptAgentMessage() (§3.5). `agentGetFile` answered by a
 *   `serveFile` effect gets the bytes; when the transition emits no `serveFile`, the runner
 *   answers `{ok:false}`.
 * - Timers: `armTimer` replaces any pending timer of the same name; `clearTimer` is a no-op when
 *   none is pending. `inactivity` is armed once at start; when it fires the reducer either times
 *   out (15 min with no state-changing event) or re-arms it for the remainder. `closeDelay` (3 s)
 *   closes a finished session (unless it is held open, AM19). `navigation` (30 s, AM20) bounds the
 *   first navigation. Fire them as `{type:'timer', timer}`.
 * - Agent commands go out as `sendAgent`. The H1 ready deadline (10 s) lives in the agent's
 *   watch: H1 sends `watch {readyTimeoutMs: 10000}` then `inject`; H0 sends `watch {0}` (no
 *   deadline). A repeated watch restarts the agent's watch with the new deadline.
 *
 * ## Sequence (§3.6)
 *
 *   start → opening ─windowCreated→ scoping ─rulesInstalled→ fitting ─tabMeasured→ (updateWindow)
 *   ─windowFitted→ navigating ─first www `loading`→ reloading (hardReload once; kill switch armed)
 *   ─reload's `loading`, then `complete`→ probing (injectAgent → agent/probe → agentReport)
 *   → evaluateProbe (probe-eval.ts): fail → closing | refit once | probe-done → closing
 *   | H0 → awaitingPick | H1 → injecting ─composer-ready→ awaitingShare (agent/probe for C8,
 *   AM13) ─C9→ finished ─closeDelay→ closing ─windowRemoved→ idle (removeRules 1001–1019).
 *
 * ## Invariants (tested generically in U9)
 *
 * - Never a retry: at most one openWindow, installRules, navigate and hardReload per hand-off;
 *   at most one `agent/inject` and one serveFile per handoffId; at most two updateWindow (the fit
 *   and the single landscape refit); after a session ends no flow effect is emitted for it.
 * - Probe mode never injects. A guarded build injects only after a probe that saw the marker.
 * - AM2/AM16: after the hard reload, every later `loading` of the composer tab re-injects the agent.
 *   A same-document load (`fresh: false`: pushState, replaceState, hash) resumes the interrupted
 *   phase as it was, replaying the agent events that arrived meanwhile. A later full-document load
 *   (`fresh`) is re-probed `strict` (isMobile must be exactly true). A re-probe never upgrades H0 to
 *   H1 and never re-injects; a passing re-probe of a new document resumes as H0. Once `fresh` says
 *   the document is new (AM28), the interrupted phase is dropped: nothing that happened in the old
 *   document (Share, the insert) counts any more, and later same-document loads re-probe.
 * - AM13: entering `awaitingShare` sends one more `agent/probe`; its report only sets `readyProbe`
 *   (C8 on the record) and never re-evaluates the flow.
 * - C9 counts only once the composer is engaged (AM18): a file reached it (composer-ready, the H1
 *   file served, or, AM28, an insert dispatched but never confirmed). Leaving /create/story for `/`
 *   before that is C5 failing (`route:'homeOnly'`, H0 "tap + → Story"), not "composer left". Any
 *   other www page (AM17) ends the session without a "posted" pre-answer: UNEXPECTED_PAGE before
 *   engagement, an unanswered "Posted?" after.
 * - AM19: a C9 after Share in a post with rehearsal off holds the popup open (no closeDelay) until
 *   the owner answers "Posted?", so an upload still running in the page is never cut off. AM28: so
 *   does a C9 after an unconfirmed insert (whatever rehearsal says), with no pre-answer.
 * - Closing always emits `closeWindow` first and removes the rules only once the window is gone
 *   (windowRemoved/tabRemoved, a failed closeWindow, startup), so rehearsal blocks stay in force
 *   while the popup can still send anything.
 */
import { firstGuess, type ScreenAvail, windowFit } from '../geometry/window-fit.ts';
import { type ProbeReport, preflightOf } from '../ig-contract/contract.ts';
import { isChromeMajor, uaRule } from '../ig-contract/device-profile.ts';
import { evaluateProbe } from '../ig-contract/probe-eval.ts';
import { rehearsalRules, SESSION_RULE_IDS } from '../ig-contract/rules.ts';
import { COMPOSER_URL, classifyComposerUrl, igPath, isComposerUrl, type UrlVerdict } from '../ig-contract/urls.ts';
import { newId } from '../model/ids.ts';
import {
  type ActiveState,
  type AgentEventName,
  CLOSE_DELAY_MS,
  type ErrorCode,
  type HandoffCtx,
  type HandoffEffect,
  type HandoffEvent,
  type HandoffLevel,
  type HandoffOutcome,
  type HandoffRecord,
  type HandoffState,
  type HandoffStatus,
  type IdleState,
  INACTIVITY_TIMEOUT_MS,
  INJECT_READY_TIMEOUT_MS,
  isArmed,
  MSITE_LOCK_MS,
  NAVIGATION_TIMEOUT_MS,
  type PhaseLogEntry,
  type ProbeStep,
  type SessionBase,
  type SessionResult,
  type WindowedSession,
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
type Finished = Extract<ActiveState, { phase: 'finished' }>;
type TabUpdated = Extract<HandoffEvent, { type: 'tabUpdated' }>;

const none = (state: HandoffState): Transition => ({ state, effects: [] });

export function handoffReducer(state: HandoffState, event: HandoffEvent, ctx: HandoffCtx): Transition {
  const out = dispatch(state, event, ctx);
  // Inactivity is measured from the last event that changed the session.
  if (out.state !== state && out.state.phase !== 'idle' && event.type !== 'timer') {
    return { state: { ...out.state, lastEventAt: ctx.now }, effects: out.effects };
  }
  return out;
}

function dispatch(state: HandoffState, event: HandoffEvent, ctx: HandoffCtx): Transition {
  if (event.type === 'startup') return onStartup(state, ctx);
  if (state.phase === 'idle') return onIdle(state, event, ctx);
  if (event.type === 'start') return refuse(state, 'HANDOFF_BUSY');
  if (state.phase === 'opening') return onOpening(state, event, ctx);
  if (state.phase === 'closing') return onClosing(state, event, ctx);
  return onWindowed(state, event, ctx);
}

// ---------------------------------------------------------------------------------------
// Small builders.

const isId = (n: number): boolean => Number.isInteger(n) && n >= 0;
const removeRules = (): HandoffEffect => ({ type: 'removeRules', ruleIds: [...SESSION_RULE_IDS] });
const clearTimers = (): HandoffEffect[] => [
  { type: 'clearTimer', timer: 'inactivity' },
  { type: 'clearTimer', timer: 'closeDelay' },
  { type: 'clearTimer', timer: 'navigation' },
];
const watch = (tabId: number, readyTimeoutMs: number): HandoffEffect => ({
  type: 'sendAgent',
  tabId,
  command: { type: 'agent/watch', readyTimeoutMs },
});

function logPhase(s: SessionBase, phase: PhaseLogEntry['phase'], now: number): PhaseLogEntry[] {
  return s.phaseLog.at(-1)?.phase === phase ? s.phaseLog : [...s.phaseLog, { phase, t: now }];
}

function base(s: SessionBase): SessionBase {
  return {
    handoffId: s.handoffId,
    nonce: s.nonce,
    mode: s.mode,
    exportId: s.exportId,
    rehearsal: s.rehearsal,
    assistedInsert: s.assistedInsert,
    chMode: s.chMode,
    chromeMajor: s.chromeMajor,
    screen: s.screen,
    startedAt: s.startedAt,
    lastEventAt: s.lastEventAt,
    phaseLog: s.phaseLog,
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
    level: s.level,
    degradedFrom: s.degradedFrom,
    offhostSeen: s.offhostSeen,
    hardReloadSent: s.hardReloadSent,
    injectSent: s.injectSent,
    fileServed: s.fileServed,
    insertDispatched: s.insertDispatched,
    loadsSinceReload: s.loadsSinceReload,
    composerReached: s.composerReached,
    route: s.route,
    url: s.url,
  };
}

function status(s: ActiveState, extra: Partial<HandoffStatus> = {}): HandoffStatus {
  const w = s.phase !== 'opening' && s.phase !== 'closing' ? s : null;
  return {
    handoffId: s.handoffId,
    phase: s.phase,
    level: s.phase === 'opening' ? null : s.level,
    // AM21: the switches this session runs with, so the panel never shows later setting edits.
    rehearsal: s.rehearsal,
    assistedInsert: s.assistedInsert,
    ...(w?.fakeBanner ? { banner: 'FAKE_INSTAGRAM' as const } : {}),
    ...(w?.route ? { route: w.route } : {}),
    ...(s.phase === 'finished' && s.holdOpen ? { holdOpen: true } : {}),
    ...(s.phase === 'finished' && s.postedUnknown ? { postedUnknown: true } : {}),
    ...extra,
  };
}

const notify = (s: ActiveState, extra?: Partial<HandoffStatus>): HandoffEffect => ({
  type: 'notifyEditor',
  status: status(s, extra),
});

function errorOf(result: SessionResult): ErrorCode | undefined {
  return result.kind === 'failed' || result.kind === 'killed' ? result.code : undefined;
}

function outcomeOf(result: SessionResult): HandoffOutcome {
  switch (result.kind) {
    case 'finished':
      return result.detectedPosted ? 'posted-confirmed' : 'not-posted';
    case 'probe-done':
      return 'not-posted';
    case 'cancelled':
      return 'abandoned';
    case 'failed':
      return `failed:${result.code}`;
    case 'killed':
      return `killed:${result.code}`;
  }
}

/** Outcomes the owner's "Posted?" answer may overwrite; failures and kills are kept. */
const answerable = (o: HandoffOutcome): boolean => o === 'posted-confirmed' || o === 'not-posted' || o === 'abandoned';

function record(
  s: SessionBase & Partial<WindowedSession>,
  phaseLog: PhaseLogEntry[],
  outcome: HandoffOutcome,
  now: number,
  detail?: string,
): HandoffRecord {
  const probe = s.probe ?? null;
  const ready = s.readyProbe ?? null;
  return {
    id: s.handoffId,
    exportId: s.exportId,
    mode: s.mode,
    level: s.level ?? null,
    rehearsal: s.rehearsal,
    chMode: s.chMode,
    phaseLog,
    ...(probe ? { probe, preflight: preflightOf(probe, s.url ?? undefined, s.route ?? null, ready) } : {}),
    ...(ready ? { readyProbe: ready } : {}),
    ...(s.route ? { route: s.route } : {}),
    ...(detail ? { detail } : {}),
    outcome,
    startedAt: s.startedAt,
    endedAt: now,
  };
}

/**
 * A refused start never touches the state: a busy session carries on, an idle one stays idle.
 * `handoffId: null` marks the status as describing the refused start, not the active session.
 */
function refuse(state: HandoffState, error: ErrorCode, extra: Partial<HandoffStatus> = {}): Transition {
  return {
    state,
    effects: [{ type: 'notifyEditor', status: { handoffId: null, phase: 'idle', level: null, error, ...extra } }],
  };
}

// ---------------------------------------------------------------------------------------
// idle

function onIdle(s: IdleState, e: HandoffEvent, ctx: HandoffCtx): Transition {
  switch (e.type) {
    case 'start':
      return start(s, e, ctx);
    case 'outcome': {
      const last = s.last;
      if (!last || last.handoffId !== e.handoffId || !answerable(last.outcome)) return none(s);
      const outcome: HandoffOutcome = e.posted ? 'posted-confirmed' : 'not-posted';
      if (outcome === last.outcome) return none(s);
      return {
        state: { phase: 'idle', last: { ...last, outcome } },
        effects: [{ type: 'patchRecordOutcome', handoffId: last.handoffId, outcome }],
      };
    }
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

function validScreen(sc: ScreenAvail): boolean {
  return [sc.availLeft, sc.availTop, sc.availWidth, sc.availHeight].every(Number.isFinite);
}

function start(s: IdleState, e: Extract<HandoffEvent, { type: 'start' }>, ctx: HandoffCtx): Transition {
  // AM23 (SG4, network-free): a guarded build in a branded browser profile is the G6 mistake; the
  // DOM marker check would come only after a spoofed visit to whatever that profile is logged in to.
  if (ctx.guarded && ctx.brandedBrowser) return refuse(s, 'BRANDED_BROWSER');
  const lockedUntil = ctx.settings.msiteLockedUntil;
  if (lockedUntil !== null && ctx.now < lockedUntil) return refuse(s, 'MSITE_LOCKED', { freeAt: lockedUntil });
  if (!ctx.rate.ok) return refuse(s, 'RATE_LIMITED', { freeAt: ctx.rate.freeAt });
  if (!isChromeMajor(ctx.chromeMajor)) {
    return refuse(s, 'AGENT_UNREACHABLE', { detail: `invalid chromeMajor ${ctx.chromeMajor}` });
  }
  const guess = validScreen(e.screen) ? firstGuess(e.screen, ctx.settings.composerProfile) : null;
  if (!guess?.ok) return refuse(s, 'SCREEN_TOO_SMALL');

  const now = ctx.now;
  const next: Opening = {
    phase: 'opening',
    handoffId: newId('handoff', ctx.uuid),
    nonce: ctx.uuid(),
    mode: e.mode,
    exportId: e.exportId,
    rehearsal: e.rehearsal,
    // H1 needs a file: probe mode, or a post without a saved export, can only ever be H0.
    assistedInsert: ctx.settings.assistedInsert && e.mode === 'post' && e.exportId !== null,
    chMode: ctx.settings.chMode,
    chromeMajor: ctx.chromeMajor,
    screen: { ...e.screen },
    startedAt: now,
    lastEventAt: now,
    phaseLog: [{ phase: 'opening', t: now }],
  };
  return {
    state: next,
    effects: [
      { type: 'noteOpen', t: now },
      { type: 'openWindow', box: guess.outer },
      { type: 'armTimer', timer: 'inactivity', ms: INACTIVITY_TIMEOUT_MS },
      notify(next),
    ],
  };
}

// ---------------------------------------------------------------------------------------
// startup and the ends of a session

function onStartup(s: HandoffState, ctx: HandoffCtx): Transition {
  if (s.phase === 'idle') return { state: s, effects: [removeRules(), ...clearTimers()] };
  const windowId = s.phase === 'opening' ? null : s.windowId;
  const close: HandoffEffect[] = windowId !== null ? [{ type: 'closeWindow', windowId }] : [];
  return endNow(s, { kind: 'cancelled' }, ctx, close);
}

/**
 * Ends a session at once (the window is gone, never opened, or is being closed by `pre`):
 * remove the rules, clear the timers, write the record unless it exists, go idle.
 */
function endNow(
  s: ActiveState,
  result: SessionResult,
  ctx: HandoffCtx,
  pre: HandoffEffect[] = [],
  detail?: string,
): Transition {
  const outcome = s.phase === 'closing' || s.phase === 'finished' ? s.outcome : outcomeOf(result);
  const error = s.phase === 'closing' ? errorOf(s.result) : errorOf(result);
  const phaseLog = logPhase(s, 'idle', ctx.now);
  const effects: HandoffEffect[] = [...pre, removeRules(), ...clearTimers(), { type: 'forgetWindow' }];
  if (s.phase !== 'closing' && s.phase !== 'finished') {
    effects.push({ type: 'writeRecord', record: record(s, phaseLog, outcome, ctx.now, detail) });
  }
  effects.push({
    type: 'notifyEditor',
    status: {
      handoffId: s.handoffId,
      phase: 'idle',
      level: s.phase === 'opening' ? null : s.level,
      ...(error ? { error } : {}),
      ...(detail ? { detail } : {}),
    },
  });
  return { state: { phase: 'idle', last: { handoffId: s.handoffId, outcome, endedAt: ctx.now } }, effects };
}

/** Closes the popup: closeWindow first, then (kill) the lock, the status and the record. */
function close(s: Windowed, result: SessionResult, ctx: HandoffCtx, extra: Partial<HandoffStatus> = {}): Transition {
  const now = ctx.now;
  const detail = extra.detail;
  const killed = result.kind === 'killed';
  const error = errorOf(result);
  const phaseLog = logPhase(s, 'closing', now);
  const written = s.phase === 'finished';
  // After `finished` the record exists: a kill still overrides its outcome, anything else keeps it.
  const outcome = written && !killed ? s.outcome : outcomeOf(result);
  const next: Closing = {
    ...base(s),
    phase: 'closing',
    phaseLog,
    windowId: s.windowId,
    tabId: s.tabId,
    result,
    level: s.level,
    outcome,
  };
  const effects: HandoffEffect[] = [{ type: 'closeWindow', windowId: s.windowId }];
  if (killed) effects.push({ type: 'lockMsite', until: now + MSITE_LOCK_MS });
  // `closing` keeps no banner flag: carry it on this last status (a live probe run on the fake).
  const banner = s.fakeBanner ? { banner: 'FAKE_INSTAGRAM' as const } : {};
  effects.push(notify(next, { ...banner, ...(error ? { error } : {}), ...extra }));
  if (!written) effects.push({ type: 'writeRecord', record: record(s, phaseLog, outcome, now, detail) });
  else if (killed) effects.push({ type: 'patchRecordOutcome', handoffId: s.handoffId, outcome });
  return { state: next, effects };
}

const fail = (s: Windowed, code: ErrorCode, ctx: HandoffCtx, extra: Partial<HandoffStatus> = {}): Transition =>
  close(s, { kind: 'failed', code }, ctx, extra);

/** Share may have been tapped: the composer was ready (or a re-probe interrupted that phase). */
const afterShare = (s: Windowed): boolean =>
  s.phase === 'awaitingShare' || (s.phase === 'probing' && s.resumeFrom === 'awaitingShare');

/**
 * AM18: the composer is in use, so leaving it is C9. A file reached it: C6 held (awaitingShare), the
 * H1 file was served (the insert may still be landing), or (AM28) the insert was dispatched and C6
 * never confirmed it, so the owner may share it from H0. Not engaged, `/` is only C5 (homeOnly).
 * A probe after a new document was detected (resumeFrom null) is never engaged.
 */
function engaged(s: Windowed): boolean {
  if (afterShare(s)) return true;
  const from = s.phase === 'probing' ? s.resumeFrom : s.phase;
  if (from === 'injecting') return s.fileServed;
  if (from === 'awaitingPick') return s.insertDispatched;
  return false;
}

/** AM17: the path an unexpected page names (query and fragment dropped), for the status and the record. */
const pageOf = (url: string | undefined): string => (url !== undefined ? igPath(url) : null) ?? '?';

/**
 * C9 (the URL leaving /create/story, or the agent's composer-left) once engaged: record with the
 * detected answer. `unexpected` (AM17): the path of the unknown www page the tab went to, so nothing
 * is pre-answered and the status says why. AM19: after Share in a post with rehearsal off the popup
 * is held open (an upload may still run in it); otherwise it closes in 3 s. AM28: after an
 * unconfirmed insert (no Share detected, but one may have happened) "Posted?" has no pre-answer and
 * a post is held open whatever rehearsal says, so neither an upload nor an H0 retry is cut off.
 */
function finish(s: Windowed, ctx: HandoffCtx, unexpected: string | null = null): Transition {
  if (s.phase === 'finished') return none(s);
  const shared = afterShare(s);
  const unconfirmed = !shared && s.insertDispatched;
  const detectedPosted = shared && unexpected === null;
  const postedUnknown = (shared && unexpected !== null) || unconfirmed;
  const holdOpen = s.mode === 'post' && ((shared && !s.rehearsal) || unconfirmed);
  const outcome = outcomeOf({ kind: 'finished', detectedPosted });
  const phaseLog = logPhase(s, 'finished', ctx.now);
  const next: Finished = {
    ...common(s),
    phase: 'finished',
    phaseLog,
    detectedPosted,
    postedUnknown,
    unexpectedPage: unexpected,
    outcome,
    holdOpen,
  };
  const why = unexpected !== null ? { error: 'UNEXPECTED_PAGE' as const, detail: `page ${unexpected}` } : {};
  const detail =
    unexpected !== null
      ? `UNEXPECTED_PAGE ${unexpected}`
      : unconfirmed
        ? 'insert not confirmed (no C6): posted unknown'
        : undefined;
  const effects: HandoffEffect[] = [
    notify(next, { detectedPosted, ...why }),
    { type: 'writeRecord', record: record(next, phaseLog, outcome, ctx.now, detail) },
  ];
  if (!holdOpen) effects.push({ type: 'armTimer', timer: 'closeDelay', ms: CLOSE_DELAY_MS });
  return { state: next, effects };
}

// ---------------------------------------------------------------------------------------
// opening (no window yet) and closing (window close requested)

function onOpening(s: Opening, e: HandoffEvent, ctx: HandoffCtx): Transition {
  switch (e.type) {
    case 'windowCreated': {
      if (!isId(e.windowId) || !isId(e.tabId)) {
        const pre: HandoffEffect[] = isId(e.windowId) ? [{ type: 'closeWindow', windowId: e.windowId }] : [];
        const detail = `windowCreated: invalid ids ${e.windowId}/${e.tabId}`;
        return endNow(s, { kind: 'failed', code: 'AGENT_UNREACHABLE' }, ctx, pre, detail);
      }
      const next: Windowed = {
        ...base(s),
        phase: 'scoping',
        phaseLog: logPhase(s, 'scoping', ctx.now),
        windowId: e.windowId,
        tabId: e.tabId,
        frameDelta: null,
        refitUsed: false,
        probe: null,
        readyProbe: null,
        fakeBanner: false,
        level: null,
        degradedFrom: null,
        offhostSeen: false,
        hardReloadSent: false,
        injectSent: false,
        fileServed: false,
        insertDispatched: false,
        loadsSinceReload: 0,
        composerReached: false,
        route: null,
        url: null,
      };
      // Installed while the tab is still about:blank, before the first navigation (§3.6 step 2).
      const addRules = [uaRule(e.tabId, s.chromeMajor, s.chMode), ...(s.rehearsal ? rehearsalRules(e.tabId) : [])];
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
      return endNow(s, { kind: 'failed', code: 'AGENT_UNREACHABLE' }, ctx, [], `openWindow: ${e.message}`);
    case 'cancel': {
      // The window does not exist yet: wait in `closing` for windowCreated, then close it.
      const phaseLog = logPhase(s, 'closing', ctx.now);
      const result: SessionResult = { kind: 'cancelled' };
      const outcome = outcomeOf(result);
      const next: Closing = {
        ...base(s),
        phase: 'closing',
        phaseLog,
        windowId: null,
        tabId: null,
        result,
        level: null,
        outcome,
      };
      return {
        state: next,
        effects: [notify(next), { type: 'writeRecord', record: record(s, phaseLog, outcome, ctx.now) }],
      };
    }
    case 'timer':
      if (e.timer !== 'inactivity') return none(s);
      return inactivity(s, ctx, () => endNow(s, { kind: 'failed', code: 'TIMEOUT' }, ctx));
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
      return e.timer === 'inactivity' ? endNow(s, s.result, ctx) : none(s);
    case 'outcome': {
      if (e.handoffId !== s.handoffId || !answerable(s.outcome)) return none(s);
      const outcome: HandoffOutcome = e.posted ? 'posted-confirmed' : 'not-posted';
      if (outcome === s.outcome) return none(s);
      return {
        state: { ...s, outcome },
        effects: [{ type: 'patchRecordOutcome', handoffId: s.handoffId, outcome }],
      };
    }
    default:
      return none(s);
  }
}

/** The inactivity timer fired: time out after 15 min without a state change, else re-arm for the rest. */
function inactivity(s: ActiveState, ctx: HandoffCtx, timeout: () => Transition): Transition {
  const quiet = ctx.now - s.lastEventAt;
  if (quiet >= INACTIVITY_TIMEOUT_MS) return timeout();
  return { state: s, effects: [{ type: 'armTimer', timer: 'inactivity', ms: INACTIVITY_TIMEOUT_MS - quiet }] };
}

// ---------------------------------------------------------------------------------------
// windowed phases

function onWindowed(s: Windowed, e: HandoffEvent, ctx: HandoffCtx): Transition {
  switch (e.type) {
    case 'tabUpdated':
      return e.tabId === s.tabId ? onTabUpdated(s, e, ctx) : none(s);
    case 'windowRemoved':
      return e.windowId === s.windowId ? endNow(s, { kind: 'cancelled' }, ctx) : none(s);
    case 'tabRemoved':
      return e.tabId === s.tabId ? endNow(s, { kind: 'cancelled' }, ctx) : none(s);
    case 'cancel':
      return s.phase === 'finished' ? closeFinished(s, ctx) : close(s, { kind: 'cancelled' }, ctx);
    case 'outcome': {
      if (s.phase !== 'finished' || e.handoffId !== s.handoffId) return none(s);
      const outcome: HandoffOutcome = e.posted ? 'posted-confirmed' : 'not-posted';
      const patch: HandoffEffect[] =
        outcome === s.outcome ? [] : [{ type: 'patchRecordOutcome', handoffId: s.handoffId, outcome }];
      const answered: Finished = { ...s, outcome };
      // AM19: a popup held open for its upload closes once the owner has answered.
      if (s.holdOpen) {
        const closing = closeFinished(answered, ctx);
        return { state: closing.state, effects: [...closing.effects, ...patch] };
      }
      return patch.length === 0 ? none(s) : { state: answered, effects: patch };
    }
    case 'timer':
      if (e.timer === 'closeDelay') return s.phase === 'finished' ? closeFinished(s, ctx) : none(s);
      if (e.timer === 'navigation') return s.phase === 'navigating' ? navigationDeadline(s, ctx) : none(s);
      return inactivity(s, ctx, () => {
        if (s.phase === 'finished') return closeFinished(s, ctx);
        // AM20: the backstop for a navigation deadline lost with a worker restart; an off-host load still kills.
        if (s.phase === 'navigating' && s.offhostSeen) return close(s, { kind: 'killed', code: 'KILLED_OFFHOST' }, ctx);
        return fail(s, 'TIMEOUT', ctx);
      });
    case 'effectFailed':
      return onEffectFailed(s, e, ctx);
    case 'rulesInstalled':
      if (s.phase !== 'scoping') return none(s);
      return to(s, 'fitting', ctx, {}, [{ type: 'measureTab', tabId: s.tabId, windowId: s.windowId }]);
    case 'tabMeasured':
      return onTabMeasured(s, e, ctx);
    case 'windowFitted':
      if (s.phase === 'fitting' && s.frameDelta !== null) {
        return to(s, 'navigating', ctx, {}, [
          { type: 'navigate', tabId: s.tabId, url: COMPOSER_URL },
          { type: 'armTimer', timer: 'navigation', ms: NAVIGATION_TIMEOUT_MS },
        ]);
      }
      if (s.phase === 'probing' && s.step === 'refitUpdate') return probeStep(s, 'awaitReport', probeCmd(s));
      return none(s);
    case 'agentInjected':
      if (s.phase === 'probing' && s.step === 'injectAgent') return onInjected(s, e.fresh !== false, ctx);
      return none(s);
    case 'agentReport':
      if (s.phase === 'probing' && s.step === 'awaitReport') return onReport(s, e.probe, ctx);
      // AM13: the C8 report asked for at composer-ready; diagnostics only, never a decision.
      if (s.phase === 'awaitingShare') {
        const next: Windowed = { ...s, readyProbe: e.probe };
        return { state: next, effects: [notify(next, { probe: e.probe })] };
      }
      return none(s);
    case 'agentGetFile':
      if (s.phase !== 'injecting' || s.fileServed || s.exportId === null) return none(s);
      return { state: { ...s, fileServed: true }, effects: [{ type: 'serveFile', exportId: s.exportId }] };
    case 'agentEvent':
      return onAgentEvent(s, e.event, ctx);
    default:
      return none(s);
  }
}

/** Moves to a non-probing windowed phase, logging it and notifying the editor. */
function to(
  s: Windowed,
  phase: 'fitting' | 'navigating' | 'reloading',
  ctx: HandoffCtx,
  patch: Partial<WindowedSession>,
  actions: HandoffEffect[],
): Transition {
  const next: Windowed = { ...common(s), ...patch, phase, phaseLog: logPhase(s, phase, ctx.now) };
  return { state: next, effects: [...actions, notify(next)] };
}

const probeCmd = (s: Windowed): HandoffEffect[] => [
  { type: 'sendAgent', tabId: s.tabId, command: { type: 'agent/probe' } },
];

function probeStep(s: Probing, step: ProbeStep, effects: HandoffEffect[]): Transition {
  return { state: { ...s, step }, effects };
}

/** Enters `probing` (first probe, or an AM2 re-probe) and notifies the editor. */
function toProbing(
  s: Windowed,
  ctx: HandoffCtx,
  fields: Pick<Probing, 'step' | 'strict' | 'resumeFrom' | 'amLoad' | 'pending'>,
  patch: Partial<WindowedSession>,
  actions: HandoffEffect[],
): Transition {
  const next: Probing = {
    ...common(s),
    ...patch,
    phase: 'probing',
    phaseLog: logPhase(s, 'probing', ctx.now),
    ...fields,
  };
  return { state: next, effects: [...actions, notify(next)] };
}

function closeFinished(s: Finished, ctx: HandoffCtx): Transition {
  return close(s, { kind: 'finished', detectedPosted: s.detectedPosted }, ctx);
}

function onTabMeasured(s: Windowed, e: Extract<HandoffEvent, { type: 'tabMeasured' }>, ctx: HandoffCtx): Transition {
  const measuring =
    (s.phase === 'fitting' && s.frameDelta === null) || (s.phase === 'probing' && s.step === 'refitMeasure');
  if (!measuring) return none(s);
  const delta = { w: Math.max(0, e.outer.width - e.inner.w), h: Math.max(0, e.outer.height - e.inner.h) };
  if (!Number.isFinite(delta.w) || !Number.isFinite(delta.h)) return fail(s, 'SCREEN_TOO_SMALL', ctx);
  const fit = windowFit(s.screen, delta, ctx.settings.composerProfile);
  if (!fit.ok) return fail(s, 'SCREEN_TOO_SMALL', ctx);
  const update: HandoffEffect = { type: 'updateWindow', windowId: s.windowId, box: fit.outer };
  if (s.phase === 'probing') return { state: { ...s, frameDelta: delta, step: 'refitUpdate' }, effects: [update] };
  return { state: { ...s, frameDelta: delta }, effects: [update] };
}

// ---------------------------------------------------------------------------------------
// tabs.onUpdated: the first navigation, the hard reload, the kill switch (§3.6) and AM2 re-probes

function onTabUpdated(s: Windowed, e: TabUpdated, ctx: HandoffCtx): Transition {
  if (!isArmed(s)) return s.phase === 'navigating' ? onNavigating(s, e, ctx) : none(s);

  const verdict = classifyComposerUrl(e.url);
  if (verdict.kind === 'stop') return fail(s, verdict.code, ctx);
  if (verdict.kind === 'kill') return close(s, { kind: 'killed', code: verdict.code }, ctx);
  if (s.phase === 'finished') return none(s);
  const url = e.url ?? null;
  if (s.phase === 'reloading') return onReloading(s, e, url, verdict, ctx);
  // AM17: fail closed on any www page that is neither the composer, home, login nor a security flow.
  if (verdict.kind === 'unknown-left') {
    const page = pageOf(e.url);
    return engaged(s) ? finish(s, ctx, page) : fail(s, 'UNEXPECTED_PAGE', ctx, { detail: `page ${page}` });
  }
  // AM18: home counts as C9 only once the composer was in use.
  if (verdict.kind === 'composer-left' && engaged(s)) return finish(s, ctx);

  // Still in the session: on the composer, or home before the composer was used (C5 then fails).
  const home = verdict.kind === 'composer-left';
  const seen: Windowed = {
    ...s,
    url,
    composerReached: s.composerReached || verdict.kind === 'ok',
    route: home && s.route === 'direct' ? 'homeOnly' : s.route,
  };
  const routed = seen.route !== s.route;
  if (e.status === 'loading') {
    // AM2/AM16: a commit (a new document, or pushState/replaceState). Re-inject; `fresh` tells which.
    const loads = s.loadsSinceReload + 1;
    if (seen.phase === 'probing' && seen.step === 'awaitComplete') {
      return { state: { ...seen, loadsSinceReload: loads }, effects: routed ? [notify(seen)] : [] };
    }
    const fields: Pick<Probing, 'step' | 'strict' | 'resumeFrom' | 'amLoad' | 'pending'> = {
      step: 'awaitComplete',
      strict: seen.phase === 'probing' ? seen.strict : false,
      resumeFrom: resumeOf(seen),
      amLoad: true,
      // Events buffered for the interrupted phase survive a second load before the injection.
      pending: seen.phase === 'probing' ? seen.pending : [],
    };
    return toProbing(seen, ctx, fields, { loadsSinceReload: loads }, []);
  }
  if (e.status === 'complete' && seen.phase === 'probing' && seen.step === 'awaitComplete') {
    const t = probeStep(seen, 'injectAgent', [{ type: 'injectAgent', tabId: s.tabId }]);
    return routed ? { state: t.state, effects: [...t.effects, notify(t.state as Probing)] } : t;
  }
  // AM18: the composer went away before the insert landed: H0 from home (one inject, never a second).
  if (home && seen.phase === 'injecting') return toPick(seen, 'INJECTION_IGNORED', ctx);
  if (routed) return { state: seen, effects: [notify(seen)] };
  return changed(s, seen);
}

/**
 * AM20: the first navigation (`navigating`, kill switch not yet armed). The first `loading` on www
 * arms the switch and triggers the one hard reload (§3.6 step 5). Before that, every update is
 * classified too, so a first load redirected off www is killed instead of waiting 15 minutes:
 * - a visible URL that is not www (i.instagram.com, http:, an error page we can see) → kill;
 * - a hidden URL with no status: the tab's URL or title changed to a page this extension may not
 *   see (accountscenter, facebook.com) → kill;
 * - a hidden URL with a status: about:blank's own load, or an off-host commit; `offhostSeen`, and the
 *   navigation deadline (30 s) kills if no www commit follows, else closes with TIMEOUT.
 */
function onNavigating(s: Windowed, e: TabUpdated, ctx: HandoffCtx): Transition {
  if (e.url === undefined || e.url === 'about:blank') {
    if (e.url === undefined && e.status === undefined) {
      return close({ ...s, url: null }, { kind: 'killed', code: 'KILLED_OFFHOST' }, ctx);
    }
    return s.offhostSeen ? none(s) : { state: { ...s, offhostSeen: true }, effects: [] };
  }
  const verdict = classifyComposerUrl(e.url);
  const seen: Windowed = { ...s, url: e.url };
  if (verdict.kind === 'kill') return close(seen, { kind: 'killed', code: verdict.code }, ctx);
  if (verdict.kind === 'stop') return fail(seen, verdict.code, ctx);
  if (e.status !== 'loading') return none(s);
  // AM17: never reload or probe an unexpected page; `/` stays allowed (a desktop first load may 302 there).
  if (verdict.kind === 'unknown-left') return fail(seen, 'UNEXPECTED_PAGE', ctx, { detail: `page ${pageOf(e.url)}` });
  if (s.hardReloadSent) return none(s);
  return to(s, 'reloading', ctx, { url: e.url, hardReloadSent: true, loadsSinceReload: 0 }, [
    { type: 'hardReload', tabId: s.tabId },
    { type: 'clearTimer', timer: 'navigation' },
  ]);
}

/** The navigation deadline passed with no www commit (AM20; its own code since AM28, not the 15 min TIMEOUT). */
function navigationDeadline(s: Windowed, ctx: HandoffCtx): Transition {
  return s.offhostSeen ? close(s, { kind: 'killed', code: 'KILLED_OFFHOST' }, ctx) : fail(s, 'NAVIGATION_TIMEOUT', ctx);
}

/** Waits for the reload's own commit, then its `complete` (an earlier `complete` is the SW-served first load). */
function onReloading(s: Windowed, e: TabUpdated, url: string | null, verdict: UrlVerdict, ctx: HandoffCtx): Transition {
  // AM17: the reload landed on an unexpected www page: never inject there.
  if (verdict.kind === 'unknown-left') {
    return fail({ ...s, url }, 'UNEXPECTED_PAGE', ctx, { detail: `page ${pageOf(e.url)}` });
  }
  if (e.status === 'loading') return { state: { ...s, url, loadsSinceReload: s.loadsSinceReload + 1 }, effects: [] };
  if (e.status !== 'complete' || s.loadsSinceReload < 1) return changed(s, { ...s, url });
  const direct = isComposerUrl(e.url);
  return toProbing(
    s,
    ctx,
    // A second commit before this `complete` is already a "later" load (AM2): strict.
    { step: 'injectAgent', strict: s.loadsSinceReload > 1, resumeFrom: null, amLoad: false, pending: [] },
    { url, route: direct ? 'direct' : 'homeOnly', composerReached: direct },
    [{ type: 'injectAgent', tabId: s.tabId }],
  );
}

/** The post-probe phase an AM2 re-probe interrupts (kept across repeated loads). */
function resumeOf(s: Windowed): Probing['resumeFrom'] {
  switch (s.phase) {
    case 'probing':
      return s.resumeFrom;
    case 'injecting':
    case 'awaitingPick':
    case 'awaitingShare':
      return s.phase;
    default:
      return null;
  }
}

/** Keeps the old object when nothing observable changed. */
function changed(s: Windowed, next: Windowed): Transition {
  return next.url === s.url && next.composerReached === s.composerReached ? none(s) : { state: next, effects: [] };
}

/**
 * The agent is in the document (AM16). After a `loading` of the armed tab, `fresh: false` means the
 * same document (pushState, replaceState, hash): nothing new to probe, so the interrupted phase
 * resumes as it was. A fresh agent means a new document: probe it, strictly (AM2). AM28: the
 * interrupted phase belonged to the old document, so it is dropped here (resumeFrom null): Share
 * and the insert happened there, not in this one, and a later same-document load re-probes instead
 * of resuming a phase whose agent and watch are gone. An interrupted H1 counts as INJECTION_IGNORED.
 */
function onInjected(s: Probing, fresh: boolean, ctx: HandoffCtx): Transition {
  if (s.amLoad && !fresh && s.resumeFrom !== null) return resume(s, ctx);
  if (s.amLoad && fresh) {
    const degradedFrom = s.resumeFrom === 'injecting' ? 'INJECTION_IGNORED' : s.degradedFrom;
    const next: Probing = {
      ...s,
      step: 'awaitReport',
      strict: true,
      resumeFrom: null,
      degradedFrom,
      insertDispatched: false,
      pending: [],
    };
    return { state: next, effects: probeCmd(s) };
  }
  return { state: { ...s, step: 'awaitReport', pending: [] }, effects: probeCmd(s) };
}

/** AM16: back to the phase a same-document load interrupted; then the agent events it buffered. */
function resume(s: Probing, ctx: HandoffCtx): Transition {
  const from = s.resumeFrom;
  const phaseLog = logPhase(s, from ?? 'probing', ctx.now);
  let t: Transition;
  if (from === 'injecting' && !s.fileServed && !isComposerUrl(s.url ?? undefined)) {
    // AM18: the composer went away before the insert landed (a client-side redirect home).
    t = toPick(s, 'INJECTION_IGNORED', ctx);
  } else if (from === 'injecting') {
    const next: Windowed = { ...common(s), phase: 'injecting', level: 'H1', phaseLog };
    t = { state: next, effects: [notify(next)] };
  } else if (from === 'awaitingPick') {
    const next: Windowed = { ...common(s), phase: 'awaitingPick', level: 'H0', degradedFrom: s.degradedFrom, phaseLog };
    t = { state: next, effects: [notify(next)] };
  } else {
    const next: Windowed = { ...common(s), phase: 'awaitingShare', level: s.level ?? 'H0', phaseLog };
    t = { state: next, effects: [notify(next)] };
  }
  let state = t.state;
  const effects = [...t.effects];
  for (const ev of s.pending) {
    if (state.phase === 'idle' || state.phase === 'opening' || state.phase === 'closing') break;
    const r = onAgentEvent(state, ev, ctx);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

// ---------------------------------------------------------------------------------------
// the probe report (§3.6 step 7)

function onReport(s: Probing, probe: ProbeReport, ctx: HandoffCtx): Transition {
  const ev = evaluateProbe({
    probe,
    guarded: ctx.guarded,
    mode: s.mode,
    assistedInsert: s.assistedInsert,
    url: s.url ?? undefined,
    refitUsed: s.refitUsed,
    strict: s.strict,
  });
  const p: Probing = { ...s, probe, fakeBanner: s.fakeBanner || ev.banner };
  const d = ev.decision;
  switch (d.kind) {
    case 'fail':
      return fail(p, d.code, ctx, { probe });
    case 'probe-done':
      return close(p, { kind: 'probe-done' }, ctx, { probe });
    case 'refit':
      return {
        state: { ...p, refitUsed: true, step: 'refitMeasure' },
        effects: [{ type: 'measureTab', tabId: s.tabId, windowId: s.windowId }],
      };
    case 'h0':
    case 'h1': {
      if (s.level !== null) {
        // A passing re-probe: never re-inject, never upgrade; carry on as H0 in the new document
        // (an interrupted H1 was marked INJECTION_IGNORED when the document was found new).
        return toPick(p, s.degradedFrom, ctx, { probe });
      }
      const canInject = d.kind === 'h1' && !s.injectSent && s.mode === 'post' && s.exportId !== null;
      if (!canInject) return toPick(p, d.kind === 'h0' ? d.reason : null, ctx, { probe });
      const phaseLog = logPhase(p, 'injecting', ctx.now);
      const next: Windowed = { ...common(p), phase: 'injecting', level: 'H1', injectSent: true, phaseLog };
      return {
        state: next,
        effects: [
          watch(s.tabId, INJECT_READY_TIMEOUT_MS),
          { type: 'sendAgent', tabId: s.tabId, command: { type: 'agent/inject' } },
          notify(next, { probe }),
        ],
      };
    }
  }
}

/** H0: the owner taps + → Story and picks the file; the agent only watches (no deadline). */
function toPick(
  s: Windowed,
  degradedFrom: ErrorCode | null,
  ctx: HandoffCtx,
  extra: Partial<HandoffStatus> = {},
): Transition {
  const phaseLog = logPhase(s, 'awaitingPick', ctx.now);
  const next: Windowed = { ...common(s), phase: 'awaitingPick', level: 'H0', degradedFrom, phaseLog };
  return {
    state: next,
    effects: [watch(s.tabId, 0), notify(next, { ...(degradedFrom ? { error: degradedFrom } : {}), ...extra })],
  };
}

/** At most this many distinct agent events are buffered across a same-document re-injection. */
const MAX_PENDING_EVENTS = 8;

function onAgentEvent(s: Windowed, event: AgentEventName, ctx: HandoffCtx): Transition {
  if (s.phase === 'probing') {
    // AM16: until `fresh` is known, an event may belong to the phase this load interrupted.
    const waiting = s.resumeFrom !== null && (s.step === 'awaitComplete' || s.step === 'injectAgent');
    if (!waiting || s.pending.includes(event) || s.pending.length >= MAX_PENDING_EVENTS) return none(s);
    return { state: { ...s, pending: [...s.pending, event] }, effects: [] };
  }
  const watching = s.phase === 'injecting' || s.phase === 'awaitingPick' || s.phase === 'awaitingShare';
  if (!watching) return none(s);
  switch (event) {
    case 'composer-ready': {
      if (s.phase === 'awaitingShare') return none(s);
      // AM24: in H1, ready counts only once the file was served (the insert happened).
      if (s.phase === 'injecting' && !s.fileServed) return none(s);
      const level: HandoffLevel = s.phase === 'injecting' ? 'H1' : 'H0';
      const phaseLog = logPhase(s, 'awaitingShare', ctx.now);
      const next: Windowed = { ...common(s), phase: 'awaitingShare', level, phaseLog };
      // AM13: probe the ready composer once more, so C8 carries the canvas (backing size, CSS rect).
      return { state: next, effects: [notify(next), ...probeCmd(next)] };
    }
    case 'inject-ignored':
      // §3.8: no second synthetic attempt; H0 in the same window.
      return s.phase === 'injecting' ? toPick(s, 'INJECTION_IGNORED', ctx) : none(s);
    case 'inject-unconfirmed':
      // AM28: as inject-ignored, but the file may be in the composer: leaving it is C9 (engaged()).
      return s.phase === 'injecting' ? toPick({ ...s, insertDispatched: true }, 'INJECTION_IGNORED', ctx) : none(s);
    case 'composer-left':
      // AM18: only an engaged composer can be left; before that the watch keeps running (H0 from home).
      return engaged(s) ? finish(s, ctx) : none(s);
    case 'sw-controller-change':
      return fail(s, 'SW_TOOK_CONTROL', ctx);
    case 'input-appeared':
      return none(s);
  }
}

// ---------------------------------------------------------------------------------------
// failed effects: flow effects close the popup (AGENT_UNREACHABLE); stale ones are ignored

function onEffectFailed(s: Windowed, e: Extract<HandoffEvent, { type: 'effectFailed' }>, ctx: HandoffCtx): Transition {
  const step = s.phase === 'probing' ? s.step : null;
  let live: boolean;
  switch (e.effect) {
    case 'installRules':
      live = s.phase === 'scoping';
      break;
    case 'measureTab':
      live = (s.phase === 'fitting' && s.frameDelta === null) || step === 'refitMeasure';
      break;
    case 'updateWindow':
      live = (s.phase === 'fitting' && s.frameDelta !== null) || step === 'refitUpdate';
      break;
    case 'navigate':
      live = s.phase === 'navigating';
      break;
    case 'hardReload':
      live = s.phase === 'reloading';
      break;
    case 'injectAgent':
      live = step === 'injectAgent';
      break;
    case 'sendAgent':
      live =
        step === 'awaitReport' || s.phase === 'injecting' || s.phase === 'awaitingPick' || s.phase === 'awaitingShare';
      break;
    case 'serveFile':
      // The file is still in Downloads: H0 in the same window, no second inject.
      return s.phase === 'injecting' ? toPick(s, 'INJECTION_IGNORED', ctx) : none(s);
    default:
      live = false;
  }
  return live ? fail(s, 'AGENT_UNREACHABLE', ctx, { detail: `${e.effect}: ${e.message}`.slice(0, 300) }) : none(s);
}
