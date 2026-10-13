/**
 * U9 (strategy §7.11): the full transition table, table-driven: guard fail; DESKTOP_SHELL;
 * NOT_LOGGED_IN (no lock); landscape refits once; input missing → H0; inject → ready;
 * inject → ignored → H0 with no second Inject; challenge → kill and lock; off-host or undefined
 * URL after arming → kill; window closed → cleanup; composer left → finished; probe mode. Plus AM2
 * re-probes, the start guards, timers and failed effects, and the 2026-10-12 changes: the verified
 * fit with its one retry and the guided resize (W2/W3), the service worker as diagnostics with an
 * interception tripwire (P1–P3), the msite width row (P4), the wait for a late story input (P5) and
 * the browser flavour (P6).
 * "No transition ever emits a retry" is asserted for every row and, generically, over
 * thousands of seeded random event sequences.
 */
import { describe, expect, it } from 'vitest';
import type { Size } from '../geometry/fit.ts';
import { firstGuess, isUsableInner, type WindowBox, windowFit } from '../geometry/window-fit.ts';
import type { PageOrientation, ProbeReport } from '../ig-contract/contract.ts';
import { uaRule } from '../ig-contract/device-profile.ts';
import { rehearsalRules, SESSION_RULE_IDS } from '../ig-contract/rules.ts';
import { COMPOSER_URL, classifyComposerUrl } from '../ig-contract/urls.ts';
import type { RateDecision } from './rate-guard.ts';
import { handoffReducer } from './reducer.ts';
import {
  type AgentEventName,
  CLOSE_DELAY_MS,
  defaultSettings,
  ERROR_EFFECT,
  type ErrorCode,
  FIT_RETRY_DELAY_MS,
  HANDOFF_TIMERS,
  type HandoffCtx,
  type HandoffEffect,
  type HandoffEvent,
  type HandoffPhase,
  type HandoffRecord,
  type HandoffState,
  type HandoffStatus,
  IDLE,
  INACTIVITY_TIMEOUT_MS,
  INJECT_READY_TIMEOUT_MS,
  INPUT_WAIT_MS,
  isArmed,
  MSITE_LOCK_MS,
  NAVIGATION_TIMEOUT_MS,
  RESIZE_POLL_MS,
  RESIZE_TIMEOUT_MS,
  type Settings,
} from './state.ts';

// ---------------------------------------------------------------------------------------
// Fixtures

const T0 = Date.UTC(2026, 9, 11, 12);
/** The owner's MacBook (S8): avail 1512x949 at top 33; the popup frame is 0x32. */
const SCREEN = { availLeft: 0, availTop: 33, availWidth: 1512, availHeight: 949 };
const WIN = 7;
const TAB = 42;
const HOME = 'https://www.instagram.com/';
const LOGIN = 'https://www.instagram.com/accounts/login/?next=%2Fcreate%2Fstory%2F';
const CHALLENGE = 'https://www.instagram.com/challenge/action/x/';
const CHECKPOINT = 'https://www.instagram.com/checkpoint/1/';
const ACCOUNTS_CENTER = 'https://accountscenter.instagram.com/';
const SESSION_IDS = [...SESSION_RULE_IDS];

const goodProbe = (over: Partial<ProbeReport> = {}): ProbeReport => ({
  marker: true,
  isMobile: true,
  inner: { w: 511, h: 909 },
  dpr: 2,
  portrait: true,
  swControlled: false,
  swIntercepted: false,
  navType: 'reload',
  storyInput: 'present',
  acceptOk: true,
  canvas: { w: 1022, h: 1818, css: { x: 0, y: 0, w: 511, h: 909 } },
  lang: 'en',
  ...over,
});

const startEv = (mode: 'post' | 'probe' = 'post', screen = SCREEN, rehearsal = true): HandoffEvent => ({
  type: 'start',
  exportId: mode === 'post' ? 'exp_1' : null,
  mode,
  rehearsal,
  screen,
  browser: 'chromium',
});
const tab = (status: 'loading' | 'complete' | undefined, url: string | undefined, tabId = TAB): HandoffEvent => ({
  type: 'tabUpdated',
  tabId,
  status,
  url,
});
const report = (over: Partial<ProbeReport> = {}): HandoffEvent => ({ type: 'agentReport', probe: goodProbe(over) });
/** agentInjected; `fresh: false` = the agent was already in that document (AM16). */
const injected = (fresh: boolean): HandoffEvent => ({ type: 'agentInjected', fresh });
/** AM37: the portrait shim's readings: installed on a landscape screen, or switched off (E2E flag). */
const SHIM_INSTALLED: PageOrientation = { type: 'portrait-primary', shim: 'installed' };
const SHIM_PRESENT: PageOrientation = { type: 'portrait-primary', shim: 'present' };
const SHIM_OFF: PageOrientation = { type: 'landscape-primary', shim: 'off' };
/** agentInjected with the shim's reading for that document (AM37). */
const injectedWith = (fresh: boolean, orientation: PageOrientation): HandoffEvent => ({
  type: 'agentInjected',
  fresh,
  orientation,
});
const SUSPENDED = 'https://www.instagram.com/accounts/suspended/?next=%2Fcreate%2Fstory%2F';
const CODE_ENTRY = 'https://www.instagram.com/auth_platform/codeentry/?apc=x';
const CONSENT = 'https://www.instagram.com/consent/?flow=x';
const agent = (event: AgentEventName): HandoffEvent => ({ type: 'agentEvent', event });
/** tabs.get inner 500x900 inside a 500x(900 + frameH) window: the S8 frame is 0x32. */
const measured = (frameH = 32): HandoffEvent => ({
  type: 'tabMeasured',
  inner: { w: 500, h: 900 },
  outer: { left: 500, top: 33, width: 500, height: 900 + frameH },
});
const MEASURED = measured();
/** windowFit for MEASURED's 0x32 frame: inner 511x909 (S8). */
const FIT = (() => {
  const f = windowFit(SCREEN, { w: 0, h: 32 });
  if (!f.ok) throw new Error('fixture screen must fit');
  return f;
})();
/** updateWindow's verification: the tab reached `inner` (fitted) or stayed at `inner` (not). */
const fittedEv = (fitted: boolean, inner: Size = FIT.inner, outer?: WindowBox): HandoffEvent => ({
  type: 'windowFitted',
  box: FIT.outer,
  target: FIT.inner,
  fitted,
  inner,
  outer: outer ?? { ...FIT.outer, width: inner.w, height: inner.h + 32 },
});
const FITTED = fittedEv(true);
/** Arc ignoring the bounds (F1): the tab stays at 1512x902 in a 1512x949 window. */
const ARC_TAB = { w: 1512, h: 902 };
const ARC_WINDOW = { left: 1831, top: 13, width: 1512, height: 949 };
const NOT_FITTED = fittedEv(false, ARC_TAB, ARC_WINDOW);
/** The settled Arc popup, as measureTab reads it (frame 0x47). */
const ARC_MEASURED: HandoffEvent = { type: 'tabMeasured', inner: ARC_TAB, outer: ARC_WINDOW, zoom: 1 };
const sized = (w: number, h: number): HandoffEvent => ({
  type: 'windowSized',
  inner: { w, h },
  outer: { left: 0, top: 0, width: w, height: h + 47 },
});
/** P5: the input wait runs out (the probe's INPUT_MISSING stands). */
const INPUT_WAITED: HandoffEvent = { type: 'timer', timer: 'inputWait' };
const HOUR = 3_600_000;
/** The session switches every active status carries (AM21): the defaults of a guarded post. */
const SWITCHES = { rehearsal: true, assistedInsert: true } as const;

interface Step {
  prev: HandoffState;
  event: HandoffEvent;
  effects: HandoffEffect[];
  state: HandoffState;
  now: number;
}

interface Opts {
  guarded?: boolean;
  settings?: Partial<Settings>;
  rate?: RateDecision;
  chromeMajor?: number;
  brandedBrowser?: boolean;
  resizeTimeoutMs?: number;
}

/** Drives the reducer like the runner would, recording every transition. */
class Run {
  state: HandoffState = IDLE;
  now = T0;
  readonly steps: Step[] = [];
  readonly opts: Opts;
  private n = 0;

  constructor(opts: Opts = {}) {
    this.opts = opts;
  }

  ctx(): HandoffCtx {
    const guarded = this.opts.guarded ?? true;
    return {
      now: this.now,
      guarded,
      chromeMajor: this.opts.chromeMajor ?? 155,
      settings: { ...defaultSettings(guarded), ...this.opts.settings },
      rate: this.opts.rate ?? { ok: true },
      uuid: () => `u${++this.n}`,
      brandedBrowser: this.opts.brandedBrowser ?? false,
      ...(this.opts.resizeTimeoutMs !== undefined ? { resizeTimeoutMs: this.opts.resizeTimeoutMs } : {}),
    };
  }

  send(...events: HandoffEvent[]): HandoffEffect[] {
    let last: HandoffEffect[] = [];
    for (const event of events) {
      const prev = this.state;
      const t = handoffReducer(prev, event, this.ctx());
      this.state = t.state;
      this.steps.push({ prev, event, effects: t.effects, state: t.state, now: this.now });
      last = t.effects;
    }
    return last;
  }

  tick(ms: number): this {
    this.now += ms;
    return this;
  }

  get phase(): HandoffPhase {
    return this.state.phase;
  }
  get effects(): HandoffEffect[] {
    return this.steps.flatMap((s) => s.effects);
  }
  get statuses(): HandoffStatus[] {
    return this.effects.flatMap((e) => (e.type === 'notifyEditor' ? [e.status] : []));
  }
  get lastStatus(): HandoffStatus | undefined {
    return this.statuses.at(-1);
  }
  count(pred: (e: HandoffEffect) => boolean): number {
    return this.effects.filter(pred).length;
  }
  get injects(): number {
    return this.count(isInject);
  }
}

const isInject = (e: HandoffEffect): boolean => e.type === 'sendAgent' && e.command.type === 'agent/inject';
const isProbeCmd = (e: HandoffEffect): boolean => e.type === 'sendAgent' && e.command.type === 'agent/probe';
const watchMs = (e: HandoffEffect): number | null =>
  e.type === 'sendAgent' && e.command.type === 'agent/watch' ? e.command.readyTimeoutMs : null;
const types = (effects: HandoffEffect[]) => effects.map((e) => e.type);

/** start → windowCreated → rules → fit → navigate. Stops in `navigating` (kill switch not armed). */
function DRIVE_NAVIGATING(r: Run): Run {
  r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
  r.send(MEASURED, FITTED);
  return r;
}
/** start → windowCreated → rules → fit → navigate → hard reload → reload committed. Stops in `reloading`. */
function toReloading(r: Run, mode: 'post' | 'probe' = 'post'): Run {
  r.send(startEv(mode), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
  r.send(MEASURED, FITTED, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
  return r;
}
/** …then the reload's complete and agentInjected: the agent/probe is out. */
function toReport(r: Run, mode: 'post' | 'probe' = 'post'): Run {
  toReloading(r, mode).send(tab('complete', COMPOSER_URL), { type: 'agentInjected' });
  return r;
}
function toInjecting(r: Run): Run {
  toReport(r).send(report());
  return r;
}
function toShare(r: Run): Run {
  toInjecting(r).send({ type: 'agentGetFile' }, agent('composer-ready'));
  return r;
}
function toPick(r: Run, over: Partial<ProbeReport> = { storyInput: 'absent' }): Run {
  // P5: a missing input is waited for once; the wait runs out (a no-op when nothing waits).
  toReport(r).send(report(over), INPUT_WAITED);
  return r;
}
/** As toShare, in a post with rehearsal off (AM19 holds the popup open after Share). */
function toShareRehearsalOff(r: Run): Run {
  r.send(startEv('post', SCREEN, false));
  r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
  r.send(MEASURED, FITTED, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
  r.send(tab('complete', COMPOSER_URL), { type: 'agentInjected' }, report(), { type: 'agentGetFile' });
  r.send(agent('composer-ready'));
  return r;
}
/** A later full-document load of the composer whose fresh agent shows a new document (AM16). */
const NEW_DOCUMENT: HandoffEvent[] = [tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), injected(true)];
/** A later same-document load (pushState, replaceState): the agent was already there. */
const SAME_DOCUMENT: HandoffEvent[] = [
  tab('loading', `${COMPOSER_URL}?x`),
  tab('complete', `${COMPOSER_URL}?x`),
  injected(false),
];

// ---------------------------------------------------------------------------------------
// Per-run invariants ("no retry"), checked after every table row and every random run.

const FLOW = new Set<HandoffEffect['type']>([
  'openWindow',
  'installRules',
  'measureTab',
  'updateWindow',
  'navigate',
  'hardReload',
  'injectAgent',
  'sendAgent',
  'serveFile',
]);

const activeId = (s: HandoffState): string | null => (s.phase === 'idle' ? null : s.handoffId);

interface Tally {
  [handoffId: string]: Partial<Record<string, number>>;
}

const LIMITS: Record<string, number> = {
  openWindow: 1,
  installRules: 1,
  navigate: 1,
  hardReload: 1,
  inject: 1,
  serveFile: 1,
  // W2: the fit and the single refit measure; the fit, its one retry and the single refit update.
  measureTab: 2,
  updateWindow: 3,
  writeRecord: 1,
  lockMsite: 1,
  noteOpen: 1,
};

function checkStep(step: Step, ctx: Pick<HandoffCtx, 'guarded' | 'settings'>, tally: Tally): void {
  const { prev, event, effects, state, now } = step;
  const id = activeId(state) ?? activeId(prev);
  const ts = types(effects);

  // Counters per hand-off: never a second open, rules, navigation, reload, inject, file, record, lock.
  if (id !== null) {
    const t = tally[id] ?? {};
    tally[id] = t;
    for (const e of effects) {
      const key = isInject(e) ? 'inject' : e.type;
      t[key] = (t[key] ?? 0) + 1;
      const limit = LIMITS[key];
      if (limit !== undefined) expect(t[key], `${key} for ${id}`).toBeLessThanOrEqual(limit);
    }
  }

  // From idle, the only flow effect is the start's openWindow (closeWindow: an orphan popup).
  if (prev.phase === 'idle') {
    for (const e of effects) if (FLOW.has(e.type)) expect(e.type === 'openWindow' && event.type === 'start').toBe(true);
  }
  // A closing session emits nothing that moves the flow forward again.
  if (prev.phase === 'closing') {
    for (const e of effects) {
      expect(FLOW.has(e.type) || ['lockMsite', 'writeRecord', 'armTimer', 'noteOpen'].includes(e.type)).toBe(false);
    }
  }
  // Rules are removed only when the session is over, and after closeWindow when both appear.
  if (ts.includes('removeRules')) {
    expect(state.phase).toBe('idle');
    if (ts.includes('closeWindow')) expect(ts.indexOf('closeWindow')).toBeLessThan(ts.indexOf('removeRules'));
  }
  for (const e of effects) if (e.type === 'removeRules') expect(e.ruleIds).toEqual(SESSION_IDS);
  // Closing a window always comes first in its transition.
  if (state.phase === 'closing' && prev.phase !== 'closing' && prev.phase !== 'opening')
    expect(ts[0]).toBe('closeWindow');
  // The hard reload comes only from `navigating`.
  if (ts.includes('hardReload')) expect(prev.phase).toBe('navigating');
  // W2/W3: the navigation starts only from a verified fit, a usable tab after the retry, or a
  // usable size read while resizing; never from a window still at Arc's 1512x949.
  if (ts.includes('navigate')) {
    expect(['fitting', 'resizing']).toContain(prev.phase);
    const win = state.phase !== 'idle' ? state.win : null;
    const last = win?.updates.at(-1);
    const usable = win?.finalTab ? isUsableInner(win.finalTab, win.zoom) : false;
    expect(usable || (prev.phase === 'fitting' && last?.fitted === true)).toBe(true);
    if (prev.phase === 'resizing') expect(win?.manualResize).toBe(true);
  }
  // W3: the tab size is read on demand only while the owner resizes.
  if (ts.includes('readSize')) expect(prev.phase).toBe('resizing');
  // AL-3: only the new popup (fitting) settles before it is measured; the refit reads it once.
  for (const e of effects) if (e.type === 'measureTab') expect(e.settle).toBe(state.phase === 'fitting');
  // P5 (AL-1/AF-1): a decision that read C4 from a report without a story input waited for it first.
  for (const e of effects) {
    if (e.type !== 'notifyEditor' || e.status.c4 === undefined || e.status.c4 === 'unknown') continue;
    // Re-probes of a later document (a level already decided) never wait (one wait per hand-off).
    if (e.status.probe?.storyInput !== 'absent' || prev.phase !== 'probing' || prev.level !== null) continue;
    expect(prev.inputWaitUsed, 'C4 read from an input-less report without the input wait').toBe(true);
  }
  // W2 hardening: the runner's re-applies (and the hold) only while the tab is still about:blank,
  // i.e. for the fit and its retry in `fitting`; the refit after the navigation is one windows.update.
  for (const e of effects) {
    if (e.type !== 'updateWindow') continue;
    expect(e.reapply).toBe(state.phase === 'fitting');
    if (state.phase === 'probing') expect(state.step).toBe('refitUpdate');
  }
  // P1: being controlled by a worker never fails a session; DESKTOP_SHELL means is_mobile was not true.
  for (const e of effects) {
    if (e.type !== 'notifyEditor' || e.status.error !== 'DESKTOP_SHELL') continue;
    expect(e.status.probe?.isMobile).not.toBe(true);
  }
  // P2: SW_TOOK_CONTROL is never emitted any more.
  for (const e of effects) if (e.type === 'notifyEditor') expect(e.status.error).not.toBe('SW_TOOK_CONTROL');
  // Locks only with a kill.
  for (const e of effects) {
    if (e.type !== 'lockMsite') continue;
    expect(e.until).toBe(now + MSITE_LOCK_MS);
    const err = effects.flatMap((x) => (x.type === 'notifyEditor' ? [x.status.error] : []));
    expect(err.some((c) => c === 'KILLED_CHALLENGE' || c === 'KILLED_OFFHOST')).toBe(true);
  }
  // Statuses describe the session at hand (or a refused start).
  for (const e of effects) {
    if (e.type !== 'notifyEditor') continue;
    expect([null, activeId(prev), activeId(state)]).toContain(e.status.handoffId);
  }
  // The single inject: post mode, a file, H1 enabled, after a probe that passed every row.
  if (effects.some(isInject)) {
    expect(prev.phase).toBe('probing');
    expect(state).toMatchObject({ phase: 'injecting', mode: 'post', exportId: expect.any(String) });
    expect(ctx.settings.assistedInsert).toBe(true);
    const p = state.phase === 'injecting' ? state.probe : null;
    expect(p).toMatchObject({ portrait: true, storyInput: 'present', acceptOk: true });
    expect(p?.isMobile).not.toBe(false);
    // P1/P3: control is diagnostics; a worker that intercepted requests never sees an insert.
    expect(p?.swIntercepted).not.toBe(true);
    expect(p?.inner.w).toBeLessThanOrEqual(767);
    if (ctx.guarded) expect(p?.marker).toBe(true);
    if (prev.phase === 'probing' && prev.strict) expect(p?.isMobile).toBe(true);
    // Never an upgrade: once a level was decided (H0, or H1 already used), no inject follows.
    if (prev.phase === 'probing') expect(prev.level).toBeNull();
  }
  // Probe mode never injects and never serves a file.
  const mode = state.phase !== 'idle' ? state.mode : prev.phase !== 'idle' ? prev.mode : null;
  if (mode === 'probe') expect(ts.includes('serveFile') || effects.some(isInject)).toBe(false);
  // The kill switch, once armed, acts on every update of the composer tab.
  if (event.type === 'tabUpdated' && event.tabId === TAB && isArmed(prev)) {
    const v = classifyComposerUrl(event.url);
    if (v.kind === 'kill') expect(ts).toEqual(expect.arrayContaining(['closeWindow', 'lockMsite']));
    if (v.kind === 'stop') {
      expect(ts).toContain('closeWindow');
      expect(ts).not.toContain('lockMsite');
    }
    // AM17: an unknown www page never locks, never injects and is never pre-answered "posted".
    if (v.kind === 'unknown-left' && prev.phase !== 'finished') {
      expect(ts).not.toContain('lockMsite');
      expect(ts).not.toContain('injectAgent');
      expect(state.phase === 'closing' || state.phase === 'finished').toBe(true);
      if (state.phase === 'finished') expect(state.detectedPosted).toBe(false);
    }
  }
  // AM20: before arming, a hidden URL change (no status) in `navigating` is off-host: kill.
  if (event.type === 'tabUpdated' && prev.phase === 'navigating' && event.tabId === prev.tabId) {
    if (event.url === undefined && event.status === undefined) {
      expect(ts).toEqual(expect.arrayContaining(['closeWindow', 'lockMsite']));
    }
    if (ts.includes('hardReload')) expect(classifyComposerUrl(event.url).kind).toMatch(/^(ok|composer-left)$/);
  }
  // AM21: every status of an active session carries that session's own switches.
  const session = state.phase !== 'idle' ? state : prev.phase !== 'idle' ? prev : null;
  for (const e of effects) {
    if (e.type !== 'notifyEditor' || !session || e.status.handoffId !== session.handoffId) continue;
    if (e.status.phase === 'idle') continue;
    expect(e.status.rehearsal).toBe(session.rehearsal);
    expect(e.status.assistedInsert).toBe(session.assistedInsert);
  }
  // AM22: a session that opened a popup remembers it, and every end of a session forgets it.
  if (prev.phase === 'opening' && state.phase === 'scoping') expect(ts).toContain('rememberWindow');
  if (prev.phase !== 'idle' && state.phase === 'idle') expect(ts).toContain('forgetWindow');
  // AM24: H1 reaches awaitingShare only after the file was served.
  if (prev.phase === 'injecting' && state.phase === 'awaitingShare') expect(prev.fileServed).toBe(true);
  // AM19: a held-open popup arms no close delay; only an engaged-after-Share post with rehearsal off holds.
  if (state.phase === 'finished' && prev.phase !== 'finished') {
    const armsClose = effects.some((e) => e.type === 'armTimer' && e.timer === 'closeDelay');
    expect(armsClose).toBe(!state.holdOpen);
    if (state.holdOpen) expect(state.mode).toBe('post');
    // AM28: with rehearsal on, only an unconfirmed insert (no pre-answer) holds the popup open.
    if (state.holdOpen && state.rehearsal) expect(state).toMatchObject({ insertDispatched: true, postedUnknown: true });
    if (state.detectedPosted) expect(['awaitingShare', 'probing']).toContain(prev.phase);
    expect(state.detectedPosted && state.postedUnknown).toBe(false);
  }
}

/** What happened in the current composer document of the current hand-off (AM16, AM28). */
interface DocFacts {
  watched: boolean;
  shareable: boolean;
}

/**
 * Per-document invariants (AM28). A new document is the reload's first probe or a fresh agent after a
 * later load: the agent and its watch of the old one are gone, and so is any Share made there.
 * - Every watching phase (injecting, awaitingPick, awaitingShare) has an agent/watch in this document,
 *   so it can still end by an agent event, not only by a cancel or the 15 min timeout.
 * - "Posted" is pre-answered only if the composer was ready (awaitingShare) in this document.
 */
function checkDocument(step: Step, doc: DocFacts): void {
  const { prev, event, effects, state } = step;
  const started = prev.phase === 'idle' && state.phase !== 'idle';
  const fresh =
    event.type === 'agentInjected' && event.fresh !== false && prev.phase === 'probing' && prev.step === 'injectAgent';
  if (started || fresh || (prev.phase === 'reloading' && state.phase === 'probing')) {
    doc.watched = false;
    doc.shareable = false;
  }
  if (effects.some((e) => watchMs(e) !== null)) doc.watched = true;
  const readyNow = (st: HandoffStatus) => st.phase === 'awaitingShare';
  if (state.phase === 'awaitingShare' || effects.some((e) => e.type === 'notifyEditor' && readyNow(e.status))) {
    doc.shareable = true;
  }
  if (state.phase === 'injecting' || state.phase === 'awaitingPick' || state.phase === 'awaitingShare') {
    expect(doc.watched, `${state.phase} without a watch in this document`).toBe(true);
  }
  if (state.phase === 'finished' && prev.phase !== 'finished' && state.detectedPosted) {
    expect(doc.shareable, 'posted pre-answered without a ready composer in this document').toBe(true);
  }
}

function checkRun(r: Run): void {
  const tally: Tally = {};
  const ctx = r.ctx();
  const doc: DocFacts = { watched: false, shareable: false };
  for (const step of r.steps) {
    checkStep(step, ctx, tally);
    checkDocument(step, doc);
  }
}

// ---------------------------------------------------------------------------------------
// The happy path, effect by effect

describe('U9 hand-off reducer: happy path (H1)', () => {
  it('emits the §3.6 sequence in order', () => {
    const r = new Run();
    const guess = firstGuess(SCREEN);
    const fit = windowFit(SCREEN, { w: 0, h: 32 });
    if (!guess.ok || !fit.ok) throw new Error('fixture screen must fit');

    expect(r.send(startEv())).toEqual([
      { type: 'noteOpen', t: T0 },
      { type: 'openWindow', box: guess.outer },
      { type: 'armTimer', timer: 'inactivity', ms: INACTIVITY_TIMEOUT_MS },
      {
        type: 'notifyEditor',
        status: { handoffId: 'hof_u1', phase: 'opening', level: null, rehearsal: true, assistedInsert: true },
      },
    ]);
    expect(r.state).toMatchObject({ phase: 'opening', handoffId: 'hof_u1', nonce: 'u2', exportId: 'exp_1' });

    const scoped = r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB });
    expect(scoped[0]).toEqual({
      type: 'installRules',
      removeRuleIds: SESSION_IDS,
      addRules: [uaRule(TAB, 155, 'full'), ...rehearsalRules(TAB)],
    });
    // AM22: the popup is remembered in storage.local, so a reloaded extension can still close it.
    expect(scoped[1]).toEqual({ type: 'rememberWindow', windowId: WIN, tabId: TAB, handoffId: 'hof_u1' });
    expect(types(r.send({ type: 'rulesInstalled' }))).toEqual(['measureTab', 'notifyEditor']);
    expect(r.state).toMatchObject({ phase: 'fitting', fitStep: 'measure' });
    // W2: the settled window measured; one update to windowFit (with the target inner size to verify).
    expect(r.send(MEASURED)).toEqual([
      { type: 'updateWindow', windowId: WIN, tabId: TAB, box: fit.outer, inner: fit.inner, reapply: true },
    ]);
    const nav = r.send(FITTED);
    expect(nav.slice(0, 2)).toEqual([
      { type: 'navigate', tabId: TAB, url: COMPOSER_URL },
      { type: 'armTimer', timer: 'navigation', ms: NAVIGATION_TIMEOUT_MS },
    ]);
    // W5: the status that starts the navigation carries the window's sizing.
    expect(nav[2]).toMatchObject({
      type: 'notifyEditor',
      status: { phase: 'navigating', window: { attempts: 1, manualResize: false, finalTab: fit.inner } },
    });
    // Before navigating, tab updates (about:blank, url hidden) are ignored.
    expect(r.send(tab('complete', undefined))).toEqual([]);
    expect(r.send(tab('loading', COMPOSER_URL)).slice(0, 2)).toEqual([
      { type: 'hardReload', tabId: TAB },
      { type: 'clearTimer', timer: 'navigation' },
    ]);
    expect(r.phase).toBe('reloading');
    expect(r.send(tab('loading', COMPOSER_URL))).toEqual([]);
    expect(r.send(tab('complete', COMPOSER_URL))[0]).toEqual({ type: 'injectAgent', tabId: TAB });
    expect(r.send({ type: 'agentInjected' })).toEqual([
      { type: 'sendAgent', tabId: TAB, command: { type: 'agent/probe' } },
    ]);
    const h1 = r.send(report());
    expect(types(h1)).toEqual(['sendAgent', 'sendAgent', 'notifyEditor']);
    expect(watchMs(h1[0] as HandoffEffect)).toBe(INJECT_READY_TIMEOUT_MS);
    expect(isInject(h1[1] as HandoffEffect)).toBe(true);
    expect(r.state).toMatchObject({ phase: 'injecting', level: 'H1', route: 'direct' });
    expect(r.send({ type: 'agentGetFile' })).toEqual([{ type: 'serveFile', exportId: 'exp_1' }]);
    expect(r.send(agent('composer-ready'))).toEqual([
      {
        type: 'notifyEditor',
        status: { handoffId: 'hof_u1', phase: 'awaitingShare', level: 'H1', route: 'direct', ...SWITCHES },
      },
      // AM13: one more probe of the ready composer, for C8.
      { type: 'sendAgent', tabId: TAB, command: { type: 'agent/probe' } },
    ]);
    const ready = goodProbe({ canvas: { w: 1080, h: 1920, css: { x: 0, y: 0, w: 511, h: 908 } } });
    expect(r.send({ type: 'agentReport', probe: ready })).toEqual([
      {
        type: 'notifyEditor',
        status: {
          handoffId: 'hof_u1',
          phase: 'awaitingShare',
          level: 'H1',
          route: 'direct',
          probe: ready,
          ...SWITCHES,
        },
      },
    ]);
    // The owner clicks Share; the composer SPA-navigates home (C9). Rehearsal on: closes in 3 s.
    const fin = r.send(tab(undefined, HOME));
    expect(types(fin)).toEqual(['notifyEditor', 'writeRecord', 'armTimer']);
    expect(fin[0]).toMatchObject({ status: { phase: 'finished', detectedPosted: true } });
    expect(fin[2]).toEqual({ type: 'armTimer', timer: 'closeDelay', ms: CLOSE_DELAY_MS });
    const rec = fin[1];
    if (rec?.type !== 'writeRecord') throw new Error('expected a record');
    expect(rec.record).toMatchObject({
      id: 'hof_u1',
      mode: 'post',
      level: 'H1',
      rehearsal: true,
      chMode: 'full',
      outcome: 'posted-confirmed',
      route: 'direct',
      preflight: { C1: 'pass', C2: 'pass', C3: 'pass', C4: 'pass', C5: 'pass', swIntercepted: false },
      readyProbe: ready,
      browser: 'chromium',
      // W5: requested (first guess), created (the settled window), frame delta, the verified update.
      window: {
        screen: SCREEN,
        requested: guess.outer,
        created: MEASURED.type === 'tabMeasured' ? MEASURED.outer : null,
        createdTab: { w: 500, h: 900 },
        frameDelta: { w: 0, h: 32 },
        updates: [{ step: 'fit', box: fit.outer, target: fit.inner, fitted: true, tab: fit.inner }],
        attempts: 1,
        manualResize: false,
        finalTab: fit.inner,
        zoom: null,
      },
    });
    expect(rec.record.swControllerChanges).toBeUndefined();
    // C8 comes from the ready composer; the deciding probe is kept as it was.
    expect(rec.record.preflight?.C8).toEqual({ inner: ready.inner, dpr: ready.dpr, canvas: ready.canvas });
    expect(rec.record.probe).toEqual(goodProbe());
    expect(rec.record.phaseLog.map((p) => p.phase)).toEqual([
      'opening',
      'scoping',
      'fitting',
      'navigating',
      'reloading',
      'probing',
      'injecting',
      'awaitingShare',
      'finished',
    ]);
    expect(types(r.tick(CLOSE_DELAY_MS).send({ type: 'timer', timer: 'closeDelay' }))).toEqual([
      'closeWindow',
      'notifyEditor',
    ]);
    expect(types(r.send({ type: 'windowRemoved', windowId: WIN }))).toEqual([
      'removeRules',
      ...HANDOFF_TIMERS.map(() => 'clearTimer'),
      'forgetWindow',
      'notifyEditor',
    ]);
    expect(r.state).toEqual({
      phase: 'idle',
      last: { handoffId: 'hof_u1', outcome: 'posted-confirmed', endedAt: T0 + CLOSE_DELAY_MS },
    });
    // The owner says "not posted" after all.
    expect(r.send({ type: 'outcome', handoffId: 'hof_u1', posted: false })).toEqual([
      { type: 'patchRecordOutcome', handoffId: 'hof_u1', outcome: 'not-posted' },
    ]);
    checkRun(r);
  });

  it('uaOnly and rehearsal OFF change only the installed rules', () => {
    const r = new Run({ settings: { chMode: 'uaOnly' } });
    r.send(startEv('post', SCREEN, false));
    const [install] = r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB });
    expect(install).toEqual({
      type: 'installRules',
      removeRuleIds: SESSION_IDS,
      addRules: [uaRule(TAB, 155, 'uaOnly')],
    });
  });
});

// ---------------------------------------------------------------------------------------
// The transition table

interface Row {
  name: string;
  opts?: Opts;
  script: (r: Run) => void;
  phase: HandoffPhase;
  /** The last status's error (null: none). */
  error?: ErrorCode | null;
  has?: HandoffEffect['type'][];
  lacks?: HandoffEffect['type'][];
  injects?: number;
  check?: (r: Run) => void;
}

const lastOutcome = (r: Run) => {
  const recs = r.effects.flatMap((e) => (e.type === 'writeRecord' ? [e.record.outcome] : []));
  return recs.at(-1);
};
const lastRecord = (r: Run) => r.effects.flatMap((e) => (e.type === 'writeRecord' ? [e.record] : [])).at(-1);

// W2/W3 fixtures: the owner's ultrawide (editor screen of the 2026-10-12 run) and Arc's 0x47 frame.
const OWNER_UW = { availLeft: 1512, availTop: -428, availWidth: 3440, availHeight: 1410 };
const ARC_DELTA = { w: 0, h: 47 };
function fitFor(screen = OWNER_UW, delta = ARC_DELTA) {
  const f = windowFit(screen, delta);
  if (!f.ok) throw new Error('fixture screen must fit');
  return f;
}
/** updateWindow's verification for `f`: fitted at its target, or the tab still at `tab`. */
const verify = (
  f: ReturnType<typeof fitFor>,
  fitted: boolean,
  tab: Size = ARC_TAB,
  applied?: number,
): HandoffEvent => ({
  type: 'windowFitted',
  box: f.outer,
  target: f.inner,
  fitted,
  inner: fitted ? f.inner : tab,
  outer: fitted ? f.outer : { ...ARC_WINDOW, width: tab.w, height: tab.h + 47 },
  ...(applied === undefined ? {} : { applied }),
});
const RETRY: HandoffEvent = { type: 'timer', timer: 'fitRetry' };
/** start on the ultrawide → popup → rules → the settled Arc popup measured. Stops in fitting/update. */
function toArcFit(r: Run, rehearsal = true): Run {
  r.send(startEv('post', OWNER_UW, rehearsal), { type: 'windowCreated', windowId: WIN, tabId: TAB });
  r.send({ type: 'rulesInstalled' }, ARC_MEASURED);
  return r;
}
/** …both updates ignored (still 1512x902): the guided resize. */
function toResizing(r: Run): Run {
  const f = fitFor();
  toArcFit(r).send(verify(f, false), RETRY, verify(f, false));
  return r;
}
/** A probe of msite's home page, where the composer lands without media (F3). */
const homeProbe = (over: Partial<ProbeReport> = {}): HandoffEvent =>
  report({ inner: { w: 524, h: 932 }, canvas: undefined, ...over });
/** navigating → hard reload → the reload lands on `/` (homeOnly) → agent injected: the probe is out. */
function toHomeReport(r: Run): Run {
  r.send(tab('loading', COMPOSER_URL), tab('loading', HOME), tab('complete', HOME), { type: 'agentInjected' });
  return r;
}

const ROWS: Row[] = [
  // Start guards: no window opens.
  {
    name: 'start: MSITE_LOCKED until the lock expires',
    opts: { settings: { msiteLockedUntil: T0 + 1000 } },
    script: (r) => r.send(startEv()),
    phase: 'idle',
    error: 'MSITE_LOCKED',
    lacks: ['openWindow', 'noteOpen'],
    check: (r) => expect(r.lastStatus).toMatchObject({ handoffId: null, freeAt: T0 + 1000 }),
  },
  {
    name: 'start: an expired lock no longer refuses',
    opts: { settings: { msiteLockedUntil: T0 } },
    script: (r) => r.send(startEv()),
    phase: 'opening',
    has: ['openWindow'],
  },
  {
    name: 'start: RATE_LIMITED',
    opts: { rate: { ok: false, code: 'RATE_LIMITED', rule: 'spacing', freeAt: T0 + 5000 } },
    script: (r) => r.send(startEv()),
    phase: 'idle',
    error: 'RATE_LIMITED',
    lacks: ['openWindow', 'noteOpen'],
    check: (r) => expect(r.lastStatus?.freeAt).toBe(T0 + 5000),
  },
  {
    name: 'start: HANDOFF_BUSY leaves the active session alone',
    script: (r) => r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, startEv()),
    phase: 'scoping',
    error: 'HANDOFF_BUSY',
    check: (r) => {
      expect(r.count((e) => e.type === 'openWindow')).toBe(1);
      expect(r.lastStatus?.handoffId).toBeNull();
      expect(r.steps.at(-1)?.state).toBe(r.steps.at(-2)?.state);
    },
  },
  {
    name: 'start: SCREEN_TOO_SMALL',
    script: (r) => r.send(startEv('post', { availLeft: 0, availTop: 0, availWidth: 800, availHeight: 600 })),
    phase: 'idle',
    error: 'SCREEN_TOO_SMALL',
    lacks: ['openWindow'],
  },
  {
    name: 'fit: SCREEN_TOO_SMALL once the real frame is measured',
    script: (r) => {
      r.send(startEv('post', { ...SCREEN, availHeight: 700 }), { type: 'windowCreated', windowId: WIN, tabId: TAB });
      r.send({ type: 'rulesInstalled' }, measured(100));
    },
    phase: 'closing',
    error: 'SCREEN_TOO_SMALL',
    has: ['closeWindow'],
    lacks: ['navigate'],
  },
  {
    name: 'start: an implausible Chrome major refuses (no garbage UA)',
    opts: { chromeMajor: Number.NaN },
    script: (r) => r.send(startEv()),
    phase: 'idle',
    error: 'AGENT_UNREACHABLE',
    lacks: ['openWindow'],
  },

  // §3.6 step 7, row by row.
  {
    name: 'guard fail: guarded build without the marker → GUARD_NOT_FAKE, nothing injected',
    script: (r) => toReport(r).send(report({ marker: false })),
    phase: 'closing',
    error: 'GUARD_NOT_FAKE',
    has: ['closeWindow', 'writeRecord'],
    lacks: ['lockMsite', 'serveFile'],
    injects: 0,
    check: (r) => expect(lastOutcome(r)).toBe('failed:GUARD_NOT_FAKE'),
  },
  {
    name: 'live build + marker → FAKE INSTAGRAM banner, and it carries on',
    opts: { guarded: false, settings: { assistedInsert: true } },
    script: (r) => toShare(r),
    phase: 'awaitingShare',
    error: null,
    injects: 1,
    check: (r) => {
      expect(r.lastStatus?.banner).toBe('FAKE_INSTAGRAM');
      expect(r.statuses.filter((s) => s.phase === 'awaitingShare')[0]?.banner).toBe('FAKE_INSTAGRAM');
    },
  },
  {
    name: 'live build without the marker: no banner',
    opts: { guarded: false, settings: { assistedInsert: true } },
    script: (r) => toReport(r).send(report({ marker: false })),
    phase: 'injecting',
    injects: 1,
    check: (r) => expect(r.statuses.some((s) => s.banner !== undefined)).toBe(false),
  },
  {
    name: 'DESKTOP_SHELL: is_mobile false',
    script: (r) => toReport(r).send(report({ isMobile: false })),
    phase: 'closing',
    error: 'DESKTOP_SHELL',
    injects: 0,
  },
  {
    name: 'P1: SW-controlled after the hard reload is diagnostics only: no DESKTOP_SHELL, recorded',
    script: (r) => toReport(r).send(report({ swControlled: true }), { type: 'agentGetFile' }, agent('composer-ready')),
    phase: 'awaitingShare',
    error: null,
    injects: 1,
    check: (r) => {
      r.send(tab(undefined, HOME));
      expect(lastRecord(r)?.preflight).toMatchObject({ swControlled: true, swIntercepted: false, C1: 'pass' });
    },
  },
  {
    name: 'P3: the probe shows a worker intercepted requests → SW_INTERCEPTS: close, no lock, nothing inserted',
    script: (r) => toReport(r).send(report({ swIntercepted: true })),
    phase: 'closing',
    error: 'SW_INTERCEPTS',
    injects: 0,
    lacks: ['lockMsite', 'serveFile'],
    check: (r) => {
      expect(lastOutcome(r)).toBe('failed:SW_INTERCEPTS');
      // It stopped before the story input: C4 is not judged (U1).
      expect(lastRecord(r)?.preflight?.C4).toBe('unknown');
      expect(r.lastStatus).toMatchObject({ c4: 'unknown', path: '/create/story/' });
    },
  },
  {
    name: 'U1: a decision that ends the session on home still tells the panel the route (the 2026-10-12 live run)',
    script: (r) => {
      toReloading(r, 'probe').send(tab('loading', HOME), tab('complete', HOME), { type: 'agentInjected' });
      r.send(report({ isMobile: false, inner: { w: 1512, h: 902 }, portrait: false, storyInput: 'absent' }));
    },
    phase: 'closing',
    error: 'DESKTOP_SHELL',
    check: (r) => {
      // Sent from `closing`, which has no route of its own: the decision carries it (Page row "/ (home…)").
      expect(r.lastStatus).toMatchObject({ route: 'homeOnly', path: '/', c4: 'unknown' });
      expect(lastRecord(r)?.route).toBe('homeOnly');
    },
  },
  {
    name: 'P3: swIntercepted unknown (no timeline) never fails',
    script: (r) => toReport(r).send(report({ swIntercepted: 'unknown' })),
    phase: 'injecting',
    injects: 1,
  },
  {
    name: 'first probe: is_mobile unknown does not fail (C1 missing)',
    script: (r) => toReport(r).send(report({ isMobile: 'unknown' })),
    phase: 'injecting',
    injects: 1,
  },
  {
    name: 'NOT_LOGGED_IN on the first load: closes at once, no reload, no lock',
    script: (r) => {
      r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED, tab('loading', LOGIN));
    },
    phase: 'closing',
    error: 'NOT_LOGGED_IN',
    has: ['closeWindow'],
    lacks: ['hardReload', 'lockMsite', 'injectAgent'],
    check: (r) => expect(r.steps.at(-1)?.effects[0]?.type).toBe('closeWindow'),
  },
  {
    name: 'NOT_LOGGED_IN after the reload (redirected): no lock',
    script: (r) => toReloading(r).send(tab('complete', LOGIN)),
    phase: 'closing',
    error: 'NOT_LOGGED_IN',
    lacks: ['lockMsite', 'injectAgent'],
  },
  {
    name: 'landscape: refits once (measure, one update), re-probes, then H1',
    script: (r) => {
      toReport(r).send(report({ portrait: false }));
      // AL-3: the refit reads the window once (it is not new; the kill switch is armed).
      expect(r.steps.at(-1)?.effects).toEqual([{ type: 'measureTab', tabId: TAB, windowId: WIN, settle: false }]);
      r.send(MEASURED);
      expect(types(r.steps.at(-1)?.effects ?? [])).toEqual(['updateWindow']);
      r.send(FITTED);
      expect(r.steps.at(-1)?.effects.some(isProbeCmd)).toBe(true);
      r.send(report());
    },
    phase: 'injecting',
    injects: 1,
    check: (r) => {
      expect(r.count((e) => e.type === 'updateWindow')).toBe(2);
      expect(r.count((e) => e.type === 'injectAgent')).toBe(1);
    },
  },
  {
    name: 'landscape twice → LANDSCAPE, no second refit',
    script: (r) => {
      toReport(r).send(report({ portrait: false }), MEASURED, FITTED, report({ portrait: false }));
    },
    phase: 'closing',
    error: 'LANDSCAPE',
    injects: 0,
    check: (r) => expect(r.count((e) => e.type === 'updateWindow')).toBe(2),
  },
  {
    name: 'input missing → H0 in the same window, watch without deadline',
    script: (r) => toPick(r, { storyInput: 'absent', acceptOk: false }),
    phase: 'awaitingPick',
    error: 'INPUT_MISSING',
    injects: 0,
    check: (r) => {
      // P5: the one input wait started the watch (no deadline); H0 keeps it running.
      expect(r.effects.map(watchMs).filter((m) => m !== null)).toEqual([0]);
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'inputWait', ms: INPUT_WAIT_MS });
      expect(lastRecord(r)).toBeUndefined();
      expect(r.lastStatus).toMatchObject({ c4: 'fail' });
    },
  },
  {
    name: 'accept drift → H0',
    script: (r) => toPick(r, { acceptOk: false }),
    phase: 'awaitingPick',
    error: 'ACCEPT_DRIFT',
    injects: 0,
  },
  {
    name: 'H1 disabled in settings → H0 with no error',
    opts: { settings: { assistedInsert: false } },
    script: (r) => toPick(r, {}),
    phase: 'awaitingPick',
    error: null,
    injects: 0,
  },
  {
    name: 'H0 pick → composer ready → awaitingShare (H0)',
    script: (r) => toPick(r).send(agent('input-appeared'), agent('composer-ready')),
    phase: 'awaitingShare',
    injects: 0,
    check: (r) => expect(r.state).toMatchObject({ level: 'H0' }),
  },
  {
    name: 'inject → ready: one inject, one file served, awaitingShare',
    script: (r) => toShare(r).send({ type: 'agentGetFile' }),
    phase: 'awaitingShare',
    injects: 1,
    check: (r) => expect(r.count((e) => e.type === 'serveFile')).toBe(1),
  },
  {
    name: 'inject → ignored → H0 with no second Inject, then picked by hand',
    script: (r) => {
      toInjecting(r).send({ type: 'agentGetFile' }, agent('inject-ignored'));
      expect(r.state).toMatchObject({ phase: 'awaitingPick', degradedFrom: 'INJECTION_IGNORED' });
      expect(r.steps.at(-1)?.effects.map(watchMs)).toContain(0);
      // A later document load re-probes; the passing re-probe stays H0 and never re-injects.
      r.send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), { type: 'agentInjected' }, report());
      expect(r.state).toMatchObject({ phase: 'awaitingPick', degradedFrom: 'INJECTION_IGNORED' });
      r.send(agent('inject-ignored'), { type: 'agentGetFile' }, agent('composer-ready'));
    },
    phase: 'awaitingShare',
    injects: 1,
    check: (r) => {
      expect(r.state).toMatchObject({ level: 'H0' });
      expect(r.count((e) => e.type === 'serveFile')).toBe(1);
    },
  },
  {
    name: 'serving the file fails → H0, no second inject',
    script: (r) =>
      toInjecting(r).send({ type: 'agentGetFile' }, { type: 'effectFailed', effect: 'serveFile', message: 'gone' }),
    phase: 'awaitingPick',
    error: 'INJECTION_IGNORED',
    injects: 1,
  },

  // The kill switch.
  {
    name: 'challenge → kill: close first, lock 7 days',
    script: (r) => toShare(r).send(tab('loading', CHALLENGE)),
    phase: 'closing',
    error: 'KILLED_CHALLENGE',
    has: ['closeWindow', 'lockMsite'],
    check: (r) => {
      expect(r.steps.at(-1)?.effects[0]?.type).toBe('closeWindow');
      expect(r.effects).toContainEqual({ type: 'lockMsite', until: T0 + MSITE_LOCK_MS });
      expect(lastOutcome(r)).toBe('killed:KILLED_CHALLENGE');
    },
  },
  {
    name: 'checkpoint during the reload → kill and lock',
    script: (r) => toReloading(r).send(tab('loading', CHECKPOINT)),
    phase: 'closing',
    error: 'KILLED_CHALLENGE',
    has: ['lockMsite'],
    lacks: ['injectAgent'],
  },
  {
    name: 'challenge on the very first load → kill, no reload',
    script: (r) => {
      r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED, tab('loading', CHALLENGE));
    },
    phase: 'closing',
    error: 'KILLED_CHALLENGE',
    lacks: ['hardReload'],
  },
  {
    name: 'off-host after arming (accountscenter) → kill',
    script: (r) => toShare(r).send(tab('loading', ACCOUNTS_CENTER)),
    phase: 'closing',
    error: 'KILLED_OFFHOST',
    has: ['lockMsite'],
  },
  {
    name: 'undefined URL after arming (no host permission) → kill',
    script: (r) => toReport(r).send(tab(undefined, undefined)),
    phase: 'closing',
    error: 'KILLED_OFFHOST',
    has: ['lockMsite'],
  },
  {
    name: 'off-host after finished still kills, and patches the written record',
    script: (r) => toShare(r).send(tab('complete', HOME), tab('loading', ACCOUNTS_CENTER)),
    phase: 'closing',
    error: 'KILLED_OFFHOST',
    has: ['lockMsite', 'patchRecordOutcome'],
    check: (r) => {
      expect(r.count((e) => e.type === 'writeRecord')).toBe(1);
      expect(r.effects).toContainEqual({
        type: 'patchRecordOutcome',
        handoffId: 'hof_u1',
        outcome: 'killed:KILLED_OFFHOST',
      });
    },
  },
  {
    name: 'updates of other tabs never trip the kill switch',
    script: (r) => toShare(r).send(tab('loading', CHALLENGE, 99), tab(undefined, undefined, 99)),
    phase: 'awaitingShare',
    lacks: ['lockMsite', 'closeWindow'],
  },
  {
    name: 'P2: a service worker taking control mid-session is counted on the record, never fatal',
    script: (r) => toShare(r).send(agent('sw-controller-change'), agent('sw-controller-change')),
    phase: 'awaitingShare',
    error: null,
    lacks: ['closeWindow', 'lockMsite'],
    check: (r) => {
      expect(r.state).toMatchObject({ swControllerChanges: 2 });
      r.send(tab(undefined, HOME));
      expect(lastRecord(r)).toMatchObject({ outcome: 'posted-confirmed', swControllerChanges: 2 });
    },
  },
  {
    name: 'P3: the watch reports an intercepted request mid-session → SW_INTERCEPTS, close, no lock',
    script: (r) => toShare(r).send(agent('sw-intercepted')),
    phase: 'closing',
    error: 'SW_INTERCEPTS',
    has: ['closeWindow'],
    lacks: ['lockMsite'],
    check: (r) => expect(r.steps.at(-1)?.effects[0]?.type).toBe('closeWindow'),
  },
  {
    name: 'AF-2: an interception the watch saw after the probe is on the status’s probe and the record (preflight)',
    opts: { settings: { assistedInsert: false } },
    script: (r) => {
      // H0 from home: the deciding probe saw no interception; the watch does later.
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe(), agent('sw-intercepted'));
    },
    phase: 'closing',
    error: 'SW_INTERCEPTS',
    check: (r) => {
      const closing = r.statuses.find((st) => st.phase === 'closing');
      expect(closing?.probe).toMatchObject({ swIntercepted: true, storyInput: 'present' });
      // No `c4` on it: the Story input row keeps the decision it showed.
      expect(closing?.c4).toBeUndefined();
      expect(lastRecord(r)).toMatchObject({
        outcome: 'failed:SW_INTERCEPTS',
        probe: { swIntercepted: true },
        preflight: { swIntercepted: true, C4: 'pass' },
      });
    },
  },
  {
    name: 'AF-2: after composer-ready the C8 report is the one shown, with the tripwire set; both probes are recorded so',
    script: (r) =>
      toShare(r).send(
        report({ canvas: { w: 1080, h: 1920, css: { x: 0, y: 0, w: 511, h: 909 } } }),
        agent('sw-intercepted'),
      ),
    phase: 'closing',
    error: 'SW_INTERCEPTS',
    check: (r) => {
      const closing = r.statuses.find((st) => st.phase === 'closing');
      expect(closing?.probe).toMatchObject({ swIntercepted: true, canvas: { w: 1080 } });
      expect(lastRecord(r)).toMatchObject({
        probe: { swIntercepted: true },
        readyProbe: { swIntercepted: true },
        preflight: { swIntercepted: true },
      });
    },
  },
  {
    name: 'P3: an interception reported after the composer was left changes nothing (an upload may run)',
    script: (r) => toShareRehearsalOff(r).send(tab(undefined, HOME), agent('sw-intercepted')),
    phase: 'finished',
    lacks: ['closeWindow'],
    check: (r) => expect(r.state).toMatchObject({ holdOpen: true }),
  },

  // AM2: every later document load re-probes.
  {
    name: 'AM2: a later full-document load re-probes strictly; is_mobile unknown → DESKTOP_SHELL',
    script: (r) => {
      toShare(r).send(tab('loading', COMPOSER_URL));
      expect(r.state).toMatchObject({
        phase: 'probing',
        step: 'awaitComplete',
        amLoad: true,
        resumeFrom: 'awaitingShare',
      });
      // A fresh agent: a new document (AM16), so the probe is strict.
      r.send(tab('complete', COMPOSER_URL), { type: 'agentInjected', fresh: true });
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitReport', strict: true });
      r.send(report({ isMobile: 'unknown' }));
    },
    phase: 'closing',
    error: 'DESKTOP_SHELL',
    injects: 1,
    check: (r) => {
      expect(r.count((e) => e.type === 'injectAgent')).toBe(2);
      expect(r.count((e) => e.type === 'hardReload')).toBe(1);
    },
  },
  {
    name: 'AM2/P3: a later load whose requests a worker handled → SW_INTERCEPTS',
    script: (r) => {
      toPick(r).send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), { type: 'agentInjected' });
      r.send(report({ swIntercepted: true, navType: 'navigate', storyInput: 'absent' }));
    },
    phase: 'closing',
    error: 'SW_INTERCEPTS',
  },
  {
    name: 'AM2/P1: a later load that is merely SW-controlled (no interception) resumes as H0',
    script: (r) => {
      toPick(r).send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), { type: 'agentInjected' });
      r.send(report({ swControlled: true, navType: 'navigate', storyInput: 'absent' }));
    },
    phase: 'awaitingPick',
    error: 'INPUT_MISSING',
  },
  {
    name: 'AM2: a passing re-probe during injecting resumes as H0 (no re-inject, no upgrade)',
    script: (r) => {
      toInjecting(r).send(tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL));
      r.send({ type: 'agentInjected' }, report());
    },
    phase: 'awaitingPick',
    error: 'INJECTION_IGNORED',
    injects: 1,
  },
  {
    name: 'AM2: a load before the first report also makes that probe strict',
    script: (r) => {
      toReport(r).send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), { type: 'agentInjected' });
      r.send(report({ isMobile: 'unknown' }));
    },
    phase: 'closing',
    error: 'DESKTOP_SHELL',
  },
  {
    name: 'never a second hard reload, however many loads follow',
    script: (r) => {
      toPick(r);
      for (let i = 0; i < 5; i++) r.send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL));
      r.send({ type: 'agentInjected' }, report({ storyInput: 'absent' }));
    },
    phase: 'awaitingPick',
    check: (r) => expect(r.count((e) => e.type === 'hardReload')).toBe(1),
  },
  {
    name: "reload race: the SW-served first load's complete is not probed",
    script: (r) => {
      r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED, tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL));
      expect(r.phase).toBe('reloading');
      r.send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL));
    },
    phase: 'probing',
    check: (r) => {
      expect(r.count((e) => e.type === 'injectAgent')).toBe(1);
      expect(r.state).toMatchObject({ strict: false });
    },
  },

  // C5 and C9.
  {
    name: 'homeOnly route: H0 "tap + → Story"; / is not "composer left" before the composer',
    script: (r) => {
      toReloading(r).send(tab('complete', HOME), { type: 'agentInjected' }, report({ storyInput: 'absent' }));
      // P5: on home the input may mount after hydration: one wait, then H0.
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitInput', route: 'homeOnly' });
      r.send(INPUT_WAITED);
      expect(r.state).toMatchObject({ phase: 'awaitingPick', route: 'homeOnly', composerReached: false });
      expect(r.lastStatus).toMatchObject({ route: 'homeOnly', error: 'INPUT_MISSING' });
      r.send(tab('complete', HOME), agent('composer-left'));
      expect(r.phase).toBe('awaitingPick');
      // The owner taps + → Story (SPA), picks the file, shares; the composer goes home.
      r.send(tab(undefined, COMPOSER_URL), agent('composer-ready'), tab(undefined, HOME));
    },
    phase: 'finished',
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ detectedPosted: true, route: 'homeOnly' });
      const rec = r.effects.find((e) => e.type === 'writeRecord');
      expect(rec?.type === 'writeRecord' && rec.record.preflight?.C5).toBe('fail');
    },
  },
  {
    name: 'AM18: leaving the composer from H0 before anything was picked is not C9; it goes homeOnly',
    script: (r) => {
      toPick(r).send(agent('composer-left'));
      expect(r.phase).toBe('awaitingPick');
      r.send(tab(undefined, HOME));
      expect(r.state).toMatchObject({ phase: 'awaitingPick', route: 'homeOnly' });
      expect(r.lastStatus).toMatchObject({ phase: 'awaitingPick', route: 'homeOnly' });
      // The owner taps + → Story, picks; then Share takes the composer home: now that is C9.
      r.send(tab(undefined, COMPOSER_URL), agent('composer-ready'), tab(undefined, HOME));
    },
    phase: 'finished',
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ detectedPosted: true, route: 'homeOnly' });
      expect(lastOutcome(r)).toBe('posted-confirmed');
      const rec = r.effects.find((e) => e.type === 'writeRecord');
      expect(rec?.type === 'writeRecord' && rec.record.preflight?.C5).toBe('fail');
    },
  },
  {
    name: 'composer left during an AM2 re-probe from awaitingShare counts as posted',
    script: (r) => toShare(r).send(tab('loading', COMPOSER_URL), tab('loading', HOME)),
    phase: 'finished',
    check: (r) => expect(r.lastStatus?.detectedPosted).toBe(true),
  },

  // AM21 (SAFE-1): the panel shows the session's switches, not later edits of the settings.
  {
    name: 'AM21: statuses carry the session snapshot; settings edited mid-session change neither rules nor statuses',
    script: (r) => {
      toPick(r);
      // The owner switches rehearsal and assisted insert off while the popup is open.
      r.opts.settings = { rehearsal: false, assistedInsert: false };
      r.send(agent('composer-ready'), tab(undefined, HOME));
    },
    phase: 'finished',
    check: (r) => {
      for (const st of r.statuses) expect(st).toMatchObject({ rehearsal: true, assistedInsert: true });
      expect(r.count((e) => e.type === 'installRules')).toBe(1);
      // Rehearsal stayed on for this session: the popup closes in 3 s as usual.
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'closeDelay', ms: CLOSE_DELAY_MS });
    },
  },
  {
    name: 'AM21: a probe-mode session reports assisted insert off (it never inserts)',
    script: (r) => toReport(r, 'probe'),
    phase: 'probing',
    check: (r) => expect(r.lastStatus).toMatchObject({ rehearsal: true, assistedInsert: false }),
  },

  // AM17 (SAFE-2): security paths kill; unknown www pages fail closed.
  {
    name: 'AM17: the reload lands on /accounts/suspended → kill and lock, never injected',
    script: (r) => toReloading(r).send(tab('complete', SUSPENDED)),
    phase: 'closing',
    error: 'KILLED_CHALLENGE',
    has: ['closeWindow', 'lockMsite'],
    lacks: ['injectAgent'],
    check: (r) => expect(lastOutcome(r)).toBe('killed:KILLED_CHALLENGE'),
  },
  {
    name: 'AM17: /auth_platform/codeentry after composer-ready → kill and lock, not "posted"',
    script: (r) => toShare(r).send(tab(undefined, CODE_ENTRY)),
    phase: 'closing',
    error: 'KILLED_CHALLENGE',
    has: ['lockMsite'],
    check: (r) => {
      expect(r.statuses.some((st) => st.phase === 'finished')).toBe(false);
      expect(lastOutcome(r)).toBe('killed:KILLED_CHALLENGE');
    },
  },
  {
    name: 'AM17: the first load redirected to /accounts/suspended → kill, no reload',
    script: (r) => {
      r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED, tab('loading', SUSPENDED));
    },
    phase: 'closing',
    error: 'KILLED_CHALLENGE',
    has: ['lockMsite'],
    lacks: ['hardReload'],
  },
  {
    name: 'AM17: an unknown www page on the first load → UNEXPECTED_PAGE, no reload, no lock',
    script: (r) => {
      r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED, tab('loading', CONSENT));
    },
    phase: 'closing',
    error: 'UNEXPECTED_PAGE',
    lacks: ['hardReload', 'lockMsite', 'injectAgent'],
    check: (r) => {
      expect(lastOutcome(r)).toBe('failed:UNEXPECTED_PAGE');
      // AM28: the page is named (query dropped) on the status and the record: a contract fact for L4.
      expect(r.lastStatus?.detail).toBe('page /consent/');
      expect(lastRecord(r)).toMatchObject({ detail: 'page /consent/' });
    },
  },
  {
    name: 'AM17: the reload lands on an unknown www page → UNEXPECTED_PAGE, never injected, no lock',
    script: (r) => toReloading(r).send(tab('complete', CONSENT)),
    phase: 'closing',
    error: 'UNEXPECTED_PAGE',
    lacks: ['injectAgent', 'lockMsite'],
    check: (r) => expect(lastRecord(r)).toMatchObject({ detail: 'page /consent/' }),
  },
  {
    name: 'AM17: an unknown www page while waiting for the pick → UNEXPECTED_PAGE, no "posted"',
    script: (r) => toPick(r).send(tab('loading', CONSENT)),
    phase: 'closing',
    error: 'UNEXPECTED_PAGE',
    lacks: ['lockMsite'],
    check: (r) => {
      expect(r.statuses.some((st) => st.phase === 'finished')).toBe(false);
      expect(r.lastStatus?.detail).toBe('page /consent/');
    },
  },
  {
    name: 'AM17: an unknown www page after Share → finished, not pre-answered, the status says why',
    script: (r) => toShare(r).send(tab(undefined, CONSENT)),
    phase: 'finished',
    lacks: ['lockMsite'],
    check: (r) => {
      // AM28: no pre-answer at all (postedUnknown), and the page is named.
      expect(r.lastStatus).toMatchObject({
        phase: 'finished',
        detectedPosted: false,
        postedUnknown: true,
        error: 'UNEXPECTED_PAGE',
        detail: 'page /consent/',
      });
      expect(r.state).toMatchObject({ postedUnknown: true, unexpectedPage: '/consent/' });
      expect(lastOutcome(r)).toBe('not-posted');
      expect(lastRecord(r)).toMatchObject({ detail: 'UNEXPECTED_PAGE /consent/' });
    },
  },

  // AM16 (RUN-1): same-document loads (pushState, replaceState) resume; new documents re-probe.
  {
    name: 'AM16: a same-document load in awaitingShare (H1) resumes at H1, with no probe and no error',
    script: (r) => {
      toShare(r);
      const commands = r.count((e) => e.type === 'sendAgent');
      r.send(
        tab('loading', `${COMPOSER_URL}?step=edit`),
        tab('complete', `${COMPOSER_URL}?step=edit`),
        injected(false),
      );
      expect(r.count((e) => e.type === 'sendAgent')).toBe(commands);
    },
    phase: 'awaitingShare',
    error: null,
    injects: 1,
    check: (r) => {
      expect(r.state).toMatchObject({ level: 'H1', degradedFrom: null });
      r.send(tab(undefined, HOME));
      expect(r.state).toMatchObject({ phase: 'finished', level: 'H1', detectedPosted: true });
      const rec = r.effects.find((e) => e.type === 'writeRecord');
      expect(rec?.type === 'writeRecord' && rec.record.level).toBe('H1');
    },
  },
  {
    name: 'AM16: a same-document load during injecting resumes it; a composer-ready sent meanwhile is replayed',
    script: (r) => {
      toInjecting(r).send({ type: 'agentGetFile' }, tab('loading', COMPOSER_URL));
      // The agent's ready event lands while the background does not yet know which document it is.
      r.send(agent('composer-ready'), tab('complete', COMPOSER_URL), injected(false));
    },
    phase: 'awaitingShare',
    error: null,
    injects: 1,
    check: (r) => {
      expect(r.state).toMatchObject({ level: 'H1' });
      // No second watch: a restart would clear the agent's H1 deadline.
      expect(r.effects.map(watchMs).filter((m) => m !== null)).toEqual([INJECT_READY_TIMEOUT_MS]);
    },
  },
  {
    name: 'AM16: C1 unknown on the first probe, then a pushState: no strict re-probe, no DESKTOP_SHELL',
    script: (r) => {
      toReport(r).send(report({ isMobile: 'unknown' }), { type: 'agentGetFile' }, agent('composer-ready'));
      r.send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), injected(false));
    },
    phase: 'awaitingShare',
    error: null,
  },
  {
    name: 'AM16: composer-left buffered during a same-document re-injection after Share → posted',
    script: (r) => {
      toShare(r).send(tab('loading', COMPOSER_URL), agent('composer-left'));
      r.send(tab('complete', COMPOSER_URL), injected(false));
    },
    phase: 'finished',
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ detectedPosted: true });
      expect(lastOutcome(r)).toBe('posted-confirmed');
    },
  },
  {
    name: 'AM16: events buffered across two quick same-document loads are still replayed',
    script: (r) => {
      toShare(r).send(tab('loading', COMPOSER_URL), agent('composer-left'), tab('complete', COMPOSER_URL));
      r.send(tab('loading', `${COMPOSER_URL}?x`), tab('complete', `${COMPOSER_URL}?x`), injected(false));
    },
    phase: 'finished',
    check: (r) => expect(r.lastStatus).toMatchObject({ detectedPosted: true }),
  },
  {
    name: 'AM16: events buffered before a new document are dropped; the new document is probed strictly',
    script: (r) => {
      toPick(r).send(tab('loading', COMPOSER_URL), agent('composer-ready'), tab('complete', COMPOSER_URL));
      r.send(injected(true), report({ storyInput: 'absent' }));
    },
    phase: 'awaitingPick',
    check: (r) => expect(r.statuses.some((st) => st.phase === 'awaitingShare')).toBe(false),
  },
  {
    name: 'AM16: a pushState during the first probe re-probes the same document non-strictly',
    script: (r) => {
      toReport(r).send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), injected(false));
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitReport', strict: false });
      r.send(report({ isMobile: 'unknown' }));
    },
    phase: 'injecting',
    injects: 1,
  },

  // AM19 (RUN-2): never cut off an upload that may still run after Share.
  {
    name: 'AM19: rehearsal off, C9 after Share holds the popup open until the owner answers',
    script: (r) => {
      r.send(startEv('post', SCREEN, false));
      r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
      r.send(tab('complete', COMPOSER_URL), { type: 'agentInjected' }, report(), { type: 'agentGetFile' });
      r.send(agent('composer-ready'), tab(undefined, HOME));
      expect(r.state).toMatchObject({ phase: 'finished', holdOpen: true, detectedPosted: true });
      expect(r.lastStatus).toMatchObject({ phase: 'finished', holdOpen: true, rehearsal: false });
      expect(r.effects.some((e) => e.type === 'armTimer' && e.timer === 'closeDelay')).toBe(false);
      // A stray closeDelay does nothing; the answer (even the pre-answered "yes") closes it.
      r.tick(CLOSE_DELAY_MS).send({ type: 'timer', timer: 'closeDelay' });
      r.send({ type: 'outcome', handoffId: 'hof_u1', posted: true });
    },
    phase: 'closing',
    has: ['closeWindow'],
    lacks: ['patchRecordOutcome'],
    check: (r) => expect(lastOutcome(r)).toBe('posted-confirmed'),
  },
  {
    name: 'AM19: a held-open popup answered "not posted" closes and patches the record',
    script: (r) => {
      r.send(startEv('post', SCREEN, false));
      r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
      r.send(tab('complete', COMPOSER_URL), { type: 'agentInjected' }, report({ storyInput: 'absent' }), INPUT_WAITED);
      r.send(agent('composer-ready'), agent('composer-left'));
      r.send({ type: 'outcome', handoffId: 'hof_u1', posted: false });
    },
    phase: 'closing',
    has: ['closeWindow', 'patchRecordOutcome'],
    check: (r) => {
      const ts = types(r.steps.at(-1)?.effects ?? []);
      expect(ts[0]).toBe('closeWindow');
      expect(r.effects).toContainEqual({ type: 'patchRecordOutcome', handoffId: 'hof_u1', outcome: 'not-posted' });
    },
  },
  {
    name: 'AM19: a held-open popup still closes after 15 quiet minutes',
    script: (r) => {
      r.send(startEv('post', SCREEN, false));
      r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
      r.send(tab('complete', COMPOSER_URL), { type: 'agentInjected' }, report({ storyInput: 'absent' }), INPUT_WAITED);
      r.send(agent('composer-ready'), tab(undefined, HOME));
      r.tick(INACTIVITY_TIMEOUT_MS).send({ type: 'timer', timer: 'inactivity' });
    },
    phase: 'closing',
    has: ['closeWindow'],
    check: (r) => expect(lastOutcome(r)).toBe('posted-confirmed'),
  },
  {
    name: 'AM19: rehearsal off, but home before the composer was ready: closes in 3 s as before',
    script: (r) => {
      r.send(startEv('post', SCREEN, false));
      r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
      r.send(tab('complete', COMPOSER_URL), { type: 'agentInjected' }, report(), { type: 'agentGetFile' });
      r.send(tab(undefined, HOME));
    },
    phase: 'finished',
    check: (r) => {
      expect(r.state).toMatchObject({ holdOpen: false, detectedPosted: false });
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'closeDelay', ms: CLOSE_DELAY_MS });
    },
  },

  // AM24 (RUN-3): composer-ready counts in H1 only after the insert.
  {
    name: 'AM24: composer-ready before the file was served is ignored; the insert then decides',
    script: (r) => {
      toInjecting(r).send(agent('composer-ready'));
      expect(r.phase).toBe('injecting');
      r.send({ type: 'agentGetFile' }, agent('inject-ignored'));
    },
    phase: 'awaitingPick',
    error: 'INJECTION_IGNORED',
    injects: 1,
    check: (r) => expect(r.statuses.some((st) => st.phase === 'awaitingShare')).toBe(false),
  },

  // AM18 (RUN-4): a client-side redirect home before the composer is used is C5, not C9.
  {
    name: 'AM18: a client redirect home during the first probe → H0 "tap + → Story", C5 fails, not finished',
    script: (r) => {
      toReloading(r).send(tab('complete', COMPOSER_URL), tab(undefined, HOME));
      expect(r.state).toMatchObject({ phase: 'probing', route: 'homeOnly' });
      r.send({ type: 'agentInjected' }, report({ storyInput: 'absent' }), INPUT_WAITED);
    },
    phase: 'awaitingPick',
    error: 'INPUT_MISSING',
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ route: 'homeOnly' });
      r.send(agent('composer-ready'), tab(undefined, HOME));
      const rec = r.effects.find((e) => e.type === 'writeRecord');
      expect(rec?.type === 'writeRecord' && rec.record).toMatchObject({
        route: 'homeOnly',
        outcome: 'posted-confirmed',
        preflight: { C5: 'fail' },
      });
    },
  },
  {
    name: 'AM18: a pushState home during the first probe (status loading) → re-probed, H0 homeOnly',
    script: (r) => {
      toReport(r).send(tab('loading', HOME), tab('complete', HOME), injected(false), report({ storyInput: 'absent' }));
      r.send(INPUT_WAITED);
    },
    phase: 'awaitingPick',
    check: (r) => expect(r.state).toMatchObject({ route: 'homeOnly', level: 'H0' }),
  },
  {
    name: 'AM18: home while injecting, before the file was served → H0 homeOnly, no second inject',
    script: (r) => {
      toInjecting(r).send(tab('loading', HOME), tab('complete', HOME), injected(false));
      r.send({ type: 'agentGetFile' });
    },
    phase: 'awaitingPick',
    error: 'INJECTION_IGNORED',
    injects: 1,
    lacks: ['serveFile'],
    check: (r) => {
      expect(r.state).toMatchObject({ route: 'homeOnly', level: 'H0' });
      expect(r.effects.map(watchMs).filter((m) => m !== null)).toEqual([INJECT_READY_TIMEOUT_MS, 0]);
    },
  },
  {
    name: 'AM18: home while injecting, URL-only update (no commit) → H0 homeOnly at once',
    script: (r) => toInjecting(r).send(tab(undefined, HOME)),
    phase: 'awaitingPick',
    error: 'INJECTION_IGNORED',
    check: (r) => expect(r.state).toMatchObject({ route: 'homeOnly' }),
  },
  {
    name: 'AM18: home after the H1 file was served (engaged) counts as C9, not posted',
    script: (r) => toInjecting(r).send({ type: 'agentGetFile' }, tab(undefined, HOME)),
    phase: 'finished',
    check: (r) => expect(r.lastStatus).toMatchObject({ detectedPosted: false }),
  },

  // AM20 (RUN-5): the first navigation is classified before the kill switch arms.
  {
    name: 'AM20: the first load goes off-host (hidden URL change) → kill and lock, no reload',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      r.send(tab('loading', undefined), tab(undefined, undefined));
    },
    phase: 'closing',
    error: 'KILLED_OFFHOST',
    has: ['closeWindow', 'lockMsite'],
    lacks: ['hardReload'],
  },
  {
    name: 'AM20: the first load lands on a visible non-www URL → kill',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      r.send(tab('loading', 'https://i.instagram.com/create/story/'));
    },
    phase: 'closing',
    error: 'KILLED_OFFHOST',
    has: ['lockMsite'],
  },
  {
    name: "AM20: about:blank's own load in navigating is not a kill; the www commit still reloads",
    script: (r) => {
      DRIVE_NAVIGATING(r);
      r.send(tab('loading', undefined), tab('complete', undefined), tab('loading', COMPOSER_URL));
    },
    phase: 'reloading',
    has: ['hardReload'],
    lacks: ['lockMsite', 'closeWindow'],
  },
  {
    name: 'AM20/AM28: no commit within the navigation deadline → NAVIGATION_TIMEOUT (not the 15 min TIMEOUT), no lock',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      r.tick(NAVIGATION_TIMEOUT_MS).send({ type: 'timer', timer: 'navigation' });
    },
    phase: 'closing',
    error: 'NAVIGATION_TIMEOUT',
    lacks: ['lockMsite'],
    check: (r) => expect(lastOutcome(r)).toBe('failed:NAVIGATION_TIMEOUT'),
  },
  {
    name: 'AM20/AM28: the navigation deadline lost with a worker restart: the 15 min backstop still kills after an off-host load',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      r.send(tab('loading', undefined), tab('complete', undefined));
      r.tick(INACTIVITY_TIMEOUT_MS).send({ type: 'timer', timer: 'inactivity' });
    },
    phase: 'closing',
    error: 'KILLED_OFFHOST',
    has: ['closeWindow', 'lockMsite'],
    check: (r) => expect(lastOutcome(r)).toBe('killed:KILLED_OFFHOST'),
  },
  {
    name: 'AM20: the 15 min backstop in navigating with nothing off-host seen is a plain TIMEOUT',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      r.tick(INACTIVITY_TIMEOUT_MS).send({ type: 'timer', timer: 'inactivity' });
    },
    phase: 'closing',
    error: 'TIMEOUT',
    lacks: ['lockMsite'],
  },
  {
    name: 'AM20: hidden-URL loads and no www commit by the deadline → KILLED_OFFHOST',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      r.send(tab('loading', undefined), tab('complete', undefined));
      r.tick(NAVIGATION_TIMEOUT_MS).send({ type: 'timer', timer: 'navigation' });
    },
    phase: 'closing',
    error: 'KILLED_OFFHOST',
    has: ['lockMsite'],
  },
  {
    name: 'AM20: a late navigation deadline after the reload does nothing',
    script: (r) => toReloading(r).send({ type: 'timer', timer: 'navigation' }),
    phase: 'reloading',
    lacks: ['closeWindow'],
  },

  // AM28 (R2S-1, R2S-3): once a fresh agent shows a new document, the interrupted phase is gone.
  {
    name: 'AM28: a new document, then a same-document load before its report: still probed strictly, never resumed',
    script: (r) => {
      toShare(r).send(...NEW_DOCUMENT, ...SAME_DOCUMENT);
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitReport', strict: true, resumeFrom: null });
      r.send(report({ isMobile: 'unknown' }));
    },
    phase: 'closing',
    error: 'DESKTOP_SHELL',
    injects: 1,
  },
  {
    name: 'AM28: from injecting, a new document then a same-document load: re-probed, a pass is H0 with its own watch',
    script: (r) => {
      toInjecting(r).send(...NEW_DOCUMENT, ...SAME_DOCUMENT);
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitReport', resumeFrom: null });
      r.send(report());
    },
    phase: 'awaitingPick',
    error: 'INJECTION_IGNORED',
    injects: 1,
    check: (r) => {
      expect(r.state).toMatchObject({ level: 'H0', degradedFrom: 'INJECTION_IGNORED' });
      expect(r.effects.map(watchMs).filter((m) => m !== null)).toEqual([INJECT_READY_TIMEOUT_MS, 0]);
    },
  },
  {
    name: 'AM28: rehearsal off, home while the new document is probed: not "posted", not held open, C5 homeOnly',
    script: (r) => {
      toShareRehearsalOff(r).send(...NEW_DOCUMENT, tab('loading', HOME));
      expect(r.state).toMatchObject({ phase: 'probing', route: 'homeOnly' });
      r.send(tab('complete', HOME), injected(true), report({ storyInput: 'absent' }));
    },
    phase: 'awaitingPick',
    check: (r) => {
      expect(r.statuses.some((st) => st.phase === 'finished')).toBe(false);
      expect(r.state).toMatchObject({ route: 'homeOnly', level: 'H0' });
    },
  },
  {
    name: 'AM28: an unknown page while the new document is probed is UNEXPECTED_PAGE, not an unanswered "Posted?"',
    script: (r) => toShareRehearsalOff(r).send(...NEW_DOCUMENT, tab(undefined, CONSENT)),
    phase: 'closing',
    error: 'UNEXPECTED_PAGE',
    check: (r) => expect(r.statuses.some((st) => st.phase === 'finished')).toBe(false),
  },

  // AM28 (R2S-2): an insert dispatched but never confirmed by C6 keeps the composer engaged.
  {
    name: 'AM28: insert dispatched, C6 never confirmed, then home: C9 with no pre-answer, held open, route kept',
    script: (r) => {
      toInjecting(r).send({ type: 'agentGetFile' }, agent('inject-unconfirmed'));
      expect(r.state).toMatchObject({
        phase: 'awaitingPick',
        level: 'H0',
        degradedFrom: 'INJECTION_IGNORED',
        insertDispatched: true,
      });
      expect(r.lastStatus?.error).toBe('INJECTION_IGNORED');
      r.send(tab(undefined, HOME));
    },
    phase: 'finished',
    injects: 1,
    lacks: ['closeWindow'],
    check: (r) => {
      expect(r.state).toMatchObject({ detectedPosted: false, postedUnknown: true, holdOpen: true, route: 'direct' });
      expect(r.lastStatus).toMatchObject({ detectedPosted: false, postedUnknown: true, holdOpen: true });
      expect(r.effects.some((e) => e.type === 'armTimer' && e.timer === 'closeDelay')).toBe(false);
      expect(lastRecord(r)).toMatchObject({ outcome: 'not-posted', detail: expect.stringContaining('not confirmed') });
      // A later timeout closes it, and the outcome stays answerable.
      r.tick(INACTIVITY_TIMEOUT_MS).send({ type: 'timer', timer: 'inactivity' });
      expect(r.phase).toBe('closing');
      expect(r.send({ type: 'outcome', handoffId: 'hof_u1', posted: true })).toEqual([
        { type: 'patchRecordOutcome', handoffId: 'hof_u1', outcome: 'posted-confirmed' },
      ]);
    },
  },
  {
    name: "AM28: after an unconfirmed insert, the agent's composer-left is C9 too",
    script: (r) => toInjecting(r).send({ type: 'agentGetFile' }, agent('inject-unconfirmed'), agent('composer-left')),
    phase: 'finished',
    check: (r) => expect(r.state).toMatchObject({ postedUnknown: true, holdOpen: true }),
  },
  {
    name: 'AM28: after an unconfirmed insert the owner picks by hand: C6, Share, home → "posted", closes in 3 s',
    script: (r) =>
      toInjecting(r).send(
        { type: 'agentGetFile' },
        agent('inject-unconfirmed'),
        agent('composer-ready'),
        tab(undefined, HOME),
      ),
    phase: 'finished',
    check: (r) => {
      expect(r.state).toMatchObject({ detectedPosted: true, postedUnknown: false, holdOpen: false });
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'closeDelay', ms: CLOSE_DELAY_MS });
    },
  },
  {
    name: 'AM28: an insert that could not be made (inject-ignored), then home → still C5: awaitingPick homeOnly',
    script: (r) => toInjecting(r).send({ type: 'agentGetFile' }, agent('inject-ignored'), tab(undefined, HOME)),
    phase: 'awaitingPick',
    check: (r) => expect(r.state).toMatchObject({ route: 'homeOnly', insertDispatched: false }),
  },
  {
    name: 'AM28: an unconfirmed insert, then a new document: the insert went with it, home is C5 again',
    script: (r) => {
      toInjecting(r).send({ type: 'agentGetFile' }, agent('inject-unconfirmed'), ...NEW_DOCUMENT, report());
      expect(r.state).toMatchObject({ phase: 'awaitingPick', insertDispatched: false });
      r.send(tab(undefined, HOME));
    },
    phase: 'awaitingPick',
    check: (r) => expect(r.state).toMatchObject({ route: 'homeOnly' }),
  },
  {
    name: 'AM28: an unconfirmed insert, then an unknown page: finished with no pre-answer, the status names the page',
    script: (r) => toInjecting(r).send({ type: 'agentGetFile' }, agent('inject-unconfirmed'), tab(undefined, CONSENT)),
    phase: 'finished',
    error: 'UNEXPECTED_PAGE',
    check: (r) => expect(r.lastStatus).toMatchObject({ postedUnknown: true, detail: 'page /consent/', holdOpen: true }),
  },

  // AM23 (SAFE-7): guarded builds refuse in branded browsers before any window opens.
  {
    name: 'AM23/AM28: a guarded build in a branded browser → BRANDED_BROWSER (not the marker check), no window, no open noted',
    opts: { brandedBrowser: true },
    script: (r) => r.send(startEv()),
    phase: 'idle',
    error: 'BRANDED_BROWSER',
    lacks: ['openWindow', 'noteOpen'],
    check: (r) => expect(r.lastStatus).toMatchObject({ handoffId: null }),
  },
  {
    name: 'AM23: the live build in a branded browser proceeds',
    opts: { guarded: false, brandedBrowser: true },
    script: (r) => r.send(startEv()),
    phase: 'opening',
    has: ['openWindow'],
  },

  // W2/W3 (Arc, 2026-10-12): a verified fit, one retry, then the guided resize.
  {
    name: 'W2 hardening: the runner re-applied the box within the first update (Arc dropped the early ones) → navigating, no retry',
    script: (r) => {
      toArcFit(r);
      const f = fitFor();
      r.send(verify(f, true, ARC_TAB, 3));
    },
    phase: 'navigating',
    has: ['navigate'],
    check: (r) => {
      expect(r.count((e) => e.type === 'updateWindow')).toBe(1);
      expect(r.count((e) => e.type === 'armTimer' && e.timer === 'fitRetry')).toBe(0);
      if (r.state.phase === 'idle') throw new Error('unreachable');
      expect(r.state.win).toMatchObject({ attempts: 1, created: ARC_WINDOW });
      expect(r.state.win.updates).toEqual([expect.objectContaining({ step: 'fit', fitted: true, applied: 3 })]);
      r.send({ type: 'cancel' });
      expect(lastRecord(r)?.window?.updates[0]?.applied).toBe(3);
    },
  },
  {
    name: 'W2 hardening: an implausible `applied` is recorded as one windows.update',
    script: (r) => {
      toArcFit(r);
      r.send(verify(fitFor(), true, ARC_TAB, Number.NaN));
    },
    phase: 'navigating',
    check: (r) => {
      if (r.state.phase === 'idle') throw new Error('unreachable');
      expect(r.state.win.updates[0]?.applied).toBe(1);
    },
  },
  {
    name: 'W1/W2: Arc ignored the create; the first update does not verify; one retry 300 ms later fits → navigating',
    script: (r) => {
      toArcFit(r);
      const f = fitFor();
      // 524x932 inner (+47 frame), centred on the ultrawide the editor is on.
      expect(f.outer).toEqual({ left: 2970, top: -212, width: 524, height: 979 });
      expect(r.steps.at(-1)?.effects).toEqual([
        { type: 'updateWindow', windowId: WIN, tabId: TAB, box: f.outer, inner: { w: 524, h: 932 }, reapply: true },
      ]);
      expect(r.send(verify(f, false))).toEqual([{ type: 'armTimer', timer: 'fitRetry', ms: FIT_RETRY_DELAY_MS }]);
      expect(r.state).toMatchObject({ phase: 'fitting', fitStep: 'retryWait' });
      expect(r.tick(FIT_RETRY_DELAY_MS).send(RETRY)).toEqual([
        { type: 'updateWindow', windowId: WIN, tabId: TAB, box: f.outer, inner: f.inner, reapply: true },
      ]);
      r.send(verify(f, true));
    },
    phase: 'navigating',
    has: ['navigate'],
    check: (r) => {
      const guess = firstGuess(OWNER_UW);
      if (!guess.ok) throw new Error('fixture');
      expect(r.state).toMatchObject({
        win: {
          screen: OWNER_UW,
          requested: guess.outer,
          created: ARC_WINDOW,
          createdTab: ARC_TAB,
          frameDelta: ARC_DELTA,
          attempts: 2,
          manualResize: false,
          finalTab: { w: 524, h: 932 },
          zoom: 1,
        },
      });
      if (r.state.phase === 'idle') throw new Error('unreachable');
      expect(r.state.win.updates.map((u) => [u.step, u.fitted])).toEqual([
        ['fit', false],
        ['retry', true],
      ]);
      // The record shows created ≠ requested and the final fit (E2E a).
      r.send({ type: 'cancel' });
      expect(lastRecord(r)?.window).toMatchObject({ created: ARC_WINDOW, attempts: 2, finalTab: { w: 524, h: 932 } });
    },
  },
  {
    name: 'W2: the retry misses but the tab is usable anyway (600x900) → navigating, no guided resize',
    script: (r) => {
      const f = fitFor();
      toArcFit(r).send(verify(f, false), RETRY, verify(f, false, { w: 600, h: 900 }));
    },
    phase: 'navigating',
    has: ['navigate'],
    lacks: ['readSize'],
    check: (r) =>
      expect(r.state).toMatchObject({ win: { attempts: 2, manualResize: false, finalTab: { w: 600, h: 900 } } }),
  },
  {
    name: 'W2: never a third fit update: stray retries and verifications change nothing',
    script: (r) => {
      const f = fitFor();
      toArcFit(r).send(RETRY, verify(f, false), RETRY, RETRY, verify(f, true), RETRY, verify(f, false));
    },
    phase: 'navigating',
    check: (r) => {
      expect(r.count((e) => e.type === 'updateWindow')).toBe(2);
      expect(r.count((e) => e.type === 'navigate')).toBe(1);
    },
  },
  {
    name: 'W2/W3: both updates ignored (1512x902) → resizing: deadline and poll armed, the size shown as not usable',
    script: (r) => toResizing(r),
    phase: 'resizing',
    lacks: ['navigate'],
    check: (r) => {
      const effects = r.steps.at(-1)?.effects ?? [];
      expect(effects.slice(0, 2)).toEqual([
        { type: 'armTimer', timer: 'resizeDeadline', ms: RESIZE_TIMEOUT_MS },
        { type: 'armTimer', timer: 'resizePoll', ms: RESIZE_POLL_MS },
      ]);
      expect(r.lastStatus).toMatchObject({
        phase: 'resizing',
        resize: { tab: ARC_TAB, ok: false, until: T0 + RESIZE_TIMEOUT_MS, maxW: 767 },
        window: { attempts: 2, manualResize: false },
      });
    },
  },
  {
    name: 'AF-8: at another default zoom the resize status names the width its ✓ uses (767 × zoom)',
    script: (r) => {
      const f = fitFor(OWNER_UW, ARC_DELTA);
      r.send(startEv('post', OWNER_UW), { type: 'windowCreated', windowId: WIN, tabId: TAB });
      r.send({ type: 'rulesInstalled' }, { ...ARC_MEASURED, zoom: 1.1 } as HandoffEvent);
      const up = r.steps.at(-1)?.effects[0];
      if (up?.type !== 'updateWindow') throw new Error('expected the fit');
      const missed = verify(f, false);
      if (missed.type !== 'windowFitted') throw new Error('unreachable');
      const zoomed: HandoffEvent = { ...missed, box: up.box, target: up.inner };
      r.send(zoomed, RETRY, zoomed);
      expect(r.lastStatus).toMatchObject({ phase: 'resizing', resize: { ok: false, maxW: 843 } });
      // 800 window px at 110% is 727 CSS px: usable, and the status says so with the same limit.
      r.send(sized(800, 900));
    },
    phase: 'navigating',
    check: (r) => expect(r.lastStatus).toMatchObject({ resize: { tab: { w: 800, h: 900 }, ok: true, maxW: 843 } }),
  },
  {
    name: 'W3: windows.onBoundsChanged reads the size; a usable one → navigating, timers cleared, manual resize recorded',
    script: (r) => {
      toResizing(r);
      expect(r.send({ type: 'boundsChanged', windowId: WIN })).toEqual([
        { type: 'readSize', windowId: WIN, tabId: TAB },
      ]);
      expect(r.send({ type: 'boundsChanged', windowId: 99 })).toEqual([]);
      // Still too wide: only the indicator moves.
      expect(types(r.send(sized(900, 902)))).toEqual(['notifyEditor']);
      expect(r.lastStatus).toMatchObject({ phase: 'resizing', resize: { tab: { w: 900, h: 902 }, ok: false } });
      expect(r.send(sized(900, 902))).toEqual([]);
      const go = r.send(sized(493, 820));
      expect(go.slice(0, 4)).toEqual([
        { type: 'clearTimer', timer: 'resizeDeadline' },
        { type: 'clearTimer', timer: 'resizePoll' },
        { type: 'navigate', tabId: TAB, url: COMPOSER_URL },
        { type: 'armTimer', timer: 'navigation', ms: NAVIGATION_TIMEOUT_MS },
      ]);
    },
    phase: 'navigating',
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ phase: 'navigating', resize: { tab: { w: 493, h: 820 }, ok: true } });
      expect(r.state).toMatchObject({ win: { manualResize: true, finalTab: { w: 493, h: 820 }, attempts: 2 } });
    },
  },
  {
    name: 'W3: the poll reads the size every second and re-arms; landscape or too short sizes never pass',
    script: (r) => {
      toResizing(r);
      expect(r.tick(RESIZE_POLL_MS).send({ type: 'timer', timer: 'resizePoll' })).toEqual([
        { type: 'readSize', windowId: WIN, tabId: TAB },
        { type: 'armTimer', timer: 'resizePoll', ms: RESIZE_POLL_MS },
      ]);
      r.send(sized(700, 650), sized(600, 500), sized(500, 600));
    },
    phase: 'resizing',
    lacks: ['navigate'],
  },
  {
    name: 'W3: no usable size within 3 minutes → WINDOW_NOT_FITTED: close, no lock, never navigated',
    script: (r) => toResizing(r).tick(RESIZE_TIMEOUT_MS).send({ type: 'timer', timer: 'resizeDeadline' }),
    phase: 'closing',
    error: 'WINDOW_NOT_FITTED',
    has: ['closeWindow'],
    lacks: ['navigate', 'lockMsite', 'hardReload'],
    check: (r) => {
      expect(lastOutcome(r)).toBe('failed:WINDOW_NOT_FITTED');
      expect(lastRecord(r)?.window).toMatchObject({ attempts: 2, manualResize: false, finalTab: ARC_TAB });
      // Stale timers after the close do nothing.
      expect(r.send({ type: 'timer', timer: 'resizePoll' })).toEqual([]);
    },
  },
  {
    name: 'W3: a guarded E2E flag shortens the deadline',
    opts: { resizeTimeoutMs: 2000 },
    script: (r) => toResizing(r),
    phase: 'resizing',
    check: (r) => {
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'resizeDeadline', ms: 2000 });
      expect(r.state).toMatchObject({ resizeUntil: T0 + 2000 });
    },
  },
  {
    name: 'W3: a live build ignores the E2E deadline flag',
    opts: { guarded: false, resizeTimeoutMs: 2000 },
    script: (r) => toResizing(r),
    phase: 'resizing',
    check: (r) =>
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'resizeDeadline', ms: RESIZE_TIMEOUT_MS }),
  },
  {
    name: 'W3: cancel while resizing closes the popup (closeWindow first)',
    script: (r) => toResizing(r).send({ type: 'cancel' }),
    phase: 'closing',
    has: ['closeWindow'],
    check: (r) => {
      expect(r.steps.at(-1)?.effects[0]?.type).toBe('closeWindow');
      expect(lastOutcome(r)).toBe('abandoned');
    },
  },
  {
    name: 'W2: a failed windows.update while fitting closes the popup (AGENT_UNREACHABLE), never navigates',
    script: (r) => toArcFit(r).send({ type: 'effectFailed', effect: 'updateWindow', message: 'No window' }),
    phase: 'closing',
    error: 'AGENT_UNREACHABLE',
    lacks: ['navigate'],
  },
  {
    name: 'W2: a failed size read while resizing is ignored (the window going away ends it)',
    script: (r) => toResizing(r).send({ type: 'effectFailed', effect: 'readSize', message: 'No tab' }),
    phase: 'resizing',
  },

  // P4: the composer must be in msite's mobile layout (≤ 767 CSS px) and portrait.
  {
    name: 'P4: the failed live run’s probe (1512x902, SW-controlled, mobile) now refits instead of DESKTOP_SHELL',
    script: (r) => {
      toReport(r).send(
        report({
          inner: { w: 1512, h: 902 },
          portrait: false,
          swControlled: true,
          storyInput: 'absent',
          acceptOk: false,
          acceptSeen: [],
        }),
      );
      expect(r.steps.at(-1)?.effects).toEqual([{ type: 'measureTab', tabId: TAB, windowId: WIN, settle: false }]);
      r.send(MEASURED, FITTED, report({ swControlled: true }));
    },
    phase: 'injecting',
    injects: 1,
    check: (r) => expect(r.count((e) => e.type === 'updateWindow')).toBe(2),
  },
  {
    name: 'P4: a portrait composer wider than 767 CSS px refits once, then still too wide → LAYOUT_TOO_WIDE',
    script: (r) => {
      const wide = { inner: { w: 800, h: 1200 }, portrait: true };
      toReport(r).send(report(wide), MEASURED, FITTED, report(wide));
    },
    phase: 'closing',
    error: 'LAYOUT_TOO_WIDE',
    injects: 0,
    lacks: ['lockMsite'],
    check: (r) => {
      expect(lastOutcome(r)).toBe('failed:LAYOUT_TOO_WIDE');
      expect(lastRecord(r)?.preflight?.C4).toBe('unknown');
      // W5: the refit is on the record too.
      expect(lastRecord(r)?.window?.updates.map((u) => u.step)).toEqual(['fit', 'refit']);
    },
  },
  {
    name: 'P4: the refit uses the composer page’s zoom to keep the width at or below 767 CSS px',
    opts: { settings: { composerProfile: { innerW: 820, innerH: 1000, capturedAt: 1 } } },
    script: (r) => {
      toReport(r).send(report({ inner: { w: 820, h: 1000 } }));
      r.send({
        type: 'tabMeasured',
        inner: { w: 738, h: 900 },
        outer: { left: 0, top: 33, width: 738, height: 932 },
        zoom: 0.9,
      });
    },
    phase: 'probing',
    check: (r) => {
      const up = r.steps.at(-1)?.effects[0];
      if (up?.type !== 'updateWindow') throw new Error('expected the refit update');
      expect(up.inner.w).toBeLessThanOrEqual(Math.floor(767 * 0.9));
      // After the navigation: one windows.update, never the pre-navigation re-applies (Instagram sees it).
      expect(up.reapply).toBe(false);
      expect(r.state).toMatchObject({ step: 'refitUpdate', win: { zoom: 0.9 } });
    },
  },

  // P5: on `/` msite mounts the header input after hydration; H1 into it opens the composer by SPA.
  {
    name: 'P5: home without the input, it appears → one more probe → H1 into the header input → SPA to the composer → posted',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe({ storyInput: 'absent', acceptOk: false, acceptSeen: [] }));
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitInput', route: 'homeOnly', inputWaitUsed: true });
      expect(r.steps.at(-1)?.effects).toEqual([
        { type: 'sendAgent', tabId: TAB, command: { type: 'agent/watch', readyTimeoutMs: 0 } },
        { type: 'armTimer', timer: 'inputWait', ms: INPUT_WAIT_MS },
      ]);
      expect(r.send(agent('input-appeared'))).toEqual([
        { type: 'clearTimer', timer: 'inputWait' },
        { type: 'sendAgent', tabId: TAB, command: { type: 'agent/probe' } },
      ]);
      r.send(homeProbe());
      expect(r.state).toMatchObject({ phase: 'injecting', level: 'H1', injectAt: 'home' });
      // Title and favicon updates on home before the insert lands are not "composer left".
      r.send({ type: 'agentGetFile' }, tab(undefined, HOME), tab('complete', HOME));
      expect(r.state).toMatchObject({ phase: 'injecting', injectAt: 'home' });
      // The insert starts msite's story session: an SPA navigation to the composer (AM16).
      r.send(tab('loading', COMPOSER_URL), agent('composer-ready'), tab('complete', COMPOSER_URL), injected(false));
      expect(r.state).toMatchObject({ phase: 'awaitingShare', level: 'H1', injectAt: 'composer' });
      r.send(tab(undefined, HOME));
    },
    phase: 'finished',
    injects: 1,
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ detectedPosted: true, route: 'homeOnly' });
      expect(lastRecord(r)).toMatchObject({
        outcome: 'posted-confirmed',
        level: 'H1',
        route: 'homeOnly',
        preflight: { C4: 'pass', C5: 'fail' },
      });
    },
  },
  {
    name: 'P5: no input within 6 s → H0 INPUT_MISSING with "tap + → Story" (homeOnly); C4 fail',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe({ storyInput: 'absent', acceptOk: false, acceptSeen: [] }));
      r.tick(INPUT_WAIT_MS).send(INPUT_WAITED);
    },
    phase: 'awaitingPick',
    error: 'INPUT_MISSING',
    injects: 0,
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ route: 'homeOnly', c4: 'fail', path: '/' });
      // No second watch: the one started for the wait keeps running.
      expect(r.effects.map(watchMs).filter((m) => m !== null)).toEqual([0]);
    },
  },
  {
    name: 'P5: hydration’s replaceState during the wait resumes it (watch restarted, the rest re-armed)',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe({ storyInput: 'absent' }));
      r.tick(2000).send(tab('loading', `${HOME}?hl=en`), tab('complete', `${HOME}?hl=en`));
      // The deadline passing while the background re-injects does not end the wait by itself.
      expect(r.send(INPUT_WAITED)).toEqual([]);
      expect(r.send(injected(false))).toEqual([
        { type: 'sendAgent', tabId: TAB, command: { type: 'agent/watch', readyTimeoutMs: 0 } },
        { type: 'armTimer', timer: 'inputWait', ms: INPUT_WAIT_MS - 2000 },
      ]);
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitInput' });
      r.send(agent('input-appeared'), homeProbe());
    },
    phase: 'injecting',
    injects: 1,
    check: (r) => expect(r.count((e) => e.type === 'armTimer' && e.timer === 'inputWait')).toBe(2),
  },
  {
    name: 'P5: a same-document load that outlasts the wait: one more probe decides (no new wait)',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe({ storyInput: 'absent' }), tab('loading', HOME), tab('complete', HOME));
      r.tick(INPUT_WAIT_MS).send(injected(false));
      expect(r.steps.at(-1)?.effects).toEqual([{ type: 'sendAgent', tabId: TAB, command: { type: 'agent/probe' } }]);
      r.send(homeProbe({ storyInput: 'absent' }));
    },
    phase: 'awaitingPick',
    error: 'INPUT_MISSING',
  },
  {
    name: 'P5: a new document during the wait is probed strictly; the wait went with the old one',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe({ storyInput: 'absent' }), tab('loading', HOME), tab('complete', HOME));
      r.send(injected(true));
      expect(r.state).toMatchObject({ step: 'awaitReport', strict: true, inputWaitUntil: null });
      r.send(homeProbe({ storyInput: 'absent' }));
    },
    phase: 'awaitingPick',
    error: 'INPUT_MISSING',
    check: (r) => expect(r.count((e) => e.type === 'armTimer' && e.timer === 'inputWait')).toBe(1),
  },
  {
    name: 'P5: one wait only: the re-probe after input-appeared still finds none → H0 at once',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(
        homeProbe({ storyInput: 'absent' }),
        agent('input-appeared'),
        homeProbe({ storyInput: 'absent' }),
      );
    },
    phase: 'awaitingPick',
    error: 'INPUT_MISSING',
    check: (r) => expect(r.count((e) => e.type === 'armTimer' && e.timer === 'inputWait')).toBe(1),
  },
  {
    name: 'P5: an insert on home that never opens the composer is not engaged: unconfirmed → H0, home is not C9',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe(), { type: 'agentGetFile' }, agent('inject-unconfirmed'), tab(undefined, HOME));
    },
    phase: 'awaitingPick',
    error: 'INJECTION_IGNORED',
    check: (r) => expect(r.state).toMatchObject({ insertDispatched: false, injectAt: 'home' }),
  },
  // AL-1/AF-1: every first decision that reads C4 waits once for a late story input, not only H1.
  {
    name: 'AL-1: probe mode on home without the input waits once; it appears → one more probe → probe-done, C4 pass',
    script: (r) => {
      r.send(startEv('probe'), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED);
      toHomeReport(r).send(homeProbe({ storyInput: 'absent', acceptOk: false, acceptSeen: [] }));
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitInput', inputWaitUsed: true, c4Reached: false });
      // A watch is not an inject: probe mode only watches for the input.
      expect(r.steps.at(-1)?.effects).toEqual([
        { type: 'sendAgent', tabId: TAB, command: { type: 'agent/watch', readyTimeoutMs: 0 } },
        { type: 'armTimer', timer: 'inputWait', ms: INPUT_WAIT_MS },
      ]);
      expect(r.send(agent('input-appeared'))).toEqual([
        { type: 'clearTimer', timer: 'inputWait' },
        { type: 'sendAgent', tabId: TAB, command: { type: 'agent/probe' } },
      ]);
      r.send(homeProbe());
    },
    phase: 'closing',
    error: null,
    injects: 0,
    lacks: ['serveFile'],
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ c4: 'pass', path: '/', route: 'homeOnly' });
      expect(r.lastStatus?.probe).toMatchObject({ storyInput: 'present' });
      expect(lastRecord(r)).toMatchObject({
        mode: 'probe',
        outcome: 'not-posted',
        probe: { storyInput: 'present' },
        preflight: { C4: 'pass', C5: 'fail' },
      });
    },
  },
  {
    name: 'AL-1: probe mode, no input within 6 s → probe-done on that report: C4 fail, checked (no "not checked")',
    script: (r) => {
      r.send(startEv('probe'), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED);
      toHomeReport(r).send(homeProbe({ storyInput: 'absent', acceptOk: false, acceptSeen: [] }));
      r.tick(INPUT_WAIT_MS).send(INPUT_WAITED);
    },
    phase: 'closing',
    error: null,
    injects: 0,
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ c4: 'fail', path: '/' });
      expect(lastRecord(r)).toMatchObject({ outcome: 'not-posted', preflight: { C4: 'fail' } });
      expect(r.count((e) => e.type === 'armTimer' && e.timer === 'inputWait')).toBe(1);
    },
  },
  {
    name: 'AF-1: H1 off (assisted insert off) on home without the input waits once; it appears → H0 with no error, C4 pass',
    opts: { settings: { assistedInsert: false } },
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe({ storyInput: 'absent', acceptOk: false, acceptSeen: [] }));
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitInput' });
      r.send(agent('input-appeared'), homeProbe());
    },
    phase: 'awaitingPick',
    error: null,
    injects: 0,
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ c4: 'pass', route: 'homeOnly', level: 'H0' });
      // The re-probe's H0 restarts the watch: harmless, and the document has one either way.
      expect(r.effects.map(watchMs).filter((m) => m !== null)).toEqual([0, 0]);
    },
  },
  {
    name: 'AF-1: H1 off, no input within 6 s → H0 with no error on that report (C4 fail); the wait’s watch keeps running',
    opts: { settings: { assistedInsert: false } },
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe({ storyInput: 'absent', acceptOk: false, acceptSeen: [] }));
      r.tick(INPUT_WAIT_MS).send(INPUT_WAITED);
    },
    phase: 'awaitingPick',
    error: null,
    injects: 0,
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ c4: 'fail', route: 'homeOnly', level: 'H0' });
      expect(r.effects.map(watchMs).filter((m) => m !== null)).toEqual([0]);
      // The owner picks by hand from home as usual.
      r.send(tab(undefined, COMPOSER_URL), agent('composer-ready'));
      expect(r.phase).toBe('awaitingShare');
    },
  },
  {
    name: 'P5: a session that ends during the wait records C4 unknown (the input was not checked to the end)',
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe({ storyInput: 'absent', acceptOk: false, acceptSeen: [] }), { type: 'cancel' });
      expect(lastRecord(r)).toMatchObject({ outcome: 'abandoned', preflight: { C4: 'unknown' } });
      // The deadline firing while the window closes changes nothing; the cleanup clears it.
      expect(r.send(INPUT_WAITED)).toEqual([]);
      r.send({ type: 'windowRemoved', windowId: WIN });
    },
    phase: 'idle',
    check: (r) => expect(r.steps.at(-1)?.effects).toContainEqual({ type: 'clearTimer', timer: 'inputWait' }),
  },
  {
    name: 'P5: an input present at the first probe, or a decision before C4, never waits',
    opts: { settings: { assistedInsert: false } },
    script: (r) => {
      DRIVE_NAVIGATING(r);
      toHomeReport(r).send(homeProbe());
    },
    phase: 'awaitingPick',
    error: null,
    check: (r) => {
      expect(r.effects.some((e) => e.type === 'armTimer' && e.timer === 'inputWait')).toBe(false);
      const probe = toReport(new Run(), 'probe').send(report());
      expect(probe.some((e) => e.type === 'armTimer' && e.timer === 'inputWait')).toBe(false);
      const wide = toReport(new Run(), 'probe').send(report({ storyInput: 'absent', inner: { w: 900, h: 1300 } }));
      expect(wide.some((e) => e.type === 'armTimer' && e.timer === 'inputWait')).toBe(false);
    },
  },
  {
    name: 'P5: a stray inputWait or input-appeared outside the wait does nothing',
    script: (r) => toInjecting(r).send(INPUT_WAITED, agent('input-appeared')),
    phase: 'injecting',
    check: (r) => expect(r.steps.slice(-2).every((st) => st.effects.length === 0)).toBe(true),
  },

  // P6: the editor's browser flavour.
  {
    name: 'P6: a guarded build refuses when the editor reports Arc → BRANDED_BROWSER, no window',
    script: (r) => r.send({ ...startEv(), browser: 'arc' } as HandoffEvent),
    phase: 'idle',
    error: 'BRANDED_BROWSER',
    lacks: ['openWindow', 'noteOpen'],
    check: (r) => expect(r.lastStatus).toMatchObject({ handoffId: null, detail: 'browser arc' }),
  },
  {
    name: 'P6: a live build in Arc proceeds and records the flavour',
    opts: { guarded: false },
    script: (r) => {
      r.send({ ...startEv(), browser: 'arc' } as HandoffEvent);
      r.send({ type: 'cancel' });
    },
    phase: 'closing',
    check: (r) => expect(lastRecord(r)).toMatchObject({ browser: 'arc', outcome: 'abandoned' }),
  },

  // U1: C4 is judged only when the decision reached it.
  {
    name: 'U1: DESKTOP_SHELL stops before the story input: the status and the record say C4 unknown',
    script: (r) => toReport(r).send(report({ isMobile: false, storyInput: 'absent', acceptOk: false })),
    phase: 'closing',
    error: 'DESKTOP_SHELL',
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ c4: 'unknown' });
      expect(lastRecord(r)?.preflight).toMatchObject({ C1: 'fail', C4: 'unknown' });
    },
  },

  // Probe mode.
  {
    name: 'probe mode: store the report, close, done; never injects or serves a file',
    script: (r) => toReport(r, 'probe').send(report(), { type: 'agentGetFile' }),
    phase: 'closing',
    error: null,
    injects: 0,
    lacks: ['serveFile'],
    check: (r) => {
      expect(r.statuses.find((s) => s.phase === 'closing')?.probe).toEqual(goodProbe());
      const rec = r.effects.find((e) => e.type === 'writeRecord');
      expect(rec?.type === 'writeRecord' && rec.record).toMatchObject({
        mode: 'probe',
        outcome: 'not-posted',
        exportId: null,
      });
    },
  },
  {
    name: 'probe mode still applies the guard',
    script: (r) => toReport(r, 'probe').send(report({ marker: false })),
    phase: 'closing',
    error: 'GUARD_NOT_FAKE',
  },

  // Ends, cleanup and timers.
  {
    name: 'cancel → close, record abandoned; cleanup on windowRemoved',
    script: (r) => toShare(r).send({ type: 'cancel' }, { type: 'windowRemoved', windowId: WIN }),
    phase: 'idle',
    has: ['closeWindow', 'removeRules'],
    check: (r) => expect(lastOutcome(r)).toBe('abandoned'),
  },
  {
    name: 'cancel while the window is still opening: the late window is closed',
    script: (r) => {
      r.send(startEv(), { type: 'cancel' }, { type: 'windowCreated', windowId: WIN, tabId: TAB });
      expect(r.steps.at(-1)?.effects).toEqual([{ type: 'closeWindow', windowId: WIN }]);
      r.send({ type: 'windowRemoved', windowId: WIN });
    },
    phase: 'idle',
    lacks: ['installRules'],
  },
  {
    name: 'a window created after the session ended is closed (orphan)',
    script: (r) => {
      r.send(startEv(), { type: 'effectFailed', effect: 'openWindow', message: 'x' });
      r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB });
    },
    phase: 'idle',
    error: 'AGENT_UNREACHABLE',
    check: (r) => expect(r.steps.at(-1)?.effects).toEqual([{ type: 'closeWindow', windowId: WIN }]),
  },
  {
    name: 'other windows closing are ignored mid-session',
    script: (r) => toShare(r).send({ type: 'windowRemoved', windowId: 99 }, { type: 'tabRemoved', tabId: 98 }),
    phase: 'awaitingShare',
    lacks: ['removeRules'],
  },
  {
    name: 'startup mid-session: close the stale popup, then remove the rules',
    script: (r) => toShare(r).send({ type: 'startup' }),
    phase: 'idle',
    check: (r) => {
      expect(types(r.steps.at(-1)?.effects ?? []).slice(0, 2)).toEqual(['closeWindow', 'removeRules']);
      expect(lastOutcome(r)).toBe('abandoned');
    },
  },
  {
    name: 'inactivity: re-armed for the remainder, then TIMEOUT after 15 quiet minutes',
    script: (r) => {
      toPick(r);
      r.tick(10 * 60_000).send({ type: 'timer', timer: 'inactivity' });
      expect(r.steps.at(-1)?.effects).toEqual([{ type: 'armTimer', timer: 'inactivity', ms: 5 * 60_000 }]);
      r.tick(5 * 60_000).send({ type: 'timer', timer: 'inactivity' });
    },
    phase: 'closing',
    error: 'TIMEOUT',
    has: ['closeWindow'],
  },
  {
    name: 'activity resets the inactivity clock',
    script: (r) => {
      toPick(r);
      r.tick(14 * 60_000).send(agent('composer-ready'));
      r.tick(60_000).send({ type: 'timer', timer: 'inactivity' });
    },
    phase: 'awaitingShare',
    check: (r) => expect(r.steps.at(-1)?.effects).toEqual([{ type: 'armTimer', timer: 'inactivity', ms: 14 * 60_000 }]),
  },
  {
    name: 'a failed rule install closes the popup (AGENT_UNREACHABLE), never navigates',
    script: (r) => {
      r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB });
      r.send({ type: 'effectFailed', effect: 'installRules', message: 'quota' });
    },
    phase: 'closing',
    error: 'AGENT_UNREACHABLE',
    lacks: ['navigate', 'measureTab'],
    check: (r) => expect(r.lastStatus?.detail).toBe('installRules: quota'),
  },
  {
    name: 'a failed hard reload closes the popup and is never retried',
    script: (r) => toReloading(r).send({ type: 'effectFailed', effect: 'hardReload', message: 'x' }),
    phase: 'closing',
    error: 'AGENT_UNREACHABLE',
  },
  {
    name: 'a stale failure (old document) is ignored',
    script: (r) =>
      toShare(r).send(tab('loading', COMPOSER_URL), { type: 'effectFailed', effect: 'sendAgent', message: 'gone' }),
    phase: 'probing',
  },
  {
    name: 'closeWindow failing (already gone) still cleans up',
    script: (r) =>
      toShare(r).send({ type: 'cancel' }, { type: 'effectFailed', effect: 'closeWindow', message: 'No window' }),
    phase: 'idle',
    has: ['removeRules'],
  },
];

describe('U9 hand-off reducer: transition table', () => {
  it.each(ROWS)('$name', (row) => {
    const r = new Run(row.opts);
    row.script(r);
    expect(r.phase).toBe(row.phase);
    if (row.error !== undefined) expect(r.lastStatus?.error ?? null).toBe(row.error);
    for (const t of row.has ?? []) expect(types(r.effects)).toContain(t);
    for (const t of row.lacks ?? []) expect(types(r.effects)).not.toContain(t);
    if (row.injects !== undefined) expect(r.injects).toBe(row.injects);
    row.check?.(r);
    checkRun(r);
  });

  const DRIVE: Partial<Record<HandoffPhase, (r: Run) => void>> = {
    scoping: (r) => r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }),
    fitting: (r) => r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' }),
    navigating: (r) => {
      r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
      r.send(MEASURED, FITTED);
    },
    reloading: (r) => toReloading(r),
    probing: (r) => toReport(r),
    injecting: (r) => toInjecting(r),
    awaitingPick: (r) => toPick(r),
    awaitingShare: (r) => toShare(r),
    finished: (r) => toShare(r).send(tab(undefined, HOME)),
  };

  it.each(Object.keys(DRIVE) as HandoffPhase[])(
    'window closed by the owner in %s → cleanup: rules 1001–1019 removed, idle',
    (phase) => {
      const r = new Run();
      DRIVE[phase]?.(r);
      expect(r.phase).toBe(phase);
      const out = r.send(
        phase === 'scoping' ? { type: 'tabRemoved', tabId: TAB } : { type: 'windowRemoved', windowId: WIN },
      );
      expect(out[0]).toEqual({ type: 'removeRules', ruleIds: SESSION_IDS });
      expect(r.state).toMatchObject({ phase: 'idle', last: { handoffId: 'hof_u1' } });
      expect(r.count((e) => e.type === 'writeRecord')).toBe(1);
      expect(lastOutcome(r)).toBe(phase === 'finished' ? 'posted-confirmed' : 'abandoned');
      checkRun(r);
    },
  );

  it('cleanup is idempotent in idle: windowRemoved, tabRemoved and startup each remove 1001–1019', () => {
    const r = new Run();
    for (const ev of [
      { type: 'windowRemoved', windowId: 5 },
      { type: 'tabRemoved', tabId: 6 },
      { type: 'startup' },
    ] as const) {
      expect(r.send(ev)[0]).toEqual({ type: 'removeRules', ruleIds: SESSION_IDS });
      expect(r.state).toBe(IDLE);
    }
  });

  it('ignored events return the very same state object', () => {
    const r = toShare(new Run());
    const before = r.state;
    for (const ev of [
      agent('input-appeared'),
      { type: 'rulesInstalled' },
      FITTED,
      { type: 'agentInjected' },
      { type: 'timer', timer: 'closeDelay' },
      tab('complete', COMPOSER_URL),
    ] as HandoffEvent[]) {
      expect(r.send(ev)).toEqual([]);
      expect(r.state).toBe(before);
    }
    // A report outside `probing` and `awaitingShare` is ignored too.
    const pick = toPick(new Run());
    const picking = pick.state;
    expect(pick.send(report())).toEqual([]);
    expect(pick.state).toBe(picking);
  });

  it('AM13: a report in awaitingShare only records C8; it never re-evaluates the flow', () => {
    const r = toShare(new Run());
    expect(r.steps.at(-1)?.effects.filter(isProbeCmd)).toHaveLength(1);
    // Even a report that would fail every row changes nothing but readyProbe.
    const bad = goodProbe({ marker: false, isMobile: false, portrait: false, storyInput: 'absent', acceptOk: false });
    expect(types(r.send({ type: 'agentReport', probe: bad }))).toEqual(['notifyEditor']);
    expect(r.state).toMatchObject({ phase: 'awaitingShare', level: 'H1', readyProbe: bad, probe: goodProbe() });
    // H0 reaches the same probe when the owner's pick makes the composer ready.
    const h0 = toPick(new Run()).send(agent('composer-ready'));
    expect(h0.filter(isProbeCmd)).toHaveLength(1);
  });

  it("the owner's answer patches finished, closing and idle records, but never a failure", () => {
    const answer = (r: Run, posted: boolean, handoffId = 'hof_u1') => r.send({ type: 'outcome', handoffId, posted });
    const patch = (outcome: string) => [{ type: 'patchRecordOutcome', handoffId: 'hof_u1', outcome }];

    const r = toShare(new Run());
    expect(answer(r, false)).toEqual([]); // not finished yet: nothing to patch
    r.send(tab(undefined, HOME));
    expect(answer(r, false)).toEqual(patch('not-posted'));
    expect(answer(r, false)).toEqual([]); // unchanged
    r.send({ type: 'timer', timer: 'closeDelay' });
    expect(answer(r, true)).toEqual(patch('posted-confirmed'));
    expect(answer(r, false, 'other')).toEqual([]);
    r.send({ type: 'windowRemoved', windowId: WIN });
    expect(answer(r, false)).toEqual(patch('not-posted'));
    expect(r.state).toMatchObject({ last: { outcome: 'not-posted' } });

    const failed = toReport(new Run());
    failed.send(report({ isMobile: false }));
    expect(answer(failed, true)).toEqual([]);
    failed.send({ type: 'windowRemoved', windowId: WIN });
    expect(answer(failed, true)).toEqual([]);
    expect(failed.state).toMatchObject({ last: { outcome: 'failed:DESKTOP_SHELL' } });
  });
});

// ---------------------------------------------------------------------------------------
// AM37 (2026-10-12): the portrait shim's reading (C3b) and SCREEN_LANDSCAPE.

/** The records the run wrote, in order. */
const written = (r: Run): HandoffRecord[] => r.effects.flatMap((e) => (e.type === 'writeRecord' ? [e.record] : []));

/** Through the hard reload to the first probe on home (`/`, msite's usual landing), injected with `o`. */
function toHomeShim(r: Run, o: PageOrientation, mode: 'post' | 'probe' = 'post'): Run {
  r.send(startEv(mode), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
  r.send(MEASURED, FITTED, tab('loading', COMPOSER_URL), tab('loading', HOME), tab('complete', HOME));
  r.send(injectedWith(true, o));
  return r;
}

/** The pick's (or the insert's) SPA navigation to the composer: a same-document load, `o` its reading. */
const toComposer = (o: PageOrientation): HandoffEvent[] => [
  tab('loading', COMPOSER_URL),
  tab('complete', COMPOSER_URL),
  injectedWith(false, o),
];

describe('U9 AM37: the composer’s screen-orientation gate (C3b) and SCREEN_LANDSCAPE', () => {
  it('every report is stamped with the shim’s reading; the record’s preflight has C3b', () => {
    const r = toHomeShim(new Run(), SHIM_INSTALLED);
    // The agent's own report never carries it (normalizeProbeReport); the background adds it.
    r.send(report());
    expect(r.state).toMatchObject({ phase: 'injecting', pageOrientation: SHIM_INSTALLED });
    expect(r.state.phase !== 'idle' && 'probe' in r.state ? r.state.probe?.orientation : null).toEqual(SHIM_INSTALLED);
    expect(r.statuses.find((s) => s.probe)?.probe?.orientation).toEqual(SHIM_INSTALLED);
    // The insert's SPA navigation reaches the composer; the shim is still in place there.
    r.send({ type: 'agentGetFile' }, ...toComposer(SHIM_PRESENT), agent('composer-ready'));
    expect(r.phase).toBe('awaitingShare');
    // AM13's C8 report is stamped with the composer document's reading.
    r.send(report({ canvas: { w: 1022, h: 1816, css: { x: 0, y: 0, w: 511, h: 908 } } }));
    expect(r.state).toMatchObject({ readyProbe: { orientation: SHIM_PRESENT } });
    r.send(tab(undefined, HOME));
    const [rec] = written(r);
    expect(rec?.outcome).toBe('posted-confirmed');
    expect(rec?.preflight).toMatchObject({ C3: 'pass', C3b: 'pass' });
    checkRun(r);
  });

  it('H0 from home, shim off: the pick reaches the composer while the page reads landscape → SCREEN_LANDSCAPE', () => {
    const r = toHomeShim(new Run({ settings: { assistedInsert: false } }), SHIM_OFF);
    // On home the composer is not mounted yet: the reading is recorded, the owner is asked to pick.
    r.send(report());
    expect(r.phase).toBe('awaitingPick');
    expect(r.lastStatus?.probe?.orientation).toEqual(SHIM_OFF);
    const out = r.send(...toComposer(SHIM_OFF));
    expect(r.phase).toBe('closing');
    expect(types(out)).toEqual(['closeWindow', 'notifyEditor', 'writeRecord']);
    expect(r.lastStatus).toMatchObject({
      error: 'SCREEN_LANDSCAPE',
      detail: 'screen landscape-primary, portrait shim off',
      probe: { orientation: SHIM_OFF },
    });
    const [rec] = written(r);
    expect(rec).toMatchObject({
      outcome: 'failed:SCREEN_LANDSCAPE',
      level: 'H0',
      detail: 'screen landscape-primary, portrait shim off',
      probe: { orientation: SHIM_OFF },
    });
    // C3a passed (the + → Story session start reads the portrait viewport), C3b failed.
    expect(rec?.preflight).toMatchObject({ C3: 'pass', C3b: 'fail' });
    // A close, never a kill: no lock.
    expect(r.count((e) => e.type === 'lockMsite')).toBe(0);
    r.send({ type: 'windowRemoved', windowId: WIN });
    expect(r.state).toMatchObject({ phase: 'idle', last: { outcome: 'failed:SCREEN_LANDSCAPE' } });
    checkRun(r);
  });

  it('H1 on home, shim off: SCREEN_LANDSCAPE once the insert’s navigation reaches the composer; one inject', () => {
    const r = toHomeShim(new Run(), SHIM_OFF);
    r.send(report(), { type: 'agentGetFile' });
    expect(r.phase).toBe('injecting');
    r.send(...toComposer(SHIM_OFF));
    expect(r.phase).toBe('closing');
    expect(r.lastStatus?.error).toBe('SCREEN_LANDSCAPE');
    expect(r.injects).toBe(1);
    expect(written(r)[0]).toMatchObject({ outcome: 'failed:SCREEN_LANDSCAPE', level: 'H1' });
    checkRun(r);
  });

  it('a composer-ready that came first (awaitingShare) still ends in SCREEN_LANDSCAPE at the composer', () => {
    const r = toHomeShim(new Run({ settings: { assistedInsert: false } }), SHIM_OFF);
    r.send(report(), agent('composer-ready'));
    expect(r.phase).toBe('awaitingShare');
    r.send(...toComposer(SHIM_OFF));
    expect(r.phase).toBe('closing');
    expect(written(r)[0]).toMatchObject({ outcome: 'failed:SCREEN_LANDSCAPE' });
    checkRun(r);
  });

  it('with the shim in place the same navigation resumes the interrupted phase', () => {
    const r = toHomeShim(new Run({ settings: { assistedInsert: false } }), SHIM_INSTALLED);
    r.send(report());
    r.send(...toComposer(SHIM_PRESENT));
    expect(r.phase).toBe('awaitingPick');
    expect(r.state).toMatchObject({ pageOrientation: SHIM_PRESENT });
    r.send(agent('composer-ready'));
    expect(r.phase).toBe('awaitingShare');
    checkRun(r);
  });

  it('the composer at the first probe (route direct), page reading landscape: row 5b, nothing inserted', () => {
    const r = toReloading(new Run());
    r.send(tab('complete', COMPOSER_URL), injectedWith(true, SHIM_OFF), report());
    expect(r.phase).toBe('closing');
    expect(r.injects).toBe(0);
    expect(r.lastStatus).toMatchObject({
      error: 'SCREEN_LANDSCAPE',
      detail: 'screen landscape-primary, portrait shim off',
      c4: 'unknown',
    });
    expect(written(r)[0]).toMatchObject({
      outcome: 'failed:SCREEN_LANDSCAPE',
      route: 'direct',
      preflight: { C3b: 'fail', C4: 'unknown' },
    });
    checkRun(r);
  });

  it('probe mode on home records the reading (C3b) and finishes normally', () => {
    const r = toHomeShim(new Run(), SHIM_OFF, 'probe');
    r.send(report());
    expect(r.phase).toBe('closing');
    expect(r.lastStatus?.error).toBeUndefined();
    expect(written(r)[0]).toMatchObject({ outcome: 'not-posted', preflight: { C3b: 'fail' } });
    const ok = toHomeShim(new Run(), SHIM_INSTALLED, 'probe').send(report());
    expect(ok.find((e) => e.type === 'writeRecord')).toMatchObject({ record: { preflight: { C3b: 'pass' } } });
  });

  it('a new document starts from its own reading; one injected without a reading forgets the old one', () => {
    const r = toHomeShim(new Run({ settings: { assistedInsert: false } }), SHIM_OFF);
    r.send(report());
    // A full-document load (fresh agent) brings the shim's new reading with it.
    r.send(tab('loading', HOME), tab('complete', HOME), injectedWith(true, SHIM_INSTALLED));
    expect(r.state).toMatchObject({ phase: 'probing', pageOrientation: SHIM_INSTALLED });
    r.send(tab('loading', HOME), tab('complete', HOME), { type: 'agentInjected', fresh: true });
    expect(r.state).toMatchObject({ phase: 'probing', pageOrientation: null });
    // The same document without a reading keeps the one it had (and home is no composer: no failure).
    const same = toHomeShim(new Run({ settings: { assistedInsert: false } }), SHIM_OFF);
    same.send(report(), tab('loading', `${HOME}?x`), tab('complete', `${HOME}?x`), injected(false));
    expect(same.state).toMatchObject({ phase: 'awaitingPick', pageOrientation: SHIM_OFF });
    checkRun(same);
  });

  it('SCREEN_LANDSCAPE closes without a lock (§3.10 effect)', () => {
    expect(ERROR_EFFECT.SCREEN_LANDSCAPE).toBe('close');
  });

  // SH-1 (2026-10-13): Instagram reads the orientation when the composer mounts (and on resize). A shim
  // that installs itself only at the injection after the composer was entered came too late.
  const LATE: PageOrientation = { ...SHIM_INSTALLED, afterComposerMount: true };
  const LATE_DETAIL = 'screen portrait-primary, portrait shim installed after the composer mounted';

  it('SH-1 (b): home read a portrait screen (nothing installed); by the pick it is landscape: installed on the composer → SCREEN_LANDSCAPE', () => {
    const PORTRAIT: PageOrientation = { type: 'portrait-primary', shim: 'portrait' };
    const r = toHomeShim(new Run({ settings: { assistedInsert: false } }), PORTRAIT);
    r.send(report());
    expect(r.phase).toBe('awaitingPick');
    const out = r.send(...toComposer(SHIM_INSTALLED));
    expect(r.phase).toBe('closing');
    expect(types(out)).toEqual(['closeWindow', 'notifyEditor', 'writeRecord']);
    expect(r.lastStatus).toMatchObject({
      error: 'SCREEN_LANDSCAPE',
      detail: LATE_DETAIL,
      probe: { orientation: LATE },
    });
    const [rec] = written(r);
    expect(rec).toMatchObject({
      outcome: 'failed:SCREEN_LANDSCAPE',
      level: 'H0',
      detail: LATE_DETAIL,
      probe: { orientation: LATE },
      preflight: { C3: 'pass', C3b: 'fail' },
    });
    expect(r.count((e) => e.type === 'lockMsite')).toBe(0);
    checkRun(r);
  });

  it('SH-1 (b): the same with H1 on home: the insert’s navigation reaches the composer, the shim installs only there', () => {
    const r = toHomeShim(new Run(), { type: 'portrait-primary', shim: 'portrait' });
    r.send(report(), { type: 'agentGetFile' });
    expect(r.phase).toBe('injecting');
    r.send(...toComposer(SHIM_INSTALLED));
    expect(r.lastStatus).toMatchObject({ error: 'SCREEN_LANDSCAPE', detail: LATE_DETAIL });
    expect(r.injects).toBe(1);
    checkRun(r);
  });

  it('SH-1: no late shim when it was there before the composer (present), or the screen reads portrait there', () => {
    for (const there of [SHIM_PRESENT, { type: 'portrait-primary', shim: 'portrait' } as const]) {
      const r = toHomeShim(new Run({ settings: { assistedInsert: false } }), SHIM_INSTALLED);
      r.send(report(), ...toComposer(there));
      expect(r.phase).toBe('awaitingPick');
      expect(r.state).toMatchObject({ pageOrientation: there, composerEntered: false });
      checkRun(r);
    }
  });

  it('SH-1: a later same-document load that stays on the composer is no entry (the composer did not mount again)', () => {
    const r = toHomeShim(new Run({ settings: { assistedInsert: false } }), SHIM_INSTALLED);
    r.send(report(), ...toComposer(SHIM_PRESENT), agent('composer-ready'));
    expect(r.phase).toBe('awaitingShare');
    // E.g. the screen became landscape on another display, and the shim's getters were gone: it installs.
    r.send(
      tab('loading', `${COMPOSER_URL}?x=1`),
      tab('complete', `${COMPOSER_URL}?x=1`),
      injectedWith(false, SHIM_INSTALLED),
    );
    expect(r.phase).toBe('awaitingShare');
    expect(r.state).toMatchObject({ pageOrientation: SHIM_INSTALLED });
    checkRun(r);
  });

  it('SH-1: a new document on the composer (a full load) is no late shim: its composer has no photo yet', () => {
    const r = toHomeShim(new Run({ settings: { assistedInsert: false } }), SHIM_INSTALLED);
    r.send(report());
    r.send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), injectedWith(true, SHIM_INSTALLED));
    expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitReport', pageOrientation: SHIM_INSTALLED });
    r.send(report());
    expect(r.phase).toBe('awaitingPick');
    checkRun(r);
  });

  it('SH-1 (a): the owner picked before the reloaded home completed: the first injection lands on the composer → SCREEN_LANDSCAPE', () => {
    const r = new Run({ settings: { assistedInsert: false } });
    r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
    // First load, the reload's own commit (home), the pick's SPA navigation, then the first `complete`.
    r.send(MEASURED, FITTED, tab('loading', COMPOSER_URL), tab('loading', HOME), tab('loading', COMPOSER_URL));
    expect(r.state).toMatchObject({ phase: 'reloading', composerEntered: true });
    r.send(tab('complete', COMPOSER_URL), injectedWith(true, SHIM_INSTALLED));
    expect(r.state).toMatchObject({ phase: 'probing', pageOrientation: LATE, composerEntered: false });
    r.send(report());
    expect(r.phase).toBe('closing');
    expect(r.injects).toBe(0);
    expect(r.lastStatus).toMatchObject({ error: 'SCREEN_LANDSCAPE', detail: LATE_DETAIL });
    expect(written(r)[0]).toMatchObject({ outcome: 'failed:SCREEN_LANDSCAPE', preflight: { C3b: 'fail' } });
    checkRun(r);
  });

  it('SH-1 (a): the reload’s own commit to the composer (route direct) is no entry: installed there passes', () => {
    const r = toReloading(new Run());
    expect(r.state).toMatchObject({ phase: 'reloading', composerEntered: false });
    r.send(tab('complete', COMPOSER_URL), injectedWith(true, SHIM_INSTALLED), report());
    expect(r.phase).toBe('injecting');
    expect(r.state).toMatchObject({ pageOrientation: SHIM_INSTALLED, route: 'direct' });
    // A portrait reading after a later commit onto the composer is fine as well.
    const p = new Run({ settings: { assistedInsert: false } });
    p.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
    p.send(MEASURED, FITTED, tab('loading', COMPOSER_URL), tab('loading', HOME), tab('loading', COMPOSER_URL));
    p.send(tab('complete', COMPOSER_URL), injectedWith(true, { type: 'portrait-primary', shim: 'portrait' }), report());
    expect(p.phase).toBe('awaitingPick');
    checkRun(p);
  });

  // SH-2 (2026-10-13): an unreadable reading ({null, failed}: the shim threw, or its result was
  // malformed) is never a pass: C3b unknown, and on the composer SCREEN_LANDSCAPE.
  const UNREADABLE: PageOrientation = { type: null, shim: 'failed' };

  it('SH-2: unreadable on home is recorded (C3b unknown); the pick reaching the composer unreadable → SCREEN_LANDSCAPE', () => {
    const r = toHomeShim(new Run({ settings: { assistedInsert: false } }), UNREADABLE);
    r.send(report());
    expect(r.phase).toBe('awaitingPick');
    r.send(...toComposer(UNREADABLE));
    expect(r.phase).toBe('closing');
    expect(r.lastStatus).toMatchObject({
      error: 'SCREEN_LANDSCAPE',
      detail: 'screen unknown, portrait shim failed',
      probe: { orientation: UNREADABLE },
    });
    expect(written(r)[0]).toMatchObject({
      outcome: 'failed:SCREEN_LANDSCAPE',
      detail: 'screen unknown, portrait shim failed',
      preflight: { C3b: 'unknown' },
    });
    checkRun(r);
  });

  it('SH-2: unreadable at the first probe on the composer (route direct): row 5b, nothing inserted', () => {
    const r = toReloading(new Run());
    r.send(tab('complete', COMPOSER_URL), injectedWith(true, UNREADABLE), report());
    expect(r.phase).toBe('closing');
    expect(r.injects).toBe(0);
    expect(written(r)[0]).toMatchObject({ outcome: 'failed:SCREEN_LANDSCAPE', preflight: { C3b: 'unknown' } });
    // In probe mode on home it is only recorded: C3b unknown, not a pass.
    const probe = toHomeShim(new Run(), UNREADABLE, 'probe').send(report());
    expect(probe.find((e) => e.type === 'writeRecord')).toMatchObject({
      record: { outcome: 'not-posted', preflight: { C3b: 'unknown' } },
    });
  });
});

// ---------------------------------------------------------------------------------------
// "No transition ever emits a retry", generically: seeded random event sequences.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;

const URLS: readonly (string | undefined)[] = [
  COMPOSER_URL,
  COMPOSER_URL,
  `${COMPOSER_URL}edit/`,
  HOME,
  HOME,
  LOGIN,
  CHALLENGE,
  CHECKPOINT,
  ACCOUNTS_CENTER,
  undefined,
  'about:blank',
  'http://www.instagram.com/create/story/',
  'https://www.instagram.com/someone/',
  SUSPENDED,
  CODE_ENTRY,
  CONSENT,
];
const AGENT_EVENTS: readonly AgentEventName[] = [
  'input-appeared',
  'composer-ready',
  'composer-left',
  'inject-ignored',
  'inject-unconfirmed',
  'sw-controller-change',
  'sw-intercepted',
];
const EFFECT_TYPES: readonly HandoffEffect['type'][] = [
  'openWindow',
  'installRules',
  'measureTab',
  'updateWindow',
  'navigate',
  'hardReload',
  'injectAgent',
  'sendAgent',
  'serveFile',
  'readSize',
  'notifyEditor',
  'closeWindow',
  'removeRules',
  'writeRecord',
  'lockMsite',
];

function randomProbe(rnd: () => number): ProbeReport {
  const good = () => rnd() < 0.85;
  return goodProbe({
    marker: good(),
    isMobile: good() ? true : pick(rnd, [false, 'unknown'] as const),
    portrait: good(),
    inner: good()
      ? { w: 511, h: 909 }
      : pick(rnd, [
          { w: 1512, h: 902 },
          { w: 800, h: 1200 },
        ]),
    swControlled: rnd() < 0.5 ? true : pick(rnd, [false, 'unknown'] as const),
    swIntercepted: good() ? false : pick(rnd, [true, 'unknown'] as const),
    storyInput: good() ? 'present' : 'absent',
    acceptOk: good(),
  });
}

/** What a cooperative runner and agent would send next. */
function happy(s: HandoffState, rnd: () => number): HandoffEvent {
  switch (s.phase) {
    case 'idle':
      return startEv(rnd() < 0.8 ? 'post' : 'probe', SCREEN, rnd() < 0.7);
    case 'opening':
      return { type: 'windowCreated', windowId: WIN, tabId: TAB };
    case 'scoping':
      return { type: 'rulesInstalled' };
    case 'fitting':
      switch (s.fitStep) {
        case 'measure':
          return rnd() < 0.5 ? MEASURED : ARC_MEASURED;
        case 'update':
        case 'retry':
          return rnd() < 0.6 ? FITTED : pick(rnd, [NOT_FITTED, fittedEv(false, { w: 600, h: 900 })]);
        case 'retryWait':
          return { type: 'timer', timer: 'fitRetry' };
      }
      break;
    case 'resizing':
      return pick(rnd, [
        sized(1512, 902),
        sized(700, 650),
        sized(524, 965),
        { type: 'boundsChanged', windowId: WIN },
        { type: 'timer', timer: 'resizePoll' },
        { type: 'timer', timer: 'resizeDeadline' },
      ] as HandoffEvent[]);
    case 'navigating':
      return rnd() < 0.9 ? tab('loading', COMPOSER_URL) : tab(pick(rnd, ['loading', 'complete'] as const), undefined);
    case 'reloading':
      return tab(s.loadsSinceReload === 0 ? 'loading' : 'complete', rnd() < 0.9 ? COMPOSER_URL : HOME);
    case 'probing':
      switch (s.step) {
        case 'awaitComplete':
          return tab('complete', COMPOSER_URL);
        case 'injectAgent':
          // AM37: the shim's reading comes with it, mostly portrait (installed), sometimes landscape.
          return rnd() < 0.4
            ? { type: 'agentInjected' }
            : injectedWith(rnd() < 0.5, rnd() < 0.85 ? SHIM_INSTALLED : SHIM_OFF);
        case 'awaitReport':
          // AM28: a same-document load, or home, can come before the report of a new document.
          return rnd() < 0.85
            ? { type: 'agentReport', probe: randomProbe(rnd) }
            : pick(rnd, [tab('loading', `${COMPOSER_URL}?x`), tab(undefined, HOME), tab('loading', HOME)]);
        case 'refitMeasure':
          return MEASURED;
        case 'refitUpdate':
          return rnd() < 0.8 ? FITTED : NOT_FITTED;
        case 'awaitInput':
          return pick(rnd, [agent('input-appeared'), INPUT_WAITED, agent('sw-controller-change')]);
      }
      break;
    // Post-probe phases also see later document loads (AM2), which must re-probe.
    case 'injecting':
      return pick(rnd, [
        { type: 'agentGetFile' },
        agent('composer-ready'),
        agent('inject-ignored'),
        agent('inject-unconfirmed'),
        tab('loading', COMPOSER_URL),
      ] as HandoffEvent[]);
    case 'awaitingPick':
      return pick(rnd, [
        agent('composer-ready'),
        agent('composer-ready'),
        tab('loading', COMPOSER_URL),
        tab(undefined, HOME),
        tab(undefined, CONSENT),
      ]);
    case 'awaitingShare':
      return pick(rnd, [
        tab(undefined, HOME),
        agent('composer-left'),
        tab('loading', COMPOSER_URL),
        tab('loading', HOME),
        tab(undefined, CONSENT),
      ]);
    case 'finished':
      return rnd() < 0.7
        ? { type: 'timer', timer: 'closeDelay' }
        : { type: 'outcome', handoffId: s.handoffId, posted: rnd() < 0.5 };
    case 'closing':
      return { type: 'windowRemoved', windowId: s.windowId ?? WIN };
  }
  return { type: 'cancel' };
}

/** Anything at all, including events for other tabs and windows and stale effect results. */
function noise(rnd: () => number): HandoffEvent {
  const kind = Math.floor(rnd() * 16);
  switch (kind) {
    case 0:
    case 1:
    case 2:
      return tab(pick(rnd, ['loading', 'complete', undefined] as const), pick(rnd, URLS), rnd() < 0.9 ? TAB : 99);
    case 3:
      return { type: 'agentReport', probe: randomProbe(rnd) };
    case 4:
      return agent(pick(rnd, AGENT_EVENTS));
    case 5:
      return { type: 'agentGetFile' };
    case 6:
      return pick(rnd, [
        { type: 'agentInjected' },
        { type: 'agentInjected', fresh: false, orientation: SHIM_OFF },
        FITTED,
        NOT_FITTED,
        { type: 'rulesInstalled' },
        MEASURED,
        sized(524, 965),
        { type: 'boundsChanged', windowId: rnd() < 0.5 ? WIN : 99 },
      ]);
    case 7:
      return { type: 'effectFailed', effect: pick(rnd, EFFECT_TYPES), message: 'boom' };
    case 8:
      return { type: 'timer', timer: pick(rnd, HANDOFF_TIMERS) };
    case 9:
      return { type: 'cancel' };
    case 10:
      return {
        ...startEv(pick(rnd, ['post', 'probe'] as const)),
        browser: pick(rnd, ['chromium', 'arc', 'unknown']),
      } as HandoffEvent;
    case 11:
      return { type: 'outcome', handoffId: pick(rnd, ['hof_u1', 'hof_u3', 'x']), posted: rnd() < 0.5 };
    case 12:
      return { type: 'windowRemoved', windowId: rnd() < 0.5 ? WIN : 99 };
    case 13:
      return { type: 'tabRemoved', tabId: rnd() < 0.5 ? TAB : 98 };
    case 14:
      return { type: 'startup' };
    default:
      return { type: 'windowCreated', windowId: rnd() < 0.5 ? WIN : 8, tabId: rnd() < 0.5 ? TAB : 43 };
  }
}

describe('U9 hand-off reducer: no transition ever emits a retry (random sequences)', () => {
  it('holds every invariant over 300 seeded runs of 150 events', () => {
    const reached = new Set<string>();
    const emitted = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = mulberry32(seed);
      const guarded = rnd() < 0.5;
      const r = new Run({
        guarded,
        settings: { assistedInsert: rnd() < 0.7, chMode: rnd() < 0.5 ? 'full' : 'uaOnly' },
        rate: rnd() < 0.9 ? { ok: true } : { ok: false, code: 'RATE_LIMITED', rule: 'hour', freeAt: T0 + HOUR },
      });
      const happyBias = 0.55 + rnd() * 0.4;
      for (let i = 0; i < 150; i++) {
        r.tick(pick(rnd, [0, 5, 250, 3000, 60_000, 60_000, 16 * 60_000]));
        const ev = rnd() < happyBias ? happy(r.state, rnd) : noise(rnd);
        expect(() => r.send(ev)).not.toThrow();
        reached.add(r.phase);
        if (r.state.phase === 'probing') reached.add(`probing:${r.state.step}`);
        if (r.state.phase === 'fitting') reached.add(`fitting:${r.state.fitStep}`);
        for (const e of r.steps.at(-1)?.effects ?? []) emitted.add(isInject(e) ? 'inject' : e.type);
      }
      checkRun(r);
    }
    // The exploration really reached every phase and every risky effect.
    const phases: HandoffPhase[] = [
      'idle',
      'opening',
      'scoping',
      'fitting',
      'resizing',
      'navigating',
      'reloading',
      'probing',
      'injecting',
      'awaitingPick',
      'awaitingShare',
      'finished',
      'closing',
    ];
    for (const p of phases) expect(reached).toContain(p);
    for (const step of ['probing:awaitInput', 'probing:refitUpdate', 'fitting:retryWait', 'fitting:retry']) {
      expect(reached).toContain(step);
    }
    for (const e of [
      'inject',
      'hardReload',
      'serveFile',
      'lockMsite',
      'patchRecordOutcome',
      'updateWindow',
      'readSize',
      'rememberWindow',
      'forgetWindow',
    ]) {
      expect(emitted).toContain(e);
    }
  });
});
