/**
 * U11 (strategy §7.11, ux.md IB1): the runner executes reducer effects through the platform wrappers.
 * - Effect order for the autopilot's happy path, from `handoff/start` through + → Story, the insert, the
 *   compose watch, Share and the outcome rules to the cleanup after the popup closed.
 * - Share once survives a stopped worker: the state that says `shareSent` is stored before the command.
 * - The editor requests the runner handles in its queue: the account choice, Finish by hand, History's
 *   mark, Resume (AM25), open Instagram, Forget this account and the badge's "result seen".
 * - The lane is pushed on connect and after every phase change; a start blocked by the 60 s spacing waits.
 * - W2/W3 (2026-10-12): the window settles before it is measured, every update passes `state:'normal'`
 *   and is verified against the tab size, one retry 300 ms later, and the guided resize driven by
 *   windows.onBoundsChanged and the poll. The popup is docked at the right edge (ux.md §4.6).
 * - A runner re-created from storage.session mid-flow resumes it (a stopped service worker), including its
 *   persisted timers, and a session found without any gets its phase's backstop.
 * - onStartup, onInstalled, windows.onRemoved (and tabs.onRemoved) remove ids 1001–1019.
 * Plus the agent sender check at processing time, the get-file answer, the kill switch's lock, the rate
 * log and the editor port. AM37: the MAIN-world portrait shim goes into the composer tab only, before the
 * agent, on every document after the hard reload; a guarded E2E flag makes it read only, a live runner
 * never reads that flag; its reading reaches the reducer (SCREEN_LANDSCAPE).
 *
 * The dnr, tabs, windows, scripting, action and idb wrappers are vi.mock'ed with one recording fake;
 * storage (session and local) is WXT's fakeBrowser behind the real src/platform/storage.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  type AgentFact,
  FIT_REAPPLY_MS,
  FIT_RETRY_DELAY_MS,
  type HandoffOutcome,
  type HandoffRecord,
  HOME_CLOSE_MS,
  NAVIGATION_TIMEOUT_MS,
  type NetEntry,
  OFFER_MANUAL_MS,
  POSTED_CLOSE_MS,
  PRE_SHARE_CAP_MS,
  RELOAD_BUDGET_MS,
  RESIZE_POLL_MS,
  RESIZE_TIMEOUT_MS,
  type RunResult,
  type Settings,
  SHARE_ACK_MS,
  UPLOAD_HOLD_MS,
} from '../core/handoff/state.ts';
import type { ProbeReport } from '../core/ig-contract/contract.ts';
import { REHEARSAL_FIRST_ID, SESSION_RULE_IDS } from '../core/ig-contract/rules.ts';
import { COMPOSER_URL } from '../core/ig-contract/urls.ts';
import { WRITE_URL_FILTERS } from '../core/ig-contract/write-endpoints.ts';
import type { InpageLane } from '../inpage/background.ts';
import type { InpageDriver } from '../inpage/driver.ts';
import { badge } from '../platform/action.ts';
import { dnr } from '../platform/dnr.ts';
import { scripting } from '../platform/scripting.ts';
import { local, session } from '../platform/storage.ts';
import { tabs } from '../platform/tabs.ts';
import { windows } from '../platform/windows.ts';
import { type BackgroundToEditor, b64ToBytes, type GetFileReply, type SenderLike } from '../shared/protocol.ts';
import { createBackgroundRunner, startBackground } from './background-main.ts';
import { localState } from './local-state.ts';
import type { RecordStore } from './records.ts';
import { backstopFor, createRunner, instagramUrl, type Runner, testRulesInstalled } from './runner.ts';
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
    /** windows.getLastFocused's id (§4.6: the editor is refocused only when this is the popup). */
    focused: null as number | null,
    /** dnr.getSessionRules (a Share test verifies its write-block rules). */
    sessionRules: [] as { id: number; condition: { tabIds?: number[] } }[],
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
      conf.focused = null;
      conf.sessionRules = [];
    },
    dnr: {
      updateSessionRules: (u: unknown) => call('dnr.updateSessionRules', u),
      getSessionRules: async () => {
        await call('dnr.getSessionRules');
        return conf.sessionRules;
      },
    },
    windows: {
      createPopup: async (box: unknown) => {
        await call('windows.createPopup', box);
        return { windowId: conf.windowId, tabId: conf.tabId };
      },
      update: async (id: number, u: Partial<Box> & { state?: string; focused?: boolean }) => {
        await call('windows.update', id, u);
        if (u.width === undefined) return;
        if (conf.readsSinceUpdate < 0) conf.readsSinceUpdate = 0;
        if (conf.dropUpdates > 0) {
          conf.dropUpdates--;
          return;
        }
        if (conf.honourUpdates) {
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
      lastFocusedId: async () => {
        await call('windows.lastFocusedId');
        return conf.focused;
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
    badge: {
      set: (text: string, color: string | null) => call('badge.set', text, color),
    },
    focusEditor: () => call('editor.focus'),
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
vi.mock('../platform/action.ts', () => ({ badge: fx.badge }));
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
const ACCOUNT = { handle: 'testuser', detectedAt: T0 - 86_400_000 };
/** env.random() is 0: every dwell is its minimum (ux.md §10). */
const DWELL = { entry: 700, insert: 1500, share: 2000 } as const;

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
  activation: { isActive: false, hasBeenActive: false },
  visibility: 'visible',
  account: { handle: 'testuser', candidates: 1 },
  entryFound: true,
  ...over,
});

const ARMED: AgentFact = {
  kind: 'entry',
  result: 'armed',
  fpUsed: false,
  storyIndex: 0,
  glyph: '0badc0de',
  menuCount: 2,
  trials: 0,
  plusTaps: 1,
  armedMs: 140,
};
const COMPOSED: AgentFact = {
  kind: 'compose',
  onComposer: true,
  drawn: true,
  landscape: false,
  controls: 1,
  variant: 'v1',
  fbAuto: false,
  settled: true,
  settleMs: 1600,
  canvas: { w: 1080, h: 1920 },
  imageScore: null,
};
/** Instagram's two write requests as the agent reports them (offsets from the Share click). */
const upload = (status: number, end = 1500): NetEntry => ({
  host: 'i',
  path: '/rupload_igphoto/fb_uploader_1760352000000',
  status,
  type: status === 0 ? '' : 'application/json',
  redirected: false,
  start: 100,
  end,
});
const publish = (status: number, end = 2500): NetEntry => ({
  host: 'www',
  path: '/api/v1/media/configure_to_story/',
  status,
  type: status === 0 ? '' : 'application/json; charset=utf-8',
  redirected: false,
  start: 1600,
  end,
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
const startMsg = (mode: 'post' | 'test' | 'shareTest' | 'check' = 'post', over: Record<string, unknown> = {}) => ({
  v: 1,
  type: 'handoff/start',
  exportId: mode === 'check' ? null : 'exp_1',
  mode,
  screen: SCREEN,
  browser: 'chromium',
  queue: false,
  ...over,
});
/** The agent command a sendMessage carried. */
const cmd = (over: Record<string, unknown>) => ({ v: 1, handoffId: HID, nonce: NONCE, ...over });

function memoryRecords() {
  const rows = new Map<string, HandoffRecord>();
  const store: RecordStore = {
    async put(r) {
      rows.set(r.id, structuredClone(r));
    },
    async patchOutcome(id: string, outcome: HandoffOutcome, result: RunResult, patch: Partial<HandoffRecord> = {}) {
      const r = rows.get(id);
      if (r) rows.set(id, { ...r, ...patch, outcome, result });
    },
    async mark(id: string, posted: boolean, at: number) {
      const r = rows.get(id);
      if (r?.outcome !== 'unknown') return false;
      const kind = posted ? ('posted' as const) : ('notPosted' as const);
      const result: RunResult = r.result
        ? { ...r.result, kind, at, markedBy: 'owner' }
        : { kind, alarms: [], at, markedBy: 'owner' };
      rows.set(id, { ...r, outcome: posted ? 'posted' : 'not-posted', result, markedBy: 'owner' });
      return true;
    },
  };
  return { rows, store };
}

interface Harness {
  runner: Runner;
  clock: ManualClock;
  records: ReturnType<typeof memoryRecords>;
  /** handoff/status messages the editor got. */
  statuses: Extract<BackgroundToEditor, { type: 'handoff/status' }>[];
  /** handoff/lane messages the editor got. */
  lanes: Extract<BackgroundToEditor, { type: 'handoff/lane' }>[];
  /** Drains the runner's queue. */
  settle(): Promise<void>;
  advance(ms: number): Promise<void>;
}

type E2eHooks = {
  resizeTimeoutMs(): Promise<number | undefined>;
  portraitShimOff(): Promise<boolean | 'home'>;
  dwellScale(): Promise<number | undefined>;
  budgetScale(): Promise<number | undefined>;
};
const hooks = (over: Partial<E2eHooks> = {}): E2eHooks => ({
  resizeTimeoutMs: async () => undefined,
  portraitShimOff: async () => false,
  dwellScale: async () => undefined,
  budgetScale: async () => undefined,
  ...over,
});

/** One service-worker lifetime: a runner over the shared fakeBrowser storage. */
async function boot(
  opts: {
    clock?: ManualClock;
    records?: ReturnType<typeof memoryRecords>;
    keepAlive?: () => void;
    brands?: string[];
    e2e?: E2eHooks;
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
      badge,
      focusEditor: fx.focusEditor,
    },
    {
      guarded: opts.guarded ?? true,
      runtimeId: RUNTIME_ID,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36',
      uuid: () => `u${++n}`,
      random: () => 0,
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
  const statuses: Harness['statuses'] = [];
  const lanes: Harness['lanes'] = [];
  runner.connectEditor((m) => {
    if (m.type === 'handoff/status') statuses.push(m);
    else lanes.push(m);
  });
  await runner.ready();
  await runner.settled();
  statuses.length = 0;
  lanes.length = 0;
  const settle = () => runner.settled();
  return { runner, clock, records, statuses, lanes, settle, advance: (ms) => clock.advance(ms, settle) };
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
/** The agent commands since the last mark. */
const commands = () =>
  since()
    .filter((c) => c.fn === 'tabs.sendMessage')
    .map((c) => c.args[1]);

async function storedState() {
  return await session.get('handoff');
}

const fact = (h: Harness, f: AgentFact, url = COMPOSER_URL) =>
  h.runner.agentMessage(agentMsg('agent/fact', { fact: f }), agentSender({ url }));

/** Drives a hand-off until the hard reload was issued (state `reloading`). */
async function toReloading(h: Harness, start: Record<string, unknown> = startMsg()): Promise<void> {
  await h.runner.editorMessage(start);
  await h.settle();
  await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
  await h.settle();
}

/** The reload's commit and complete (msite redirects /create/story home without a pick): the probe goes out. */
async function toProbing(h: Harness, start?: Record<string, unknown>): Promise<void> {
  await toReloading(h, start);
  await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: HOME });
  await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: HOME });
  await h.settle();
}

/** The probe passes and the account is the expected one: the dwell before + → Story runs. */
async function toEntry(h: Harness, probe = goodProbe(), start?: Record<string, unknown>): Promise<void> {
  await toProbing(h, start);
  await h.runner.agentMessage(agentMsg('agent/report', { probe }), agentSender({ url: HOME }));
  await h.settle();
  expect(h.runner.state()).toMatchObject({ phase: 'openingEntry', sub: 'dwell' });
}

/** + → Story armed the story input: the dwell before the insert runs. */
async function toInserting(h: Harness, probe?: ProbeReport, start?: Record<string, unknown>): Promise<void> {
  await toEntry(h, probe, start);
  await h.advance(DWELL.entry);
  await fact(h, ARMED, HOME);
  await h.settle();
  expect(h.runner.state()).toMatchObject({ phase: 'inserting', sub: 'dwell' });
}

/** The insert, Instagram's SPA navigation to the composer, the compose facts: the dwell before Share. */
async function toComposeReady(
  h: Harness,
  probe?: ProbeReport,
  start?: Record<string, unknown>,
  phase = start?.mode === 'test' ? 'closing' : 'composeReady',
): Promise<void> {
  await toInserting(h, probe, start);
  await h.advance(DWELL.insert);
  await h.runner.agentMessage(agentMsg('agent/get-file'), agentSender({ url: HOME }));
  await fact(h, { kind: 'inserted' }, HOME);
  // The same document (AM16): the shim installed on the first one finds itself there.
  fx.conf.agentFresh = false;
  fx.conf.orientation = { type: 'portrait-primary', shim: 'present' };
  await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
  await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: COMPOSER_URL });
  await h.settle();
  await fact(h, COMPOSED);
  await h.settle();
  // A Test passes here and closes; every other mode waits to Share.
  expect(h.runner.state()).toMatchObject({ phase });
}

/** Share was sent and the agent tapped it: the outcome rules run. */
async function toConfirming(h: Harness, probe?: ProbeReport, start?: Record<string, unknown>): Promise<void> {
  await toComposeReady(h, probe, start);
  await h.advance(DWELL.share);
  expect(h.runner.state().phase).toBe('sharing');
  await fact(h, { kind: 'share-done', t0Wall: T0 });
  await h.settle();
  expect(h.runner.state().phase).toBe('confirmingUpload');
}

beforeEach(async () => {
  fx.reset();
  mark = 0;
  sleeps = 0;
  fx.conf.exports.set('exp_1', { bytes: PNG, mime: 'image/png' });
  // The account instapost learned on an earlier run (ux.md §4.8): no prompt unless a test removes it.
  await local.set('expectedAccount', ACCOUNT);
});

// ---------------------------------------------------------------------------------------

describe('U11 happy path: effect order (the autopilot, a live build)', () => {
  it('runs every effect in the reducer’s order, through to Posted and the cleanup', async () => {
    const h = await boot({ guarded: false });
    const { runner } = h;
    const TAB = fx.conf.tabId;
    const WIN = fx.conf.windowId;
    fx.conf.focused = WIN; // the owner watches the Instagram window when it closes

    // start → popup at about:blank → rules → measure → fit → navigate
    await runner.editorMessage(startMsg());
    await h.settle();
    const opening = since();
    expect(names(opening)).toEqual([
      'windows.createPopup',
      'badge.set',
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
    expect(opening[1]?.args).toEqual(['…', '#4a6fd1']);
    // ux.md §4.6: docked at the right edge of the available area, at its top.
    expect(opening[7]?.args).toEqual([WIN, { state: 'normal', left: 1001, top: 33, width: 511, height: 941 }]);
    // Rule 1001 only for a post (no write-block rules): installed while the tab is still about:blank.
    const install = opening[2]?.args[0] as { removeRuleIds: number[]; addRules: { id: number }[] };
    expect(install.removeRuleIds).toEqual(SESSION_IDS);
    expect(install.addRules.map((r) => r.id)).toEqual([1001]);
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
    // The reload's own commit (msite redirects home), then `complete` → shim, agent and probe.
    await runner.tabUpdated(TAB, { status: 'loading', url: HOME });
    await runner.tabUpdated(TAB, { status: 'complete', url: HOME });
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
    expect(probing[2]?.args).toEqual([TAB, cmd({ type: 'agent/probe' })]);

    // The report: the account is the expected one, so nothing waits on the owner; the entry dwell runs.
    const probe = goodProbe({ marker: false });
    expect(await runner.agentMessage(agentMsg('agent/report', { probe }), agentSender({ url: HOME }))).toEqual({
      ok: true,
    });
    await h.settle();
    expect(since()).toEqual([]);
    expect(runner.state()).toMatchObject({ phase: 'openingEntry', sub: 'dwell' });

    // + → Story after the dwell, with the stored menu fingerprint (none yet).
    await h.advance(DWELL.entry - 1);
    expect(since()).toEqual([]);
    await h.advance(1);
    expect(commands()).toEqual([cmd({ type: 'agent/drive', step: 'open-entry', fingerprint: null })]);
    expect(await fact(h, ARMED, HOME)).toEqual({ ok: true });
    await h.settle();
    // The menu the agent learned is stored for the next run.
    expect(await local.get('menuFingerprint')).toEqual({
      count: 2,
      storyIndex: 0,
      glyph: '0badc0de',
      savedAt: T0 + DWELL.entry,
    });

    // The insert after its dwell; get-file → the export's bytes, once.
    await h.advance(DWELL.insert);
    expect(commands()).toEqual([cmd({ type: 'agent/drive', step: 'insert' })]);
    const reply = (await runner.agentMessage(agentMsg('agent/get-file'), agentSender({ url: HOME }))) as GetFileReply;
    expect(reply).toMatchObject({ ok: true, name: 'story.png', mime: 'image/png' });
    if (!reply.ok) throw new Error('unreachable');
    expect(Array.from(b64ToBytes(reply.b64))).toEqual(Array.from(PNG));
    expect(await runner.agentMessage(agentMsg('agent/get-file'), agentSender({ url: HOME }))).toEqual({ ok: false });
    await fact(h, { kind: 'inserted' }, HOME);
    await h.settle();
    expect(commands()).toEqual([cmd({ type: 'agent/drive', step: 'compose', sample: null })]);

    // Instagram's SPA navigation to the composer: the same document (AM16), the shim and agent find themselves.
    fx.conf.agentFresh = false;
    fx.conf.orientation = { type: 'portrait-primary', shim: 'present' };
    await runner.tabUpdated(TAB, { status: 'loading', url: COMPOSER_URL });
    await runner.tabUpdated(TAB, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    expect(names(since())).toEqual(['scripting.injectPortraitShim', 'scripting.injectComposerAgent']);

    // The composer drew the photo and one Share control settled: one C8 probe (AM13), then the Share dwell.
    await fact(h, COMPOSED);
    await h.settle();
    expect(commands()).toEqual([cmd({ type: 'agent/probe' })]);
    expect(runner.state()).toMatchObject({ phase: 'composeReady', sub: 'dwell' });
    const ready = goodProbe({ marker: false, canvas: { w: 1080, h: 1920, css: { x: 0, y: 0, w: 511, h: 908 } } });
    expect(await runner.agentMessage(agentMsg('agent/report', { probe: ready }), agentSender())).toEqual({ ok: true });

    // Share, once.
    await h.advance(DWELL.share);
    expect(commands()).toEqual([cmd({ type: 'agent/drive', step: 'share' })]);
    expect(runner.state()).toMatchObject({ phase: 'sharing', shareSent: true });
    await fact(h, { kind: 'share-done', t0Wall: T0 + 4200 });
    await h.settle();
    expect(runner.state().phase).toBe('confirmingUpload');

    // Instagram's upload and publish: O1 → Posted; the record, the badge and lastResult.
    await fact(h, { kind: 'net', entries: [upload(200), publish(200)], elapsedMs: 2600 });
    await h.settle();
    expect(runner.state().phase).toBe('finished');
    expect(names(since())).toEqual(['badge.set']);
    const rec = h.records.rows.get(HID);
    expect(rec).toMatchObject({
      outcome: 'posted',
      mode: 'post',
      result: { kind: 'posted' },
      readyProbe: ready,
      account: { detected: 'testuser', expected: 'testuser', decision: 'ok', confirmedBy: 'match' },
      entry: { result: 'armed', storyIndex: 0 },
      compose: { controls: 1, variant: 'v1' },
      evidence: { sharedBy: 'autopilot', net: [expect.objectContaining({ status: 200 }), expect.anything()] },
      preflight: { C8: { inner: ready.inner, dpr: ready.dpr, canvas: ready.canvas } },
    });
    expect(Object.keys(rec?.steps ?? {})).toEqual(
      expect.arrayContaining(['opened', 'instagram', 'account', 'armed', 'composer', 'share', 'confirmed']),
    );
    expect(await local.get('lastResult')).toMatchObject({ handoffId: HID, mode: 'post', result: { kind: 'posted' } });

    // Instagram goes home after the post: the window closes 2 s later (its own toast shows).
    await runner.tabUpdated(TAB, { status: undefined, url: HOME });
    await h.settle();
    await h.advance(HOME_CLOSE_MS - 1);
    expect(since()).toEqual([]);
    await h.advance(1);
    // §4.6: the editor is refocused first (the owner was watching the popup), then the popup closes.
    expect(names(since())).toEqual(['windows.lastFocusedId', 'editor.focus', 'windows.remove']);
    expect(runner.state().phase).toBe('closing');
    await runner.dispatch({ type: 'windowRemoved', windowId: WIN });
    await h.settle();
    const cleanup = since();
    expect(names(cleanup)).toEqual(['dnr.updateSessionRules']);
    expect(cleanup[0]?.args[0]).toEqual({ removeRuleIds: SESSION_IDS });
    expect(runner.state()).toMatchObject({
      phase: 'idle',
      last: { handoffId: HID, outcome: 'posted', result: { kind: 'posted' } },
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
      'openingEntry',
      'inserting',
      'composeReady',
      'sharing',
      'confirmingUpload',
      'finished',
      'closing',
      'idle',
    ]);
    expect(h.statuses.find((s) => s.phase === 'finished')).toMatchObject({ result: { kind: 'posted' } });
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

  it('Share once: the state saying shareSent is stored before the Share command leaves', async () => {
    const h = await boot({ guarded: false });
    await toComposeReady(h, goodProbe({ marker: false }));
    const stored: unknown[] = [];
    const orig = fx.tabs.sendMessage;
    fx.tabs.sendMessage = async (id, msg) => {
      if ((msg as { step?: string }).step === 'share') stored.push(await storedState());
      return orig(id, msg);
    };
    try {
      await h.advance(DWELL.share);
    } finally {
      fx.tabs.sendMessage = orig;
    }
    expect(stored).toEqual([expect.objectContaining({ phase: 'sharing', shareSent: true })]);
  });

  it('a guarded build blocks Instagram’s writes for a post too: a blocked upload is a Share test', async () => {
    const h = await boot();
    await toConfirming(h);
    await fact(h, { kind: 'net', entries: [upload(0, 500)], elapsedMs: 600 });
    await h.settle();
    // O9: the upload settles 3 s after it ended (the next confirm tick decides).
    await h.advance(4000);
    expect(h.runner.state()).toMatchObject({ phase: 'finished', result: { kind: 'shareTested' } });
  });

  it('a guarded build: a 2xx upload is TEST_LEAK, killed and locked', async () => {
    const h = await boot();
    await toConfirming(h);
    await fact(h, { kind: 'net', entries: [upload(200)], elapsedMs: 1600 });
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'killed:TEST_LEAK' });
    expect(await local.get('msiteLock')).toBeGreaterThan(T0);
  });
});

describe('U11 the runs that block writes (ux.md §7)', () => {
  it('Test: the write-block rules go in with rule 1001, and the run passes at the composer, before Share', async () => {
    const h = await boot();
    await toComposeReady(h, goodProbe(), startMsg('test'));
    const install = fx.calls.find((c) => c.fn === 'dnr.updateSessionRules')?.args[0] as { addRules: { id: number }[] };
    expect(install.addRules.map((r) => r.id)).toEqual([
      1001,
      ...WRITE_URL_FILTERS.map((_, i) => REHEARSAL_FIRST_ID + i),
    ]);
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'tested' });
    expect(await local.get('lastTestPassAt')).toBe(T0 + DWELL.entry + DWELL.insert);
    // probe, open-entry, insert, compose: never Share.
    const sent = fx.calls.filter((c) => c.fn === 'tabs.sendMessage').map((c) => c.args[1] as { type: string });
    expect(sent.map((m) => (m as { step?: string }).step ?? m.type)).toEqual([
      'agent/probe',
      'open-entry',
      'insert',
      'compose',
    ]);
  });

  it('Share test: verifies its write-block rules on the composer tab before Share', async () => {
    fx.conf.sessionRules = WRITE_URL_FILTERS.map((_, i) => ({
      id: REHEARSAL_FIRST_ID + i,
      condition: { tabIds: [fx.conf.tabId] },
    }));
    const h = await boot();
    await toComposeReady(h, goodProbe(), startMsg('shareTest'));
    await h.settle();
    expect(names(fx.calls)).toContain('dnr.getSessionRules');
    await h.advance(DWELL.share);
    expect(h.runner.state()).toMatchObject({ phase: 'sharing' });
  });

  it('Share test: rules that do not name the composer tab end the run before Share', async () => {
    fx.conf.sessionRules = [{ id: REHEARSAL_FIRST_ID, condition: { tabIds: [1] } }];
    const h = await boot();
    await toComposeReady(h, goodProbe(), startMsg('shareTest'), 'closing');
    await h.advance(DWELL.share);
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:AGENT_UNREACHABLE' });
    expect(commands().some((m) => (m as { step?: string }).step === 'share')).toBe(false);
  });

  it('testRulesInstalled: every write-block id, each naming the tab', () => {
    const all = WRITE_URL_FILTERS.map((_, i) => ({ id: REHEARSAL_FIRST_ID + i, condition: { tabIds: [5] } }));
    expect(testRulesInstalled(all, 5)).toBe(true);
    expect(testRulesInstalled(all, 6)).toBe(false);
    expect(testRulesInstalled(all.slice(1), 5)).toBe(false);
  });

  it('Check connection: no file, no tap; closes as soon as the account is read, and learns it', async () => {
    await local.remove('expectedAccount');
    const h = await boot();
    await toProbing(h, startMsg('check'));
    since();
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME }));
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'checked' });
    expect(commands()).toEqual([]);
    expect(await local.get('expectedAccount')).toEqual({ handle: 'testuser', detectedAt: T0 });
  });
});

describe('U11 the account (ux.md §4.8) and the editor requests', () => {
  it('a first post asks: nothing is tapped until the owner answers; Continue learns the account', async () => {
    await local.remove('expectedAccount');
    const h = await boot();
    await toProbing(h);
    since();
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME }));
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'awaitingAccount', prompt: 'first' });
    expect(h.statuses.at(-1)).toMatchObject({
      phase: 'awaitingAccount',
      accountPrompt: { kind: 'first', detected: 'testuser', expected: null },
    });
    await h.advance(30_000);
    expect(commands()).toEqual([]);
    // A reconnecting editor gets the prompt as it is.
    const got: BackgroundToEditor[] = [];
    h.runner.connectEditor((m) => got.push(m));
    await h.settle();
    expect(got[0]).toMatchObject({
      type: 'handoff/status',
      phase: 'awaitingAccount',
      accountPrompt: { kind: 'first' },
    });
    // An answer for another hand-off changes nothing.
    await h.runner.editorMessage({ v: 1, type: 'handoff/account-choice', handoffId: 'hof_other', proceed: true });
    await h.settle();
    expect(h.runner.state().phase).toBe('awaitingAccount');
    await h.runner.editorMessage({ v: 1, type: 'handoff/account-choice', handoffId: HID, proceed: true });
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'openingEntry', account: { confirmedBy: 'owner' } });
    expect(await local.get('expectedAccount')).toEqual({ handle: 'testuser', detectedAt: T0 + 30_000 });
  });

  it('No: the run stops and nothing was tapped', async () => {
    await local.set('expectedAccount', { handle: 'someone', detectedAt: T0 - 1 });
    const h = await boot();
    await toProbing(h);
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME }));
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'awaitingAccount', prompt: 'mismatch' });
    await h.runner.editorMessage({ v: 1, type: 'handoff/account-choice', handoffId: HID, proceed: false });
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'cancelled' });
    expect(fx.calls.filter((c) => c.fn === 'tabs.sendMessage')).toHaveLength(1); // the probe only
  });

  it('no answer within a minute is ACCOUNT_UNCONFIRMED (the pre-Share cap is paused meanwhile)', async () => {
    await local.set('expectedAccount', { handle: 'someone', detectedAt: T0 - 1 });
    const h = await boot();
    await toProbing(h);
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME }));
    await h.settle();
    expect(await session.get('timers')).toEqual({ accountPrompt: T0 + 60_000 });
    await h.advance(60_000);
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:ACCOUNT_UNCONFIRMED' });
  });

  it('ui/open-instagram opens Instagram’s own pages in a normal tab; a bad handle is dropped', async () => {
    const h = await boot();
    await h.runner.editorMessage({ v: 1, type: 'ui/open-instagram', page: 'home' });
    await h.runner.editorMessage({ v: 1, type: 'ui/open-instagram', page: 'story', handle: 'testuser' });
    await h.runner.editorMessage({ v: 1, type: 'ui/open-instagram', page: 'story', handle: '../evil' });
    await h.settle();
    expect(since().map((c) => [c.fn, ...c.args])).toEqual([
      ['tabs.create', 'https://www.instagram.com/'],
      ['tabs.create', 'https://www.instagram.com/stories/testuser/'],
    ]);
    expect(instagramUrl('story')).toBeNull();
  });

  it('AP-4: a check that found another account offers Use @it; only that check’s own handle is taken', async () => {
    await local.set('expectedAccount', { handle: 'someone', detectedAt: T0 - 1 });
    const h = await boot();
    await toProbing(h, startMsg('check'));
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME }));
    await h.settle();
    expect(await local.get('lastResult')).toMatchObject({
      handoffId: HID,
      result: { kind: 'checked', account: 'testuser', lockedTo: 'someone' },
    });
    // Nothing learned by the check itself.
    expect(await local.get('expectedAccount')).toEqual({ handle: 'someone', detectedAt: T0 - 1 });
    // Another run's id: dropped.
    await h.runner.editorMessage({ v: 1, type: 'ui/use-account', handoffId: 'hof_other' });
    await h.settle();
    expect(await local.get('expectedAccount')).toEqual({ handle: 'someone', detectedAt: T0 - 1 });
    await h.runner.editorMessage({ v: 1, type: 'ui/use-account', handoffId: HID });
    await h.settle();
    expect(await local.get('expectedAccount')).toMatchObject({ handle: 'testuser' });
  });

  it('ui/forget-account forgets the learned account', async () => {
    const h = await boot();
    await h.runner.editorMessage({ v: 1, type: 'ui/forget-account' });
    await h.settle();
    expect(await local.get('expectedAccount')).toBeUndefined();
  });

  it('ui/result-seen clears the badge of the last result only, once the run is over', async () => {
    const h = await boot();
    await toEntry(h);
    await h.advance(DWELL.entry);
    await fact(h, { ...ARMED, result: 'MENU_DRIFT', menuCount: 3 } as AgentFact, HOME);
    await h.settle();
    expect(
      since()
        .filter((c) => c.fn === 'badge.set')
        .map((c) => c.args[0]),
    ).toEqual(['…', '!']);
    // Still running (Finish by hand is offered): the badge stays.
    await h.runner.editorMessage({ v: 1, type: 'ui/result-seen', handoffId: HID });
    await h.settle();
    expect(since()).toEqual([]);
    // Done, and the window is gone.
    await h.runner.editorMessage({ v: 1, type: 'handoff/cancel' });
    await h.runner.dispatch({ type: 'windowRemoved', windowId: fx.conf.windowId });
    await h.settle();
    since();
    await h.runner.editorMessage({ v: 1, type: 'ui/result-seen', handoffId: 'hof_other' });
    await h.settle();
    expect(since()).toEqual([]);
    await h.runner.editorMessage({ v: 1, type: 'ui/result-seen', handoffId: HID });
    await h.runner.editorMessage({ v: 1, type: 'ui/result-seen', handoffId: HID });
    await h.settle();
    expect(since().map((c) => [c.fn, ...c.args])).toEqual([['badge.set', '', null]]);
  });

  it('History’s mark applies to a Couldn’t confirm record and its lastResult only', async () => {
    const h = await boot({ guarded: false });
    await toConfirming(h, goodProbe({ marker: false }));
    // The publish answered 5xx: Couldn't confirm (O3).
    await fact(h, { kind: 'net', entries: [upload(200), publish(503)], elapsedMs: 2600 });
    await h.settle();
    expect(h.records.rows.get(HID)?.outcome).toBe('unknown');
    await h.runner.editorMessage({ v: 1, type: 'handoff/mark', handoffId: HID, posted: true });
    await h.settle();
    expect(h.records.rows.get(HID)?.outcome).toBe('posted');
    // AP-3: lastResult says it is the owner's mark, so no editor renders it as Instagram's confirmation.
    expect(await local.get('lastResult')).toMatchObject({
      handoffId: HID,
      result: { kind: 'posted', markedBy: 'owner' },
    });
    // A second mark finds no Couldn't confirm record: nothing changes.
    await h.runner.editorMessage({ v: 1, type: 'handoff/mark', handoffId: HID, posted: false });
    await h.settle();
    expect(h.records.rows.get(HID)?.outcome).toBe('posted');
  });

  it('Finish by hand: offered after a step before Share failed; the agent then only observes', async () => {
    const h = await boot();
    await toEntry(h);
    await h.advance(DWELL.entry);
    await fact(h, { ...ARMED, result: 'MENU_DRIFT', menuCount: 3 } as AgentFact, HOME);
    await h.settle();
    expect(h.runner.state()).toMatchObject({
      phase: 'finished',
      hold: 'offerManual',
      result: { kind: 'notPosted', code: 'STORY_ENTRY_MISSING' },
    });
    since();
    await h.runner.editorMessage({ v: 1, type: 'handoff/manual', handoffId: HID });
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'manual', needs: 'pick' });
    const calls = since();
    expect(names(calls)).toEqual(['windows.update', 'tabs.sendMessage']);
    expect(calls[0]?.args).toEqual([fx.conf.windowId, { focused: true }]);
    expect(calls[1]?.args[1]).toEqual(cmd({ type: 'agent/observe', from: 'manual' }));
  });

  it('E41 (moved here): a page hidden at the probe raises the window once (focus only), then + → Story goes on', async () => {
    const h = await boot();
    await toProbing(h);
    since();
    await h.runner.agentMessage(
      agentMsg('agent/report', { probe: goodProbe({ visibility: 'hidden' }) }),
      agentSender({ url: HOME }),
    );
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'openingEntry', raisedForVisibility: true, hidden: true });
    const raised = since().filter((c) => c.fn === 'windows.update');
    expect(raised.map((c) => c.args)).toEqual([[fx.conf.windowId, { focused: true }]]);
    // Visible again before the dwell ends: the autopilot carries on, and is not raised twice.
    await fact(h, { kind: 'visibility', hidden: false }, HOME);
    await h.advance(DWELL.entry);
    const later = since();
    expect(later.filter((c) => c.fn === 'windows.update')).toEqual([]);
    expect(later.some((c) => c.fn === 'tabs.sendMessage')).toBe(true);
    expect(h.runner.state()).toMatchObject({ phase: 'openingEntry', sub: 'sent' });
  });

  it('Finish by hand that nobody asks for closes the window after a minute', async () => {
    const h = await boot();
    await toEntry(h);
    await h.advance(DWELL.entry);
    await fact(h, { ...ARMED, result: 'ENTRY_MISSING' } as AgentFact, HOME);
    await h.settle();
    since();
    await h.advance(OFFER_MANUAL_MS);
    expect(names(since())).toContain('windows.remove');
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:STORY_ENTRY_MISSING' });
  });
});

describe('U11 the lane (ux.md §8)', () => {
  it('is pushed on connect and after every phase change', async () => {
    const h = await boot();
    const got: BackgroundToEditor[] = [];
    h.runner.connectEditor((m) => got.push(m));
    await h.settle();
    expect(got.map((m) => m.type)).toEqual(['handoff/status', 'handoff/lane']);
    expect(got[1]).toMatchObject({ kind: 'ready' });
    await h.runner.editorMessage(startMsg());
    await h.settle();
    expect(h.lanes.at(-1)).toMatchObject({ kind: 'busy', handoffId: HID });
    await h.runner.editorMessage({ v: 1, type: 'handoff/cancel' });
    await h.runner.dispatch({ type: 'windowRemoved', windowId: fx.conf.windowId });
    await h.settle();
    expect(h.lanes.at(-1)).toMatchObject({ kind: 'spacing', freeAt: T0 + 60_000 });
  });

  it('K11: a post blocked only by the 60 s spacing waits in the queue and starts by itself', async () => {
    const h = await boot();
    await h.runner.editorMessage(startMsg('check'));
    await h.settle();
    await h.runner.dispatch({ type: 'windowRemoved', windowId: fx.conf.windowId });
    await h.advance(20_000);
    since();
    await h.runner.editorMessage(startMsg('post', { queue: true }));
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'queued', startAt: T0 + 60_000 });
    expect(names(since())).toEqual(['badge.set']);
    expect(h.lanes.at(-1)).toMatchObject({ kind: 'queued', freeAt: T0 + 60_000 });
    await h.advance(40_000);
    expect(names(since())[0]).toBe('windows.createPopup');
    expect(h.runner.state().phase).toBe('navigating');
  });

  it('a queued post can be stopped', async () => {
    const h = await boot();
    await h.runner.editorMessage(startMsg('check'));
    await h.settle();
    await h.runner.dispatch({ type: 'windowRemoved', windowId: fx.conf.windowId });
    await h.runner.editorMessage(startMsg('post', { queue: true }));
    await h.settle();
    await h.runner.editorMessage({ v: 1, type: 'handoff/cancel' });
    await h.settle();
    expect(h.runner.state().phase).toBe('idle');
    since();
    await h.advance(60_000);
    expect(names(since())).not.toContain('windows.createPopup');
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
    await second.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: HOME });
    await second.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: HOME });
    await second.settle();
    const calls = since();
    expect(names(calls)).toEqual(['scripting.injectPortraitShim', 'scripting.injectComposerAgent', 'tabs.sendMessage']);
    expect(calls[2]?.args[1]).toEqual(cmd({ type: 'agent/probe' }));
    // No second hard reload after the restart.
    expect(names(fx.calls).filter((n) => n === 'tabs.hardReload')).toHaveLength(1);
    // The agent's messages are accepted by the new instance.
    expect(
      await second.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME })),
    ).toEqual({ ok: true });
    await second.settle();
    expect(second.runner.state().phase).toBe('openingEntry');
  });

  it('re-arms the persisted timers and fires them on schedule (the reload budget)', async () => {
    const first = await boot();
    await toReloading(first);
    expect(await session.get('timers')).toEqual({
      preShareCap: T0 + PRE_SHARE_CAP_MS,
      stepDeadline: T0 + RELOAD_BUDGET_MS,
    });
    first.clock.kill();
    since();

    const second = await boot({ clock: manualClock(T0 + 10_000) });
    await second.advance(RELOAD_BUDGET_MS - 10_000 - 1);
    expect(since()).toEqual([]);
    await second.advance(1);
    expect(names(since())).toEqual(['windows.lastFocusedId', 'windows.remove', 'badge.set']);
    expect(second.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:TIMEOUT' });
  });

  it('fires a timer that fell due while the worker was stopped, before any other event', async () => {
    const first = await boot({ guarded: false });
    await toConfirming(first, goodProbe({ marker: false }));
    await fact(first, { kind: 'net', entries: [upload(200), publish(200)], elapsedMs: 2600 });
    await first.settle();
    expect(first.runner.state().phase).toBe('finished');
    const closeAt = (await session.get('timers'))?.closeDelay;
    expect(closeAt).toBe(first.clock.now() + POSTED_CLOSE_MS);
    first.clock.kill();
    since();

    // Ten seconds later the worker wakes for an unrelated tab update.
    const second = await boot({ clock: manualClock((closeAt ?? 0) + 2000), guarded: false });
    expect(names(since())).toEqual(['windows.lastFocusedId', 'windows.remove']);
    expect(second.runner.state().phase).toBe('closing');
  });

  it('a session found without timers gets its phase’s backstop: an unanswered Share is Couldn’t confirm, held', async () => {
    const first = await boot();
    await toComposeReady(first);
    await first.advance(DWELL.share);
    expect(first.runner.state().phase).toBe('sharing');
    // The worker stopped after persisting the state, before its timers were stored.
    await session.set('timers', {});
    first.clock.kill();
    since();
    const second = await boot({ clock: manualClock(first.clock.now() + 1000) });
    await second.advance(0);
    expect(second.runner.state()).toMatchObject({
      phase: 'finished',
      hold: 'upload',
      result: { kind: 'unknown', why: 'share-not-acknowledged', held: true },
    });
    expect(names(since())).not.toContain('tabs.sendMessage'); // never a second Share
  });

  it('backstopFor: by phase, the timer whose expiry decides what that phase would', () => {
    const at = (phase: string, extra: Record<string, unknown> = {}) =>
      ({ phase, ...extra }) as unknown as Parameters<typeof backstopFor>[0];
    expect(backstopFor(at('queued', { startAt: T0 + 5000 }), T0)).toEqual(['queue', 5000]);
    expect(backstopFor(at('closing'), T0)).toEqual(['stepDeadline', 0]);
    expect(backstopFor(at('finished', { hold: 'upload' }), T0)).toEqual(['uploadHold', 0]);
    expect(backstopFor(at('finished', { hold: 'offerManual' }), T0)).toEqual(['offerManual', 0]);
    expect(backstopFor(at('finished', { hold: 'none' }), T0)).toEqual(['closeDelay', 0]);
    expect(backstopFor(at('sharing'), T0)).toEqual(['shareAck', 0]);
    expect(backstopFor(at('confirmingUpload'), T0)).toEqual(['confirmTick', 0]);
    expect(backstopFor(at('manual', { until: T0 + 9000 }), T0)).toEqual(['manualDeadline', 9000]);
    expect(backstopFor(at('probing', { preShareUntil: T0 + 7000 }), T0)).toEqual(['preShareCap', 7000]);
  });
});

describe('U11 after Share (ux.md §6)', () => {
  it('no answer to Share within SHARE_ACK_MS: Couldn’t confirm, the window held while an upload may run', async () => {
    const h = await boot();
    await toComposeReady(h);
    await h.advance(DWELL.share);
    since();
    await h.advance(SHARE_ACK_MS);
    expect(h.runner.state()).toMatchObject({ phase: 'finished', hold: 'upload', result: { kind: 'unknown' } });
    expect(names(since())).not.toContain('windows.remove');
    // Stop does nothing after Share; Done (cancel while finished) closes the window.
    expect(h.statuses.at(-1)).toMatchObject({ canStop: false, held: 'upload' });
    await h.runner.editorMessage({ v: 1, type: 'handoff/cancel' });
    await h.settle();
    expect(names(since())).toContain('windows.remove');
  });

  it('a held Couldn’t confirm closes after the hold; the window closed by the owner keeps the result', async () => {
    const h = await boot();
    await toComposeReady(h);
    await h.advance(DWELL.share + SHARE_ACK_MS);
    since();
    await h.advance(UPLOAD_HOLD_MS);
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'unknown' });
  });

  it('a closed window after Share is Couldn’t confirm, never Not posted', async () => {
    const h = await boot();
    await toConfirming(h);
    await h.runner.dispatch({ type: 'windowRemoved', windowId: fx.conf.windowId });
    await h.settle();
    expect(h.runner.state()).toMatchObject({
      phase: 'idle',
      last: { outcome: 'unknown', result: { kind: 'unknown', why: 'window-closed' } },
    });
    expect(h.records.rows.get(HID)?.outcome).toBe('unknown');
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
    // The window lane alone: the in-page lane (src/inpage/background.ts) has its own tests (U36).
    const runner = startBackground(
      production ? createBackgroundRunner(quietLog) : (await boot()).runner,
      quietLog,
      () => null,
    );
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

  /** A stand-in for the in-page lane (src/inpage/background.ts has its own tests): busy or not, and its calls. */
  function inpageLane(busy: { value: boolean }, how: 'toggled' | 'editor' | 'reload' = 'editor') {
    const calls: string[] = [];
    const lane: InpageLane = {
      driver: { busy: () => busy.value } as unknown as InpageDriver,
      agentMessage: () => null,
      actionClicked: async () => {
        calls.push('actionClicked');
        return how;
      },
      reinject: async () => {
        calls.push('reinject');
      },
    };
    return { lane, calls };
  }

  it('RS-1: while an in-page run holds the rules, an unrelated tab or window closing leaves them alone', async () => {
    const onConnect = stubEvent();
    (fakeBrowser.runtime as unknown as { onConnect: unknown }).onConnect = onConnect;
    const busy = { value: true };
    const { lane } = inpageLane(busy);
    const runner = startBackground((await boot()).runner, quietLog, () => lane);
    await runner.ready();
    await runner.settled();
    since();
    for (const l of fx.listeners.tabRemoved) l(456);
    for (const l of fx.listeners.windowRemoved) l(123);
    await fakeBrowser.runtime.onStartup.trigger();
    await runner.settled();
    expect(removed()).toEqual([]);
    // The in-page run ended (it removed its rules itself): the window lane's cleanup is back.
    busy.value = false;
    for (const l of fx.listeners.tabRemoved) l(456);
    await runner.settled();
    expect(removed()).toEqual([{ removeRuleIds: SESSION_IDS }]);
  });

  it('FX14: onInstalled (install, update) re-injects the in-page content script; other reasons do not', async () => {
    const onConnect = stubEvent();
    (fakeBrowser.runtime as unknown as { onConnect: unknown }).onConnect = onConnect;
    const { lane, calls } = inpageLane({ value: false });
    const runner = startBackground((await boot()).runner, quietLog, () => lane);
    await runner.ready();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'chrome_update' } as never);
    expect(calls).toEqual([]);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'update', previousVersion: '0.1.0' } as never);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' } as never);
    expect(calls).toEqual(['reinject', 'reinject']);
  });

  it('FX14: the toolbar on an Instagram tab without the content script opens the editor with the reload notice', async () => {
    const onConnect = stubEvent();
    (fakeBrowser.runtime as unknown as { onConnect: unknown }).onConnect = onConnect;
    const { lane } = inpageLane({ value: false }, 'reload');
    const runner = startBackground((await boot()).runner, quietLog, () => lane);
    await runner.ready();
    since();
    await fakeBrowser.action.onClicked.trigger({ id: 3, url: 'https://www.instagram.com/' } as never);
    await vi.waitFor(() => expect(names(since())).toContain('tabs.create'));
    expect(await session.get('editorNotice')).toBe('reloadInstagram');
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
    expect(runner.state()).toMatchObject({ phase: 'idle', last: { outcome: 'cancelled' } });
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

  it('accepts the hand-off port from extension pages only, and sends the current status and lane', async () => {
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
    expect(editor.posted[0]).toEqual({ v: 1, type: 'handoff/status', handoffId: null, phase: 'idle' });
    expect(editor.posted[1]).toMatchObject({ v: 1, type: 'handoff/lane', kind: 'ready' });

    for (const l of editor.onMessage.ls) l(startMsg());
    await runner.settled();
    expect(runner.state().phase).toBe('navigating');
    const statuses = editor.posted.filter((m) => (m as BackgroundToEditor).type === 'handoff/status');
    expect((statuses.at(-1) as { phase: string }).phase).toBe('navigating');
  });
});

describe('U11 agent messages are checked at processing time', () => {
  async function probing(): Promise<Harness> {
    const h = await boot();
    await toProbing(h);
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

  it('answers get-file with {ok:false} outside the insert (phase gate)', async () => {
    const h = await probing();
    expect(await h.runner.agentMessage(agentMsg('agent/get-file'), agentSender())).toEqual({ ok: false });
  });

  it('answers get-file with {ok:false} before the insert command (the dwell still runs)', async () => {
    const h = await boot();
    await toInserting(h);
    expect(await h.runner.agentMessage(agentMsg('agent/get-file'), agentSender())).toEqual({ ok: false });
  });

  it('a fact of the wrong phase is dropped (an entry fact while inserting)', async () => {
    const h = await boot();
    await toInserting(h);
    since();
    expect(await fact(h, ARMED, HOME)).toEqual({ ok: false });
    expect(await fact(h, { kind: 'share-done', t0Wall: T0 })).toEqual({ ok: false });
    await h.settle();
    expect(h.runner.state()).toMatchObject({ phase: 'inserting', sub: 'dwell' });
  });

  it('a missing export fails the insert (INJECTION_IGNORED) and offers Finish by hand in the same window', async () => {
    fx.conf.exports.clear();
    const h = await boot();
    await toInserting(h);
    await h.advance(DWELL.insert);
    since();
    expect(await h.runner.agentMessage(agentMsg('agent/get-file'), agentSender({ url: HOME }))).toEqual({ ok: false });
    await h.settle();
    expect(h.runner.state()).toMatchObject({
      phase: 'finished',
      hold: 'offerManual',
      result: { kind: 'notPosted', code: 'INJECTION_IGNORED' },
    });
    expect(names(fx.calls).filter((n) => n === 'windows.remove')).toEqual([]);
  });

  it('an agent that does not ack a command ends the session with AGENT_UNREACHABLE', async () => {
    fx.conf.agentAck = undefined;
    const h = await boot();
    await toProbing(h);
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
    // A kill never refocuses the editor: the window closes at once.
    expect(names(since())).toEqual(['windows.remove', 'badge.set']);
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
    expect(h.lanes.at(-1)).toMatchObject({ kind: 'paused' });
  });

  it('a second start within 60 s is RATE_LIMITED and opens no window (E14)', async () => {
    const h = await boot();
    await h.runner.editorMessage(startMsg('check'));
    await h.settle();
    await h.runner.dispatch({ type: 'windowRemoved', windowId: fx.conf.windowId });
    await h.advance(30_000);
    since();
    await h.runner.editorMessage(startMsg('check'));
    await h.settle();
    expect(since()).toEqual([]);
    expect(h.statuses.at(-1)).toMatchObject({ error: 'RATE_LIMITED', freeAt: T0 + 60_000 });
    await h.advance(30_000);
    await h.runner.editorMessage(startMsg('check'));
    await h.settle();
    expect(names(since())[0]).toBe('windows.createPopup');
    expect(await local.get('rateLog')).toEqual([T0, T0 + 60_000]);
  });

  it('a malformed editor message is dropped', async () => {
    const h = await boot();
    await h.runner.editorMessage({ v: 1, type: 'handoff/start', mode: 'post' });
    await h.runner.editorMessage({ ...startMsg(), rehearsal: true, queue: undefined });
    await h.settle();
    expect(since()).toEqual([]);
    expect(h.runner.state().phase).toBe('idle');
  });
});

describe('U11 AM25: Resume goes through the background queue', () => {
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
    expect(h.lanes.at(-1)).toMatchObject({ kind: 'ready' });
    // The next start is no longer refused.
    await h.runner.editorMessage(startMsg('check'));
    await h.settle();
    expect(names(since())[0]).toBe('windows.createPopup');
  });

  it('a lock from before AM25 in the settings object still refuses a start, and Resume clears it', async () => {
    const until = T0 + 86_400_000;
    await local.set('settings', { keepCopies: true, msiteLockedUntil: until } as Settings);
    const h = await boot();
    await h.runner.editorMessage(startMsg('check'));
    await h.settle();
    expect(h.statuses.at(-1)).toMatchObject({ error: 'MSITE_LOCKED', freeAt: until });
    await h.runner.editorMessage({ v: 1, type: 'handoff/enable-msite', lockedUntil: until });
    await h.settle();
    expect(await local.get('settings')).toMatchObject({ keepCopies: true, msiteLockedUntil: null });
  });

  it('localState.lockMsite and an editor settings write interleave without losing either', async () => {
    // The editor's write path (settings-state.ts) reads and writes `settings`; the background's
    // lock writes only `msiteLock`, so no ordering of the two loses the lock or the edit.
    const ls = localState(true);
    const until = T0 + 7 * 86_400_000;
    const editorRead = await local.get('settings');
    await ls.lockMsite(until);
    await local.set('settings', { ...(editorRead ?? ({} as Settings)), keepCopies: true } as Settings);
    expect((await ls.settings()).msiteLockedUntil).toBe(until);
    expect((await ls.settings()).keepCopies).toBe(true);
    // Never shortened.
    await ls.lockMsite(until - 1000);
    expect(await local.get('msiteLock')).toBe(until);
  });

  it('AP-12: the lock keeps why it was set: reasons join while it is in force, a lapsed one starts over', async () => {
    const ls = localState(true);
    const week = 7 * 86_400_000;
    await ls.lockMsite(T0 + week, 'TEST_LEAK', T0);
    expect(await local.get('msiteLockReasons')).toEqual(['TEST_LEAK']);
    // A kill while the leak's lock is still on: both reasons are said.
    await ls.lockMsite(T0 + 1000 + week, 'KILLED_CHALLENGE', T0 + 1000);
    expect(await local.get('msiteLockReasons')).toEqual(['KILLED_CHALLENGE', 'TEST_LEAK']);
    expect(await local.get('msiteLock')).toBe(T0 + 1000 + week);
    // Long after it lapsed (never resumed): only the new reason.
    const later = T0 + 3 * week;
    await ls.lockMsite(later + week, 'KILLED_OFFHOST', later);
    expect(await local.get('msiteLockReasons')).toEqual(['KILLED_OFFHOST']);
    // Resume clears the reasons with the lock.
    expect(await ls.clearMsiteLock(later + week)).toBe(true);
    expect(await local.get('msiteLockReasons')).toBeUndefined();
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
  it('forwards the agent sentinel: before any tap, a same-document load needs no probe; a new document is re-probed', async () => {
    const h = await boot();
    await toEntry(h);
    since();
    fx.conf.agentFresh = false;
    // Hydration's replaceState: Chrome reports loading, then complete.
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: `${HOME}?x=1` });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: `${HOME}?x=1` });
    await h.settle();
    expect(commands()).toEqual([]);
    expect(h.runner.state()).toMatchObject({ phase: 'openingEntry', sub: 'dwell' });
    // A full reload of the composer tab before + → Story: probed again (strictly), the account decided again.
    fx.conf.agentFresh = true;
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: HOME });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: HOME });
    await h.settle();
    expect(commands()).toEqual([cmd({ type: 'agent/probe' })]);
    expect(h.runner.state()).toMatchObject({ phase: 'probing', strict: true });
    // The dwell of the old document never drives anything.
    await h.advance(DWELL.entry);
    expect(commands()).toEqual([]);
  });

  it('a new document while the photo goes in fails the run (INJECTION_IGNORED), Finish by hand offered', async () => {
    const h = await boot();
    await toInserting(h);
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: HOME });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: HOME });
    await h.settle();
    expect(h.runner.state()).toMatchObject({
      phase: 'finished',
      hold: 'offerManual',
      result: { code: 'INJECTION_IGNORED', detail: 'page reloaded' },
    });
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
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME }));
    await h.settle();
    expect(h.runner.state().phase).toBe('openingEntry');
    // A new document (a full reload of the composer tab): the shim again, before the fresh agent.
    await h.runner.tabUpdated(TAB, { status: 'loading', url: HOME });
    await h.runner.tabUpdated(TAB, { status: 'complete', url: HOME });
    await h.settle();
    expect(injections()).toEqual([
      [SHIM, TAB, true],
      [AGENT, TAB],
    ]);
    // A same-document load (hydration's replaceState) re-injects both; the shim finds itself there.
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME }));
    fx.conf.agentFresh = false;
    fx.conf.orientation = { type: 'portrait-primary', shim: 'present' };
    await h.runner.tabUpdated(TAB, { status: 'loading', url: HOME });
    await h.runner.tabUpdated(TAB, { status: 'complete', url: HOME });
    await h.settle();
    expect(injections()).toEqual([
      [SHIM, TAB, true],
      [AGENT, TAB],
    ]);
    expect(h.runner.state()).toMatchObject({
      phase: 'openingEntry',
      pageOrientation: { type: 'portrait-primary', shim: 'present' },
    });
  });

  it('its reading is stamped on the agent’s report and shown to the editor', async () => {
    const h = await boot();
    fx.conf.orientation = { type: 'portrait-primary', shim: 'installed' };
    await toProbing(h);
    // An agent cannot forge the reading: whatever it sends there is dropped and replaced.
    const forged = { ...goodProbe(), orientation: { type: 'landscape-primary', shim: 'off' } };
    await h.runner.agentMessage(agentMsg('agent/report', { probe: forged }), agentSender({ url: HOME }));
    await h.settle();
    const probe = h.statuses.find((s) => s.probe)?.probe;
    expect(probe?.orientation).toEqual({ type: 'portrait-primary', shim: 'installed' });
  });

  it('a guarded build’s E2E flag makes it read only', async () => {
    const off = hooks({ portraitShimOff: vi.fn(async () => true) });
    const h = await boot({ e2e: off });
    await toProbing(h);
    expect(h.runner.state()).toMatchObject({ phase: 'probing' });
    expect(injections()).toEqual([
      [SHIM, fx.conf.tabId, false],
      [AGENT, fx.conf.tabId],
    ]);
    expect(off.portraitShimOff).toHaveBeenCalledTimes(1);
  });

  it('SH-1: the flag `home` makes it read only off the composer, so it installs first when the insert reached the composer', async () => {
    const late = hooks({ portraitShimOff: vi.fn(async () => 'home' as const) });
    const h = await boot({ e2e: late });
    const TAB = fx.conf.tabId;
    fx.conf.tabUrl = HOME;
    fx.conf.orientation = { type: 'landscape-primary', shim: 'off' };
    await toInserting(h);
    expect(injections()).toEqual([
      [SHIM, TAB, false],
      [AGENT, TAB],
    ]);
    await h.advance(DWELL.insert);
    await h.runner.agentMessage(agentMsg('agent/get-file'), agentSender({ url: HOME }));
    await fact(h, { kind: 'inserted' }, HOME);
    await h.settle();
    // The insert's SPA navigation: the shim installs only now, on the composer.
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
    const off = hooks({ portraitShimOff: vi.fn(async () => true) });
    const h = await boot({ guarded: false, e2e: off });
    await toProbing(h);
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
    await toInserting(h);
    await h.advance(DWELL.insert);
    await h.runner.agentMessage(agentMsg('agent/get-file'), agentSender({ url: HOME }));
    await fact(h, { kind: 'inserted' }, HOME);
    await h.settle();
    since();
    // The insert's SPA navigation to the composer (same document).
    fx.conf.agentFresh = false;
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'loading', url: COMPOSER_URL });
    await h.runner.tabUpdated(fx.conf.tabId, { status: 'complete', url: COMPOSER_URL });
    await h.settle();
    expect(names(since())).toEqual([SHIM, AGENT, 'windows.lastFocusedId', 'windows.remove', 'badge.set']);
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
    await toProbing(h);
    expect(names(fx.calls)).not.toContain(AGENT);
    expect(h.runner.state()).toMatchObject({ phase: 'closing', outcome: 'failed:AGENT_UNREACHABLE' });
    expect(h.records.rows.get(HID)?.detail).toMatch(/^injectAgent: scripting.injectPortraitShim failed/);
  });
});

describe('U11 an editor that connects mid-session gets the session as it is', () => {
  /** A second editor port (a reloaded editor page) connects; its first message. */
  async function reconnect(h: Harness): Promise<BackgroundToEditor | undefined> {
    const got: BackgroundToEditor[] = [];
    h.runner.connectEditor((m) => got.push(m));
    await h.settle();
    return got[0];
  }

  it('mid-run: the phase, the step and whether it can still be stopped', async () => {
    const h = await boot();
    await toInserting(h);
    expect(await reconnect(h)).toMatchObject({
      type: 'handoff/status',
      phase: 'inserting',
      step: 'story',
      canStop: true,
      account: { detected: 'testuser' },
      entry: { result: 'armed' },
    });
  });

  it('after Share: it can no longer be stopped, and the evidence so far is shown', async () => {
    const h = await boot();
    await toConfirming(h);
    await fact(h, { kind: 'net', entries: [upload(0, 300)], elapsedMs: 400 });
    await h.settle();
    expect(await reconnect(h)).toMatchObject({
      phase: 'confirmingUpload',
      step: 'confirm',
      canStop: false,
      shareSent: true,
      evidence: { sharedBy: 'autopilot', net: [expect.objectContaining({ host: 'i', status: 0 })] },
    });
  });

  it('finished on an unexpected page after Share: Couldn’t confirm, never Not posted (AM28)', async () => {
    const h = await boot();
    await toConfirming(h);
    await h.runner.tabUpdated(fx.conf.tabId, { status: undefined, url: 'https://www.instagram.com/consent/?flow=x' });
    await h.settle();
    expect(h.runner.state().phase).toBe('finished');
    expect(await reconnect(h)).toMatchObject({
      phase: 'finished',
      result: { kind: 'unknown', code: 'OUTCOME_UNKNOWN', why: 'unexpected-page' },
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
      preShareCap: T0 + PRE_SHARE_CAP_MS,
      navigation: T0 + NAVIGATION_TIMEOUT_MS,
    });
    first.clock.kill();
    since();

    const second = await boot({ clock: manualClock(T0 + 10_000), records: first.records });
    await second.advance(NAVIGATION_TIMEOUT_MS - 10_000 - 1);
    expect(since()).toEqual([]);
    await second.advance(1);
    expect(names(since())).toEqual(['windows.lastFocusedId', 'windows.remove', 'badge.set']);
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
  const updates = () =>
    fx.calls.filter((c) => c.fn === 'windows.update' && (c.args[1] as { width?: number }).width).map((c) => c.args[1]);
  /** 524x932 inner + 47 frame, docked at the ultrawide's right edge and top. */
  const BOX = { left: 4428, top: -428, width: 524, height: 979 };

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
    const measure = calls.slice(3, calls.indexOf('tabs.get'));
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
    expect(calls.slice(3, calls.indexOf('tabs.get')).length).toBe(11);
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
    await toProbing(h);
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
    await toProbing(h);
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
    startBackground(h.runner, { info: () => undefined, warn: () => undefined, error: () => undefined }, () => null);
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

  it('the poll reads the size every second; no usable size within the resize deadline → WINDOW_NOT_FITTED', async () => {
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
    const e2e = hooks({ resizeTimeoutMs: async () => 2000 });
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

describe('U11 E2E scales (guarded builds only)', () => {
  it('the dwell scale shortens the human-pace waits; a live runner never reads it', async () => {
    const e2e = hooks({ dwellScale: vi.fn(async () => 0.01) });
    const h = await boot({ e2e });
    await toProbing(h);
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME }));
    await h.settle();
    since();
    await h.advance(7); // 700 ms × 0.01
    expect(commands()).toEqual([cmd({ type: 'agent/drive', step: 'open-entry', fingerprint: null })]);

    fx.reset();
    const live = hooks({ dwellScale: vi.fn(async () => 0.01) });
    await boot({ guarded: false, e2e: live, clock: manualClock(T0 + 600_000) });
    expect(live.dwellScale).not.toHaveBeenCalled();
  });
});

describe('U11 timers keep the worker awake only while pending', () => {
  it('pings while a timer is pending and stops when none is', async () => {
    await local.remove('expectedAccount');
    const pings: number[] = [];
    const clock = manualClock();
    const h = await boot({ clock, keepAlive: () => pings.push(clock.now()) });
    expect(clock.intervals()).toBe(0);
    // The account prompt waits a minute on one timer.
    await toProbing(h);
    await h.runner.agentMessage(agentMsg('agent/report', { probe: goodProbe() }), agentSender({ url: HOME }));
    await h.settle();
    expect(h.runner.state().phase).toBe('awaitingAccount');
    expect(clock.intervals()).toBe(1);
    pings.length = 0;
    await h.advance(2 * KEEPALIVE_MS);
    expect(pings).toHaveLength(2);
    expect((pings[1] ?? 0) - (pings[0] ?? 0)).toBe(KEEPALIVE_MS);
    await h.runner.dispatch({ type: 'windowRemoved', windowId: fx.conf.windowId });
    expect(h.runner.state().phase).toBe('idle');
    expect(clock.intervals()).toBe(0);
  });
});
