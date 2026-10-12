/**
 * U9 (strategy §7.11): the full transition table, table-driven: guard fail; DESKTOP_SHELL;
 * NOT_LOGGED_IN (no lock); landscape refits once; input missing → H0; inject → ready;
 * inject → ignored → H0 with no second Inject; challenge → kill and lock; off-host or undefined
 * URL after arming → kill; SW_TOOK_CONTROL; window closed → cleanup; composer left → finished;
 * probe mode. Plus AM2 re-probes, the start guards, timers and failed effects.
 * "No transition ever emits a retry" is asserted for every row and, generically, over
 * thousands of seeded random event sequences.
 */
import { describe, expect, it } from 'vitest';
import { firstGuess, windowFit } from '../geometry/window-fit.ts';
import type { ProbeReport } from '../ig-contract/contract.ts';
import { uaRule } from '../ig-contract/device-profile.ts';
import { rehearsalRules, SESSION_RULE_IDS } from '../ig-contract/rules.ts';
import { COMPOSER_URL, classifyComposerUrl } from '../ig-contract/urls.ts';
import type { RateDecision } from './rate-guard.ts';
import { handoffReducer } from './reducer.ts';
import {
  type AgentEventName,
  CLOSE_DELAY_MS,
  defaultSettings,
  type ErrorCode,
  type HandoffCtx,
  type HandoffEffect,
  type HandoffEvent,
  type HandoffPhase,
  type HandoffState,
  type HandoffStatus,
  IDLE,
  INACTIVITY_TIMEOUT_MS,
  INJECT_READY_TIMEOUT_MS,
  isArmed,
  MSITE_LOCK_MS,
  NAVIGATION_TIMEOUT_MS,
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
  r.send(MEASURED, { type: 'windowFitted' });
  return r;
}
/** start → windowCreated → rules → fit → navigate → hard reload → reload committed. Stops in `reloading`. */
function toReloading(r: Run, mode: 'post' | 'probe' = 'post'): Run {
  r.send(startEv(mode), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
  r.send(MEASURED, { type: 'windowFitted' }, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
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
  toReport(r).send(report(over));
  return r;
}
/** As toShare, in a post with rehearsal off (AM19 holds the popup open after Share). */
function toShareRehearsalOff(r: Run): Run {
  r.send(startEv('post', SCREEN, false));
  r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
  r.send(MEASURED, { type: 'windowFitted' }, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
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
  measureTab: 2,
  updateWindow: 2,
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
    expect(p?.swControlled).not.toBe(true);
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
    expect(r.send(MEASURED)).toEqual([{ type: 'updateWindow', windowId: WIN, box: fit.outer }]);
    expect(r.send({ type: 'windowFitted' }).slice(0, 2)).toEqual([
      { type: 'navigate', tabId: TAB, url: COMPOSER_URL },
      { type: 'armTimer', timer: 'navigation', ms: NAVIGATION_TIMEOUT_MS },
    ]);
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
      preflight: { C1: 'pass', C2: 'pass', C3: 'pass', C4: 'pass', C5: 'pass' },
      readyProbe: ready,
    });
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
      'clearTimer',
      'clearTimer',
      'clearTimer',
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
    name: 'DESKTOP_SHELL: still SW-controlled after the hard reload',
    script: (r) => toReport(r).send(report({ swControlled: true })),
    phase: 'closing',
    error: 'DESKTOP_SHELL',
    injects: 0,
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
      r.send(MEASURED, { type: 'windowFitted' }, tab('loading', LOGIN));
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
      expect(r.steps.at(-1)?.effects).toEqual([{ type: 'measureTab', tabId: TAB, windowId: WIN }]);
      r.send(MEASURED);
      expect(types(r.steps.at(-1)?.effects ?? [])).toEqual(['updateWindow']);
      r.send({ type: 'windowFitted' });
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
      toReport(r).send(report({ portrait: false }), MEASURED, { type: 'windowFitted' }, report({ portrait: false }));
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
    check: (r) => expect(r.effects.map(watchMs).filter((m) => m !== null)).toEqual([0]),
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
      r.send(MEASURED, { type: 'windowFitted' }, tab('loading', CHALLENGE));
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
    name: 'SW_TOOK_CONTROL mid-session → close, no lock',
    script: (r) => toShare(r).send(agent('sw-controller-change')),
    phase: 'closing',
    error: 'SW_TOOK_CONTROL',
    lacks: ['lockMsite'],
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
    name: 'AM2: a later load served by the SW → DESKTOP_SHELL',
    script: (r) => {
      toPick(r).send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), { type: 'agentInjected' });
      r.send(report({ swControlled: true, storyInput: 'absent' }));
    },
    phase: 'closing',
    error: 'DESKTOP_SHELL',
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
      r.send(MEASURED, { type: 'windowFitted' }, tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL));
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
      r.send(MEASURED, { type: 'windowFitted' }, tab('loading', SUSPENDED));
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
      r.send(MEASURED, { type: 'windowFitted' }, tab('loading', CONSENT));
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
      r.send(MEASURED, { type: 'windowFitted' }, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
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
      r.send(MEASURED, { type: 'windowFitted' }, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
      r.send(tab('complete', COMPOSER_URL), { type: 'agentInjected' }, report({ storyInput: 'absent' }));
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
      r.send(MEASURED, { type: 'windowFitted' }, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
      r.send(tab('complete', COMPOSER_URL), { type: 'agentInjected' }, report({ storyInput: 'absent' }));
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
      r.send(MEASURED, { type: 'windowFitted' }, tab('loading', COMPOSER_URL), tab('loading', COMPOSER_URL));
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
      r.send({ type: 'agentInjected' }, report({ storyInput: 'absent' }));
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
      r.send(MEASURED, { type: 'windowFitted' });
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
      { type: 'windowFitted' },
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
    swControlled: good() ? false : pick(rnd, [true, 'unknown'] as const),
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
      return s.frameDelta === null ? MEASURED : { type: 'windowFitted' };
    case 'navigating':
      return rnd() < 0.9 ? tab('loading', COMPOSER_URL) : tab(pick(rnd, ['loading', 'complete'] as const), undefined);
    case 'reloading':
      return tab(s.loadsSinceReload === 0 ? 'loading' : 'complete', rnd() < 0.9 ? COMPOSER_URL : HOME);
    case 'probing':
      switch (s.step) {
        case 'awaitComplete':
          return tab('complete', COMPOSER_URL);
        case 'injectAgent':
          return rnd() < 0.5 ? { type: 'agentInjected' } : injected(rnd() < 0.5);
        case 'awaitReport':
          // AM28: a same-document load, or home, can come before the report of a new document.
          return rnd() < 0.85
            ? { type: 'agentReport', probe: randomProbe(rnd) }
            : pick(rnd, [tab('loading', `${COMPOSER_URL}?x`), tab(undefined, HOME), tab('loading', HOME)]);
        case 'refitMeasure':
          return MEASURED;
        case 'refitUpdate':
          return { type: 'windowFitted' };
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
      return pick(rnd, [{ type: 'agentInjected' }, { type: 'windowFitted' }, { type: 'rulesInstalled' }, MEASURED]);
    case 7:
      return { type: 'effectFailed', effect: pick(rnd, EFFECT_TYPES), message: 'boom' };
    case 8:
      return { type: 'timer', timer: pick(rnd, ['inactivity', 'closeDelay', 'navigation'] as const) };
    case 9:
      return { type: 'cancel' };
    case 10:
      return startEv(pick(rnd, ['post', 'probe'] as const));
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
    for (const e of [
      'inject',
      'hardReload',
      'serveFile',
      'lockMsite',
      'patchRecordOutcome',
      'updateWindow',
      'rememberWindow',
      'forgetWindow',
    ]) {
      expect(emitted).toContain(e);
    }
  });
});
