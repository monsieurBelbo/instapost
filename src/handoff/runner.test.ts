/**
 * U11 (strategy §7.11): the runner executes reducer effects through the platform wrappers.
 * - Effect order for the H1 happy path, from `handoff/start` to the cleanup after the popup closed.
 * - A runner re-created from storage.session mid-flow resumes it (a stopped service worker),
 *   including its persisted timers.
 * - onStartup, onInstalled, windows.onRemoved (and tabs.onRemoved) remove ids 1001–1019.
 * Plus the agent sender check at processing time, the get-file answer, the kill switch's lock,
 * the rate log and the editor port.
 *
 * The dnr, tabs, windows, scripting and idb wrappers are vi.mock'ed with one recording fake;
 * storage (session and local) is WXT's fakeBrowser behind the real src/platform/storage.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  type HandoffRecord,
  INACTIVITY_TIMEOUT_MS,
  NAVIGATION_TIMEOUT_MS,
  type Settings,
} from '../core/handoff/state.ts';
import type { ProbeReport } from '../core/ig-contract/contract.ts';
import { SESSION_RULE_IDS } from '../core/ig-contract/rules.ts';
import { COMPOSER_URL } from '../core/ig-contract/urls.ts';
import { dnr } from '../platform/dnr.ts';
import { scripting } from '../platform/scripting.ts';
import { local, session } from '../platform/storage.ts';
import { tabs } from '../platform/tabs.ts';
import { windows } from '../platform/windows.ts';
import { type BackgroundToEditor, b64ToBytes, type GetFileReply, type SenderLike } from '../shared/protocol.ts';
import { createBackgroundRunner, startBackground } from './background-main.ts';
import { localState } from './local-state.ts';
import type { RecordStore } from './records.ts';
import { createRunner, type Runner } from './runner.ts';
import { sessionStore } from './session-store.ts';
import { KEEPALIVE_MS } from './timers.ts';

// ---------------------------------------------------------------------------------------
// The recording platform fake (hoisted so vi.mock can use it).

const fx = vi.hoisted(() => {
  type Listener<A extends unknown[]> = (...args: A) => void;
  const calls: { fn: string; args: unknown[] }[] = [];
  const failing = new Set<string>();
  const listeners = {
    tabUpdated: [] as Listener<[number, { status: 'loading' | 'complete' | undefined; url: string | undefined }]>[],
    tabRemoved: [] as Listener<[number]>[],
    windowRemoved: [] as Listener<[number]>[],
  };
  const conf = {
    windowId: 7,
    tabId: 42,
    inner: { w: 500, h: 900 } as { w: number; h: number } | null,
    outer: { left: 500, top: 33, width: 500, height: 932 },
    agentAck: { ok: true } as unknown,
    exports: new Map<string, { bytes: Uint8Array; mime: string }>(),
    /** executeScript's result for the agent: true = installed (a new document), false = already there. */
    agentFresh: true,
    /** windows.get(id, {populate}) per window id: type and tab URLs; absent = no such window. */
    existing: new Map<number, { type: string; tabUrls: (string | undefined)[] }>(),
  };
  const call = async (fn: string, ...args: unknown[]) => {
    calls.push({ fn, args });
    if (failing.has(fn)) throw new Error(`${fn} failed`);
  };
  const sub =
    <A extends unknown[]>(list: Listener<A>[]) =>
    (l: Listener<A>) => {
      list.push(l);
      return () => list.splice(list.indexOf(l), 1);
    };
  return {
    calls,
    failing,
    listeners,
    conf,
    reset() {
      calls.length = 0;
      failing.clear();
      listeners.tabUpdated.length = 0;
      listeners.tabRemoved.length = 0;
      listeners.windowRemoved.length = 0;
      conf.inner = { w: 500, h: 900 };
      conf.agentAck = { ok: true };
      conf.exports.clear();
      conf.agentFresh = true;
      conf.existing.clear();
    },
    dnr: {
      updateSessionRules: (u: unknown) => call('dnr.updateSessionRules', u),
      getSessionRules: async () => [],
    },
    windows: {
      createPopup: async (box: unknown) => {
        await call('windows.createPopup', box);
        return { windowId: conf.windowId, tabId: conf.tabId };
      },
      update: (id: number, u: unknown) => call('windows.update', id, u),
      getBox: async (id: number) => {
        await call('windows.getBox', id);
        return conf.outer;
      },
      remove: (id: number) => call('windows.remove', id),
      describe: async (id: number) => {
        await call('windows.describe', id);
        return conf.existing.get(id) ?? null;
      },
      onRemoved: sub(listeners.windowRemoved),
    },
    tabs: {
      get: async (id: number) => {
        await call('tabs.get', id);
        return { id, windowId: conf.windowId, url: 'about:blank', width: conf.inner?.w, height: conf.inner?.h };
      },
      create: async (url: string) => {
        await call('tabs.create', url);
        return { id: 99, windowId: 1, url, width: 1000, height: 800 };
      },
      activate: (id: number) => call('tabs.activate', id),
      navigate: (id: number, url: string) => call('tabs.navigate', id, url),
      hardReload: (id: number) => call('tabs.hardReload', id),
      sendMessage: async (id: number, msg: unknown) => {
        await call('tabs.sendMessage', id, msg);
        return conf.agentAck;
      },
      onUpdated: sub(listeners.tabUpdated),
      onRemoved: sub(listeners.tabRemoved),
    },
    scripting: {
      injectComposerAgent: async (id: number) => {
        await call('scripting.injectComposerAgent', id);
        return { fresh: conf.agentFresh };
      },
    },
    getExport: async (id: string) => {
      const e = conf.exports.get(id);
      return e
        ? { id, mime: e.mime, blob: new Blob([e.bytes as Uint8Array<ArrayBuffer>], { type: e.mime }) }
        : undefined;
    },
  };
});

vi.mock('../platform/dnr.ts', () => ({ dnr: fx.dnr }));
vi.mock('../platform/windows.ts', () => ({ windows: fx.windows }));
vi.mock('../platform/tabs.ts', () => ({ tabs: fx.tabs }));
vi.mock('../platform/scripting.ts', () => ({ scripting: fx.scripting }));
vi.mock('../platform/idb.ts', () => ({
  getExport: fx.getExport,
  db: async () => {
    throw new Error('IndexedDB is not available in the unit project');
  },
}));

// ---------------------------------------------------------------------------------------
// A manual clock: timers fire only when the test advances time.

const T0 = Date.UTC(2026, 9, 11, 12);

interface Pending {
  at: number;
  fn: () => void;
  every?: number;
}

function manualClock(start = T0) {
  let t = start;
  let seq = 0;
  const pending = new Map<number, Pending>();
  return {
    now: () => t,
    setTimeout: (fn: () => void, ms: number) => {
      pending.set(++seq, { at: t + ms, fn });
      return seq;
    },
    clearTimeout: (id: unknown) => void pending.delete(id as number),
    setInterval: (fn: () => void, ms: number) => {
      pending.set(++seq, { at: t + ms, fn, every: ms });
      return seq;
    },
    clearInterval: (id: unknown) => void pending.delete(id as number),
    /** Moves time forward, firing due callbacks in order and letting `settle` drain after each. */
    async advance(ms: number, settle: () => Promise<void>) {
      const end = t + ms;
      for (;;) {
        const next = [...pending.entries()].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, p] = next;
        t = p.at;
        if (p.every) p.at += p.every;
        else pending.delete(id);
        p.fn();
        await settle();
      }
      t = end;
    },
    /** The worker stopped: its in-memory timers are gone. */
    kill: () => pending.clear(),
    count: () => pending.size,
    intervals: () => [...pending.values()].filter((p) => p.every !== undefined).length,
  };
}
type ManualClock = ReturnType<typeof manualClock>;

// ---------------------------------------------------------------------------------------
// Fixtures

const SCREEN = { availLeft: 0, availTop: 33, availWidth: 1512, availHeight: 949 };
const HOME = 'https://www.instagram.com/';
const SESSION_IDS = [...SESSION_RULE_IDS];
const RUNTIME_ID = fakeBrowser.runtime.id;
const HID = 'hof_u1';
const NONCE = 'u2';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);

const goodProbe = (over: Partial<ProbeReport> = {}): ProbeReport => ({
  marker: true,
  isMobile: true,
  inner: { w: 511, h: 909 },
  dpr: 2,
  portrait: true,
  swControlled: false,
  storyInput: 'present',
  acceptOk: true,
  lang: 'en',
  ...over,
});

const agentSender = (over: Partial<SenderLike> = {}): SenderLike => ({
  id: RUNTIME_ID,
  tab: { id: fx.conf.tabId },
  frameId: 0,
  url: COMPOSER_URL,
  ...over,
});
const agentMsg = (type: string, extra: Record<string, unknown> = {}) => ({
  v: 1,
  type,
  handoffId: HID,
  nonce: NONCE,
  ...extra,
});
const startMsg = (mode: 'post' | 'probe' = 'post') => ({
  v: 1,
  type: 'handoff/start',
  exportId: mode === 'post' ? 'exp_1' : null,
  mode,
  rehearsal: true,
  screen: SCREEN,
});

function memoryRecords() {
  const rows = new Map<string, HandoffRecord>();
  const store: RecordStore = {
    async put(r) {
      rows.set(r.id, structuredClone(r));
    },
    async patchOutcome(id, outcome) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, outcome });
    },
  };
  return { rows, store };
}

interface Harness {
  runner: Runner;
  clock: ManualClock;
  records: ReturnType<typeof memoryRecords>;
  statuses: BackgroundToEditor[];
  /** Drains the runner's queue. */
  settle(): Promise<void>;
  advance(ms: number): Promise<void>;
}

/** One service-worker lifetime: a runner over the shared fakeBrowser storage. */
async function boot(
  opts: {
    clock?: ManualClock;
    records?: ReturnType<typeof memoryRecords>;
    keepAlive?: () => void;
    brands?: string[];
  } = {},
): Promise<Harness> {
  const clock = opts.clock ?? manualClock();
  const records = opts.records ?? memoryRecords();
  let n = 0;
  const runner = createRunner(
    {
      dnr,
      tabs,
      windows,
      scripting,
      store: sessionStore(),
      local: localState(true, { startOf: (t) => t - (t % 86_400_000) }),
      records: records.store,
      exports: async (id) => fx.conf.exports.get(id),
    },
    {
      guarded: true,
      runtimeId: RUNTIME_ID,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36',
      uuid: () => `u${++n}`,
      clock,
      brands: opts.brands ?? ['Not:A-Brand', 'Chromium'],
      keepAlive: opts.keepAlive,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    },
  );
  const statuses: BackgroundToEditor[] = [];
  runner.connectEditor((m) => statuses.push(m));
  await runner.ready();
  await runner.settled();
  statuses.length = 0;
  const settle = () => runner.settled();
  return { runner, clock, records, statuses, settle, advance: (ms) => clock.advance(ms, settle) };
}

/** The platform calls since the last mark, as `fn` names. */
let mark = 0;
const since = () => {
  const out = fx.calls.slice(mark);
  mark = fx.calls.length;
  return out;
};
const names = (calls: { fn: string }[]) => calls.map((c) => c.fn);

async function storedState() {
  return await session.get('handoff');
}

/** Drives a post hand-off until the hard reload was issued (state `reloading`). */
async function toReloading(h: Harness): Promise<void> {
  await h.runner.editorMessage(startMsg());
  await h.settle();
  await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
  await h.settle();
}

beforeEach(() => {
  fx.reset();
  mark = 0;
  fx.conf.exports.set('exp_1', { bytes: PNG, mime: 'image/png' });
});

// ---------------------------------------------------------------------------------------

describe('U11 happy path: effect order (H1)', () => {
  it('runs every effect in the reducer’s order, through to the cleanup', async () => {
    const h = await boot();
    const { runner } = h;
    const TAB = fx.conf.tabId;
    const WIN = fx.conf.windowId;

    // start → popup at about:blank → rules → measure → fit → navigate
    await runner.editorMessage(startMsg());
    await h.settle();
    const opening = since();
    expect(names(opening)).toEqual([
      'windows.createPopup',
      'dnr.updateSessionRules',
      'tabs.get',
      'windows.getBox',
      'windows.update',
      'tabs.navigate',
    ]);
    // Rule 1001 and the rehearsal rules are installed while the tab is still about:blank.
    const install = opening[1]?.args[0] as { removeRuleIds: number[]; addRules: { id: number }[] };
    expect(install.removeRuleIds).toEqual(SESSION_IDS);
    expect(install.addRules.map((r) => r.id)).toEqual([1001, ...SESSION_IDS.slice(1, install.addRules.length)]);
    expect(install.addRules[0]).toMatchObject({
      condition: { tabIds: [TAB] },
      action: {
        type: 'modifyHeaders',
        requestHeaders: expect.arrayContaining([expect.objectContaining({ header: 'user-agent' })]),
      },
    });
    expect(JSON.stringify(install.addRules[0])).toContain('Chrome/155.0.0.0 Mobile');
    expect(opening[5]?.args).toEqual([TAB, COMPOSER_URL]);
    expect(runner.state().phase).toBe('navigating');
    // The rate log noted the open.
    expect(await local.get('rateLog')).toEqual([T0]);

    // First www `loading` → exactly one hard reload.
    await runner.tabUpdated(TAB, { status: 'loading', url: COMPOSER_URL });
    await h.settle();
    expect(names(since())).toEqual(['tabs.hardReload']);
    // The reload's own commit, then `complete` → inject the agent and probe.
    await runner.tabUpdated(TAB, { status: 'loading', url: COMPOSER_URL });
    await runner.tabUpdated(TAB, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    const probing = since();
    expect(names(probing)).toEqual(['scripting.injectComposerAgent', 'tabs.sendMessage']);
    expect(probing[1]?.args).toEqual([TAB, { v: 1, type: 'agent/probe', handoffId: HID, nonce: NONCE }]);

    // Report → H1: watch with the 10 s deadline, then inject.
    expect(await runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender())).toEqual({
      ok: true,
    });
    await h.settle();
    expect(since().map((c) => c.args[1])).toEqual([
      { v: 1, type: 'agent/watch', readyTimeoutMs: 10_000, handoffId: HID, nonce: NONCE },
      { v: 1, type: 'agent/inject', handoffId: HID, nonce: NONCE },
    ]);
    expect(runner.state().phase).toBe('injecting');

    // get-file → the export's bytes.
    const reply = (await runner.agentMessage(agentMsg('agent/get-file'), agentSender())) as GetFileReply;
    expect(reply).toMatchObject({ ok: true, name: 'story.png', mime: 'image/png' });
    if (!reply.ok) throw new Error('unreachable');
    expect(Array.from(b64ToBytes(reply.b64))).toEqual(Array.from(PNG));
    // A second get-file gets nothing: one serve per hand-off.
    expect(await runner.agentMessage(agentMsg('agent/get-file'), agentSender())).toEqual({ ok: false });

    // Composer ready → awaitingShare and one more agent/probe for C8 (AM13), answered in awaitingShare.
    await runner.agentMessage(agentMsg('agent/event', { event: 'composer-ready' }), agentSender());
    expect(runner.state().phase).toBe('awaitingShare');
    await h.settle();
    expect(since().map((c) => c.args[1])).toEqual([{ v: 1, type: 'agent/probe', handoffId: HID, nonce: NONCE }]);
    const ready = goodProbe({ canvas: { w: 1080, h: 1920, css: { x: 0, y: 0, w: 511, h: 908 } } });
    expect(await runner.agentMessage(agentMsg('agent/report', { probe: ready }), agentSender())).toEqual({ ok: true });
    // The URL leaving /create/story → finished (record written, C8 from the ready composer).
    await runner.tabUpdated(TAB, { status: undefined, url: HOME });
    await h.settle();
    expect(runner.state().phase).toBe('finished');
    expect(h.records.rows.get(HID)).toMatchObject({
      level: 'H1',
      outcome: 'posted-confirmed',
      mode: 'post',
      readyProbe: ready,
      preflight: { C8: { inner: ready.inner, dpr: ready.dpr, canvas: ready.canvas } },
    });
    expect(since()).toEqual([]);

    // closeDelay (3 s) → close the window; the rules stay until it is gone.
    await h.advance(3000);
    expect(names(since())).toEqual(['windows.remove']);
    expect(runner.state().phase).toBe('closing');
    await runner.dispatch({ type: 'windowRemoved', windowId: WIN });
    await h.settle();
    const cleanup = since();
    expect(names(cleanup)).toEqual(['dnr.updateSessionRules']);
    expect(cleanup[0]?.args[0]).toEqual({ removeRuleIds: SESSION_IDS });
    expect(runner.state()).toEqual({
      phase: 'idle',
      last: { handoffId: HID, outcome: 'posted-confirmed', endedAt: T0 + 3000 },
    });

    // The editor saw the phases in order, and the stored state followed every transition.
    const phases = h.statuses.map((s) => s.phase).filter((p, i, a) => p !== a[i - 1]);
    expect(phases).toEqual([
      'opening',
      'scoping',
      'fitting',
      'navigating',
      'reloading',
      'probing',
      'injecting',
      'awaitingShare',
      'finished',
      'closing',
      'idle',
    ]);
    expect(h.statuses.find((s) => s.phase === 'finished')).toMatchObject({ detectedPosted: true });
    expect(await storedState()).toEqual(runner.state());
    expect(await session.get('timers')).toEqual({});
    expect(h.clock.count()).toBe(0);
  });

  it('persists the state before the effects run', async () => {
    const h = await boot();
    const seen: (string | undefined)[] = [];
    const orig = fx.windows.createPopup;
    fx.windows.createPopup = async (box) => {
      seen.push((await storedState())?.phase);
      return orig(box);
    };
    try {
      await h.runner.editorMessage(startMsg());
      await h.settle();
    } finally {
      fx.windows.createPopup = orig;
    }
    expect(seen).toEqual(['opening']);
  });
});

describe('U11 service-worker restart resumes from storage.session', () => {
  it('a new runner picks up mid-flow (reloading) and carries on with the same hand-off', async () => {
    const first = await boot();
    await toReloading(first);
    expect(first.runner.state().phase).toBe('reloading');
    first.clock.kill(); // the worker stops: in-memory timers and state are gone
    since();

    const second = await boot({ clock: manualClock(first.clock.now()), records: first.records });
    expect(second.runner.state()).toEqual(first.runner.state());
    await second.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
    await second.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: COMPOSER_URL });
    await second.settle();
    const calls = since();
    expect(names(calls)).toEqual(['scripting.injectComposerAgent', 'tabs.sendMessage']);
    expect(calls[1]?.args[1]).toEqual({ v: 1, type: 'agent/probe', handoffId: HID, nonce: NONCE });
    // No second hard reload after the restart.
    expect(names(fx.calls).filter((n) => n === 'tabs.hardReload')).toHaveLength(1);
    // The agent's messages are accepted by the new instance.
    expect(await second.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender())).toEqual({
      ok: true,
    });
    await second.settle();
    expect(second.runner.state().phase).toBe('injecting');
  });

  it('re-arms the persisted inactivity timer and times out on schedule', async () => {
    const first = await boot();
    await toReloading(first);
    expect(await session.get('timers')).toEqual({ inactivity: T0 + INACTIVITY_TIMEOUT_MS });
    first.clock.kill();
    since();

    const second = await boot({ clock: manualClock(T0 + 60_000) });
    await second.advance(INACTIVITY_TIMEOUT_MS - 60_000 - 1);
    expect(since()).toEqual([]);
    await second.advance(1);
    expect(names(since())).toEqual(['windows.remove']);
    expect(second.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:TIMEOUT' });
  });

  it('fires a timer that fell due while the worker was stopped, before any other event', async () => {
    const first = await boot();
    await first.runner.editorMessage(startMsg('post'));
    await first.settle();
    await first.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
    await first.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
    await first.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: COMPOSER_URL });
    await first.settle();
    await first.runner.agentMessage(
      agentMsg('agent/report', { probe: goodProbe({ storyInput: 'absent' }) }),
      agentSender(),
    );
    await first.runner.tabUpdated(fx.conf.tabId, { status: undefined, url: `${HOME}create/story/` });
    await first.runner.agentMessage(agentMsg('agent/event', { event: 'composer-ready' }), agentSender());
    await first.runner.tabUpdated(fx.conf.tabId, { status: undefined, url: HOME });
    await first.settle();
    expect(first.runner.state().phase).toBe('finished');
    expect((await session.get('timers'))?.closeDelay).toBe(T0 + 3000);
    first.clock.kill();
    since();

    // Ten seconds later the worker wakes for an unrelated tab update.
    const second = await boot({ clock: manualClock(T0 + 10_000) });
    expect(names(since())).toEqual(['windows.remove']);
    expect(second.runner.state().phase).toBe('closing');
  });
});

describe('U11 cleanup: onStartup, onInstalled, windows.onRemoved and tabs.onRemoved', () => {
  function stubEvent<T extends (...args: never[]) => unknown>() {
    const ls: T[] = [];
    return { addListener: (l: T) => void ls.push(l), removeListener: () => undefined, hasListener: () => true, ls };
  }

  const quietLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

  /**
   * startBackground over a test runner (manual clock, Chrome 155 UA), or over the production
   * runner (`createBackgroundRunner`) when `production` is set.
   */
  async function background(production = false) {
    const onConnect = stubEvent();
    // fakeBrowser does not implement runtime.onConnect.
    (fakeBrowser.runtime as unknown as { onConnect: unknown }).onConnect = onConnect;
    const runner = startBackground(production ? createBackgroundRunner(quietLog) : (await boot()).runner, quietLog);
    await runner.ready();
    await runner.settled();
    since();
    return { runner, onConnect };
  }

  const removed = () =>
    since()
      .filter((c) => c.fn === 'dnr.updateSessionRules')
      .map((c) => c.args[0]);

  it('runtime.onStartup removes 1001–1019 (production wiring)', async () => {
    const { runner } = await background(true);
    await fakeBrowser.runtime.onStartup.trigger();
    await runner.settled();
    expect(removed()).toEqual([{ removeRuleIds: SESSION_IDS }]);
  });

  it('runtime.onInstalled removes 1001–1019', async () => {
    const { runner } = await background();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.0.9' } as never);
    await runner.settled();
    expect(removed()).toEqual([{ removeRuleIds: SESSION_IDS }]);
  });

  it('windows.onRemoved and tabs.onRemoved remove 1001–1019, idempotently', async () => {
    const { runner } = await background();
    for (const l of fx.listeners.windowRemoved) l(123);
    for (const l of fx.listeners.windowRemoved) l(123);
    for (const l of fx.listeners.tabRemoved) l(456);
    await runner.settled();
    expect(removed()).toEqual([
      { removeRuleIds: SESSION_IDS },
      { removeRuleIds: SESSION_IDS },
      { removeRuleIds: SESSION_IDS },
    ]);
  });

  it('closing the composer window mid-flow removes the rules and returns to idle (E15)', async () => {
    const { runner } = await background();
    await runner.editorMessage(startMsg());
    await runner.settled();
    expect(runner.state().phase).toBe('navigating');
    since();
    for (const l of fx.listeners.windowRemoved) l(fx.conf.windowId);
    await runner.settled();
    expect(removed()).toContainEqual({ removeRuleIds: SESSION_IDS });
    expect(runner.state().phase).toBe('idle');
    expect(await storedState()).toMatchObject({ phase: 'idle' });
  });

  it('routes tabs.onUpdated for the composer tab only', async () => {
    const { runner } = await background();
    await runner.editorMessage(startMsg());
    await runner.settled();
    since();
    for (const l of fx.listeners.tabUpdated) l(fx.conf.tabId + 1, { status: 'loading', url: COMPOSER_URL });
    await runner.settled();
    expect(since()).toEqual([]);
    for (const l of fx.listeners.tabUpdated) l(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
    await runner.settled();
    expect(names(since())).toEqual(['tabs.hardReload']);
  });

  it('answers agent messages through runtime.onMessage and ignores other messages', async () => {
    const { runner } = await background();
    const replies: unknown[] = [];
    const keepOpen = await fakeBrowser.runtime.onMessage.trigger(
      agentMsg('agent/get-file'),
      agentSender() as never,
      (r: unknown) => replies.push(r),
    );
    expect(keepOpen).toContain(true);
    await runner.settled();
    await vi.waitFor(() => expect(replies).toEqual([{ ok: false }])); // no session
    const other = await fakeBrowser.runtime.onMessage.trigger({ type: 'editor/ping' }, {} as never, () => undefined);
    expect(other).toEqual([false]);
  });

  it('accepts the hand-off port from extension pages only, and sends the current status', async () => {
    const { runner, onConnect } = await background();
    const port = (url: string) => {
      const posted: unknown[] = [];
      const onMessage = stubEvent<(m: unknown) => void>();
      const onDisconnect = stubEvent<() => void>();
      return {
        name: 'handoff',
        sender: { id: RUNTIME_ID, url },
        postMessage: (m: unknown) => void posted.push(m),
        disconnect: vi.fn(),
        onMessage,
        onDisconnect,
        posted,
      };
    };
    const foreign = port(COMPOSER_URL);
    const editor = port(fakeBrowser.runtime.getURL('/editor.html'));
    for (const l of onConnect.ls as ((p: unknown) => void)[]) {
      l(foreign);
      l(editor);
    }
    await runner.settled();
    expect(foreign.disconnect).toHaveBeenCalled();
    expect(foreign.onMessage.ls).toHaveLength(0);
    expect(editor.posted).toEqual([{ v: 1, type: 'handoff/status', handoffId: null, phase: 'idle', level: null }]);

    for (const l of editor.onMessage.ls) l(startMsg());
    await runner.settled();
    expect(runner.state().phase).toBe('navigating');
    expect((editor.posted.at(-1) as BackgroundToEditor).phase).toBe('navigating');
  });
});

describe('U11 agent messages are checked at processing time', () => {
  async function probing(): Promise<Harness> {
    const h = await boot();
    await toReloading(h);
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    since();
    return h;
  }

  it.each<[string, Partial<SenderLike>, Record<string, unknown>]>([
    ['another tab', { tab: { id: 1 } }, {}],
    ['a subframe', { frameId: 2 }, {}],
    ['another origin', { url: 'https://accountscenter.instagram.com/' }, {}],
    ['another extension', { id: 'other' }, {}],
    ['a wrong nonce', {}, { nonce: 'u3' }],
  ])('drops a report from %s without changing anything', async (_, s, extra) => {
    const h = await probing();
    const before = h.runner.state();
    const reply = await h.runner.agentMessage(
      agentMsg('agent/report', { probe: goodProbe(), ...extra }),
      agentSender(s),
    );
    await h.settle();
    expect(reply).toEqual({ ok: false });
    expect(h.runner.state()).toBe(before);
    expect(since()).toEqual([]);
  });

  it('answers get-file with {ok:false} outside injecting (phase gate)', async () => {
    const h = await probing();
    expect(await h.runner.agentMessage(agentMsg('agent/get-file'), agentSender())).toEqual({ ok: false });
  });

  it('a missing export degrades to H0 in the same window (no second inject)', async () => {
    fx.conf.exports.clear();
    const h = await probing();
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender());
    await h.settle();
    since();
    expect(await h.runner.agentMessage(agentMsg('agent/get-file'), agentSender())).toEqual({ ok: false });
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'awaitingPick', level: 'H0', degradedFrom: 'INJECTION_IGNORED' });
    const sent = since().map((c) => c.args[1] as { type: string; readyTimeoutMs?: number });
    expect(sent).toEqual([expect.objectContaining({ type: 'agent/watch', readyTimeoutMs: 0 })]);
    expect(names(fx.calls).filter((n) => n === 'windows.remove')).toEqual([]);
  });

  it('an agent that does not ack a command ends the session with AGENT_UNREACHABLE', async () => {
    fx.conf.agentAck = undefined;
    const h = await boot();
    await toReloading(h);
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:AGENT_UNREACHABLE' });
    expect(names(fx.calls)).toContain('windows.remove');
    expect(h.statuses.at(-1)).toMatchObject({
      error: 'AGENT_UNREACHABLE',
      detail: expect.stringContaining('sendAgent'),
    });
  });
});

describe('U11 kill switch, lock and rate log', () => {
  it('an undefined URL after arming kills: close, lock 7 days; rules removed once the window is gone', async () => {
    const h = await boot();
    await toReloading(h);
    since();
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: undefined });
    await h.settle();
    expect(names(since())).toEqual(['windows.remove']);
    // AM25: the lock has its own key; the editor-owned settings object is never written by the background.
    expect(await local.get('msiteLock')).toBe(T0 + 7 * 24 * 3_600_000);
    expect(await local.get('settings')).toBeUndefined();
    expect(h.records.rows.get(HID)?.outcome).toBe('killed:KILLED_OFFHOST');

    await h.runner.dispatch({ type: 'windowRemoved', windowId: fx.conf.windowId });
    expect(since().map((c) => c.args[0])).toEqual([{ removeRuleIds: SESSION_IDS }]);

    // The next start is refused without opening anything.
    await h.advance(120_000);
    since();
    await h.runner.editorMessage(startMsg());
    await h.settle();
    expect(since()).toEqual([]);
    expect(h.statuses.at(-1)).toMatchObject({ handoffId: null, phase: 'idle', error: 'MSITE_LOCKED' });
  });

  it('a second start within 60 s is RATE_LIMITED and opens no window (E14)', async () => {
    const h = await boot();
    await h.runner.editorMessage(startMsg('probe'));
    await h.settle();
    await h.runner.dispatch({ type: 'windowRemoved', windowId: fx.conf.windowId });
    await h.advance(30_000);
    since();
    await h.runner.editorMessage(startMsg('probe'));
    await h.settle();
    expect(since()).toEqual([]);
    expect(h.statuses.at(-1)).toMatchObject({ error: 'RATE_LIMITED', freeAt: T0 + 60_000 });
    await h.advance(30_000);
    await h.runner.editorMessage(startMsg('probe'));
    await h.settle();
    expect(names(since())[0]).toBe('windows.createPopup');
    expect(await local.get('rateLog')).toEqual([T0, T0 + 60_000]);
  });

  it('a malformed editor message is dropped', async () => {
    const h = await boot();
    await h.runner.editorMessage({ v: 1, type: 'handoff/start', mode: 'post' });
    await h.settle();
    expect(since()).toEqual([]);
    expect(h.runner.state().phase).toBe('idle');
  });
});

describe('U11 AM25: ENABLE goes through the background queue', () => {
  it('clears the lock the editor showed, and keeps one written after it', async () => {
    const h = await boot();
    const until = T0 + 7 * 86_400_000;
    await local.set('msiteLock', until);
    // A newer kill happened after the editor rendered `until - 1`: kept.
    await h.runner.editorMessage({ v: 1, type: 'handoff/enable-msite', lockedUntil: until - 1 });
    await h.settle();
    expect(await local.get('msiteLock')).toBe(until);
    await h.runner.editorMessage({ v: 1, type: 'handoff/enable-msite', lockedUntil: until });
    await h.settle();
    expect((await local.get('msiteLock')) ?? null).toBeNull();
    expect(await local.get('settings')).toBeUndefined();
    // The next start is no longer refused.
    await h.runner.editorMessage(startMsg('probe'));
    await h.settle();
    expect(names(since())[0]).toBe('windows.createPopup');
  });

  it('a lock from before AM25 in the settings object still refuses a start, and ENABLE clears it', async () => {
    const until = T0 + 86_400_000;
    await local.set('settings', { accountLabel: '@me', msiteLockedUntil: until } as Settings);
    const h = await boot();
    await h.runner.editorMessage(startMsg('probe'));
    await h.settle();
    expect(h.statuses.at(-1)).toMatchObject({ error: 'MSITE_LOCKED', freeAt: until });
    await h.runner.editorMessage({ v: 1, type: 'handoff/enable-msite', lockedUntil: until });
    await h.settle();
    expect(await local.get('settings')).toMatchObject({ accountLabel: '@me', msiteLockedUntil: null });
  });

  it('localState.lockMsite and an editor settings write interleave without losing either', async () => {
    // The editor's write path (settings-state.ts) reads and writes `settings`; the background's
    // lock writes only `msiteLock`, so no ordering of the two loses the lock or the edit.
    const ls = localState(true);
    const until = T0 + 7 * 86_400_000;
    const editorRead = await local.get('settings');
    await ls.lockMsite(until);
    await local.set('settings', { ...(editorRead ?? ({} as Settings)), accountLabel: '@edited' } as Settings);
    expect((await ls.settings()).msiteLockedUntil).toBe(until);
    expect((await ls.settings()).accountLabel).toBe('@edited');
    // Never shortened.
    await ls.lockMsite(until - 1000);
    expect(await local.get('msiteLock')).toBe(until);
  });
});

describe('U11 AM22: a popup left by a reloaded extension is closed', () => {
  const popup = { type: 'popup', tabUrls: [`${HOME}create/story/`] };

  it('a remembered popup no stored session owns is closed before the startup cleanup removes the rules', async () => {
    await local.set('composerWindow', { windowId: 7, tabId: 42, handoffId: 'hof_old' });
    fx.conf.existing.set(7, popup);
    const h = await boot(); // storage.session is empty, as after a reload
    await h.runner.dispatch({ type: 'startup' });
    await h.settle();
    const calls = names(fx.calls);
    expect(calls).toContain('windows.remove');
    expect(calls.indexOf('windows.remove')).toBeLessThan(calls.indexOf('dnr.updateSessionRules'));
    expect((await local.get('composerWindow')) ?? null).toBeNull();
  });

  it('never closes a window that is not our composer popup (an id from an earlier browser session)', async () => {
    for (const other of [
      { type: 'normal', tabUrls: [`${HOME}create/story/`] },
      { type: 'popup', tabUrls: ['https://example.com/'] },
      { type: 'popup', tabUrls: [undefined] },
      { type: 'popup', tabUrls: [HOME, HOME] },
    ]) {
      fx.reset();
      await local.set('composerWindow', { windowId: 7, tabId: 42, handoffId: 'hof_old' });
      fx.conf.existing.set(7, other);
      await boot();
      expect(names(fx.calls)).not.toContain('windows.remove');
      expect((await local.get('composerWindow')) ?? null).toBeNull();
    }
  });

  it('keeps the popup of the session storage.session still holds (a plain worker restart)', async () => {
    const first = await boot();
    await toReloading(first);
    expect(await local.get('composerWindow')).toEqual({ windowId: 7, tabId: 42, handoffId: HID });
    fx.conf.existing.set(7, popup);
    first.clock.kill();
    since();
    const second = await boot({ clock: manualClock(first.clock.now()), records: first.records });
    expect(names(since())).not.toContain('windows.remove');
    expect(second.runner.state().phase).toBe('reloading');
    // The session's end forgets it.
    await second.runner.dispatch({ type: 'windowRemoved', windowId: 7 });
    expect((await local.get('composerWindow')) ?? null).toBeNull();
  });
});

describe('U11 AM16 and AM23 through the runner', () => {
  it('forwards the agent sentinel: a same-document load resumes without a probe', async () => {
    const h = await boot();
    await toReloading(h);
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    await h.runner.agentMessage(
      agentMsg('agent/report', { probe: goodProbe({ storyInput: 'absent' }) }),
      agentSender(),
    );
    await h.settle();
    expect(h.runner.state().phase).toBe('awaitingPick');
    since();
    fx.conf.agentFresh = false;
    // pushState inside the composer: Chrome reports loading, then complete, with the new URL.
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: `${COMPOSER_URL}?x=1` });
    // The agent's ready event arrives before the background knows it is the same document.
    expect(await h.runner.agentMessage(agentMsg('agent/event', { event: 'composer-ready' }), agentSender())).toEqual({
      ok: true,
    });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: `${COMPOSER_URL}?x=1` });
    await h.settle();
    const sent = since()
      .filter((c) => c.fn === 'tabs.sendMessage')
      .map((c) => (c.args[1] as { type: string }).type);
    // No agent/probe for the same document; only the AM13 C8 probe once the replayed ready lands.
    expect(sent).toEqual(['agent/probe']);
    expect(h.runner.state()).toMatchObject({ phase: 'awaitingShare', level: 'H0' });
  });

  it('a guarded runner in a branded browser refuses with BRANDED_BROWSER and opens nothing', async () => {
    const h = await boot({ brands: ['Google Chrome', 'Chromium', 'Not A(Brand'] });
    await h.runner.editorMessage(startMsg());
    await h.settle();
    expect(since()).toEqual([]);
    expect(h.statuses.at(-1)).toMatchObject({ handoffId: null, error: 'BRANDED_BROWSER' });
    expect(await local.get('rateLog')).toBeUndefined();
  });
});

describe('U11 AM19, AM21 and AM28: an editor that connects mid-session gets the session as it is', () => {
  /** A second editor port (a reloaded editor page) connects; its first message. */
  async function reconnect(h: Harness): Promise<BackgroundToEditor | undefined> {
    const got: BackgroundToEditor[] = [];
    h.runner.connectEditor((m) => got.push(m));
    await h.settle();
    return got[0];
  }

  /** A post up to `awaitingShare` (H1), with the given rehearsal switch. */
  async function toShare(h: Harness, rehearsal: boolean): Promise<void> {
    const TAB = fx.conf.tabId;
    await h.runner.editorMessage({ ...startMsg(), rehearsal });
    await h.settle();
    await h.runner.tabUpdated(TAB, { status: 'loading', url: COMPOSER_URL });
    await h.runner.tabUpdated(TAB, { status: 'loading', url: COMPOSER_URL });
    await h.runner.tabUpdated(TAB, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender());
    await h.runner.agentMessage(agentMsg('agent/get-file'), agentSender());
    await h.runner.agentMessage(agentMsg('agent/event', { event: 'composer-ready' }), agentSender());
    await h.settle();
    expect(h.runner.state().phase).toBe('awaitingShare');
  }

  it('awaitingPick: the session switches (AM21), not the settings edited since', async () => {
    const h = await boot();
    await toReloading(h);
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    await h.runner.agentMessage(
      agentMsg('agent/report', { probe: goodProbe({ storyInput: 'absent' }) }),
      agentSender(),
    );
    await h.settle();
    expect(h.runner.state().phase).toBe('awaitingPick');
    // The owner edits the settings while the popup is open; they apply to the next hand-off only.
    await local.set('settings', { rehearsal: false, assistedInsert: false } as Settings);
    expect(await reconnect(h)).toMatchObject({
      phase: 'awaitingPick',
      level: 'H0',
      rehearsal: true,
      assistedInsert: true,
    });
  });

  it('finished after Share with rehearsal off: held open, pre-answered (AM19)', async () => {
    const h = await boot();
    await toShare(h, false);
    await h.runner.tabUpdated(fx.conf.tabId, { status: undefined, url: HOME });
    await h.settle();
    expect(await reconnect(h)).toMatchObject({
      phase: 'finished',
      holdOpen: true,
      detectedPosted: true,
      rehearsal: false,
      assistedInsert: true,
    });
  });

  it('finished on an unexpected page after Share: its error, the page and no pre-answer survive (AM28)', async () => {
    const h = await boot();
    await toShare(h, false);
    await h.runner.tabUpdated(fx.conf.tabId, { status: undefined, url: 'https://www.instagram.com/consent/?flow=x' });
    await h.settle();
    expect(h.runner.state().phase).toBe('finished');
    expect(await reconnect(h)).toMatchObject({
      phase: 'finished',
      error: 'UNEXPECTED_PAGE',
      detail: 'page /consent/',
      detectedPosted: false,
      postedUnknown: true,
      holdOpen: true,
    });
  });
});

describe('U11 AM20: the navigation deadline survives a service-worker restart', () => {
  it('a worker restarted in navigating still closes on the 30 s deadline (NAVIGATION_TIMEOUT)', async () => {
    const first = await boot();
    await first.runner.editorMessage(startMsg());
    await first.settle();
    expect(first.runner.state().phase).toBe('navigating');
    expect(await session.get('timers')).toEqual({
      inactivity: T0 + INACTIVITY_TIMEOUT_MS,
      navigation: T0 + NAVIGATION_TIMEOUT_MS,
    });
    first.clock.kill();
    since();

    const second = await boot({ clock: manualClock(T0 + 10_000), records: first.records });
    await second.advance(NAVIGATION_TIMEOUT_MS - 10_000 - 1);
    expect(since()).toEqual([]);
    await second.advance(1);
    expect(names(since())).toEqual(['windows.remove']);
    expect(second.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:NAVIGATION_TIMEOUT' });
  });
});

describe('U11 timers keep the worker awake only while pending', () => {
  it('pings while a timer is pending and stops when none is', async () => {
    const pings: number[] = [];
    const clock = manualClock();
    const h = await boot({ clock, keepAlive: () => pings.push(clock.now()) });
    expect(clock.intervals()).toBe(0);
    await toReloading(h);
    expect(clock.intervals()).toBe(1);
    await h.advance(2 * KEEPALIVE_MS);
    expect(pings).toEqual([T0 + KEEPALIVE_MS, T0 + 2 * KEEPALIVE_MS]);
    await h.runner.dispatch({ type: 'windowRemoved', windowId: fx.conf.windowId });
    expect(h.runner.state().phase).toBe('idle');
    expect(clock.intervals()).toBe(0);
  });
});
