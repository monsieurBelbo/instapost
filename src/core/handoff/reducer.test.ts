/**
 * U9 + U19 (strategy §7.11, docs/ux.md): the hand-off reducer, table-driven.
 *
 * - The autopilot chain: probe → account → openingEntry → inserting → composeReady → sharing →
 *   confirmingUpload → finished, effect by effect, with its record, badge and last result.
 * - Share once, across a re-injection (same document), a new document and a simulated worker restart;
 *   no Share in a test run; no Share in a Share test before its write-block rules are verified.
 * - The account prompt and its timeout; the queue (K10/K11); Stop only before Share; a window closed after
 *   Share is Couldn't confirm; the hold and a late upgrade (§6.4); Finish by hand; the offer-manual, hold and
 *   kill effects; a kill after Posted keeps Posted and locks (IR12).
 * - Kept from the hand-off era: the verified fit, its retry and the guided resize (W2/W3), the first
 *   navigation (AM20), the kill switch (AM17), the service-worker tripwire (P1–P3), the width rule (P4),
 *   the late input (P5), the browser flavour (P6) and the portrait shim's reading (AM37, SH-1, SH-2).
 *
 * "No transition ever emits a retry" and Share once are asserted for every row and, generically, over
 * seeded random event sequences.
 */
import { describe, expect, it } from 'vitest';
import type { Size } from '../geometry/fit.ts';
import { firstGuess, isUsableInner, type WindowBox, windowFit } from '../geometry/window-fit.ts';
import type { PageOrientation, ProbeReport } from '../ig-contract/contract.ts';
import { uaRule } from '../ig-contract/device-profile.ts';
import { rehearsalRules, SESSION_RULE_IDS } from '../ig-contract/rules.ts';
import { COMPOSER_URL, classifyComposerUrl } from '../ig-contract/urls.ts';
import { classifyEntry, isOk } from './outcome.ts';
import type { RateDecision } from './rate-guard.ts';
import { handoffReducer, statusOf } from './reducer.ts';
import {
  ACCOUNT_PROMPT_MS,
  type AgentEventName,
  type AgentFact,
  CLOSE_DELAY_MS,
  CLOSING_BACKSTOP_MS,
  CONFIRM_TICK_MS,
  defaultSettings,
  ENTRY_BUDGET_MS,
  type EntryFact,
  ERROR_EFFECT,
  type ErrorCode,
  FIT_RETRY_DELAY_MS,
  HANDOFF_TIMERS,
  type HandoffCtx,
  type HandoffEffect,
  type HandoffEvent,
  type HandoffMode,
  type HandoffRecord,
  type HandoffState,
  type HandoffStatus,
  HIDDEN_WAIT_MS,
  HOME_CLOSE_MS,
  HOME_READY_MS,
  IDLE,
  INPUT_WAIT_MS,
  INSERT_BUDGET_MS,
  isArmed,
  MANUAL_DEADLINE_MS,
  MAX_NET_ENTRIES,
  MAX_OTHER_NET_ENTRIES,
  MAX_WRITE_NET_ENTRIES,
  type MenuFingerprint,
  MSITE_LOCK_MS,
  NAVIGATION_TIMEOUT_MS,
  type NetEntry,
  OFFER_MANUAL_MS,
  POSTED_CLOSE_MS,
  PRE_SHARE_CAP_MS,
  RESIZE_POLL_MS,
  RESIZE_TIMEOUT_MS,
  type SessionPhase,
  type Settings,
  SHARE_ACK_MS,
  SHARE_ACTIVATION_WAIT_MS,
  UPLOAD_HOLD_MS,
  type WindowedSession,
} from './state.ts';

// ---------------------------------------------------------------------------------------
// Fixtures

const T0 = Date.UTC(2026, 9, 13, 12);
/** The owner's MacBook (S8): avail 1512x949 at top 33; the popup frame is 0x32. */
const SCREEN = { availLeft: 0, availTop: 33, availWidth: 1512, availHeight: 949 };
const WIN = 7;
const TAB = 42;
const HOME = 'https://www.instagram.com/';
const LOGIN = 'https://www.instagram.com/accounts/login/?next=%2Fcreate%2Fstory%2F';
const CHALLENGE = 'https://www.instagram.com/challenge/action/x/';
const CHECKPOINT = 'https://www.instagram.com/checkpoint/1/';
const ACCOUNTS_CENTER = 'https://accountscenter.instagram.com/';
const SUSPENDED = 'https://www.instagram.com/accounts/suspended/?next=%2Fcreate%2Fstory%2F';
const CODE_ENTRY = 'https://www.instagram.com/auth_platform/codeentry/?apc=x';
const CONSENT = 'https://www.instagram.com/consent/?flow=x';
const SESSION_IDS = [...SESSION_RULE_IDS];
const SHA = 'a'.repeat(64);
const HANDLE = 'testuser';

/** A probe of msite's home page after hydration (the usual landing, F3): the story input and the account. */
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
  lang: 'en',
  account: { handle: HANDLE, candidates: 1 },
  entryFound: true,
  activation: { isActive: false, hasBeenActive: false },
  visibility: 'visible',
  ...over,
});

const startEv = (mode: HandoffMode = 'post', screen = SCREEN, over: Partial<HandoffEvent> = {}): HandoffEvent =>
  ({
    type: 'start',
    exportId: mode === 'check' ? null : 'exp_1',
    mode,
    screen,
    browser: 'chromium',
    queue: false,
    exportSha256: SHA,
    ...over,
  }) as HandoffEvent;
const tab = (status: 'loading' | 'complete' | undefined, url: string | undefined, tabId = TAB): HandoffEvent => ({
  type: 'tabUpdated',
  tabId,
  status,
  url,
});
const report = (over: Partial<ProbeReport> = {}): HandoffEvent => ({ type: 'agentReport', probe: goodProbe(over) });
const SHIM_INSTALLED: PageOrientation = { type: 'portrait-primary', shim: 'installed' };
const SHIM_PRESENT: PageOrientation = { type: 'portrait-primary', shim: 'present' };
const SHIM_OFF: PageOrientation = { type: 'landscape-primary', shim: 'off' };
const injectedWith = (fresh: boolean, orientation?: PageOrientation): HandoffEvent => ({
  type: 'agentInjected',
  fresh,
  ...(orientation ? { orientation } : {}),
});
const agent = (event: AgentEventName): HandoffEvent => ({ type: 'agentEvent', event });
const fact = (f: AgentFact): HandoffEvent => ({ type: 'agentFact', fact: f });
const timer = (name: (typeof HANDOFF_TIMERS)[number]): HandoffEvent => ({ type: 'timer', timer: name });

const entryFact = (over: Partial<EntryFact> = {}): HandoffEvent =>
  fact({
    kind: 'entry',
    result: 'armed',
    fpUsed: false,
    storyIndex: 1,
    glyph: '0a1b2c3d',
    menuCount: 2,
    trials: 1,
    plusTaps: 2,
    armedMs: 310,
    ...over,
  });
const composeFact = (over: Partial<Extract<AgentFact, { kind: 'compose' }>> = {}): HandoffEvent =>
  fact({
    kind: 'compose',
    onComposer: true,
    drawn: true,
    landscape: false,
    controls: 1,
    variant: 'v1',
    fbAuto: false,
    settled: true,
    settleMs: 1600,
    canvas: { w: 1022, h: 1818 },
    imageScore: null,
    ...over,
  });
const SHARE_DONE = fact({ kind: 'share-done', t0Wall: T0 });
const net = (entries: NetEntry[], elapsedMs: number): HandoffEvent => fact({ kind: 'net', entries, elapsedMs });
const UPLOAD = '/rupload_igphoto/fb_uploader_1760356800000';
const PUBLISH = '/api/v1/media/configure_to_story/';
const upload = (status: number, end = 1500): NetEntry => ({
  host: 'i',
  path: UPLOAD,
  status,
  type: status ? 'application/json' : '',
  redirected: false,
  start: 100,
  end,
});
const publish = (status: number, end = 2500, over: Partial<NetEntry> = {}): NetEntry => ({
  host: 'www',
  path: PUBLISH,
  status,
  type: status ? 'application/json' : '',
  redirected: false,
  start: 1600,
  end,
  ...over,
});

/** tabs.get inner 500x900 inside a 500x(900 + frameH) window: the S8 frame is 0x32. */
const measured = (frameH = 32): HandoffEvent => ({
  type: 'tabMeasured',
  inner: { w: 500, h: 900 },
  outer: { left: 500, top: 33, width: 500, height: 900 + frameH },
});
const MEASURED = measured();
const FIT = (() => {
  const f = windowFit(SCREEN, { w: 0, h: 32 });
  if (!f.ok) throw new Error('fixture screen must fit');
  return f;
})();
const fittedEv = (fitted: boolean, inner: Size = FIT.inner, outer?: WindowBox): HandoffEvent => ({
  type: 'windowFitted',
  box: FIT.outer,
  target: FIT.inner,
  fitted,
  inner,
  outer: outer ?? { ...FIT.outer, width: inner.w, height: inner.h + 32 },
});
const FITTED = fittedEv(true);
const ARC_TAB = { w: 1512, h: 902 };
const ARC_WINDOW = { left: 1831, top: 13, width: 1512, height: 949 };
const NOT_FITTED = fittedEv(false, ARC_TAB, ARC_WINDOW);
const ARC_MEASURED: HandoffEvent = { type: 'tabMeasured', inner: ARC_TAB, outer: ARC_WINDOW, zoom: 1 };
const sized = (w: number, h: number): HandoffEvent => ({
  type: 'windowSized',
  inner: { w, h },
  outer: { left: 0, top: 0, width: w, height: h + 47 },
});
const INPUT_WAITED = timer('inputWait');
const HOUR = 3_600_000;

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
  fingerprint?: MenuFingerprint | null;
  dwellScale?: number;
  budgetScale?: number;
}

const EXPECTED = { handle: HANDLE, detectedAt: T0 - 86_400_000 };

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
    // The live build by default: a guarded build's static ruleset blocks every post's writes.
    const guarded = this.opts.guarded ?? false;
    return {
      now: this.now,
      guarded,
      chromeMajor: this.opts.chromeMajor ?? 155,
      settings: {
        ...defaultSettings(guarded),
        expectedAccount: EXPECTED,
        lastTestPassAt: T0 - 1,
        ...this.opts.settings,
      },
      rate: this.opts.rate ?? { ok: true },
      uuid: () => `u${++this.n}`,
      random: () => 0.5,
      fingerprint: this.opts.fingerprint ?? null,
      brandedBrowser: this.opts.brandedBrowser ?? false,
      ...(this.opts.resizeTimeoutMs !== undefined ? { resizeTimeoutMs: this.opts.resizeTimeoutMs } : {}),
      ...(this.opts.dwellScale !== undefined ? { dwellScale: this.opts.dwellScale } : {}),
      ...(this.opts.budgetScale !== undefined ? { budgetScale: this.opts.budgetScale } : {}),
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

  get phase(): SessionPhase {
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
  get shares(): number {
    return this.count(isShare);
  }
  /** The session as a windowed state (tests only). */
  get w(): WindowedSession {
    const s = this.state;
    if (s.phase === 'idle' || s.phase === 'queued' || s.phase === 'opening' || s.phase === 'closing') {
      throw new Error(`not windowed: ${s.phase}`);
    }
    return s;
  }
}

const isDrive =
  (step: string) =>
  (e: HandoffEffect): boolean =>
    e.type === 'sendAgent' && e.command.type === 'agent/drive' && e.command.step === step;
const isShare = isDrive('share');
const isEntry = isDrive('open-entry');
const isInsert = isDrive('insert');
const types = (effects: HandoffEffect[]) => effects.map((e) => e.type);
const lastRecord = (r: Run): HandoffRecord | undefined =>
  r.effects.flatMap((e) => (e.type === 'writeRecord' ? [e.record] : [])).at(-1);
const lastOutcome = (r: Run) => lastRecord(r)?.outcome;
const lastResult = (r: Run) => r.statuses.flatMap((s) => (s.result ? [s.result] : [])).at(-1);

// ---- drivers ----------------------------------------------------------------------------

/** start → popup → rules → fit → navigate. Stops in `navigating`. */
function toNavigating(r: Run, mode: HandoffMode = 'post'): Run {
  r.send(startEv(mode), { type: 'windowCreated', windowId: WIN, tabId: TAB }, { type: 'rulesInstalled' });
  r.send(MEASURED, FITTED);
  return r;
}
/** …→ the first www commit → hard reload → its own commit. Stops in `reloading`. */
function toReloading(r: Run, mode: HandoffMode = 'post'): Run {
  toNavigating(r, mode).send(tab('loading', COMPOSER_URL), tab('loading', HOME));
  return r;
}
/** …→ the reload lands on home, shim installed, agent in: the probe is out. */
function toReport(r: Run, mode: HandoffMode = 'post', o: PageOrientation = SHIM_INSTALLED): Run {
  toReloading(r, mode).send(tab('complete', HOME), injectedWith(true, o));
  return r;
}
/** …→ the probe passes, the account is ok: + → Story waits for its dwell. */
function toEntry(r: Run, mode: HandoffMode = 'post'): Run {
  toReport(r, mode).send(report());
  return r;
}
/** …→ the dwell ran: agent/drive open-entry is out. */
function toEntrySent(r: Run, mode: HandoffMode = 'post'): Run {
  toEntry(r, mode).send(timer('dwell'));
  return r;
}
/** …→ Story armed the story input: the insert waits for its dwell. */
function toInserting(r: Run, mode: HandoffMode = 'post'): Run {
  toEntrySent(r, mode).send(entryFact());
  return r;
}
/** …→ the insert command, the file served, the photo set: the compose watch is out. */
function toAwaitComposer(r: Run, mode: HandoffMode = 'post'): Run {
  toInserting(r, mode).send(timer('dwell'), { type: 'agentGetFile' }, fact({ kind: 'inserted' }));
  return r;
}
/** Instagram's SPA navigation to /create/story/ after the photo was processed (a same-document load). */
const TO_COMPOSER: HandoffEvent[] = [
  tab('loading', COMPOSER_URL),
  tab('complete', COMPOSER_URL),
  injectedWith(false, SHIM_PRESENT),
];
/** …→ the composer drew the photo with one Share control. */
function toComposeReady(r: Run, mode: HandoffMode = 'post'): Run {
  toAwaitComposer(r, mode).send(...TO_COMPOSER, composeFact());
  return r;
}
/** …→ the share dwell ran: the Share command is out (once). */
function toSharing(r: Run): Run {
  toComposeReady(r).send(timer('dwell'));
  return r;
}
/** …→ the agent tapped Share: the outcome rules run. */
function toConfirming(r: Run): Run {
  toSharing(r).send(SHARE_DONE);
  return r;
}
/** …→ Instagram's upload and publish answered 200 JSON: Posted. */
function toPosted(r: Run): Run {
  toConfirming(r).send(net([upload(200), publish(200)], 2600));
  return r;
}

// ---------------------------------------------------------------------------------------
// Per-run invariants, checked after every table row and every random run.

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
  'raiseWindow',
]);

const activeId = (s: HandoffState): string | null => (s.phase === 'idle' ? null : s.handoffId);
const windowed = (s: HandoffState): WindowedSession | null =>
  s.phase === 'idle' || s.phase === 'queued' || s.phase === 'opening' || s.phase === 'closing' ? null : s;
const afterShare = (s: WindowedSession | null): boolean =>
  s !== null && ((s.shareSent && s.shareRefused === null) || s.sharedBy !== null);

const LIMITS: Record<string, number> = {
  openWindow: 1,
  installRules: 1,
  navigate: 1,
  hardReload: 1,
  serveFile: 1,
  'drive:open-entry': 1,
  'drive:insert': 1,
  'drive:share': 1,
  measureTab: 2,
  updateWindow: 3,
  writeRecord: 1,
  lockMsite: 1,
  noteOpen: 1,
  verifyTestRules: 1,
};

type Tally = Record<string, Record<string, number>>;

function key(e: HandoffEffect): string {
  return e.type === 'sendAgent' && e.command.type === 'agent/drive' ? `drive:${e.command.step}` : e.type;
}

function checkStep(step: Step, tally: Tally): void {
  const { prev, event, effects, state, now } = step;
  const id = activeId(state) ?? activeId(prev);
  const ts = types(effects);
  const pw = windowed(prev);
  const sw = windowed(state);

  // Never a second open, rules, navigation, reload, file, entry, insert, Share, record or lock.
  if (id !== null) {
    tally[id] ??= {};
    const t = tally[id];
    for (const e of effects) {
      const k = key(e);
      t[k] = (t[k] ?? 0) + 1;
      const limit = LIMITS[k];
      if (limit !== undefined) expect(t[k], `${k} for ${id}`).toBeLessThanOrEqual(limit);
    }
  }

  // From idle (or the queue), the only flow effect is the start's openWindow (closeWindow: an orphan popup).
  if (prev.phase === 'idle' || prev.phase === 'queued') {
    for (const e of effects) if (FLOW.has(e.type)) expect(e.type).toBe('openWindow');
  }
  // A closing session emits nothing that moves the flow forward again.
  if (prev.phase === 'closing') {
    for (const e of effects)
      expect(FLOW.has(e.type) || ['lockMsite', 'writeRecord', 'noteOpen'].includes(e.type)).toBe(false);
  }
  // Rules are removed only when the session is over, after closeWindow when both appear.
  if (ts.includes('removeRules')) {
    expect(state.phase).toBe('idle');
    if (ts.includes('closeWindow')) expect(ts.indexOf('closeWindow')).toBeLessThan(ts.indexOf('removeRules'));
  }
  for (const e of effects) if (e.type === 'removeRules') expect(e.ruleIds).toEqual(SESSION_IDS);
  // Closing comes first (after the editor refocus, never before a kill's close).
  if (state.phase === 'closing' && prev.phase !== 'closing' && prev.phase !== 'opening') {
    const kill = ts.includes('lockMsite');
    expect(kill ? ts[0] : ts[0] === 'focusEditor' ? ts[1] : ts[0]).toBe('closeWindow');
  }
  // The hard reload comes only from `navigating`; the navigation only from a verified or usable fit.
  if (ts.includes('hardReload')) expect(prev.phase).toBe('navigating');
  if (ts.includes('navigate')) {
    expect(['fitting', 'resizing']).toContain(prev.phase);
    const win = sw?.win ?? null;
    const last = win?.updates.at(-1);
    const usable = win?.finalTab ? isUsableInner(win.finalTab, win.zoom) : false;
    expect(usable || (prev.phase === 'fitting' && last?.fitted === true)).toBe(true);
  }
  if (ts.includes('readSize')) expect(prev.phase).toBe('resizing');
  for (const e of effects) if (e.type === 'measureTab') expect(e.settle).toBe(state.phase === 'fitting');
  for (const e of effects) {
    if (e.type !== 'updateWindow') continue;
    expect(e.reapply).toBe(state.phase === 'fitting');
  }
  // Locks only with a kill (the kill switch or TEST_LEAK).
  for (const e of effects) {
    if (e.type !== 'lockMsite') continue;
    expect(e.until).toBe(now + MSITE_LOCK_MS);
    const err = effects.flatMap((x) => (x.type === 'notifyEditor' ? [x.status.error] : []));
    expect(err.some((c) => c === 'KILLED_CHALLENGE' || c === 'KILLED_OFFHOST' || c === 'TEST_LEAK')).toBe(true);
  }
  // Statuses describe the session at hand (or a refused start).
  for (const e of effects) {
    if (e.type !== 'notifyEditor') continue;
    expect([null, activeId(prev), activeId(state)]).toContain(e.status.handoffId);
  }
  // Taps: open-entry only from the entry dwell, after the account decision; the insert only after an armed
  // entry; Share once (IR11), only from composeReady in a post or a verified Share test.
  if (effects.some(isEntry)) {
    expect(prev).toMatchObject({ phase: 'openingEntry', sub: 'dwell', entrySent: false });
    expect(pw?.account.confirmedBy).not.toBeNull();
  }
  if (effects.some(isInsert)) {
    expect(prev).toMatchObject({ phase: 'inserting', sub: 'dwell', insertSent: false });
    expect(pw?.entry?.result).toBe('armed');
  }
  if (effects.some(isShare)) {
    // From the share dwell, or (AP-5) when a page hidden at the dwell shows again.
    expect(prev).toMatchObject({ phase: 'composeReady', shareSent: false });
    expect(['dwell', 'awaitVisible']).toContain((prev as { sub?: string }).sub);
    // AP-5: never sent to a page known to be hidden.
    expect(sw?.hidden).toBe(false);
    expect(state).toMatchObject({ phase: 'sharing', shareSent: true });
    expect(['post', 'shareTest']).toContain(pw?.mode);
    if (pw?.mode === 'shareTest') expect(pw.testRulesVerified).toBe(true);
    expect(pw?.account.confirmedBy).not.toBeNull();
    expect(pw?.compose).toMatchObject({ onComposer: true, drawn: true, landscape: false, controls: 1 });
  }
  if (ts.includes('serveFile')) expect(prev).toMatchObject({ phase: 'inserting', sub: 'sent' });
  // A test never presses Share; a check never taps at all.
  const mode = sw?.mode ?? pw?.mode ?? null;
  if (mode === 'test') expect(effects.some(isShare)).toBe(false);
  if (mode === 'check')
    expect(effects.some((e) => isEntry(e) || isInsert(e) || isShare(e) || e.type === 'serveFile')).toBe(false);
  // AP-2: a run whose writes are blocked (a Share test, a guarded post) is never Posted or Not posted
  // after Share: its writes were meant to be blocked, so only O9, O10 or Couldn't confirm can decide it.
  const session = sw ?? pw;
  if (session?.writeBlocked) {
    for (const e of effects) {
      if (e.type !== 'notifyEditor' || !e.status.result) continue;
      expect(e.status.result.kind).not.toBe('posted');
      if (e.status.result.kind === 'notPosted') expect(e.status.result.code).not.toBe('UPLOAD_FAILED');
    }
  }
  // Posted only from Instagram's publish answer (2xx JSON, not redirected), when it is first decided.
  for (const e of effects) {
    if (e.type !== 'notifyEditor' || e.status.result?.kind !== 'posted' || state.phase !== 'finished') continue;
    if (prev.phase === 'finished' && prev.result.kind === 'posted') continue;
    const evidence = state.net;
    const pub = evidence.filter((x) => classifyEntry(x) === 'publish')[0];
    expect(pub, 'posted without a publish request').toBeDefined();
    expect(pub && isOk(pub.status) && !pub.redirected && /json/.test(pub.type)).toBe(true);
  }
  // After Share: never "Stopped", never a before-Share failure (Couldn't confirm unless the rules decided).
  if (afterShare(sw) && state.phase === 'finished' && prev.phase !== 'finished') {
    expect(['posted', 'notPosted', 'unknown', 'shareTested']).toContain(state.result.kind);
    if (state.result.kind === 'notPosted') expect(state.result.code).toBe('UPLOAD_FAILED');
  }
  // Stop after the Share command does nothing (until the result is known).
  if (event.type === 'cancel' && afterShare(pw) && prev.phase !== 'finished') expect(effects).toEqual([]);
  // The kill switch acts on every armed update of the composer tab.
  if (event.type === 'tabUpdated' && event.tabId === TAB && isArmed(prev)) {
    const v = classifyComposerUrl(event.url);
    if (v.kind === 'kill') expect(ts).toEqual(expect.arrayContaining(['closeWindow', 'lockMsite']));
  }
  // AM22: a session that opened a popup remembers it, and every end of a session forgets it.
  if (prev.phase === 'opening' && state.phase === 'scoping') expect(ts).toContain('rememberWindow');
  if (prev.phase !== 'idle' && prev.phase !== 'queued' && state.phase === 'idle') expect(ts).toContain('forgetWindow');
}

function checkRun(r: Run): void {
  const tally: Tally = {};
  for (const step of r.steps) checkStep(step, tally);
}

// ---------------------------------------------------------------------------------------
// The autopilot, effect by effect

describe('U19 the autopilot: Post story to Posted with no input', () => {
  it('emits the sequence in order, and only Instagram’s publish answer says Posted', () => {
    const r = new Run();
    const guess = firstGuess(SCREEN);
    if (!guess.ok) throw new Error('fixture screen must fit');

    expect(r.send(startEv())).toEqual([
      { type: 'noteOpen', t: T0 },
      { type: 'openWindow', box: guess.outer },
      { type: 'armTimer', timer: 'preShareCap', ms: PRE_SHARE_CAP_MS },
      { type: 'setBadge', text: '…', color: '#4a6fd1' },
      expect.objectContaining({
        type: 'notifyEditor',
        status: expect.objectContaining({ phase: 'opening', mode: 'post', step: 'instagram', canStop: true }),
      }),
    ]);
    // ux.md §4.6: docked at the right edge of the editor's screen, at its top.
    expect(guess.outer.left + guess.outer.width).toBe(SCREEN.availLeft + SCREEN.availWidth);
    expect(guess.outer.top).toBe(SCREEN.availTop);

    // A post installs only rule 1001: no write blocking (that is every test's).
    const scoped = r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB });
    expect(scoped[0]).toEqual({
      type: 'installRules',
      removeRuleIds: SESSION_IDS,
      addRules: [uaRule(TAB, 155, 'full')],
    });
    expect(scoped[1]).toEqual({ type: 'rememberWindow', windowId: WIN, tabId: TAB, handoffId: 'hof_u1' });
    r.send({ type: 'rulesInstalled' }, MEASURED);
    const nav = r.send(FITTED);
    expect(nav.slice(0, 2)).toEqual([
      { type: 'navigate', tabId: TAB, url: COMPOSER_URL },
      { type: 'armTimer', timer: 'navigation', ms: NAVIGATION_TIMEOUT_MS },
    ]);
    expect(r.send(tab('loading', COMPOSER_URL)).slice(0, 3)).toEqual([
      { type: 'hardReload', tabId: TAB },
      { type: 'clearTimer', timer: 'navigation' },
      { type: 'armTimer', timer: 'stepDeadline', ms: 30_000 },
    ]);
    r.send(tab('loading', HOME));
    expect(r.send(tab('complete', HOME)).slice(0, 2)).toEqual([
      { type: 'injectAgent', tabId: TAB },
      { type: 'armTimer', timer: 'stepDeadline', ms: HOME_READY_MS },
    ]);
    expect(r.send(injectedWith(true, SHIM_INSTALLED))).toEqual([
      { type: 'sendAgent', tabId: TAB, command: { type: 'agent/probe' } },
    ]);

    // The probe passes on home; the account is the expected one: + → Story after a human dwell.
    const decided = r.send(report());
    expect(types(decided)).toEqual(['clearTimer', 'armTimer', 'notifyEditor']);
    expect(decided[1]).toEqual({ type: 'armTimer', timer: 'dwell', ms: 1100 });
    expect(r.state).toMatchObject({
      phase: 'openingEntry',
      sub: 'dwell',
      route: 'homeOnly',
      account: { detected: HANDLE, expected: HANDLE, decision: 'ok', confirmedBy: 'match' },
    });
    expect(r.lastStatus).toMatchObject({ phase: 'openingEntry', step: 'story', c4: 'pass', path: '/' });

    expect(r.send(timer('dwell'))).toEqual([
      { type: 'sendAgent', tabId: TAB, command: { type: 'agent/drive', step: 'open-entry', fingerprint: null } },
      { type: 'armTimer', timer: 'stepDeadline', ms: ENTRY_BUDGET_MS },
    ]);
    // Story armed the input; the menu's fingerprint is learned.
    const armed = r.send(entryFact());
    expect(types(armed)).toEqual(['clearTimer', 'storeFingerprint', 'armTimer', 'notifyEditor']);
    expect(armed[1]).toEqual({
      type: 'storeFingerprint',
      fingerprint: { count: 2, storyIndex: 1, glyph: '0a1b2c3d', savedAt: T0 },
    });
    expect(armed[2]).toEqual({ type: 'armTimer', timer: 'dwell', ms: 2250 });
    expect(r.state).toMatchObject({ phase: 'inserting', sub: 'dwell' });

    expect(r.send(timer('dwell'))).toEqual([
      { type: 'sendAgent', tabId: TAB, command: { type: 'agent/drive', step: 'insert' } },
      { type: 'armTimer', timer: 'stepDeadline', ms: INSERT_BUDGET_MS },
    ]);
    expect(r.send({ type: 'agentGetFile' })).toEqual([{ type: 'serveFile', exportId: 'exp_1' }]);
    expect(r.send({ type: 'agentGetFile' })).toEqual([]);
    expect(types(r.send(fact({ kind: 'inserted' })))).toEqual(['sendAgent', 'armTimer', 'notifyEditor']);
    expect(r.state).toMatchObject({ phase: 'inserting', sub: 'awaitComposer' });

    // Instagram processes the photo and pushState's /create/story/: a same-document load (AM16).
    r.send(tab('loading', COMPOSER_URL));
    expect(r.state).toMatchObject({ phase: 'inserting', docCheck: 'awaitComplete', composerEntered: true });
    expect(r.send(tab('complete', COMPOSER_URL))).toEqual([{ type: 'injectAgent', tabId: TAB }]);
    expect(r.send(injectedWith(false, SHIM_PRESENT))).toEqual([]);
    expect(r.state).toMatchObject({ docCheck: null, pageOrientation: SHIM_PRESENT });

    // The composer drew the photo, its Share footer settled: a dwell of at least 2 s, then Share once.
    const ready = r.send(composeFact());
    expect(types(ready)).toEqual(['clearTimer', 'sendAgent', 'armTimer', 'notifyEditor']);
    expect(ready[2]).toEqual({ type: 'armTimer', timer: 'dwell', ms: 2500 });
    const share = r.send(timer('dwell'));
    expect(share).toEqual([
      { type: 'clearTimer', timer: 'preShareCap' },
      { type: 'clearTimer', timer: 'hiddenWait' },
      { type: 'sendAgent', tabId: TAB, command: { type: 'agent/drive', step: 'share' } },
      { type: 'armTimer', timer: 'shareAck', ms: SHARE_ACK_MS },
      expect.objectContaining({ type: 'notifyEditor' }),
    ]);
    expect(r.state).toMatchObject({ phase: 'sharing', shareSent: true, shareSentAt: T0 });
    expect(r.lastStatus).toMatchObject({ phase: 'sharing', step: 'share', canStop: false, shareSent: true });

    r.tick(800);
    const done = r.send(SHARE_DONE);
    expect(types(done)).toEqual(['clearTimer', 'armTimer', 'notifyEditor']);
    expect(done[1]).toEqual({ type: 'armTimer', timer: 'confirmTick', ms: CONFIRM_TICK_MS });
    expect(r.state).toMatchObject({ phase: 'confirmingUpload', sharedBy: 'autopilot', sharedAt: T0 + 800 });
    // The upload alone decides nothing; going home alone decides nothing.
    expect(r.send(net([upload(200)], 1600))).toEqual([]);
    r.send(tab('loading', HOME));
    expect(r.phase).toBe('confirmingUpload');

    r.tick(1200);
    const posted = r.send(net([publish(200)], 2900));
    expect(r.state).toMatchObject({ phase: 'finished', hold: 'none', result: { kind: 'posted', account: HANDLE } });
    // Instagram went home before the answer: the window closes 2 s later.
    expect(posted).toContainEqual({ type: 'armTimer', timer: 'closeDelay', ms: HOME_CLOSE_MS });
    expect(posted).toContainEqual({ type: 'setBadge', text: '✓', color: '#1f8f4e' });
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: 'writeLastResult',
        last: expect.objectContaining({ handoffId: 'hof_u1', mode: 'post' }),
      }),
    );
    const rec = lastRecord(r);
    expect(rec).toMatchObject({
      id: 'hof_u1',
      mode: 'post',
      outcome: 'posted',
      result: { kind: 'posted', detail: 'publish 200 application/json' },
      route: 'homeOnly',
      account: { detected: HANDLE, confirmedBy: 'match' },
      entry: { result: 'armed', storyIndex: 1, trials: 1 },
      compose: { variant: 'v1', controls: 1 },
      evidence: { sharedBy: 'autopilot', sharedAt: T0 + 800, alarms: [] },
      exportSha256: SHA,
      preflight: { C1: 'pass', C3: 'pass', C3b: 'pass', C4: 'pass', C5: 'fail' },
    });
    // Paths on the record have their digits normalised.
    expect(rec?.evidence?.net.map((e) => e.path)).toEqual([
      '/rupload_igphoto/fb_uploader_<n>',
      '/api/v<n>/media/configure_to_story/',
    ]);
    expect(rec?.phaseLog.map((p) => p.phase)).toEqual([
      'opening',
      'scoping',
      'fitting',
      'navigating',
      'reloading',
      'probing',
      'openingEntry',
      'inserting',
      'composeReady',
      'sharing',
      'confirmingUpload',
      'finished',
    ]);
    expect(rec?.steps).toMatchObject({ opened: T0, share: T0 + 800, confirmed: T0 + 2000 });

    const closing = r.tick(HOME_CLOSE_MS).send(timer('closeDelay'));
    expect(types(closing).slice(0, 2)).toEqual(['focusEditor', 'closeWindow']);
    expect(closing).not.toContainEqual(expect.objectContaining({ type: 'writeRecord' }));
    r.send({ type: 'windowRemoved', windowId: WIN });
    expect(r.state).toMatchObject({ phase: 'idle', last: { handoffId: 'hof_u1', outcome: 'posted' } });
    expect(r.shares).toBe(1);
    checkRun(r);
  });

  it('Posted before Instagram went home closes 8 s after the confirmation, or 2 s after home', () => {
    const r = toPosted(new Run());
    expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'closeDelay', ms: POSTED_CLOSE_MS });
    expect(r.state).toMatchObject({ phase: 'finished', homeClose: false });
    r.tick(1000).send(tab(undefined, HOME));
    expect(r.steps.at(-1)?.effects).toEqual([{ type: 'armTimer', timer: 'closeDelay', ms: HOME_CLOSE_MS }]);
    expect(r.state).toMatchObject({ homeClose: true });
    checkRun(r);
  });

  it('statusOf: a reconnected editor sees the run as it is, then the last result', () => {
    const r = toComposeReady(new Run());
    expect(statusOf(r.state)).toMatchObject({
      phase: 'composeReady',
      step: 'story',
      canStop: true,
      compose: { variant: 'v1' },
    });
    r.send(timer('dwell'), SHARE_DONE, net([upload(200), publish(200)], 2600), timer('closeDelay'));
    r.send({ type: 'windowRemoved', windowId: WIN });
    expect(statusOf(r.state)).toMatchObject({ handoffId: 'hof_u1', phase: 'idle', result: { kind: 'posted' } });
    expect(statusOf(IDLE)).toEqual({ handoffId: null, phase: 'idle' });
  });
});

// ---------------------------------------------------------------------------------------
// The transition table

interface Row {
  name: string;
  opts?: Opts;
  script: (r: Run) => void;
  phase: SessionPhase;
  /** The last status's error (null: none). */
  error?: ErrorCode | null;
  has?: HandoffEffect['type'][];
  lacks?: HandoffEffect['type'][];
  shares?: number;
  check?: (r: Run) => void;
}

const OWNER_UW = { availLeft: 1512, availTop: -428, availWidth: 3440, availHeight: 1410 };
const ARC_DELTA = { w: 0, h: 47 };
function fitFor(screen = OWNER_UW, delta = ARC_DELTA) {
  const f = windowFit(screen, delta);
  if (!f.ok) throw new Error('fixture screen must fit');
  return f;
}
const verify = (f: ReturnType<typeof fitFor>, fitted: boolean, t: Size = ARC_TAB, applied?: number): HandoffEvent => ({
  type: 'windowFitted',
  box: f.outer,
  target: f.inner,
  fitted,
  inner: fitted ? f.inner : t,
  outer: fitted ? f.outer : { ...ARC_WINDOW, width: t.w, height: t.h + 47 },
  ...(applied === undefined ? {} : { applied }),
});
const RETRY = timer('fitRetry');
function toArcFit(r: Run): Run {
  r.send(startEv('post', OWNER_UW), { type: 'windowCreated', windowId: WIN, tabId: TAB });
  r.send({ type: 'rulesInstalled' }, ARC_MEASURED);
  return r;
}
function toResizing(r: Run): Run {
  const f = fitFor();
  toArcFit(r).send(verify(f, false), RETRY, verify(f, false));
  return r;
}

const ROWS: Row[] = [
  // ---- the start and its guards ------------------------------------------------------------
  {
    name: 'start: MSITE_LOCKED until the lock expires, no window',
    opts: { settings: { msiteLockedUntil: T0 + 1000 } },
    script: (r) => r.send(startEv()),
    phase: 'idle',
    error: 'MSITE_LOCKED',
    lacks: ['openWindow', 'noteOpen'],
    check: (r) => expect(r.lastStatus).toMatchObject({ handoffId: null, freeAt: T0 + 1000 }),
  },
  {
    name: 'start: RATE_LIMITED by the hour cap, even when it may queue; the refusal names the rule',
    opts: { rate: { ok: false, code: 'RATE_LIMITED', rule: 'hour', freeAt: T0 + HOUR } },
    script: (r) => r.send(startEv('post', SCREEN, { queue: true } as Partial<HandoffEvent>)),
    phase: 'idle',
    error: 'RATE_LIMITED',
    lacks: ['openWindow', 'noteOpen', 'armTimer'],
    check: (r) => expect(r.lastStatus).toMatchObject({ handoffId: null, freeAt: T0 + HOUR, detail: 'hour' }),
  },
  {
    name: 'start: a test within the 60 s spacing is refused (no queue), naming the spacing',
    opts: { rate: { ok: false, code: 'RATE_LIMITED', rule: 'spacing', freeAt: T0 + 42_000 } },
    script: (r) => r.send(startEv('test')),
    phase: 'idle',
    error: 'RATE_LIMITED',
    lacks: ['openWindow', 'noteOpen'],
    check: (r) => expect(r.lastStatus).toMatchObject({ handoffId: null, freeAt: T0 + 42_000, detail: 'spacing' }),
  },
  {
    name: 'K10/K11: blocked only by the 60 s spacing, a queued post waits and starts by itself',
    opts: { rate: { ok: false, code: 'RATE_LIMITED', rule: 'spacing', freeAt: T0 + 42_000 } },
    script: (r) => {
      r.send(startEv('post', SCREEN, { queue: true } as Partial<HandoffEvent>));
      expect(r.state).toMatchObject({ phase: 'queued', startAt: T0 + 42_000 });
      expect(r.steps.at(-1)?.effects).toContainEqual({ type: 'armTimer', timer: 'queue', ms: 42_000 });
      expect(r.lastStatus).toMatchObject({ phase: 'queued', queuedUntil: T0 + 42_000, canStop: true });
      // A second click while queued is HANDOFF_BUSY; the queue stays.
      r.send(startEv());
      expect(r.lastStatus).toMatchObject({ handoffId: null, error: 'HANDOFF_BUSY' });
      r.opts.rate = { ok: true };
      r.tick(42_000).send(timer('queue'));
    },
    phase: 'opening',
    has: ['openWindow', 'noteOpen'],
    check: (r) => {
      // The queued id is the run's id (the editor follows it).
      expect(r.state).toMatchObject({ handoffId: 'hof_u1' });
      expect(r.count((e) => e.type === 'noteOpen')).toBe(1);
    },
  },
  {
    name: 'K11: Cancel while queued goes idle with Stopped; no window, no open noted, no record',
    opts: { rate: { ok: false, code: 'RATE_LIMITED', rule: 'spacing', freeAt: T0 + 42_000 } },
    script: (r) => r.send(startEv('post', SCREEN, { queue: true } as Partial<HandoffEvent>), { type: 'cancel' }),
    phase: 'idle',
    lacks: ['openWindow', 'noteOpen', 'writeRecord'],
    check: (r) => {
      expect(r.lastStatus).toMatchObject({ handoffId: 'hof_u1', phase: 'idle', result: { kind: 'stopped' } });
      expect(r.steps.at(-1)?.effects).toContainEqual({ type: 'clearTimer', timer: 'queue' });
    },
  },
  {
    name: 'K11: when the queue fires a cap applies after all → RATE_LIMITED, idle',
    opts: { rate: { ok: false, code: 'RATE_LIMITED', rule: 'spacing', freeAt: T0 + 42_000 } },
    script: (r) => {
      r.send(startEv('post', SCREEN, { queue: true } as Partial<HandoffEvent>));
      r.opts.rate = { ok: false, code: 'RATE_LIMITED', rule: 'hour', freeAt: T0 + HOUR };
      r.tick(42_000).send(timer('queue'));
    },
    phase: 'idle',
    error: 'RATE_LIMITED',
    lacks: ['openWindow'],
  },
  {
    name: 'start: HANDOFF_BUSY leaves the active session alone',
    script: (r) => r.send(startEv(), { type: 'windowCreated', windowId: WIN, tabId: TAB }, startEv()),
    phase: 'scoping',
    error: 'HANDOFF_BUSY',
    check: (r) => {
      expect(r.count((e) => e.type === 'openWindow')).toBe(1);
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
    name: 'start: a post or a test without an export is refused (only the check has no file)',
    script: (r) => r.send(startEv('test', SCREEN, { exportId: null } as Partial<HandoffEvent>)),
    phase: 'idle',
    error: 'AGENT_UNREACHABLE',
    lacks: ['openWindow'],
  },
  {
    name: 'start: an implausible Chrome major refuses',
    opts: { chromeMajor: Number.NaN },
    script: (r) => r.send(startEv()),
    phase: 'idle',
    error: 'AGENT_UNREACHABLE',
    lacks: ['openWindow'],
  },
  {
    name: 'AM23: a guarded build in a branded browser → BRANDED_BROWSER, no window',
    opts: { guarded: true, brandedBrowser: true },
    script: (r) => r.send(startEv()),
    phase: 'idle',
    error: 'BRANDED_BROWSER',
    lacks: ['openWindow', 'noteOpen'],
  },
  {
    name: 'P6: a guarded build refuses when the editor reports Arc',
    opts: { guarded: true },
    script: (r) => r.send(startEv('post', SCREEN, { browser: 'arc' } as Partial<HandoffEvent>)),
    phase: 'idle',
    error: 'BRANDED_BROWSER',
    check: (r) => expect(r.lastStatus).toMatchObject({ detail: 'browser arc' }),
  },
  {
    name: 'every test blocks Instagram’s writes for the tab (and workers); a post in live does not',
    script: (r) => {
      r.send(startEv('test'));
      expect(r.send({ type: 'windowCreated', windowId: WIN, tabId: TAB })[0]).toEqual({
        type: 'installRules',
        removeRuleIds: SESSION_IDS,
        addRules: [uaRule(TAB, 155, 'full'), ...rehearsalRules(TAB)],
      });
      expect(r.state).toMatchObject({ writeBlocked: true });
      const live = new Run();
      live.send(startEv());
      expect(live.state).toMatchObject({ writeBlocked: false });
      // A guarded build's static ruleset blocks a post's writes: it decides with Share-test semantics.
      const mock = new Run({ guarded: true });
      mock.send(startEv());
      expect(mock.state).toMatchObject({ writeBlocked: true });
    },
    phase: 'scoping',
  },

  // ---- W2/W3: the verified fit, its retry, the guided resize ----------------------------------
  {
    name: 'W1/W2: Arc ignored the create; one retry 300 ms later fits → navigating',
    script: (r) => {
      toArcFit(r);
      const f = fitFor();
      // 524x932 inner (+47 frame), docked right on the ultrawide the editor is on.
      expect(f.outer).toEqual({ left: 1512 + 3440 - 524, top: -428, width: 524, height: 979 });
      expect(r.send(verify(f, false))).toEqual([{ type: 'armTimer', timer: 'fitRetry', ms: FIT_RETRY_DELAY_MS }]);
      expect(r.tick(FIT_RETRY_DELAY_MS).send(RETRY)).toEqual([
        { type: 'updateWindow', windowId: WIN, tabId: TAB, box: f.outer, inner: f.inner, reapply: true },
      ]);
      r.send(verify(f, true));
    },
    phase: 'navigating',
    has: ['navigate'],
    check: (r) => expect(r.w.win).toMatchObject({ attempts: 2, created: ARC_WINDOW, docked: true }),
  },
  {
    name: 'W2: the retry misses but the tab is usable anyway (600x900) → navigating',
    script: (r) => {
      const f = fitFor();
      toArcFit(r).send(verify(f, false), RETRY, verify(f, false, { w: 600, h: 900 }));
    },
    phase: 'navigating',
    lacks: ['readSize'],
  },
  {
    name: 'W2/W3: both updates ignored → resizing; the pre-Share cap pauses',
    script: (r) => toResizing(r),
    phase: 'resizing',
    lacks: ['navigate'],
    check: (r) => {
      expect(r.steps.at(-1)?.effects.slice(0, 3)).toEqual([
        { type: 'clearTimer', timer: 'preShareCap' },
        { type: 'armTimer', timer: 'resizeDeadline', ms: RESIZE_TIMEOUT_MS },
        { type: 'armTimer', timer: 'resizePoll', ms: RESIZE_POLL_MS },
      ]);
      expect(r.state).toMatchObject({ preShareUntil: null, preShareLeft: PRE_SHARE_CAP_MS });
      expect(r.lastStatus).toMatchObject({ phase: 'resizing', resize: { tab: ARC_TAB, ok: false, maxW: 767 } });
    },
  },
  {
    name: 'W3: a usable size navigates; the pre-Share cap resumes with what was left',
    script: (r) => {
      toResizing(r);
      r.tick(90_000).send({ type: 'boundsChanged', windowId: WIN }, sized(900, 902), sized(493, 820));
    },
    phase: 'navigating',
    check: (r) => {
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'preShareCap', ms: PRE_SHARE_CAP_MS });
      expect(r.w).toMatchObject({ preShareUntil: T0 + 90_000 + PRE_SHARE_CAP_MS, win: { manualResize: true } });
    },
  },
  {
    name: 'W3: no usable size within 2 minutes → WINDOW_NOT_FITTED, never navigated',
    script: (r) => toResizing(r).tick(RESIZE_TIMEOUT_MS).send(timer('resizeDeadline')),
    phase: 'closing',
    error: 'WINDOW_NOT_FITTED',
    lacks: ['navigate', 'lockMsite'],
    check: (r) => expect(lastOutcome(r)).toBe('failed:WINDOW_NOT_FITTED'),
  },
  {
    name: 'W3: a guarded E2E flag shortens the deadline; a live build ignores it',
    opts: { guarded: true, resizeTimeoutMs: 2000 },
    script: (r) => toResizing(r),
    phase: 'resizing',
    check: (r) => {
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'resizeDeadline', ms: 2000 });
      const live = toResizing(new Run({ guarded: false, resizeTimeoutMs: 2000 }));
      expect(live.effects).toContainEqual({ type: 'armTimer', timer: 'resizeDeadline', ms: RESIZE_TIMEOUT_MS });
    },
  },
  {
    name: 'W2: a failed windows.update while fitting closes the popup (AGENT_UNREACHABLE)',
    script: (r) => toArcFit(r).send({ type: 'effectFailed', effect: 'updateWindow', message: 'No window' }),
    phase: 'closing',
    error: 'AGENT_UNREACHABLE',
    lacks: ['navigate'],
  },

  // ---- AM20: the first navigation -------------------------------------------------------------
  {
    name: 'AM20: the first load goes off-host (hidden URL change) → kill and lock, no reload',
    script: (r) => toNavigating(r).send(tab('loading', undefined), tab(undefined, undefined)),
    phase: 'closing',
    error: 'KILLED_OFFHOST',
    has: ['lockMsite'],
    lacks: ['hardReload'],
  },
  {
    name: 'AM20: no commit within 30 s → NAVIGATION_TIMEOUT, no lock',
    script: (r) => toNavigating(r).tick(NAVIGATION_TIMEOUT_MS).send(timer('navigation')),
    phase: 'closing',
    error: 'NAVIGATION_TIMEOUT',
    lacks: ['lockMsite'],
  },
  {
    name: 'NOT_LOGGED_IN on the first load: closes at once, no reload, no lock',
    script: (r) => toNavigating(r).send(tab('loading', LOGIN)),
    phase: 'closing',
    error: 'NOT_LOGGED_IN',
    lacks: ['hardReload', 'lockMsite'],
  },
  {
    name: 'the reload never completes → TIMEOUT (step Instagram)',
    script: (r) => toReloading(r).tick(30_000).send(timer('stepDeadline')),
    phase: 'closing',
    error: 'TIMEOUT',
    check: (r) => expect(lastResult(r)).toMatchObject({ code: 'TIMEOUT', detail: 'instagram 30 s' }),
  },

  // ---- the probe (§3.6 step 7) ---------------------------------------------------------------
  {
    name: 'guard fail: guarded build without the marker → GUARD_NOT_FAKE, nothing tapped',
    opts: { guarded: true },
    script: (r) => toReport(r).send(report({ marker: false })),
    phase: 'closing',
    error: 'GUARD_NOT_FAKE',
    lacks: ['lockMsite', 'serveFile'],
  },
  {
    name: 'live build + marker → FAKE INSTAGRAM banner, and it carries on',
    script: (r) => toReport(r).send(report({ marker: true })),
    phase: 'openingEntry',
    check: (r) => expect(r.lastStatus?.banner).toBe('FAKE_INSTAGRAM'),
  },
  {
    name: 'DESKTOP_SHELL: is_mobile false',
    script: (r) => toReport(r).send(report({ isMobile: false })),
    phase: 'closing',
    error: 'DESKTOP_SHELL',
  },
  {
    name: 'P3: the probe shows a worker intercepted requests → SW_INTERCEPTS, no lock',
    script: (r) => toReport(r).send(report({ swIntercepted: true })),
    phase: 'closing',
    error: 'SW_INTERCEPTS',
    lacks: ['lockMsite'],
  },
  {
    name: 'P4: landscape refits once (measure, one update), re-probes, then proceeds',
    script: (r) => {
      toReport(r).send(report({ portrait: false }));
      expect(r.steps.at(-1)?.effects).toEqual([{ type: 'measureTab', tabId: TAB, windowId: WIN, settle: false }]);
      r.send(MEASURED, FITTED, report());
    },
    phase: 'openingEntry',
    check: (r) => expect(r.count((e) => e.type === 'updateWindow')).toBe(2),
  },
  {
    name: 'P4: still too wide after the refit → LAYOUT_TOO_WIDE',
    script: (r) => {
      const wide = { inner: { w: 800, h: 1200 }, portrait: true };
      toReport(r).send(report(wide), MEASURED, FITTED, report(wide));
    },
    phase: 'closing',
    error: 'LAYOUT_TOO_WIDE',
  },
  {
    name: 'P5: no story input on home: one wait; it appears → one more probe → proceed',
    script: (r) => {
      toReport(r).send(report({ storyInput: 'absent', acceptOk: false }));
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitInput', inputWaitUsed: true });
      expect(r.steps.at(-1)?.effects).toEqual([
        { type: 'sendAgent', tabId: TAB, command: { type: 'agent/watch' } },
        { type: 'armTimer', timer: 'inputWait', ms: INPUT_WAIT_MS },
      ]);
      r.send(agent('input-appeared'), report());
    },
    phase: 'openingEntry',
  },
  {
    name: 'P5 (E12 h): the account link is there at once, the story input is not: account-appeared does not end the wait early',
    script: (r) => {
      toReport(r).send(report({ storyInput: 'absent', acceptOk: false }));
      r.tick(100).send(agent('account-appeared'), report({ storyInput: 'absent', acceptOk: false }));
      // Still waiting, for the rest of the one wait (no new agent/watch: the watch reports the input once).
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitInput' });
      expect(r.steps.at(-1)?.effects).toEqual([{ type: 'armTimer', timer: 'inputWait', ms: INPUT_WAIT_MS - 100 }]);
      r.tick(1000).send(agent('input-appeared'), report());
    },
    phase: 'openingEntry',
    check: (r) => {
      expect(r.count((e) => e.type === 'sendAgent' && e.command.type === 'agent/watch')).toBe(1);
      expect(r.count((e) => e.type === 'armTimer' && e.timer === 'inputWait')).toBe(2);
    },
  },
  {
    name: 'P5: an appeared event missed while a re-probe was in flight: the deadline probes once more and decides',
    script: (r) => {
      toReport(r).send(report({ storyInput: 'absent', acceptOk: false }));
      r.tick(100).send(agent('account-appeared'));
      // input-appeared while the re-probe is in flight is not acted on …
      r.send(agent('input-appeared'), report({ storyInput: 'absent', acceptOk: false }));
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitInput' });
      // … the deadline's probe sees the input.
      r.tick(INPUT_WAIT_MS).send(INPUT_WAITED, report());
    },
    phase: 'openingEntry',
  },
  {
    name: 'P5: the account link mounts late too: the same one wait covers it',
    script: (r) => {
      toReport(r).send(report({ account: { handle: null, candidates: 0 } }));
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitInput' });
      r.send(agent('account-appeared'), report());
    },
    phase: 'openingEntry',
    check: (r) => expect(r.count((e) => e.type === 'armTimer' && e.timer === 'inputWait')).toBe(1),
  },
  {
    name: 'P5 + offer-manual: no story input within 6 s → INPUT_MISSING, the window kept 60 s for Finish by hand',
    script: (r) => {
      toReport(r).send(report({ storyInput: 'absent', acceptOk: false }), INPUT_WAITED);
      // The wait ran out: one more probe decides on what is there now.
      expect(r.steps.at(-1)?.effects).toEqual([{ type: 'sendAgent', tabId: TAB, command: { type: 'agent/probe' } }]);
      r.send(report({ storyInput: 'absent', acceptOk: false }));
    },
    phase: 'finished',
    error: 'INPUT_MISSING',
    lacks: ['closeWindow'],
    check: (r) => {
      expect(r.state).toMatchObject({ hold: 'offerManual', result: { kind: 'notPosted', code: 'INPUT_MISSING' } });
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'offerManual', ms: OFFER_MANUAL_MS });
      expect(r.lastStatus).toMatchObject({ held: 'offerManual', c4: 'fail' });
      expect(lastRecord(r)).toMatchObject({ outcome: 'failed:INPUT_MISSING' });
      // Unused, the offer runs out and the window closes.
      r.tick(OFFER_MANUAL_MS).send(timer('offerManual'));
      expect(r.phase).toBe('closing');
    },
  },
  {
    name: 'a test has nothing to finish by hand: an entry failure in a Test run closes the window',
    script: (r) => toEntrySent(r, 'test').send(entryFact({ result: 'MENU_DRIFT', menuCount: 3, storyIndex: null })),
    phase: 'closing',
    error: 'STORY_ENTRY_MISSING',
    check: (r) => {
      expect(r.count((e) => e.type === 'armTimer' && e.timer === 'offerManual')).toBe(0);
      expect(lastRecord(r)).toMatchObject({ outcome: 'failed:STORY_ENTRY_MISSING', mode: 'test' });
    },
  },
  {
    name: 'accept drift → ACCEPT_DRIFT (offer-manual)',
    script: (r) => toReport(r).send(report({ acceptOk: false })),
    phase: 'finished',
    error: 'ACCEPT_DRIFT',
  },
  {
    name: 'the probe never answers within 15 s → TIMEOUT',
    script: (r) => toReport(r).tick(HOME_READY_MS).send(timer('stepDeadline')),
    phase: 'closing',
    error: 'TIMEOUT',
  },
  {
    name: '§4.6: a hidden page at the probe is raised once before anything is tapped',
    script: (r) => toReport(r).send(report({ visibility: 'hidden' })),
    phase: 'openingEntry',
    has: ['raiseWindow'],
    check: (r) => {
      expect(r.w).toMatchObject({ raisedForVisibility: true, hidden: true });
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'hiddenWait', ms: HIDDEN_WAIT_MS });
      expect(r.count((e) => e.type === 'raiseWindow')).toBe(1);
    },
  },

  // ---- the check ------------------------------------------------------------------------------
  {
    name: 'check: reads the account and closes at once; never taps, never serves a file',
    script: (r) => toReport(r, 'check').send(report(), { type: 'agentGetFile' }),
    phase: 'closing',
    error: null,
    lacks: ['serveFile', 'raiseWindow'],
    check: (r) => {
      expect(lastRecord(r)).toMatchObject({
        mode: 'check',
        outcome: 'checked',
        exportId: null,
        result: { account: HANDLE },
      });
      expect(r.count((e) => isEntry(e) || isShare(e) || isInsert(e))).toBe(0);
      // Checks block writes too, and count toward the pace.
      expect(r.effects).toContainEqual(expect.objectContaining({ type: 'noteOpen' }));
    },
  },
  {
    name: 'check with no account expected yet learns it',
    opts: { settings: { expectedAccount: null } },
    script: (r) => toReport(r, 'check').send(report()),
    phase: 'closing',
    has: ['setExpectedAccount'],
  },

  // ---- the account (§4.8) -----------------------------------------------------------------------
  {
    name: '§4.8: another account is logged in → paused before any tap; the cap pauses; Post as @other proceeds',
    script: (r) => {
      toReport(r).send(report({ account: { handle: 'other', candidates: 1 } }));
      expect(r.state).toMatchObject({ phase: 'awaitingAccount', prompt: 'mismatch', until: T0 + ACCOUNT_PROMPT_MS });
      expect(r.lastStatus).toMatchObject({
        accountPrompt: { kind: 'mismatch', detected: 'other', expected: HANDLE, until: T0 + ACCOUNT_PROMPT_MS },
        step: 'account',
      });
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'accountPrompt', ms: ACCOUNT_PROMPT_MS });
      expect(r.w.preShareUntil).toBeNull();
      // A stray dwell or a hidden page does nothing while the owner decides.
      expect(r.send(timer('dwell'))).toEqual([]);
      r.tick(20_000).send({ type: 'accountChoice', handoffId: 'hof_u1', proceed: true });
    },
    phase: 'openingEntry',
    has: ['setExpectedAccount'],
    check: (r) => {
      expect(r.w.account).toMatchObject({ detected: 'other', confirmedBy: 'owner', expected: 'other' });
      expect(r.effects).toContainEqual({
        type: 'setExpectedAccount',
        account: { handle: 'other', detectedAt: T0 + 20_000 },
      });
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'preShareCap', ms: expect.any(Number) });
      expect(r.count(isEntry)).toBe(0);
    },
  },
  {
    name: '§4.8: Cancel at the prompt → Stopped, nothing tapped',
    script: (r) => {
      toReport(r).send(report({ account: { handle: 'other', candidates: 1 } }));
      r.send({ type: 'accountChoice', handoffId: 'hof_u1', proceed: false });
    },
    phase: 'closing',
    lacks: ['serveFile'],
    check: (r) => {
      expect(lastRecord(r)).toMatchObject({ outcome: 'cancelled', result: { kind: 'stopped', stoppedBy: 'owner' } });
      expect(r.count(isEntry)).toBe(0);
    },
  },
  {
    name: '§4.8: nobody answers within a minute → ACCOUNT_UNCONFIRMED (close), nothing tapped',
    script: (r) => {
      const two = report({ account: { handle: null, candidates: 2 } });
      toReport(r).send(two, INPUT_WAITED, two);
      expect(r.state).toMatchObject({ phase: 'awaitingAccount', prompt: 'unreadable' });
      r.tick(ACCOUNT_PROMPT_MS).send(timer('accountPrompt'));
    },
    phase: 'closing',
    error: 'ACCOUNT_UNCONFIRMED',
    check: (r) => expect(lastResult(r)).toMatchObject({ code: 'ACCOUNT_UNCONFIRMED', detail: 'unreadable' }),
  },
  {
    name: '§4.8: an unreadable account, Post anyway: proceeds without remembering anything',
    script: (r) => {
      const none = report({ account: { handle: null, candidates: 0 } });
      toReport(r).send(none, INPUT_WAITED, none);
      r.send({ type: 'accountChoice', handoffId: 'hof_u1', proceed: true });
    },
    phase: 'openingEntry',
    lacks: ['setExpectedAccount'],
  },
  {
    name: '§4.8: no account expected (after Forget): a post asks first',
    opts: { settings: { expectedAccount: null } },
    script: (r) => toEntry(r),
    phase: 'awaitingAccount',
    check: (r) => expect(r.state).toMatchObject({ prompt: 'first' }),
  },
  {
    name: 'the setup test with no account expected learns it without asking',
    opts: { settings: { expectedAccount: null, lastTestPassAt: null } },
    script: (r) => toEntry(r, 'test'),
    phase: 'openingEntry',
    has: ['setExpectedAccount'],
    check: (r) => expect(r.w.account).toMatchObject({ decision: 'learn', confirmedBy: 'learned' }),
  },
  {
    name: '"Only post as" off: never asks, whoever is logged in',
    opts: { settings: { accountLock: false } },
    script: (r) => toReport(r).send(report({ account: { handle: 'other', candidates: 1 } })),
    phase: 'openingEntry',
    check: (r) => expect(r.w.account).toMatchObject({ decision: 'unlocked', confirmedBy: 'unlocked' }),
  },
  {
    name: 'a choice for another hand-off, or outside the prompt, is ignored',
    script: (r) => {
      toEntry(r).send({ type: 'accountChoice', handoffId: 'hof_u1', proceed: false });
      toReport(new Run()).send(report({ account: { handle: 'x', candidates: 1 } }), {
        type: 'accountChoice',
        handoffId: 'hof_other',
        proceed: true,
      });
    },
    phase: 'openingEntry',
  },

  // ---- + → Story (C10, C11) --------------------------------------------------------------------
  {
    name: 'a stored fingerprint goes with the open-entry; an unchanged one is not stored again',
    opts: { fingerprint: { count: 2, storyIndex: 1, glyph: '0a1b2c3d', savedAt: T0 - 5 } },
    script: (r) => toInserting(r),
    phase: 'inserting',
    lacks: ['storeFingerprint'],
    check: (r) =>
      expect(r.effects.find(isEntry)).toMatchObject({
        command: { fingerprint: { count: 2, storyIndex: 1, glyph: '0a1b2c3d' } },
      }),
  },
  {
    name: 'C10: the menu is not what instapost expects → STORY_ENTRY_MISSING (offer-manual), nothing more tapped',
    script: (r) =>
      toEntrySent(r).send(entryFact({ result: 'MENU_DRIFT', menuCount: 3, storyIndex: null, glyph: null })),
    phase: 'finished',
    error: 'STORY_ENTRY_MISSING',
    lacks: ['closeWindow'],
    check: (r) => {
      expect(r.state).toMatchObject({
        hold: 'offerManual',
        result: { code: 'STORY_ENTRY_MISSING', detail: 'menu 3 items' },
      });
      expect(r.count(isInsert)).toBe(0);
    },
  },
  {
    name: 'C3a: Instagram refused to start the story (landscape viewport) → LANDSCAPE, close',
    script: (r) => toEntrySent(r).send(entryFact({ result: 'SESSION_NOT_STARTED' })),
    phase: 'closing',
    error: 'LANDSCAPE',
    check: (r) => expect(lastResult(r)).toMatchObject({ detail: 'story session refused' }),
  },
  {
    name: 'R22: the owner kept clicking in the window → WINDOW_IN_USE (offer-manual)',
    script: (r) => toEntrySent(r).send(entryFact({ result: 'ACTIVATION_ACTIVE' })),
    phase: 'finished',
    error: 'WINDOW_IN_USE',
  },
  {
    name: 'the entry never answers within its budget → TIMEOUT (step Story)',
    script: (r) => toEntrySent(r).tick(ENTRY_BUDGET_MS).send(timer('stepDeadline')),
    phase: 'closing',
    error: 'TIMEOUT',
    check: (r) => expect(lastResult(r)).toMatchObject({ detail: 'story 30 s' }),
  },
  {
    name: 'an entry fact before the command, or a second one, is ignored',
    script: (r) => {
      toEntry(r).send(entryFact());
      expect(r.phase).toBe('openingEntry');
      r.send(timer('dwell'), entryFact(), entryFact({ result: 'MENU_MISSING' }));
    },
    phase: 'inserting',
  },

  // ---- the insert and the composer (C12) ----------------------------------------------------------
  {
    name: 'the insert failed (accept drift) → ACCEPT_DRIFT (offer-manual)',
    script: (r) =>
      toInserting(r).send(
        timer('dwell'),
        { type: 'agentGetFile' },
        fact({ kind: 'insert-failed', why: 'accept-drift' }),
      ),
    phase: 'finished',
    error: 'ACCEPT_DRIFT',
  },
  {
    name: 'the export is missing (serveFile failed) → INJECTION_IGNORED (offer-manual)',
    script: (r) =>
      toInserting(r).send(
        timer('dwell'),
        { type: 'agentGetFile' },
        { type: 'effectFailed', effect: 'serveFile', message: 'gone' },
      ),
    phase: 'finished',
    error: 'INJECTION_IGNORED',
    check: (r) => expect(lastResult(r)).toMatchObject({ detail: 'export missing' }),
  },
  {
    name: 'the composer never drew the photo → INJECTION_IGNORED (offer-manual)',
    script: (r) => toAwaitComposer(r).tick(INSERT_BUDGET_MS).send(timer('stepDeadline')),
    phase: 'finished',
    error: 'INJECTION_IGNORED',
  },
  {
    name: 'C12: no Share control, or two → SHARE_MISSING (offer-manual), nothing pressed',
    script: (r) => toAwaitComposer(r).send(...TO_COMPOSER, composeFact({ controls: 2, variant: null })),
    phase: 'finished',
    error: 'SHARE_MISSING',
    shares: 0,
    check: (r) => expect(lastResult(r)).toMatchObject({ detail: '2 Share controls' }),
  },
  {
    name: 'C3b: Instagram’s rotate snackbar → SCREEN_LANDSCAPE, nothing pressed',
    script: (r) => toAwaitComposer(r).send(...TO_COMPOSER, composeFact({ landscape: true, controls: 0 })),
    phase: 'closing',
    error: 'SCREEN_LANDSCAPE',
    shares: 0,
  },
  {
    name: 'OD12: the v2 footer with Facebook’s badge is recorded and said on Posted',
    script: (r) => {
      toAwaitComposer(r).send(...TO_COMPOSER, composeFact({ variant: 'v2', fbAuto: true }));
      r.send(timer('dwell'), SHARE_DONE, net([upload(200), publish(200)], 2600));
    },
    phase: 'finished',
    check: (r) => expect(lastResult(r)).toMatchObject({ kind: 'posted', facebook: true }),
  },

  // ---- test runs (§7) ---------------------------------------------------------------------------
  {
    name: 'Test run: stops at Share (never pressed), closes at once, remembers the pass',
    script: (r) => toComposeReady(r, 'test'),
    phase: 'closing',
    shares: 0,
    has: ['setLastTestPass'],
    check: (r) => {
      expect(lastRecord(r)).toMatchObject({
        mode: 'test',
        outcome: 'tested',
        result: { kind: 'tested', account: HANDLE },
      });
      expect(r.effects).toContainEqual({ type: 'setLastTestPass', at: T0 });
      expect(r.effects).toContainEqual(expect.objectContaining({ type: 'storeFingerprint' }));
    },
  },
  {
    name: 'Share test: verifies its write-block rules, then presses Share once; a blocked upload passes',
    script: (r) => {
      toAwaitComposer(r, 'shareTest').send(...TO_COMPOSER, composeFact());
      expect(r.state).toMatchObject({ phase: 'composeReady', sub: 'verifyRules' });
      expect(r.steps.at(-1)?.effects).toContainEqual({ type: 'verifyTestRules', tabId: TAB });
      // A dwell before the rules are verified presses nothing.
      expect(r.send(timer('dwell'))).toEqual([]);
      r.send({ type: 'rulesVerified', ok: true }, timer('dwell'), SHARE_DONE);
      r.send(net([upload(0, 1000)], 2000));
      expect(r.phase).toBe('confirmingUpload');
      r.tick(3000).send(timer('confirmTick'));
    },
    phase: 'finished',
    shares: 1,
    check: (r) => expect(lastRecord(r)).toMatchObject({ mode: 'shareTest', outcome: 'share-tested' }),
  },
  {
    name: 'Share test without its rules installed: Share is never pressed (AGENT_UNREACHABLE)',
    script: (r) =>
      toAwaitComposer(r, 'shareTest').send(...TO_COMPOSER, composeFact(), { type: 'rulesVerified', ok: false }),
    phase: 'closing',
    error: 'AGENT_UNREACHABLE',
    shares: 0,
  },
  {
    name: 'O10: a Share test whose publish went through → TEST_LEAK: kill and lock',
    script: (r) => {
      toAwaitComposer(r, 'shareTest').send(...TO_COMPOSER, composeFact(), { type: 'rulesVerified', ok: true });
      r.send(timer('dwell'), SHARE_DONE, net([upload(200), publish(200)], 2600));
    },
    phase: 'closing',
    error: 'TEST_LEAK',
    has: ['lockMsite'],
    check: (r) =>
      expect(lastRecord(r)).toMatchObject({
        outcome: 'killed:TEST_LEAK',
        result: { code: 'TEST_LEAK', killed: 'TEST_LEAK' },
      }),
  },

  // ---- Share and the outcome (§6) -----------------------------------------------------------------
  {
    name: 'share-refused (nothing clicked) is a before-Share failure: Nothing was posted, offer-manual',
    script: (r) => toSharing(r).send(fact({ kind: 'share-refused', why: 'controls' })),
    phase: 'finished',
    error: 'SHARE_MISSING',
    check: (r) => {
      expect(r.state).toMatchObject({ hold: 'offerManual', shareRefused: 'controls' });
      expect(lastResult(r)).toMatchObject({ kind: 'notPosted', code: 'SHARE_MISSING' });
    },
  },
  {
    name: 'O8: no answer to the Share command → Couldn’t confirm, held (an upload may be running)',
    script: (r) => toSharing(r).tick(SHARE_ACK_MS).send(timer('shareAck')),
    phase: 'finished',
    check: (r) => {
      expect(r.state).toMatchObject({
        hold: 'upload',
        result: { kind: 'unknown', why: 'share-not-acknowledged', held: true },
      });
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'uploadHold', ms: UPLOAD_HOLD_MS });
      expect(r.effects).toContainEqual({ type: 'setBadge', text: '?', color: '#b7791f' });
    },
  },
  {
    name: 'O2: the publish answered 400 → Not posted (UPLOAD_FAILED), closes in 3 s',
    script: (r) => toConfirming(r).send(net([upload(200), publish(400)], 2600)),
    phase: 'finished',
    error: 'UPLOAD_FAILED',
    check: (r) => {
      expect(r.effects).toContainEqual({ type: 'armTimer', timer: 'closeDelay', ms: CLOSE_DELAY_MS });
      expect(lastRecord(r)).toMatchObject({ outcome: 'failed:UPLOAD_FAILED' });
    },
  },
  {
    name: 'O3: a redirect to a login page (200 HTML) is never Posted',
    script: (r) =>
      toConfirming(r).send(net([upload(200), publish(200, 2500, { type: 'text/html', redirected: true })], 2600)),
    phase: 'finished',
    check: (r) => expect(lastResult(r)).toMatchObject({ kind: 'unknown', why: 'redirected' }),
  },
  {
    name: 'O4: the upload failed (500) and Instagram never published → Not posted after 3 s',
    script: (r) => {
      toConfirming(r).send(net([upload(500, 1000)], 1500));
      r.tick(CONFIRM_TICK_MS * 2).send(timer('confirmTick'));
    },
    phase: 'finished',
    error: 'UPLOAD_FAILED',
  },
  {
    name: 'O5 + §6.4: no publish 75 s after a 2xx upload → held; a late 200 upgrades the record to Posted',
    script: (r) => {
      toConfirming(r).send(net([upload(200, 1000)], 1500));
      r.tick(76_000).send(timer('confirmTick'));
      expect(r.state).toMatchObject({
        phase: 'finished',
        hold: 'upload',
        result: { kind: 'unknown', why: 'no-finalize-after-upload' },
      });
      r.tick(30_000).send(net([publish(200, 107_000)], 107_100));
    },
    phase: 'finished',
    has: ['patchRecordOutcome'],
    check: (r) => {
      expect(r.state).toMatchObject({ hold: 'none', result: { kind: 'posted', late: true } });
      expect(r.effects).toContainEqual(
        expect.objectContaining({ type: 'patchRecordOutcome', handoffId: 'hof_u1', outcome: 'posted' }),
      );
      expect(r.count((e) => e.type === 'writeRecord')).toBe(1);
    },
  },
  {
    name: 'O6: no upload at all within 120 s → Couldn’t confirm, held up to 15 minutes, then closed',
    script: (r) => {
      toConfirming(r).tick(120_000).send(timer('confirmTick'));
      expect(r.state).toMatchObject({ hold: 'upload', result: { why: 'no-upload-seen' } });
      r.tick(UPLOAD_HOLD_MS).send(timer('uploadHold'));
    },
    phase: 'closing',
    check: (r) => expect(lastOutcome(r)).toBe('unknown'),
  },
  {
    name: 'a guarded E2E budget scale shortens O6 (a guarded post’s writes are blocked by its static ruleset)',
    opts: { guarded: true, budgetScale: 0.01, rate: { ok: true } },
    script: (r) => toConfirming(r).tick(1300).send(timer('confirmTick')),
    phase: 'finished',
    check: (r) => expect(lastResult(r)).toMatchObject({ kind: 'unknown', why: 'no-upload-seen' }),
  },
  {
    name: 'O7: two publish requests: Posted, with the duplicate alarm',
    script: (r) => toConfirming(r).send(net([upload(200), publish(200, 2500), publish(200, 2700)], 2800)),
    phase: 'finished',
    check: (r) => expect(lastResult(r)).toMatchObject({ kind: 'posted', alarms: ['DUPLICATE_UPLOAD'] }),
  },

  // ---- Stop, the window, the kill switch after Share ---------------------------------------------
  {
    name: 'Stop before Share → Stopped, Nothing was posted; cleanup on windowRemoved',
    script: (r) => toComposeReady(r).send({ type: 'cancel' }, { type: 'windowRemoved', windowId: WIN }),
    phase: 'idle',
    has: ['closeWindow', 'removeRules'],
    shares: 0,
    check: (r) =>
      expect(lastRecord(r)).toMatchObject({ outcome: 'cancelled', result: { kind: 'stopped', stoppedBy: 'owner' } }),
  },
  {
    name: 'Stop after the Share command is not honoured',
    script: (r) => toSharing(r).send({ type: 'cancel' }, SHARE_DONE, { type: 'cancel' }),
    phase: 'confirmingUpload',
    lacks: ['closeWindow'],
  },
  {
    name: 'the window closed by hand before Share → Stopped (you closed the Instagram window)',
    script: (r) => toInserting(r).send({ type: 'windowRemoved', windowId: WIN }),
    phase: 'idle',
    check: (r) => expect(lastRecord(r)).toMatchObject({ result: { kind: 'stopped', stoppedBy: 'window' } }),
  },
  {
    name: 'O8: the window closed after Share → Couldn’t confirm (window-closed)',
    script: (r) => toConfirming(r).send({ type: 'windowRemoved', windowId: WIN }),
    phase: 'idle',
    check: (r) => expect(lastRecord(r)).toMatchObject({ outcome: 'unknown', result: { why: 'window-closed' } }),
  },
  {
    name: 'IR12: a security check after Share, before Instagram answered → Couldn’t confirm and the lock',
    script: (r) => toConfirming(r).send(tab('loading', CHALLENGE)),
    phase: 'closing',
    error: 'KILLED_CHALLENGE',
    has: ['lockMsite'],
    check: (r) =>
      expect(lastRecord(r)).toMatchObject({
        outcome: 'killed:KILLED_CHALLENGE',
        result: { kind: 'unknown', killed: 'KILLED_CHALLENGE' },
      }),
  },
  {
    name: 'IR12: a security check after Posted keeps Posted, and locks',
    script: (r) => toPosted(r).send(tab('loading', CHECKPOINT)),
    phase: 'closing',
    has: ['lockMsite', 'patchRecordOutcome'],
    check: (r) => {
      expect(r.effects).toContainEqual(
        expect.objectContaining({
          type: 'patchRecordOutcome',
          outcome: 'posted',
          result: expect.objectContaining({ kind: 'posted', killed: 'KILLED_CHALLENGE' }),
        }),
      );
      expect(r.lastStatus).toMatchObject({ result: { kind: 'posted', killed: 'KILLED_CHALLENGE' } });
    },
  },
  {
    name: 'a login page after Share → Couldn’t confirm (unexpected page), no lock',
    script: (r) => toConfirming(r).send(tab('loading', LOGIN)),
    phase: 'finished',
    lacks: ['lockMsite'],
    check: (r) => expect(lastResult(r)).toMatchObject({ kind: 'unknown', why: 'unexpected-page' }),
  },
  {
    name: 'an unknown www page after Share → Couldn’t confirm, never "Nothing was posted"',
    script: (r) => toConfirming(r).send(tab(undefined, CONSENT)),
    phase: 'finished',
    check: (r) => expect(lastResult(r)).toMatchObject({ kind: 'unknown', detail: 'page /consent/' }),
  },
  {
    name: 'a new document after Share: the old observer is gone → Couldn’t confirm (agent-lost), not held',
    script: (r) => toConfirming(r).send(tab('loading', HOME), tab('complete', HOME), injectedWith(true)),
    phase: 'finished',
    check: (r) => expect(r.state).toMatchObject({ hold: 'none', result: { kind: 'unknown', why: 'agent-lost' } }),
  },
  {
    name: 'P3: a worker intercepting after Share cuts nothing off',
    script: (r) => toConfirming(r).send(agent('sw-intercepted')),
    phase: 'confirmingUpload',
    lacks: ['closeWindow'],
  },

  // ---- the kill switch before Share --------------------------------------------------------------
  {
    name: 'challenge before Share → kill: close first, lock 7 days, Not posted',
    script: (r) => toInserting(r).send(tab('loading', CHALLENGE)),
    phase: 'closing',
    error: 'KILLED_CHALLENGE',
    has: ['lockMsite'],
    check: (r) => {
      expect(r.steps.at(-1)?.effects[0]?.type).toBe('closeWindow');
      expect(lastRecord(r)).toMatchObject({ outcome: 'killed:KILLED_CHALLENGE', result: { kind: 'notPosted' } });
    },
  },
  {
    name: 'AM17: /accounts/suspended on the reload → kill, never injected',
    script: (r) => toNavigating(r).send(tab('loading', COMPOSER_URL), tab('complete', SUSPENDED)),
    phase: 'closing',
    error: 'KILLED_CHALLENGE',
    lacks: ['injectAgent'],
  },
  {
    name: 'AM17: /auth_platform/codeentry at the composer → kill',
    script: (r) => toComposeReady(r).send(tab(undefined, CODE_ENTRY)),
    phase: 'closing',
    error: 'KILLED_CHALLENGE',
  },
  {
    name: 'off-host (accountscenter) before Share → kill',
    script: (r) => toEntry(r).send(tab('loading', ACCOUNTS_CENTER)),
    phase: 'closing',
    error: 'KILLED_OFFHOST',
    has: ['lockMsite'],
  },
  {
    name: 'AM17: an unknown www page before Share → UNEXPECTED_PAGE, no lock',
    script: (r) => toEntrySent(r).send(tab('loading', CONSENT)),
    phase: 'closing',
    error: 'UNEXPECTED_PAGE',
    lacks: ['lockMsite'],
    check: (r) => expect(r.lastStatus?.detail).toBe('page /consent/'),
  },
  {
    name: 'updates of other tabs never trip the kill switch',
    script: (r) => toComposeReady(r).send(tab('loading', CHALLENGE, 99)),
    phase: 'composeReady',
    lacks: ['lockMsite', 'closeWindow'],
  },
  {
    name: 'P3: the watch reports an intercepted request before Share → SW_INTERCEPTS, no lock',
    script: (r) => toInserting(r).send(agent('sw-intercepted')),
    phase: 'closing',
    error: 'SW_INTERCEPTS',
    lacks: ['lockMsite'],
  },

  // ---- document checks (AM16) and AM37 at the composer ---------------------------------------------
  {
    name: 'AM16: a new document before any tap is probed again, strictly; the account is decided again',
    script: (r) => {
      toEntry(r).send(tab('loading', HOME), tab('complete', HOME), injectedWith(true, SHIM_INSTALLED));
      expect(r.state).toMatchObject({ phase: 'probing', step: 'awaitReport', strict: true, decided: false });
      r.send(report());
    },
    phase: 'openingEntry',
    check: (r) => expect(r.count(isEntry)).toBe(0),
  },
  {
    name: 'AM16: a new document after the open-entry → STORY_ENTRY_MISSING (page reloaded), never a second open-entry',
    script: (r) => toEntrySent(r).send(tab('loading', HOME), tab('complete', HOME), injectedWith(true)),
    phase: 'finished',
    error: 'STORY_ENTRY_MISSING',
    check: (r) => expect(r.count(isEntry)).toBe(1),
  },
  {
    name: 'AM16: a new document while inserting → INJECTION_IGNORED (page reloaded)',
    script: (r) =>
      toAwaitComposer(r).send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), injectedWith(true)),
    phase: 'finished',
    error: 'INJECTION_IGNORED',
  },
  {
    name: 'AM37: the insert’s navigation reaches the composer while the page reads landscape → SCREEN_LANDSCAPE',
    script: (r) =>
      toAwaitComposer(r).send(
        tab('loading', COMPOSER_URL),
        tab('complete', COMPOSER_URL),
        injectedWith(false, SHIM_OFF),
      ),
    phase: 'closing',
    error: 'SCREEN_LANDSCAPE',
    shares: 0,
    check: (r) => expect(r.lastStatus?.detail).toBe('screen landscape-primary, portrait shim off'),
  },
  {
    name: 'SH-1: home read portrait; the shim installed only on the composer → SCREEN_LANDSCAPE',
    script: (r) => {
      toReloading(r).send(
        tab('complete', HOME),
        injectedWith(true, { type: 'portrait-primary', shim: 'portrait' }),
        report(),
      );
      r.send(timer('dwell'), entryFact(), timer('dwell'), { type: 'agentGetFile' }, fact({ kind: 'inserted' }));
      r.send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), injectedWith(false, SHIM_INSTALLED));
    },
    phase: 'closing',
    error: 'SCREEN_LANDSCAPE',
    check: (r) =>
      expect(r.lastStatus?.detail).toBe('screen portrait-primary, portrait shim installed after the composer mounted'),
  },
  {
    name: 'AM37 row 5b: the reload lands on the composer reading landscape → SCREEN_LANDSCAPE, nothing tapped',
    script: (r) =>
      toNavigating(r).send(
        tab('loading', COMPOSER_URL),
        tab('loading', COMPOSER_URL),
        tab('complete', COMPOSER_URL),
        injectedWith(true, SHIM_OFF),
        report(),
      ),
    phase: 'closing',
    error: 'SCREEN_LANDSCAPE',
    check: (r) => expect(lastRecord(r)).toMatchObject({ route: 'direct', preflight: { C3b: 'fail', C4: 'unknown' } }),
  },

  // ---- visibility (§4.6) -----------------------------------------------------------------------------
  {
    name: '§4.6: hidden before a tap → raised once; visible again within 10 s → carries on',
    script: (r) => {
      toEntrySent(r).send(fact({ kind: 'visibility', hidden: true }));
      expect(r.steps.at(-1)?.effects).toEqual([
        { type: 'raiseWindow', windowId: WIN },
        { type: 'armTimer', timer: 'hiddenWait', ms: HIDDEN_WAIT_MS },
      ]);
      r.send(fact({ kind: 'visibility', hidden: false }));
      expect(r.steps.at(-1)?.effects).toEqual([{ type: 'clearTimer', timer: 'hiddenWait' }]);
      r.send(fact({ kind: 'visibility', hidden: true }));
      expect(r.count((e) => e.type === 'raiseWindow')).toBe(1);
      r.send(fact({ kind: 'visibility', hidden: false }), entryFact());
    },
    phase: 'inserting',
  },
  {
    name: '§4.6: still hidden 10 s later → WINDOW_HIDDEN (close), nothing more tapped',
    script: (r) => {
      toEntrySent(r).send(fact({ kind: 'visibility', hidden: true }));
      r.tick(HIDDEN_WAIT_MS).send(timer('hiddenWait'));
    },
    phase: 'closing',
    error: 'WINDOW_HIDDEN',
  },
  {
    name: '§4.6: after Share visibility no longer matters',
    script: (r) => toConfirming(r).send(fact({ kind: 'visibility', hidden: true }), timer('hiddenWait')),
    phase: 'confirmingUpload',
    lacks: ['raiseWindow'],
  },

  // ---- Finish by hand (§4.9) ---------------------------------------------------------------------------
  {
    name: '§4.9: Finish by hand after a drift failure: instapost observes; the owner’s Share → Posted, the record patched',
    script: (r) => {
      toEntrySent(r).send(entryFact({ result: 'MENU_MISSING', menuCount: null, storyIndex: null, glyph: null }));
      expect(r.state).toMatchObject({ phase: 'finished', hold: 'offerManual' });
      const m = r.send({ type: 'manual', handoffId: 'hof_u1' });
      expect(m.slice(0, 4)).toEqual([
        { type: 'clearTimer', timer: 'offerManual' },
        { type: 'raiseWindow', windowId: WIN },
        { type: 'sendAgent', tabId: TAB, command: { type: 'agent/observe', from: 'manual' } },
        { type: 'armTimer', timer: 'manualDeadline', ms: MANUAL_DEADLINE_MS },
      ]);
      expect(r.state).toMatchObject({ phase: 'manual', needs: 'pick' });
      expect(r.lastStatus).toMatchObject({ phase: 'manual', manual: { needs: 'pick' }, canStop: true });
      // The owner picks: the composer draws; then taps Share.
      r.send(...TO_COMPOSER, composeFact());
      expect(r.state).toMatchObject({ needs: 'share' });
      r.send(fact({ kind: 'owner-share', t0Wall: T0 }), net([upload(200), publish(200)], 2600));
    },
    phase: 'finished',
    shares: 0,
    has: ['patchRecordOutcome'],
    check: (r) => {
      expect(r.state).toMatchObject({ result: { kind: 'posted' }, sharedBy: 'owner' });
      expect(r.count((e) => e.type === 'writeRecord')).toBe(1);
      expect(r.count(isInsert)).toBe(0);
    },
  },
  {
    name: '§4.9: the owner’s click missed but Instagram uploads: shared by hand all the same',
    script: (r) => {
      toEntrySent(r).send(entryFact({ result: 'NOT_ARMED' }), { type: 'manual', handoffId: 'hof_u1' });
      r.send(net([upload(200)], 30_000));
      expect(r.state).toMatchObject({ phase: 'confirmingUpload', sharedBy: 'owner' });
    },
    phase: 'confirmingUpload',
  },
  {
    name: '§4.9: nothing within 5 minutes → TIMEOUT, Nothing was posted',
    script: (r) => {
      toEntrySent(r).send(entryFact({ result: 'NOT_ARMED' }), { type: 'manual', handoffId: 'hof_u1' });
      r.tick(MANUAL_DEADLINE_MS).send(timer('manualDeadline'));
    },
    phase: 'closing',
    error: 'TIMEOUT',
    check: (r) => expect(lastResult(r)).toMatchObject({ kind: 'notPosted', detail: 'manual 300 s' }),
  },
  {
    name: '§4.9: Finish by hand is only possible while the window is offered',
    script: (r) => toEntry(r).send({ type: 'manual', handoffId: 'hof_u1' }),
    phase: 'openingEntry',
    lacks: ['raiseWindow'],
  },

  // ---- ends, cleanup, timers, failed effects -----------------------------------------------------------
  {
    name: 'the pre-Share cap: 2 minutes before Share → TIMEOUT',
    script: (r) => toEntry(r).tick(PRE_SHARE_CAP_MS).send(timer('preShareCap')),
    phase: 'closing',
    error: 'TIMEOUT',
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
    name: 'a window whose windowRemoved never comes ends after the backstop',
    script: (r) => {
      toEntry(r).send({ type: 'cancel' });
      r.tick(CLOSING_BACKSTOP_MS).send(timer('stepDeadline'));
    },
    phase: 'idle',
    has: ['removeRules'],
  },
  {
    name: 'startup mid-session: close the stale popup, then remove the rules',
    script: (r) => toInserting(r).send({ type: 'startup' }),
    phase: 'idle',
    check: (r) => {
      expect(types(r.steps.at(-1)?.effects ?? []).slice(0, 2)).toEqual(['closeWindow', 'removeRules']);
      expect(lastRecord(r)).toMatchObject({ result: { code: 'AGENT_UNREACHABLE', detail: 'browser restarted' } });
    },
  },
  {
    name: 'startup after Share: Couldn’t confirm (agent-lost)',
    script: (r) => toConfirming(r).send({ type: 'startup' }),
    phase: 'idle',
    check: (r) => expect(lastOutcome(r)).toBe('unknown'),
  },
  {
    name: 'an agent that cannot be reached for the Share command → Couldn’t confirm',
    script: (r) => toSharing(r).send({ type: 'effectFailed', effect: 'sendAgent', message: 'gone' }),
    phase: 'finished',
    check: (r) => expect(lastResult(r)).toMatchObject({ kind: 'unknown', why: 'share-not-acknowledged' }),
  },
  {
    name: 'an agent that cannot be reached before Share → AGENT_UNREACHABLE',
    script: (r) => toEntrySent(r).send({ type: 'effectFailed', effect: 'sendAgent', message: 'gone' }),
    phase: 'closing',
    error: 'AGENT_UNREACHABLE',
  },
  {
    name: 'a failed rule install closes the popup, never navigates',
    script: (r) =>
      r.send(
        startEv(),
        { type: 'windowCreated', windowId: WIN, tabId: TAB },
        { type: 'effectFailed', effect: 'installRules', message: 'quota' },
      ),
    phase: 'closing',
    error: 'AGENT_UNREACHABLE',
    lacks: ['navigate', 'measureTab'],
  },
  {
    name: 'History’s mark goes to the runner (it applies to a Couldn’t confirm record only)',
    script: (r) => r.send({ type: 'mark', handoffId: 'hof_x', posted: true }),
    phase: 'idle',
    has: ['markRecord'],
    check: (r) => expect(r.steps.at(-1)?.effects).toEqual([{ type: 'markRecord', handoffId: 'hof_x', posted: true }]),
  },
];

describe('U19 hand-off reducer: transition table', () => {
  it.each(ROWS)('$name', (row) => {
    const r = new Run(row.opts);
    row.script(r);
    expect(r.phase).toBe(row.phase);
    if (row.error !== undefined) expect(r.lastStatus?.error ?? null).toBe(row.error);
    for (const t of row.has ?? []) expect(types(r.effects)).toContain(t);
    for (const t of row.lacks ?? []) expect(types(r.effects)).not.toContain(t);
    if (row.shares !== undefined) expect(r.shares).toBe(row.shares);
    row.check?.(r);
    checkRun(r);
  });

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
    const r = toComposeReady(new Run());
    const before = r.state;
    for (const ev of [
      agent('input-appeared'),
      { type: 'rulesInstalled' },
      FITTED,
      { type: 'agentInjected' },
      timer('closeDelay'),
      { type: 'agentGetFile' },
      entryFact(),
      fact({ kind: 'share-done', t0Wall: 1 }),
    ] as HandoffEvent[]) {
      expect(r.send(ev)).toEqual([]);
      expect(r.state).toBe(before);
    }
  });

  it('the error effects are as specified (§5)', () => {
    expect(ERROR_EFFECT).toMatchObject({
      INPUT_MISSING: 'offer-manual',
      ACCEPT_DRIFT: 'offer-manual',
      INJECTION_IGNORED: 'offer-manual',
      STORY_ENTRY_MISSING: 'offer-manual',
      SHARE_MISSING: 'offer-manual',
      WINDOW_IN_USE: 'offer-manual',
      OUTCOME_UNKNOWN: 'hold',
      TEST_LEAK: 'kill',
      UPLOAD_FAILED: 'close',
      WINDOW_HIDDEN: 'close',
      ACCOUNT_UNCONFIRMED: 'close',
      SCREEN_LANDSCAPE: 'close',
    });
  });
});

// ---------------------------------------------------------------------------------------
// Share once (IR11): across a re-injection, a new document and a worker restart

describe('U19 Share once', () => {
  it('a same-document re-injection during sharing and confirming never sends a second Share', () => {
    const r = toSharing(new Run());
    r.send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), injectedWith(false, SHIM_PRESENT));
    r.send(SHARE_DONE, tab('loading', HOME), tab('complete', HOME), injectedWith(false, SHIM_PRESENT));
    r.send(timer('dwell'), timer('dwell'), composeFact(), timer('confirmTick'));
    expect(r.shares).toBe(1);
    expect(r.phase).toBe('confirmingUpload');
    checkRun(r);
  });

  it('a worker restart re-feeding the persisted state never sends a second Share', () => {
    const r = toSharing(new Run());
    const persisted = JSON.parse(JSON.stringify(r.state)) as HandoffState;
    expect(persisted).toMatchObject({ phase: 'sharing', shareSent: true });
    // A fresh runner over storage.session: every later event, timers included.
    const again = new Run();
    again.state = persisted;
    again.now = r.now;
    again.send(timer('dwell'), composeFact(), timer('shareAck'));
    expect(again.shares).toBe(0);
    expect(again.state).toMatchObject({
      phase: 'finished',
      result: { kind: 'unknown', why: 'share-not-acknowledged' },
    });
    // …and a stored composeReady whose Share went out (a crash between persisting and the next step).
    const composed = toComposeReady(new Run());
    const sent = { ...(composed.state as WindowedSession), shareSent: true } as unknown as HandoffState;
    const next = handoffReducer(sent, timer('dwell'), composed.ctx());
    expect(next.effects.some(isShare)).toBe(false);
  });

  it('a new document after Share ends the run (Couldn’t confirm) and never shares again', () => {
    const r = toConfirming(new Run());
    r.send(tab('loading', COMPOSER_URL), tab('complete', COMPOSER_URL), injectedWith(true, SHIM_PRESENT));
    r.send(composeFact(), timer('dwell'));
    expect(r.shares).toBe(1);
    expect(r.state).toMatchObject({ phase: 'finished', result: { kind: 'unknown' } });
    checkRun(r);
  });

  it('no Share in a test run, whatever arrives; no Share in a Share test before the rules are verified', () => {
    const t = toComposeReady(new Run(), 'test');
    t.send(timer('dwell'), composeFact(), timer('dwell'));
    expect(t.shares).toBe(0);
    const s = toAwaitComposer(new Run(), 'shareTest');
    s.send(...TO_COMPOSER, composeFact(), timer('dwell'), timer('dwell'));
    expect(s.shares).toBe(0);
    s.send({ type: 'rulesVerified', ok: true }, timer('dwell'), timer('dwell'));
    expect(s.shares).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------
// "No transition ever emits a retry", Share once and the rest, generically: seeded random sequences.

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
  HOME,
  HOME,
  LOGIN,
  CHALLENGE,
  CHECKPOINT,
  ACCOUNTS_CENTER,
  undefined,
  'about:blank',
  'https://www.instagram.com/someone/',
  SUSPENDED,
  CONSENT,
];
const AGENT_EVENTS: readonly AgentEventName[] = [
  'input-appeared',
  'account-appeared',
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
  'closeWindow',
  'verifyTestRules',
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
    swIntercepted: good() ? false : pick(rnd, [true, 'unknown'] as const),
    storyInput: good() ? 'present' : 'absent',
    acceptOk: good(),
    account: good()
      ? { handle: HANDLE, candidates: 1 }
      : pick(rnd, [
          { handle: 'other', candidates: 1 },
          { handle: null, candidates: 0 },
        ]),
    visibility: rnd() < 0.95 ? 'visible' : 'hidden',
  });
}

function randomNet(rnd: () => number): NetEntry[] {
  const out: NetEntry[] = [];
  if (rnd() < 0.6) out.push(upload(pick(rnd, [200, 200, 0, 500]), 1500));
  if (rnd() < 0.5) {
    out.push(
      publish(pick(rnd, [200, 200, 400, 500, 0]), 2500, {
        type: pick(rnd, ['application/json', 'text/html', '']),
        redirected: rnd() < 0.1,
      }),
    );
  }
  if (rnd() < 0.3)
    out.push({
      host: 'www',
      path: '/graphql/query',
      status: 200,
      type: 'application/json',
      redirected: false,
      start: 10,
      end: 20,
    });
  return out;
}

/** What a cooperative runner and agent would send next. */
function happy(s: HandoffState, rnd: () => number): HandoffEvent {
  switch (s.phase) {
    case 'idle':
      return startEv(pick(rnd, ['post', 'post', 'post', 'test', 'shareTest', 'check'] as const), SCREEN, {
        queue: rnd() < 0.3,
      } as Partial<HandoffEvent>);
    case 'queued':
      return timer('queue');
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
          return RETRY;
      }
      break;
    case 'resizing':
      return pick(rnd, [
        sized(1512, 902),
        sized(524, 965),
        { type: 'boundsChanged', windowId: WIN },
        timer('resizeDeadline'),
      ] as HandoffEvent[]);
    case 'navigating':
      return rnd() < 0.9 ? tab('loading', COMPOSER_URL) : tab(pick(rnd, ['loading', 'complete'] as const), undefined);
    case 'reloading':
      return tab(s.loadsSinceReload === 0 ? 'loading' : 'complete', rnd() < 0.8 ? HOME : COMPOSER_URL);
    case 'probing':
      switch (s.step) {
        case 'awaitComplete':
          return tab('complete', HOME);
        case 'injectAgent':
          return injectedWith(rnd() < 0.5, rnd() < 0.9 ? SHIM_INSTALLED : SHIM_OFF);
        case 'awaitReport':
          return rnd() < 0.9 ? { type: 'agentReport', probe: randomProbe(rnd) } : tab('loading', HOME);
        case 'refitMeasure':
          return MEASURED;
        case 'refitUpdate':
          return rnd() < 0.8 ? FITTED : NOT_FITTED;
        case 'awaitInput':
          return pick(rnd, [agent('input-appeared'), agent('account-appeared'), INPUT_WAITED]);
      }
      break;
    case 'awaitingAccount':
      return pick(rnd, [
        { type: 'accountChoice', handoffId: s.handoffId, proceed: true },
        { type: 'accountChoice', handoffId: s.handoffId, proceed: false },
        timer('accountPrompt'),
      ] as HandoffEvent[]);
    case 'openingEntry':
      if (s.sub === 'dwell') return timer('dwell');
      return rnd() < 0.85
        ? entryFact()
        : entryFact({
            result: pick(rnd, ['MENU_DRIFT', 'ACTIVATION_ACTIVE', 'HIDDEN', 'SESSION_NOT_STARTED'] as const),
          });
    case 'inserting':
      switch (s.sub) {
        case 'dwell':
          return timer('dwell');
        case 'sent':
          return { type: 'agentGetFile' };
        case 'served':
          return rnd() < 0.9 ? fact({ kind: 'inserted' }) : fact({ kind: 'insert-failed', why: 'accept-drift' });
        case 'awaitComposer':
          return rnd() < 0.5
            ? pick(rnd, TO_COMPOSER)
            : composeFact(rnd() < 0.85 ? {} : pick(rnd, [{ controls: 0 }, { landscape: true }, { drawn: false }]));
      }
      break;
    case 'composeReady':
      return s.sub === 'verifyRules' ? { type: 'rulesVerified', ok: rnd() < 0.9 } : timer('dwell');
    case 'sharing':
      return rnd() < 0.85
        ? SHARE_DONE
        : pick(rnd, [fact({ kind: 'share-refused', why: 'activation' }), timer('shareAck')]);
    case 'confirmingUpload':
      return rnd() < 0.7 ? net(randomNet(rnd), Math.floor(rnd() * 130_000)) : timer('confirmTick');
    case 'manual':
      return pick(rnd, [
        fact({ kind: 'owner-share', t0Wall: 1 }),
        composeFact(),
        timer('manualDeadline'),
        net(randomNet(rnd), 5000),
      ]);
    case 'finished':
      if (s.hold === 'offerManual' && rnd() < 0.5) return { type: 'manual', handoffId: s.handoffId };
      return pick(rnd, [timer('closeDelay'), timer('uploadHold'), timer('offerManual'), net(randomNet(rnd), 200_000)]);
    case 'closing':
      return { type: 'windowRemoved', windowId: s.windowId ?? WIN };
  }
  return { type: 'cancel' };
}

/** Anything at all, including events for other tabs and windows and stale effect results. */
function noise(rnd: () => number): HandoffEvent {
  switch (Math.floor(rnd() * 18)) {
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
        injectedWith(false, SHIM_OFF),
        injectedWith(true, SHIM_INSTALLED),
        FITTED,
        { type: 'rulesInstalled' },
        MEASURED,
        { type: 'rulesVerified', ok: true },
      ] as HandoffEvent[]);
    case 7:
      return { type: 'effectFailed', effect: pick(rnd, EFFECT_TYPES), message: 'boom' };
    case 8:
      return timer(pick(rnd, HANDOFF_TIMERS));
    case 9:
      return { type: 'cancel' };
    case 10:
      return startEv(pick(rnd, ['post', 'test', 'check'] as const));
    case 11:
      return fact(
        pick(rnd, [
          { kind: 'share-done', t0Wall: 1 },
          { kind: 'inserted' },
          { kind: 'visibility', hidden: rnd() < 0.5 },
          { kind: 'owner-share', t0Wall: 1 },
          { kind: 'ui', progressSeen: true, toast: 'plain', wentHome: true },
        ] as AgentFact[]),
      );
    case 12:
      return net(randomNet(rnd), Math.floor(rnd() * 200_000));
    case 13:
      return pick(rnd, [entryFact(), composeFact(), composeFact({ controls: 2 })]);
    case 14:
      return { type: 'windowRemoved', windowId: rnd() < 0.5 ? WIN : 99 };
    case 15:
      return { type: 'startup' };
    case 16:
      return { type: 'accountChoice', handoffId: 'hof_u1', proceed: rnd() < 0.5 };
    default:
      return { type: 'windowCreated', windowId: rnd() < 0.5 ? WIN : 8, tabId: rnd() < 0.5 ? TAB : 43 };
  }
}

describe('U19 hand-off reducer: random sequences keep every invariant', () => {
  it('holds over 300 seeded runs of 160 events', () => {
    const reached = new Set<string>();
    const emitted = new Set<string>();
    const results = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = mulberry32(seed);
      const r = new Run({
        guarded: rnd() < 0.5,
        settings: {
          chMode: rnd() < 0.5 ? 'full' : 'uaOnly',
          accountLock: rnd() < 0.85,
          expectedAccount: rnd() < 0.8 ? EXPECTED : null,
        },
        rate:
          rnd() < 0.85
            ? { ok: true }
            : { ok: false, code: 'RATE_LIMITED', rule: rnd() < 0.5 ? 'spacing' : 'hour', freeAt: T0 + 30_000 },
        fingerprint: rnd() < 0.5 ? { count: 2, storyIndex: 1, glyph: '0a1b2c3d', savedAt: T0 } : null,
      });
      const happyBias = 0.6 + rnd() * 0.35;
      for (let i = 0; i < 160; i++) {
        r.tick(pick(rnd, [0, 5, 250, 3000, 60_000, 130_000]));
        const ev = rnd() < happyBias ? happy(r.state, rnd) : noise(rnd);
        expect(() => r.send(ev)).not.toThrow();
        reached.add(r.phase);
        for (const e of r.steps.at(-1)?.effects ?? []) {
          emitted.add(key(e));
          if (e.type === 'notifyEditor' && e.status.result) results.add(e.status.result.kind);
        }
      }
      checkRun(r);
    }
    for (const p of [
      'idle',
      'queued',
      'opening',
      'fitting',
      'resizing',
      'navigating',
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
      'closing',
    ]) {
      expect(reached, p).toContain(p);
    }
    for (const e of [
      'drive:open-entry',
      'drive:insert',
      'drive:share',
      'serveFile',
      'lockMsite',
      'patchRecordOutcome',
      'raiseWindow',
      'verifyTestRules',
    ]) {
      expect(emitted, e).toContain(e);
    }
    for (const k of ['posted', 'notPosted', 'unknown', 'tested', 'checked', 'stopped']) expect(results, k).toContain(k);
  });
});

// ---------------------------------------------------------------------------------------
// Review fixes AP-1, AP-2, AP-4, AP-5, AP-12 (2026-10-13)

/** Instagram's background XHRs (GraphQL, logging): never decide anything. */
const others = (n: number, from = 0): NetEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    host: 'www' as const,
    path: '/graphql/query',
    status: 200,
    type: 'application/json',
    redirected: false,
    start: 10 + from + i,
    end: 20 + from + i,
  }));

/** A Share test (or any run) at its Share dwell, its write-block rules verified. */
function toShareTestSharing(r: Run): Run {
  toAwaitComposer(r, 'shareTest').send(...TO_COMPOSER, composeFact(), { type: 'rulesVerified', ok: true });
  r.send(timer('dwell'));
  expect(r.state).toMatchObject({ phase: 'sharing', writeBlocked: true });
  return r;
}

describe('AP-1 the net cap never drops the upload and publish entries that decide', () => {
  it('confirming: 64 other entries first, then upload 200 and publish 200 → Posted', () => {
    const r = toConfirming(new Run());
    r.send(net(others(MAX_NET_ENTRIES), 1000));
    r.tick(3000).send(net([upload(200, 2000), publish(200, 3000)], 3100));
    expect(r.state).toMatchObject({ phase: 'finished', result: { kind: 'posted' } });
    expect(r.w.net.length).toBeLessThanOrEqual(MAX_NET_ENTRIES);
    expect(r.w.net.filter((e) => classifyEntry(e) === 'other').length).toBe(MAX_OTHER_NET_ENTRIES);
    checkRun(r);
  });

  it('held (O6, hold upload): the window filled with other entries, a late publish 200 still upgrades', () => {
    const r = toConfirming(new Run()).tick(120_000);
    r.send(timer('confirmTick'));
    expect(r.state).toMatchObject({ phase: 'finished', hold: 'upload', result: { why: 'no-upload-seen' } });
    r.tick(60_000).send(net(others(MAX_NET_ENTRIES), 180_000), net(others(MAX_NET_ENTRIES, 100), 181_000));
    r.tick(60_000).send(net([upload(200, 200_000), publish(200, 240_000)], 240_100));
    expect(r.state).toMatchObject({ phase: 'finished', hold: 'none', result: { kind: 'posted', late: true } });
    expect(r.effects).toContainEqual(expect.objectContaining({ type: 'patchRecordOutcome', outcome: 'posted' }));
    checkRun(r);
  });

  it('the write entries are capped too, generously: O7’s duplicate alarm still fires', () => {
    const r = toConfirming(new Run());
    r.send(net(others(MAX_NET_ENTRIES), 1000));
    r.send(net([upload(200), publish(200, 2500), publish(200, 2700)], 2800));
    expect(r.state).toMatchObject({ result: { kind: 'posted', alarms: ['DUPLICATE_UPLOAD'] } });
    checkRun(r);
    const c = toConfirming(new Run());
    c.send(
      net(
        Array.from({ length: 20 }, () => upload(0)),
        1600,
      ),
    );
    expect(c.w.net.length).toBe(MAX_WRITE_NET_ENTRIES);
  });

  it('Finish by hand: other entries are not kept; a missed Share click is still seen by its upload', () => {
    const r = new Run();
    toEntrySent(r).send(entryFact({ result: 'NOT_ARMED' }), { type: 'manual', handoffId: 'hof_u1' });
    expect(r.state).toMatchObject({ phase: 'manual' });
    // Minutes of Instagram's own XHRs while the owner picks the photo.
    for (let i = 0; i < 4; i++) r.tick(30_000).send(net(others(MAX_NET_ENTRIES, i * 100), 30_000 * (i + 1)));
    expect(r.w.net).toEqual([]);
    expect(r.lastStatus?.canStop).toBe(true);
    // The owner's Share click was missed; Instagram's upload and publish show it was shared.
    r.tick(10_000).send(net([upload(200, 130_000), publish(200, 131_000)], 131_100));
    expect(r.state).toMatchObject({ phase: 'finished', sharedBy: 'owner', result: { kind: 'posted' } });
    r.tick(MANUAL_DEADLINE_MS).send(timer('manualDeadline'));
    expect(lastResult(r)).toMatchObject({ kind: 'posted' });
    expect(r.statuses.some((st) => st.error === 'TIMEOUT')).toBe(false);
    checkRun(r);
  });

  it('Finish by hand: the upload alone moves the run to confirming, never TIMEOUT “Nothing was posted”', () => {
    const r = new Run();
    toEntrySent(r).send(entryFact({ result: 'NOT_ARMED' }), { type: 'manual', handoffId: 'hof_u1' });
    r.tick(60_000).send(net(others(MAX_NET_ENTRIES), 60_000));
    r.tick(1000).send(net([upload(200, 61_000)], 61_100));
    expect(r.state).toMatchObject({ phase: 'confirmingUpload', sharedBy: 'owner' });
    r.tick(MANUAL_DEADLINE_MS).send(timer('manualDeadline'));
    expect(r.statuses.some((st) => st.error === 'TIMEOUT')).toBe(false);
    checkRun(r);
  });
});

describe('AP-2 a late answer obeys writeBlocked', () => {
  it('Share test: Share unacknowledged (held), then a late publish 200 → TEST_LEAK, kill and lock, never Posted', () => {
    const r = toShareTestSharing(new Run());
    r.tick(SHARE_ACK_MS).send(timer('shareAck'));
    expect(r.state).toMatchObject({ phase: 'finished', hold: 'upload', result: { why: 'share-not-acknowledged' } });
    r.tick(2000).send(net([upload(200), publish(200)], 2600));
    expect(r.state).toMatchObject({
      phase: 'closing',
      result: { kind: 'unknown', code: 'TEST_LEAK', killed: 'TEST_LEAK', late: true },
    });
    expect(r.effects).toContainEqual({ type: 'lockMsite', until: r.now + MSITE_LOCK_MS, reason: 'TEST_LEAK' });
    expect(r.lastStatus).toMatchObject({ error: 'TEST_LEAK' });
    expect(r.effects).toContainEqual(
      expect.objectContaining({ type: 'patchRecordOutcome', outcome: 'killed:TEST_LEAK' }),
    );
    expect(r.statuses.some((st) => st.result?.kind === 'posted')).toBe(false);
    checkRun(r);
  });

  it('Share test: a late 2xx upload alone is a leak too', () => {
    const r = toShareTestSharing(new Run());
    r.tick(SHARE_ACK_MS).send(timer('shareAck'));
    r.tick(2000).send(net([upload(200)], 2000));
    expect(r.state).toMatchObject({ phase: 'closing', result: { code: 'TEST_LEAK' } });
    checkRun(r);
  });

  it('Share test: a late blocked upload (status 0) passes the Share test, never “Not posted”', () => {
    const r = toShareTestSharing(new Run());
    r.tick(SHARE_ACK_MS).send(timer('shareAck'));
    r.tick(2000).send(net([upload(0, 1500)], 2000));
    expect(r.state).toMatchObject({ phase: 'finished', hold: 'none', result: { kind: 'shareTested', late: true } });
    expect(r.effects).toContainEqual(expect.objectContaining({ type: 'patchRecordOutcome', outcome: 'share-tested' }));
    checkRun(r);
  });

  it('Share test: a late upload that reached a server (403) leaves Couldn’t confirm as it is', () => {
    const r = toShareTestSharing(new Run());
    r.tick(SHARE_ACK_MS).send(timer('shareAck'));
    const before = r.state;
    expect(r.tick(2000).send(net([upload(403, 1500)], 2000))).toEqual([]);
    expect(r.state).toMatchObject({ phase: 'finished', result: (before as { result: unknown }).result });
    checkRun(r);
  });

  it('a guarded post (writes blocked by the static ruleset): a late publish 200 is TEST_LEAK, not Posted', () => {
    const r = new Run({ guarded: true });
    toSharing(r);
    expect(r.w.writeBlocked).toBe(true);
    r.tick(SHARE_ACK_MS).send(timer('shareAck'));
    r.tick(2000).send(net([upload(200), publish(200)], 2600));
    expect(r.state).toMatchObject({ phase: 'closing', result: { code: 'TEST_LEAK', killed: 'TEST_LEAK' } });
    checkRun(r);
  });
});

describe('AP-5 Share is sent only to a visible page, and a late refusal lets the window go', () => {
  it('SHARE_ACK_MS covers both of the agent’s waits (visibility, then activation) plus a margin', () => {
    expect(SHARE_ACK_MS).toBeGreaterThanOrEqual(2 * SHARE_ACTIVATION_WAIT_MS + 2000);
  });

  it('hidden at the Share dwell: raised, Share waits; visible again → Share once', () => {
    const r = toComposeReady(new Run());
    r.send(fact({ kind: 'visibility', hidden: true }));
    expect(r.steps.at(-1)?.effects).toEqual([
      { type: 'raiseWindow', windowId: WIN },
      { type: 'armTimer', timer: 'hiddenWait', ms: HIDDEN_WAIT_MS },
    ]);
    r.tick(3000).send(timer('dwell'));
    expect(r.state).toMatchObject({ phase: 'composeReady', sub: 'awaitVisible', shareSent: false });
    expect(r.shares).toBe(0);
    expect(r.count((e) => e.type === 'raiseWindow')).toBe(1);
    r.tick(4000).send(fact({ kind: 'visibility', hidden: false }));
    expect(r.shares).toBe(1);
    expect(r.state).toMatchObject({ phase: 'sharing', shareSent: true });
    expect(r.steps.at(-1)?.effects[0]).toEqual({ type: 'clearTimer', timer: 'hiddenWait' });
    expect(r.steps.at(-1)?.effects).toContainEqual({ type: 'armTimer', timer: 'shareAck', ms: SHARE_ACK_MS });
    checkRun(r);
  });

  it('hidden at the Share dwell and never shown again → WINDOW_HIDDEN, Nothing was posted, no Share', () => {
    const r = toComposeReady(new Run());
    r.send(fact({ kind: 'visibility', hidden: true }), timer('dwell'));
    r.tick(HIDDEN_WAIT_MS).send(timer('hiddenWait'));
    expect(r.phase).toBe('closing');
    expect(r.lastStatus).toMatchObject({ error: 'WINDOW_HIDDEN' });
    expect(r.shares).toBe(0);
    checkRun(r);
  });

  it('a refusal that arrives after the shareAck hold → the before-Share failure; the hold is let go', () => {
    const r = toSharing(new Run());
    r.tick(SHARE_ACK_MS).send(timer('shareAck'));
    expect(r.state).toMatchObject({ hold: 'upload', result: { why: 'share-not-acknowledged' } });
    r.tick(1500).send(fact({ kind: 'share-refused', why: 'activation' }));
    expect(r.state).toMatchObject({
      phase: 'finished',
      hold: 'offerManual',
      shareRefused: 'activation',
      result: { kind: 'notPosted', code: 'WINDOW_IN_USE' },
    });
    expect(r.steps.at(-1)?.effects).toContainEqual({ type: 'clearTimer', timer: 'uploadHold' });
    expect(r.effects).toContainEqual(
      expect.objectContaining({ type: 'patchRecordOutcome', outcome: 'failed:WINDOW_IN_USE' }),
    );
    // Nothing was pressed and nothing was seen: "Nothing was posted" may be said.
    expect(r.w.shareRefused).toBe('activation');
    expect(r.w.net).toEqual([]);
    checkRun(r);
  });

  it('a late refusal still hidden → WINDOW_HIDDEN closes the window', () => {
    const r = toSharing(new Run());
    r.tick(SHARE_ACK_MS).send(timer('shareAck'), fact({ kind: 'share-refused', why: 'hidden' }));
    expect(r.phase).toBe('closing');
    expect(r.lastStatus).toMatchObject({ error: 'WINDOW_HIDDEN' });
    checkRun(r);
  });

  it('a late refusal is ignored once a write was seen, or for any other held result', () => {
    const a = toSharing(new Run());
    a.tick(SHARE_ACK_MS).send(timer('shareAck'), net([upload(200, 1000)], 1100));
    expect(a.send(fact({ kind: 'share-refused', why: 'activation' }))).toEqual([]);
    expect(a.state).toMatchObject({ hold: 'upload', result: { kind: 'unknown' } });
    const b = toConfirming(new Run()).tick(120_000);
    b.send(timer('confirmTick'));
    expect(b.send(fact({ kind: 'share-refused', why: 'activation' }))).toEqual([]);
    checkRun(a);
    checkRun(b);
  });
});

describe('AP-4 a check reports a mismatch, never “Posts go to this account”', () => {
  it('the lock on and another account logged in: checked, lockedTo the expected one, nothing learned', () => {
    const r = toReport(new Run(), 'check');
    r.send(report({ account: { handle: 'someoneelse', candidates: 1 } }));
    expect(r.phase).toBe('closing');
    expect(lastResult(r)).toMatchObject({ kind: 'checked', account: 'someoneelse', lockedTo: HANDLE });
    expect(r.lastStatus?.account).toMatchObject({ decision: 'mismatch', confirmedBy: null, expected: HANDLE });
    expect(r.count((e) => e.type === 'setExpectedAccount')).toBe(0);
    checkRun(r);
  });

  it('the expected account logged in: checked with a match and no lockedTo', () => {
    const r = toReport(new Run(), 'check');
    r.send(report());
    expect(lastResult(r)).toMatchObject({ kind: 'checked', account: HANDLE });
    expect(lastResult(r)?.lockedTo).toBeUndefined();
    expect(r.lastStatus?.account).toMatchObject({ decision: 'ok', confirmedBy: 'match' });
  });
});

describe('AP-12 the lock says why', () => {
  it('a kill switch lock carries its reason', () => {
    const r = toConfirming(new Run());
    r.send(tab('loading', CHALLENGE));
    expect(r.effects).toContainEqual({ type: 'lockMsite', until: T0 + MSITE_LOCK_MS, reason: 'KILLED_CHALLENGE' });
  });
});
