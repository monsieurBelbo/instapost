/**
 * U11 (strategy §7.11): the runner executes reducer effects through the platform wrappers.
 * - Effect order for the H1 happy path, from `handoff/start` to the cleanup after the popup closed.
 * - W2/W3 (2026-10-12): the window settles before it is measured, every update passes
 *   `state:'normal'` and is verified against the tab size, one retry 300 ms later, and the guided
 *   resize driven by windows.onBoundsChanged and the poll.
 * - A runner re-created from storage.session mid-flow resumes it (a stopped service worker),
 *   including its persisted timers.
 * - onStartup, onInstalled, windows.onRemoved (and tabs.onRemoved) remove ids 1001–1019.
 * Plus the agent sender check at processing time, the get-file answer, the kill switch's lock,
 * the rate log and the editor port. AM37: the MAIN-world portrait shim goes into the composer tab
 * only, before the agent, on every document after the hard reload; a guarded E2E flag makes it read
 * only, a live runner never reads that flag; its reading reaches the reducer (SCREEN_LANDSCAPE).
 * The executeScript call itself (MAIN world, frame 0, injectImmediately) is src/platform/scripting.test.ts.
 *
 * The dnr, tabs, windows, scripting and idb wrappers are vi.mock'ed with one recording fake;
 * storage (session and local) is WXT's fakeBrowser behind the real src/platform/storage.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  FIT_REAPPLY_MS,
  FIT_RETRY_DELAY_MS,
  type HandoffRecord,
  INACTIVITY_TIMEOUT_MS,
  INPUT_WAIT_MS,
  NAVIGATION_TIMEOUT_MS,
  RESIZE_POLL_MS,
  RESIZE_TIMEOUT_MS,
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
    windowBounds: [] as Listener<[number]>[],
  };
  type Box = { left: number; top: number; width: number; height: number };
  const conf = {
    windowId: 7,
    tabId: 42,
    /** The popup's outer box; tabs.get reports it minus `frame` (null = no size, as for a hidden tab). */
    box: { left: 500, top: 33, width: 500, height: 932 } as Box,
    frame: { w: 0, h: 32 },
    sizeless: false,
    /** W2: windows.update moves the window (true) or is ignored (Arc's early updates, F1). */
    honourUpdates: true,
    /** W2 hardening: this many windows.update calls are ignored first (Arc often ignores the first). */
    dropUpdates: 0,
    /** W2 hardening: Arc re-places the popup at this tabs.get read (counted from the first update). */
    replaceAt: null as { read: number; box: Box } | null,
    /** tabs.get reads since the last windows.update was issued for the first time. */
    readsSinceUpdate: -1,
    /** windows.getBox reads that come before the box settles (consumed one per read). */
    settling: [] as Box[],
    zoom: 1,
    agentAck: { ok: true } as unknown,
    exports: new Map<string, { bytes: Uint8Array; mime: string }>(),
    /** executeScript's result for the agent: true = installed (a new document), false = already there. */
    agentFresh: true,
    /** AM37: the portrait shim's result (the page's screen orientation after it, and its state). */
    orientation: { type: 'portrait-primary', shim: 'installed' } as { type: string | null; shim: string },
    /** windows.get(id, {populate}) per window id: type and tab URLs; absent = no such window. */
    existing: new Map<number, { type: string; tabUrls: (string | undefined)[] }>(),
    /** tabs.get's url (SH-1: the shim-off flag `'home'` reads it). */
    tabUrl: 'about:blank' as string | undefined,
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
      listeners.windowBounds.length = 0;
      conf.box = { left: 500, top: 33, width: 500, height: 932 };
      conf.frame = { w: 0, h: 32 };
      conf.sizeless = false;
      conf.honourUpdates = true;
      conf.dropUpdates = 0;
      conf.replaceAt = null;
      conf.readsSinceUpdate = -1;
      conf.settling = [];
      conf.zoom = 1;
      conf.agentAck = { ok: true };
      conf.exports.clear();
      conf.agentFresh = true;
      conf.orientation = { type: 'portrait-primary', shim: 'installed' };
      conf.existing.clear();
      conf.tabUrl = 'about:blank';
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
      update: async (id: number, u: Partial<Box> & { state?: string }) => {
        await call('windows.update', id, u);
        if (conf.readsSinceUpdate < 0) conf.readsSinceUpdate = 0;
        if (conf.dropUpdates > 0) {
          conf.dropUpdates--;
          return;
        }
        if (conf.honourUpdates && u.width !== undefined) {
          conf.box = { left: u.left ?? 0, top: u.top ?? 0, width: u.width, height: u.height ?? 0 };
        }
      },
      getBox: async (id: number) => {
        await call('windows.getBox', id);
        return { ...(conf.settling.shift() ?? conf.box) };
      },
      remove: (id: number) => call('windows.remove', id),
      describe: async (id: number) => {
        await call('windows.describe', id);
        return conf.existing.get(id) ?? null;
      },
      onRemoved: sub(listeners.windowRemoved),
      onBoundsChanged: sub(listeners.windowBounds),
    },
    tabs: {
      get: async (id: number) => {
        await call('tabs.get', id);
        if (conf.readsSinceUpdate >= 0) conf.readsSinceUpdate++;
        if (conf.replaceAt && conf.readsSinceUpdate === conf.replaceAt.read) conf.box = { ...conf.replaceAt.box };
        const w = conf.sizeless ? undefined : conf.box.width - conf.frame.w;
        const h = conf.sizeless ? undefined : conf.box.height - conf.frame.h;
        return { id, windowId: conf.windowId, url: conf.tabUrl, width: w, height: h };
      },
      getZoom: async (id: number) => {
        await call('tabs.getZoom', id);
        return conf.zoom;
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
      injectPortraitShim: async (id: number, install: boolean) => {
        await call('scripting.injectPortraitShim', id, install);
        return { ...conf.orientation };
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
  swIntercepted: false,
  navType: 'reload',
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
  browser: 'chromium',
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
    e2e?: { resizeTimeoutMs(): Promise<number | undefined>; portraitShimOff(): Promise<boolean | 'home'> };
    /** A live build's runner (no E2E hooks are passed to it in production). */
    guarded?: boolean;
    /** The waits inside effects; by default they resolve at once (and are counted in `sleeps`). */
    sleep?: (ms: number) => Promise<void>;
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
      guarded: opts.guarded ?? true,
      runtimeId: RUNTIME_ID,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36',
      uuid: () => `u${++n}`,
      clock,
      // The settle and verify waits resolve at once: their loops are bounded by read counts.
      sleep:
        opts.sleep ??
        (async () => {
          sleeps++;
        }),
      brands: opts.brands ?? ['Not:A-Brand', 'Chromium'],
      keepAlive: opts.keepAlive,
      ...(opts.e2e ? { e2e: opts.e2e } : {}),
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

/** Waits taken inside effects (settle and verify). */
let sleeps = 0;

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
  sleeps = 0;
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
      // W2: the window settles (two equal reads), then its tab and zoom are read.
      'windows.getBox',
      'windows.getBox',
      'tabs.get',
      'tabs.getZoom',
      // One update with state normal, verified against the tab size at once; it fits, so nothing is
      // re-applied, but it must still hold FIT_HOLD_MS (1.1 s): one read every 100 ms plus the 150 ms
      // re-apply check (W2 hardening: Arc re-places new popups up to about 1 s late).
      'windows.update',
      ...Array<string>(13).fill('tabs.get'),
      'windows.getBox',
      'tabs.navigate',
    ]);
    expect(opening[6]?.args).toEqual([WIN, { state: 'normal', left: 501, top: 37, width: 511, height: 941 }]);
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
    expect(opening.at(-1)?.args).toEqual([TAB, COMPOSER_URL]);
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
    // AM37: the portrait shim (MAIN world, installing) into the composer tab first, then the agent.
    expect(names(probing)).toEqual([
      'scripting.injectPortraitShim',
      'scripting.injectComposerAgent',
      'tabs.sendMessage',
    ]);
    expect(probing[0]?.args).toEqual([TAB, true]);
    expect(probing[1]?.args).toEqual([TAB]);
    expect(probing[2]?.args).toEqual([TAB, { v: 1, type: 'agent/probe', handoffId: HID, nonce: NONCE }]);

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
    expect(names(calls)).toEqual(['scripting.injectPortraitShim', 'scripting.injectComposerAgent', 'tabs.sendMessage']);
    expect(calls[2]?.args[1]).toEqual({ v: 1, type: 'agent/probe', handoffId: HID, nonce: NONCE });
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
    // P5: the one wait for a late story input runs out (6 s).
    await first.advance(INPUT_WAIT_MS);
    await first.runner.tabUpdated(fx.conf.tabId, { status: undefined, url: `${HOME}create/story/` });
    await first.runner.agentMessage(agentMsg('agent/event', { event: 'composer-ready' }), agentSender());
    await first.runner.tabUpdated(fx.conf.tabId, { status: undefined, url: HOME });
    await first.settle();
    expect(first.runner.state().phase).toBe('finished');
    expect((await session.get('timers'))?.closeDelay).toBe(T0 + INPUT_WAIT_MS + 3000);
    first.clock.kill();
    since();

    // Ten seconds later the worker wakes for an unrelated tab update.
    const second = await boot({ clock: manualClock(T0 + INPUT_WAIT_MS + 10_000) });
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
    await h.advance(INPUT_WAIT_MS);
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

describe('U11 AM37: the MAIN-world portrait shim', () => {
  /** The shim and agent injections since the last mark: [fn, tabId, install?]. */
  const injections = () =>
    since()
      .filter((c) => c.fn.startsWith('scripting.'))
      .map((c) => [c.fn, ...c.args]);
  const SHIM = 'scripting.injectPortraitShim';
  const AGENT = 'scripting.injectComposerAgent';

  /** The reload's commit and complete on `/`: the first document Instagram gives the composer tab. */
  async function firstDocument(h: Harness): Promise<void> {
    await toReloading(h);
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: HOME });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: HOME });
    await h.settle();
  }

  it('goes into the composer tab only, before the agent, on every document after the hard reload', async () => {
    const h = await boot();
    const TAB = fx.conf.tabId;
    await h.runner.editorMessage(startMsg());
    await h.settle();
    // Nothing is injected before the hard reload: not into about:blank, not into the first (SW) load.
    await h.runner.tabUpdated(TAB, { status: 'loading', url: COMPOSER_URL });
    await h.settle();
    expect(injections()).toEqual([]);
    await h.runner.tabUpdated(TAB, { status: 'loading', url: HOME });
    await h.runner.tabUpdated(TAB, { status: 'complete', url: HOME });
    await h.settle();
    expect(injections()).toEqual([
      [SHIM, TAB, true],
      [AGENT, TAB],
    ]);
    // Another tab's loads (a normal Instagram tab of the profile) never get either script.
    await h.runner.tabUpdated(99, { status: 'loading', url: HOME });
    await h.runner.tabUpdated(99, { status: 'complete', url: HOME });
    await h.settle();
    expect(injections()).toEqual([]);
    await h.runner.agentMessage(
      agentMsg('agent/report', { probe: goodProbe({ inner: { w: 511, h: 909 } }) }),
      agentSender({ url: HOME }),
    );
    await h.settle();
    expect(h.runner.state().phase).toBe('injecting');
    // A new document (a full reload of the composer tab): the shim again, before the fresh agent.
    await h.runner.tabUpdated(TAB, { status: 'loading', url: HOME });
    await h.runner.tabUpdated(TAB, { status: 'complete', url: HOME });
    await h.settle();
    expect(injections()).toEqual([
      [SHIM, TAB, true],
      [AGENT, TAB],
    ]);
    // A same-document load (the insert's SPA navigation) re-injects both; the shim finds itself there.
    fx.conf.agentFresh = false;
    fx.conf.orientation = { type: 'portrait-primary', shim: 'present' };
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME }));
    await h.runner.tabUpdated(TAB, { status: 'loading', url: COMPOSER_URL });
    await h.runner.tabUpdated(TAB, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    expect(injections()).toEqual([
      [SHIM, TAB, true],
      [AGENT, TAB],
    ]);
    expect(h.runner.state()).toMatchObject({ pageOrientation: { type: 'portrait-primary', shim: 'present' } });
  });

  it('its reading is stamped on the agent’s report and shown to the editor', async () => {
    const h = await boot();
    fx.conf.orientation = { type: 'portrait-primary', shim: 'installed' };
    await firstDocument(h);
    // An agent cannot forge the reading: whatever it sends there is dropped and replaced.
    const forged = { ...goodProbe(), orientation: { type: 'landscape-primary', shim: 'off' } };
    await h.runner.agentMessage(agentMsg('agent/report', { probe: forged }), agentSender({ url: HOME }));
    await h.settle();
    const probe = h.statuses.find((s) => s.probe)?.probe;
    expect(probe?.orientation).toEqual({ type: 'portrait-primary', shim: 'installed' });
  });

  it('a guarded build’s E2E flag makes it read only', async () => {
    const off = { resizeTimeoutMs: async () => undefined, portraitShimOff: vi.fn(async () => true) };
    const h = await boot({ e2e: off });
    await firstDocument(h);
    expect(h.runner.state()).toMatchObject({ phase: 'probing' });
    expect(injections()).toEqual([
      [SHIM, fx.conf.tabId, false],
      [AGENT, fx.conf.tabId],
    ]);
    expect(off.portraitShimOff).toHaveBeenCalledTimes(1);
  });

  it('SH-1: the flag `home` makes it read only off the composer, so it installs first after the pick reached the composer', async () => {
    const late = { resizeTimeoutMs: async () => undefined, portraitShimOff: vi.fn(async () => 'home' as const) };
    const h = await boot({ e2e: late });
    const TAB = fx.conf.tabId;
    fx.conf.tabUrl = HOME;
    fx.conf.orientation = { type: 'landscape-primary', shim: 'off' };
    await firstDocument(h);
    expect(injections()).toEqual([
      [SHIM, TAB, false],
      [AGENT, TAB],
    ]);
    await h.runner.agentMessage(
      agentMsg('agent/report', { probe: goodProbe({ inner: { w: 511, h: 909 } }) }),
      agentSender({ url: HOME }),
    );
    await h.settle();
    // The pick's SPA navigation: the shim installs only now, on the composer.
    fx.conf.tabUrl = COMPOSER_URL;
    fx.conf.agentFresh = false;
    fx.conf.orientation = { type: 'portrait-primary', shim: 'installed' };
    await h.runner.tabUpdated(TAB, { status: 'loading', url: COMPOSER_URL });
    await h.runner.tabUpdated(TAB, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    expect(injections()).toEqual([
      [SHIM, TAB, true],
      [AGENT, TAB],
    ]);
    expect(h.statuses.at(-1)).toMatchObject({
      error: 'SCREEN_LANDSCAPE',
      detail: 'screen portrait-primary, portrait shim installed after the composer mounted',
    });
    expect(late.portraitShimOff).toHaveBeenCalledTimes(2);
  });

  it('a live runner installs it whatever a test flag says (live builds get no test hooks at all)', async () => {
    const off = { resizeTimeoutMs: async () => undefined, portraitShimOff: vi.fn(async () => true) };
    const h = await boot({ guarded: false, e2e: off });
    await firstDocument(h);
    expect(h.runner.state()).toMatchObject({ phase: 'probing' });
    expect(injections()).toEqual([
      [SHIM, fx.conf.tabId, true],
      [AGENT, fx.conf.tabId],
    ]);
    expect(off.portraitShimOff).not.toHaveBeenCalled();
  });

  it('a landscape reading on the composer ends the session with SCREEN_LANDSCAPE (close, no lock)', async () => {
    const h = await boot();
    fx.conf.orientation = { type: 'landscape-primary', shim: 'failed' };
    await firstDocument(h);
    await h.runner.agentMessage(
      agentMsg('agent/report', { probe: goodProbe({ storyInput: 'absent' }) }),
      agentSender({ url: HOME }),
    );
    await h.advance(INPUT_WAIT_MS);
    expect(h.runner.state().phase).toBe('awaitingPick');
    since();
    // The owner's pick: msite's SPA navigation to the composer (same document).
    fx.conf.agentFresh = false;
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    expect(names(since())).toEqual([SHIM, AGENT, 'windows.remove']);
    expect(h.statuses.at(-1)).toMatchObject({
      phase: 'closing',
      error: 'SCREEN_LANDSCAPE',
      detail: 'screen landscape-primary, portrait shim failed',
    });
    expect(h.records.rows.get(HID)).toMatchObject({
      outcome: 'failed:SCREEN_LANDSCAPE',
      preflight: { C3b: 'fail' },
    });
    expect(await local.get('msiteLock')).toBeUndefined();
  });

  it('a failed shim injection fails the injection: AGENT_UNREACHABLE, no agent', async () => {
    const h = await boot();
    fx.failing.add('scripting.injectPortraitShim');
    await firstDocument(h);
    expect(names(fx.calls)).not.toContain(AGENT);
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:AGENT_UNREACHABLE' });
    expect(h.records.rows.get(HID)?.detail).toMatch(/^injectAgent: scripting.injectPortraitShim failed/);
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
    await h.advance(INPUT_WAIT_MS);
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

describe('U11 W2/W3: the popup is fitted while it is still about:blank (Arc, 2026-10-12)', () => {
  /** Arc's popup: 1512x949 at (1831,13) whatever windows.create asked for, with a 0x47 frame (F1). */
  const ARC = { left: 1831, top: 13, width: 1512, height: 949 };
  const UW = { availLeft: 1512, availTop: -428, availWidth: 3440, availHeight: 1410 };
  const ultrawideStart = () => ({ ...startMsg(), screen: UW });
  const arc = () => {
    fx.conf.box = { ...ARC };
    fx.conf.frame = { w: 0, h: 47 };
  };
  const updates = () => fx.calls.filter((c) => c.fn === 'windows.update').map((c) => c.args[1]);
  /** 524x932 inner + 47 frame, centred on the ultrawide. */
  const BOX = { left: 2970, top: -212, width: 524, height: 979 };

  it('waits for the window to settle (two equal reads 100 ms apart) before measuring it', async () => {
    arc();
    // Arc moves the new popup twice before it stays put.
    fx.conf.settling = [
      { left: 2970, top: -328, width: 524, height: 1012 },
      { left: 1800, top: 0, width: 1400, height: 900 },
    ];
    const h = await boot();
    await h.runner.editorMessage(ultrawideStart());
    await h.settle();
    const calls = names(since());
    const measure = calls.slice(2, calls.indexOf('tabs.get'));
    expect(measure).toEqual(['windows.getBox', 'windows.getBox', 'windows.getBox', 'windows.getBox']);
    // One FIT_SETTLE_POLL_MS wait between reads; the honoured update verifies at once and then holds
    // until FIT_HOLD_MS (12 waits: every 100 ms to 1.1 s, plus the 150 ms re-apply check).
    expect(sleeps).toBe(3 + 12);
    // The update asks for the fit computed from the settled window's real frame (0x47), with state normal.
    expect(updates()).toEqual([{ state: 'normal', ...BOX }]);
    expect(h.runner.state()).toMatchObject({
      phase: 'navigating',
      win: { created: ARC, createdTab: { w: 1512, h: 902 }, frameDelta: { w: 0, h: 47 }, attempts: 1, zoom: 1 },
    });
  });

  it('gives up settling after 1 s and measures the latest read', async () => {
    arc();
    fx.conf.settling = Array.from({ length: 12 }, (_, i) => ({ left: i, top: 0, width: 1512, height: 949 }));
    const h = await boot();
    await h.runner.editorMessage(ultrawideStart());
    await h.settle();
    const calls = names(since());
    expect(calls.slice(2, calls.indexOf('tabs.get')).length).toBe(11);
    expect(h.runner.state()).toMatchObject({ win: { created: { left: 10 } } });
  });

  it('an ignored update is re-applied at 150/300/500/1000 ms, verified for 1.5 s, retried once 300 ms later, and the retry fits', async () => {
    arc();
    fx.conf.honourUpdates = false;
    const h = await boot();
    await h.runner.editorMessage(ultrawideStart());
    await h.settle();
    // 1 read right after the update, one every 100 ms for 1.5 s and one at the 150 ms re-apply: 17 tab
    // reads; the box is applied 5 times (FIT_REAPPLY_MS), all while the tab is still about:blank.
    const first = names(since());
    const fromUpdate = first.slice(first.indexOf('windows.update'));
    expect(fromUpdate.filter((n) => n === 'tabs.get')).toHaveLength(17);
    expect(fromUpdate.filter((n) => n === 'windows.update')).toHaveLength(FIT_REAPPLY_MS.length);
    expect(sleeps).toBe(1 + 16);
    expect(h.runner.state()).toMatchObject({ phase: 'fitting', fitStep: 'retryWait' });
    if (h.runner.state().phase === 'idle') throw new Error('unreachable');
    expect((h.runner.state() as { win: { updates: unknown[] } }).win.updates).toEqual([
      expect.objectContaining({ step: 'fit', fitted: false, applied: 5 }),
    ]);
    expect((await session.get('timers'))?.fitRetry).toBe(T0 + FIT_RETRY_DELAY_MS);
    // Arc honours a later update with state normal (F1).
    fx.conf.honourUpdates = true;
    await h.advance(FIT_RETRY_DELAY_MS);
    expect(updates()).toEqual(Array(FIT_REAPPLY_MS.length + 1).fill({ state: 'normal', ...BOX }));
    expect(names(since()).at(-1)).toBe('tabs.navigate');
    expect(h.runner.state()).toMatchObject({ phase: 'navigating', win: { attempts: 2, finalTab: { w: 524, h: 932 } } });
  });

  it('W2 hardening: Arc drops the first updates; a re-apply within the same attempt fits (no retry)', async () => {
    arc();
    // The first two windows.update calls are ignored (Arc often ignores the first, F1 research).
    fx.conf.dropUpdates = 2;
    const h = await boot();
    await h.runner.editorMessage(ultrawideStart());
    await h.settle();
    expect(updates()).toEqual(Array(3).fill({ state: 'normal', ...BOX }));
    expect(h.runner.state()).toMatchObject({
      phase: 'navigating',
      win: { attempts: 1, finalTab: { w: 524, h: 932 }, created: ARC },
    });
    expect((h.runner.state() as { win: { updates: unknown[] } }).win.updates).toEqual([
      expect.objectContaining({ step: 'fit', fitted: true, applied: 3 }),
    ]);
  });

  it('W2 hardening: a fit that Arc undoes later (re-placed) is re-applied at the next offset and must hold', async () => {
    arc();
    const h = await boot();
    // The update fits at once; 300 ms in (the 5th tab read of the verification), Arc re-places the popup.
    fx.conf.replaceAt = { read: 5, box: { ...ARC } };
    await h.runner.editorMessage(ultrawideStart());
    await h.settle();
    expect(updates()).toEqual(Array(2).fill({ state: 'normal', ...BOX }));
    expect(h.runner.state()).toMatchObject({ phase: 'navigating', win: { attempts: 1, finalTab: { w: 524, h: 932 } } });
    expect((h.runner.state() as { win: { updates: unknown[] } }).win.updates).toEqual([
      expect.objectContaining({ step: 'fit', fitted: true, applied: 2 }),
    ]);
  });

  it('the refit after the navigation is one windows.update: never re-applied, no hold', async () => {
    const h = await boot();
    await toReloading(h);
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: HOME });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: HOME });
    await h.settle();
    // Instagram is loaded now and the window went wide; the refit's update is ignored, verified for
    // 1.5 s, and not re-applied.
    fx.conf.box = { left: 0, top: 33, width: 900, height: 1332 };
    fx.conf.honourUpdates = false;
    since();
    sleeps = 0;
    const wide = goodProbe({ inner: { w: 900, h: 1300 } });
    expect(await h.runner.agentMessage(agentMsg('agent/report', { probe: wide }), agentSender())).toEqual({ ok: true });
    await h.settle();
    const calls = names(since());
    expect(calls.filter((n) => n === 'windows.update')).toHaveLength(1);
    // AL-3: no settling (one windows.get), then 15 polls of the verification, no 150 ms re-apply check.
    expect(calls.slice(0, 3)).toEqual(['windows.getBox', 'tabs.get', 'tabs.getZoom']);
    expect(sleeps).toBe(15);
    expect(h.runner.state()).toMatchObject({ phase: 'probing', step: 'awaitReport' });
    expect((h.runner.state() as { win: { updates: unknown[] } }).win.updates.at(-1)).toEqual(
      expect.objectContaining({ step: 'refit', fitted: false, applied: 1 }),
    );
  });

  it('AL-3: the refit never holds the queue: a challenge during its verification is killed within one poll tick', async () => {
    // A gate the verification's waits hang on until the test releases it.
    let gate: Promise<void> | null = null;
    let release: () => void = () => undefined;
    const h = await boot({
      sleep: async () => {
        sleeps++;
        if (gate) await gate;
      },
    });
    await toReloading(h);
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: HOME });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: HOME });
    await h.settle();
    // Arc ignores the refit (as in E24): its verification would poll for the full 1.5 s.
    fx.conf.box = { left: 0, top: 33, width: 900, height: 1332 };
    fx.conf.honourUpdates = false;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    since();
    sleeps = 0;
    void h.runner.agentMessage(
      agentMsg('agent/report', { probe: goodProbe({ inner: { w: 900, h: 1300 } }) }),
      agentSender(),
    );
    // The report is handled and the refit's one windows.update issued; its verification now waits.
    const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 50 && !names(fx.calls).includes('windows.update'); i++) await turn();
    for (let i = 0; i < 5; i++) await turn();
    expect(sleeps).toBe(1);
    expect(h.runner.state()).toMatchObject({ phase: 'probing', step: 'refitUpdate' });

    // Instagram redirects the composer to a challenge while the verification is still waiting.
    void h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: 'https://www.instagram.com/challenge/x/' });
    for (let i = 0; i < 50 && !names(fx.calls).includes('windows.remove'); i++) await turn();
    // Within that one pending poll: closed and locked, before the verification has ended.
    expect(sleeps).toBe(1);
    expect(names(fx.calls)).toContain('windows.remove');
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'killed:KILLED_CHALLENGE' });
    await expect.poll(async () => (await local.get('msiteLock')) ?? null).toBeGreaterThan(T0);

    // The late answer of the verification changes nothing: no probe, no second update.
    gate = null;
    release();
    await h.settle();
    const after = since();
    expect(names(after).filter((n) => n === 'windows.update')).toHaveLength(1);
    expect(after.some((c) => c.fn === 'tabs.sendMessage')).toBe(false);
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'killed:KILLED_CHALLENGE' });
  });

  it('AM29/AL-4 budget: at most FIT_REAPPLY_MS.length windows.update per pre-navigation attempt, 1 for the refit', async () => {
    arc();
    fx.conf.honourUpdates = false;
    const h = await boot();
    await h.runner.editorMessage(ultrawideStart());
    await h.settle();
    await h.advance(FIT_RETRY_DELAY_MS);
    // Both attempts ignored: the whole budget, all while the tab is about:blank, and no more.
    expect(h.runner.state().phase).toBe('resizing');
    expect(updates()).toHaveLength(2 * FIT_REAPPLY_MS.length);
    expect(names(fx.calls)).not.toContain('tabs.navigate');
  });

  it('both ignored → resizing; windows.onBoundsChanged for the popup reads it; a usable size navigates', async () => {
    arc();
    fx.conf.honourUpdates = false;
    const onConnect = { addListener: () => undefined, removeListener: () => undefined, hasListener: () => true };
    (fakeBrowser.runtime as unknown as { onConnect: unknown }).onConnect = onConnect;
    const h = await boot();
    startBackground(h.runner, { info: () => undefined, warn: () => undefined, error: () => undefined });
    await h.runner.editorMessage(ultrawideStart());
    await h.settle();
    await h.advance(FIT_RETRY_DELAY_MS);
    expect(h.runner.state()).toMatchObject({ phase: 'resizing' });
    expect(h.statuses.at(-1)).toMatchObject({
      phase: 'resizing',
      resize: { tab: { w: 1512, h: 902 }, ok: false, until: T0 + FIT_RETRY_DELAY_MS + RESIZE_TIMEOUT_MS },
      window: { attempts: 2, manualResize: false },
    });
    since();
    // Another window's bounds change is not read.
    for (const l of fx.listeners.windowBounds) l(fx.conf.windowId + 1);
    await h.settle();
    expect(since()).toEqual([]);
    // The owner drags the popup narrow and tall (the E2E does this with chrome.windows.update).
    fx.conf.box = { left: 2970, top: 0, width: 493, height: 867 };
    for (const l of fx.listeners.windowBounds) l(fx.conf.windowId);
    await h.settle();
    expect(names(since())).toEqual(['tabs.get', 'windows.getBox', 'tabs.navigate']);
    expect(h.runner.state()).toMatchObject({
      phase: 'navigating',
      win: { manualResize: true, finalTab: { w: 493, h: 820 } },
    });
    expect(await session.get('timers')).not.toHaveProperty('resizeDeadline');
    expect(await session.get('timers')).not.toHaveProperty('resizePoll');
  });

  it('the poll reads the size every second; no usable size within 3 min → WINDOW_NOT_FITTED', async () => {
    arc();
    fx.conf.honourUpdates = false;
    const h = await boot();
    await h.runner.editorMessage(ultrawideStart());
    await h.settle();
    await h.advance(FIT_RETRY_DELAY_MS);
    since();
    await h.advance(RESIZE_POLL_MS);
    expect(names(since())).toEqual(['tabs.get', 'windows.getBox']);
    // A reconnecting editor gets the guided resize as it is.
    const got: BackgroundToEditor[] = [];
    h.runner.connectEditor((m) => got.push(m));
    await h.settle();
    expect(got[0]).toMatchObject({ phase: 'resizing', resize: { tab: { w: 1512, h: 902 }, ok: false } });
    await h.advance(RESIZE_TIMEOUT_MS);
    expect(names(fx.calls)).toContain('windows.remove');
    expect(names(fx.calls)).not.toContain('tabs.navigate');
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:WINDOW_NOT_FITTED' });
    expect(h.records.rows.get(HID)?.window).toMatchObject({ attempts: 2, manualResize: false });
  });

  it('a guarded E2E flag shortens the deadline; a worker restart keeps it', async () => {
    arc();
    fx.conf.honourUpdates = false;
    const e2e = { resizeTimeoutMs: async () => 2000, portraitShimOff: async () => false };
    const first = await boot({ e2e });
    await first.runner.editorMessage(ultrawideStart());
    await first.settle();
    await first.advance(FIT_RETRY_DELAY_MS);
    expect(first.runner.state().phase).toBe('resizing');
    first.clock.kill();
    since();
    const second = await boot({ clock: manualClock(first.clock.now() + 1000), records: first.records, e2e });
    // The poll that fell due while the worker was stopped reads the size at once.
    expect(names(since())).toEqual(['tabs.get', 'windows.getBox']);
    await second.advance(1000);
    expect(second.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:WINDOW_NOT_FITTED' });
  });

  it('every update is verified and recorded; a tab with no size fails the measure (AGENT_UNREACHABLE)', async () => {
    fx.conf.sizeless = true;
    const h = await boot();
    await h.runner.editorMessage(startMsg());
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:AGENT_UNREACHABLE' });
    expect(h.statuses.at(-1)).toMatchObject({
      error: 'AGENT_UNREACHABLE',
      detail: expect.stringContaining('measureTab'),
    });
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
