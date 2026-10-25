/**
 * U36 (docs/inpage.md §9.2, §10.4): the in-page driver against fakes of the content script, the agent, dNR,
 * scripting and storage. Real timers, budgets and dwells scaled down.
 */
import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  type MenuFingerprint,
  type MsiteLockReason,
  type NetEntry,
  type Settings,
} from '../core/handoff/state.ts';
import type { ProbeReport } from '../core/ig-contract/contract.ts';
import type { DnrRule } from '../core/ig-contract/rules.ts';
import type { SenderLike } from '../shared/protocol.ts';
import {
  createInpageDriver,
  INPAGE_DRIVER_MARKER,
  type InpageDriver,
  type InpageMode,
  type InpageRecord,
  isInflightRecord,
  RESTARTED_DETAIL,
  restartedRecord,
} from './driver.ts';
import { DEFAULT_TOGGLES, type DevToggles, type RunPhoto } from './messages.ts';

const RID = 'jehchapoghccaofddgdkakdkjijmknhk';
const TAB = 5;
const FRAME = 7;
const DOC = 'D0C';
const HOME = 'https://www.instagram.com/';

const PROBE: ProbeReport = {
  marker: true,
  isMobile: true,
  inner: { w: 540, h: 960 },
  dpr: 2,
  portrait: true,
  swControlled: true,
  swIntercepted: false,
  navType: 'navigate',
  storyInput: 'present',
  acceptOk: true,
  acceptSeen: ['image/avif,image/jpeg,image/png'],
  lang: 'en',
  account: { handle: 'fake_owner', candidates: 1 },
  entryFound: true,
};

interface Opts {
  toggles?: Partial<DevToggles>;
  /** How the frame's first document goes. */
  frame?: 'ok' | 'xfo-refused' | 'login';
  /** The upload's status after Share (0 = blocked). */
  uploadStatus?: number;
  lockedUntil?: number | null;
  rateOk?: boolean;
  windowBusy?: boolean;
  /** Called when the agent receives a drive step (to inject trouble mid-run). */
  onStep?: (step: string, d: InpageDriver) => void;
  /** Home hydrates late: the account shows first, the story input 30 ms after the watch starts. */
  lateInput?: boolean;
  /** A guarded (dev, mock) build, and whether the worker's brands name a branded browser. */
  guarded?: boolean;
  branded?: boolean;
  /** The page carries no fake marker (real Instagram). */
  noMarker?: boolean;
  /** The agent's resource entries after Share (default: one upload with `uploadStatus`). */
  shareNet?: NetEntry[];
  /** C15: Instagram served "Sorry, this page isn't available" in the frame (no header, no navigation). */
  unavailable?: boolean;
  /** RS-1: something else removes these session rules at the n-th getSessionRules read (1-based). */
  dropRules?: { read: number; ids: number[] };
  /** The desktop page's URL when the run starts (tabs.get). */
  startUrl?: string;
}

const PHOTO: RunPhoto = { mime: 'image/png', b64: 'AAECAwQF', sample: null };
const upload = (status: number): NetEntry => ({
  host: 'i',
  path: '/rupload_igphoto/fb_uploader_1',
  status,
  type: 'application/json',
  redirected: false,
  start: 1,
  end: 2,
});
const publish = (status: number, over: Partial<NetEntry> = {}): NetEntry => ({
  host: 'www',
  path: '/api/v1/media/configure_to_story/',
  status,
  type: 'application/json; charset=utf-8',
  redirected: false,
  start: 3,
  end: 4,
  ...over,
});

function harness(o: Opts = {}) {
  const rules = new Map<number, DnrRule>();
  const log: string[] = [];
  const locks: MsiteLockReason[] = [];
  const saved: InpageRecord[] = [];
  const kinds: string[] = [];
  let opens = 0;
  let pageUrl = o.startUrl ?? HOME;
  let reads = 0;
  const inflight: { op: 'save' | 'clear'; runId: string; shared: boolean }[] = [];
  const settings: Settings = {
    ...defaultSettings(false),
    expectedAccount: { handle: 'fake_owner', detectedAt: 1 },
    msiteLockedUntil: o.lockedUntil ?? null,
  };
  const agentSender: SenderLike = { id: RID, tab: { id: TAB }, frameId: FRAME, documentId: DOC, url: HOME };
  const pageSender: SenderLike = { id: RID, tab: { id: TAB }, frameId: 0, url: HOME };
  let driver: InpageDriver;
  const later = (fn: () => void, ms = 2) => setTimeout(fn, ms);

  function frameEvents(runId: string) {
    const base = { tabId: TAB, frameId: FRAME, parentFrameId: 0 };
    driver.frameRequest({ kind: 'before', ...base, url: HOME });
    if (o.frame === 'login') {
      driver.frameRequest({
        kind: 'redirect',
        ...base,
        url: HOME,
        redirectUrl: `${HOME}accounts/login/?next=%2F`,
        status: 302,
      });
    }
    if (o.frame === 'xfo-refused') {
      driver.frameRequest({ kind: 'headers', ...base, url: HOME, status: 200, xfo: 'DENY' });
      driver.frameRequest({ kind: 'error', ...base, url: HOME, error: 'net::ERR_BLOCKED_BY_RESPONSE' });
      later(() =>
        driver.pageMessage({ v: 1, type: 'inpage/frame-loaded', runId, readable: false, path: null }, pageSender),
      );
      return;
    }
    driver.frameRequest({ kind: 'headers', ...base, url: HOME, status: 200, xfo: null });
    driver.frameRequest({ kind: 'completed', ...base, url: HOME, status: 200 });
    const path = o.frame === 'login' ? '/accounts/login/' : '/';
    later(() => driver.pageMessage({ v: 1, type: 'inpage/frame-loaded', runId, readable: true, path }, pageSender));
  }

  let inputShown = false;
  function agentGot(msg: Record<string, unknown>) {
    const addr = { v: 1, handoffId: msg.handoffId, nonce: msg.nonce };
    const send = (m: Record<string, unknown>) => void driver.agentMessage({ ...addr, ...m }, agentSender);
    const fact = (f: Record<string, unknown>) => send({ type: 'agent/fact', fact: f });
    if (msg.type === 'agent/probe') {
      const base = o.noMarker ? { ...PROBE, marker: false } : PROBE;
      const empty = { ...base, storyInput: 'absent', acceptOk: false, acceptSeen: [] };
      const probe = o.unavailable
        ? { ...empty, account: { handle: null, candidates: 0 }, entryFound: false }
        : o.lateInput && !inputShown
          ? empty
          : base;
      return later(() => send({ type: 'agent/report', probe }));
    }
    if (msg.type === 'agent/watch' && o.lateInput) {
      later(() => send({ type: 'agent/event', event: 'account-appeared' }));
      later(() => {
        inputShown = true;
        send({ type: 'agent/event', event: 'input-appeared' });
      }, 30);
      return;
    }
    if (msg.type !== 'agent/drive') return;
    o.onStep?.(String(msg.step), driver);
    switch (msg.step) {
      case 'open-entry':
        return later(() =>
          fact({
            kind: 'entry',
            result: 'armed',
            fpUsed: false,
            storyIndex: 1,
            glyph: 'abc',
            menuCount: 2,
            trials: 1,
            plusTaps: 1,
            armedMs: 30,
          }),
        );
      case 'insert':
        return later(async () => {
          const file = await driver.agentMessage({ ...addr, type: 'agent/get-file' }, agentSender);
          const f = file as { mime?: string; b64?: string } | null;
          log.push(`file:${f?.mime ?? 'none'}`, `b64:${f?.b64 ?? 'none'}`);
          driver.pageMessage(
            { v: 1, type: 'inpage/frame-path', runId: String(msg.handoffId), readable: true, path: '/create/story/' },
            pageSender,
          );
          fact({ kind: 'inserted' });
        });
      case 'compose':
        return later(() =>
          fact({
            kind: 'compose',
            onComposer: true,
            drawn: true,
            landscape: false,
            controls: 1,
            variant: 'v1',
            fbAuto: false,
            settled: true,
            settleMs: 1500,
            canvas: { w: 1080, h: 1920 },
            imageScore: null,
          }),
        );
      case 'share':
        return later(() => {
          fact({ kind: 'share-done', t0Wall: 1 });
          fact({
            kind: 'net',
            entries: o.shareNet ?? [{ ...upload(o.uploadStatus ?? 0), type: '' }],
            elapsedMs: 3,
          });
        });
    }
  }

  driver = createInpageDriver({
    dnr: {
      async updateSessionRules({ removeRuleIds = [], addRules = [] }) {
        log.push(`rules:-${removeRuleIds.length}+${addRules.map((r) => r.id).join(',')}`);
        for (const id of removeRuleIds) rules.delete(id);
        for (const r of addRules) rules.set(r.id, r);
      },
      async getSessionRules() {
        reads++;
        if (o.dropRules && reads === o.dropRules.read) for (const id of o.dropRules.ids) rules.delete(id);
        return [...rules.values()];
      },
    },
    tabs: {
      async get(tabId) {
        return { id: tabId, windowId: 1, url: pageUrl, width: 1500, height: 900 };
      },
      async sendMessage<R>(tabId: number, msg: unknown, frameId = 0) {
        const m = msg as Record<string, unknown>;
        log.push(`send:${tabId}:${frameId}:${String(m.type)}${m.step ? `:${String(m.step)}` : ''}`);
        if (frameId === 0) {
          if (m.type === 'inpage/open-frame') {
            later(() => frameEvents(String(m.runId)));
            return { ok: true, box: { w: 540, h: 960 }, dpr: 2, scale: 0.8 } as R;
          }
          return { ok: true } as R;
        }
        if (frameId !== FRAME) throw new Error('no such frame');
        later(() => agentGot(m));
        return { ok: true } as R;
      },
    },
    scripting: {
      async injectPortraitShim(tabId, install, frameId) {
        log.push(`shim:${tabId}:${frameId}:${install}`);
        return { type: 'portrait-primary', shim: 'installed' };
      },
      async injectComposerAgent(tabId, frameId) {
        log.push(`agent:${tabId}:${frameId}`);
        return { fresh: true, documentId: DOC };
      },
    },
    local: {
      settings: async () => settings,
      rate: async (_now, _s, kind) => {
        kinds.push(`rate:${kind}`);
        return o.rateOk === false ? { ok: false, code: 'RATE_LIMITED', rule: 'spacing', freeAt: 99 } : { ok: true };
      },
      noteOpen: async (_t, kind) => {
        kinds.push(`open:${kind}`);
        opens++;
      },
      lockMsite: async (_until, reason) => {
        if (reason) locks.push(reason);
      },
      fingerprint: async (): Promise<MenuFingerprint | null> => null,
      storeFingerprint: async () => undefined,
      setExpectedAccount: async () => undefined,
    },
    toggles: async () => ({ ...DEFAULT_TOGGLES, ...o.toggles }),
    saveRecord: async (r) => {
      saved.push(r);
    },
    inflight: {
      save: async (r) => {
        inflight.push({ op: 'save', runId: r.runId, shared: r.share?.sent === true });
        log.push(`inflight:save:${r.share?.sent === true ? 'shared' : 'start'}`);
      },
      clear: async (runId) => {
        inflight.push({ op: 'clear', runId, shared: false });
        log.push('inflight:clear');
      },
    },
    calibration: async () => ({ mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }),
    now: () => Date.now(),
    random: () => 0,
    uuid: () => crypto.randomUUID(),
    runtimeId: RID,
    chromeMajor: 155,
    windowLaneBusy: () => o.windowBusy === true,
    ...(o.guarded !== undefined ? { guarded: o.guarded } : {}),
    ...(o.branded !== undefined ? { brandedBrowser: o.branded } : {}),
    scale: 0.01,
  });

  async function run(
    mode: InpageMode,
    confirmShare = mode === 'shareTest',
    photo: RunPhoto | null = mode === 'post' ? PHOTO : null,
  ): Promise<InpageRecord> {
    const r = await driver.start({ tabId: TAB, mode, confirmShare, photo });
    if (!r.ok) throw new Error(`refused ${r.why}`);
    await driver.idle();
    const rec = saved.at(-1);
    if (!rec) throw new Error('no record');
    return rec;
  }
  return {
    driver,
    run,
    rules,
    log,
    locks,
    saved,
    kinds,
    inflight,
    opens: () => opens,
    setPageUrl: (u: string) => {
      pageUrl = u;
    },
  };
}

describe('U36 in-page driver', () => {
  it('check: rules (1001 tab-wide, 1020, the write block), the frame, shim and agent in the frame, then frame before rules', async () => {
    const h = harness();
    const rec = await h.run('check');
    expect(rec.marker).toBe(INPAGE_DRIVER_MARKER);
    expect(rec.writeBlocked).toBe(true);
    expect(h.kinds).toEqual(['rate:test', 'open:test']);
    expect(rec.outcome).toBe('checked');
    expect(rec.account.detected).toBe('fake_owner');
    expect(rec.rules.installed).toEqual([1001, 1020, 1021, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010]);
    expect(rec.rules.after).toEqual([]);
    expect(h.opens()).toBe(1);
    expect(h.log).toContain(`shim:${TAB}:${FRAME}:true`);
    expect(h.log).toContain(`agent:${TAB}:${FRAME}`);
    const removeFrame = h.log.indexOf(`send:${TAB}:0:inpage/remove-frame`);
    const removeRules = h.log.lastIndexOf('rules:-29+');
    expect(removeFrame).toBeGreaterThan(0);
    expect(removeRules).toBeGreaterThan(removeFrame);
    expect(h.log.indexOf('rules:-29+1001,1020,1002,1003,1004,1005,1006,1007,1008,1009,1010')).toBeLessThan(
      h.log.indexOf(`send:${TAB}:0:inpage/open-frame`),
    );
  });

  it('test: + → Story, the calibration card, the composer, then stop before Share', async () => {
    const h = harness();
    const rec = await h.run('test');
    expect(rec.outcome).toBe('tested');
    expect(rec.entry?.result).toBe('armed');
    expect(rec.compose?.canvas).toEqual({ w: 1080, h: 1920 });
    expect(h.log).toContain('file:image/png');
    expect(h.log.some((l) => l.endsWith(':share'))).toBe(false);
    expect(rec.frame.paths).toEqual(['/', '/create/story/']);
  });

  it('test: a late story input is waited for even when the account shows first (live 2026-10-14)', async () => {
    const h = harness({ lateInput: true });
    const rec = await h.run('test');
    expect(rec.code ?? null).toBeNull();
    expect(rec.outcome).toBe('tested');
    expect(rec.probe?.storyInput).toBe('present');
  });

  it('shareTest: verifies the write block, Share once, a blocked upload passes', async () => {
    const h = harness();
    const rec = await h.run('shareTest');
    expect(rec.outcome).toBe('shareTested');
    expect(h.log.filter((l) => l.endsWith(':agent/drive:share'))).toHaveLength(1);
    expect(h.locks).toEqual([]);
  });

  it('shareTest: an upload that reached a server with 2xx is TEST_LEAK: killed and locked', async () => {
    const h = harness({ uploadStatus: 200 });
    const rec = await h.run('shareTest');
    expect(rec.outcome).toBe('killed');
    expect(rec.code).toBe('TEST_LEAK');
    expect(h.locks).toEqual(['TEST_LEAK']);
    expect(rec.rules.after).toEqual([]);
  });

  it('refusals before anything opens: a post without a photo, Share test unconfirmed, paused, rate, busy lanes', async () => {
    const h = harness();
    expect(await h.driver.start({ tabId: TAB, mode: 'post', confirmShare: false })).toEqual({
      ok: false,
      why: 'NO_PHOTO',
    });
    expect(
      await h.driver.start({
        tabId: TAB,
        mode: 'post',
        confirmShare: false,
        photo: { mime: 'image/gif', b64: 'AAAA', sample: null } as unknown as RunPhoto,
      }),
    ).toEqual({ ok: false, why: 'NO_PHOTO' });
    expect(await h.driver.start({ tabId: TAB, mode: 'shareTest', confirmShare: false })).toEqual({
      ok: false,
      why: 'SHARE_NOT_CONFIRMED',
    });
    expect(
      await harness({ lockedUntil: Date.now() + 60_000 }).driver.start({
        tabId: TAB,
        mode: 'check',
        confirmShare: false,
      }),
    ).toMatchObject({
      ok: false,
      why: 'PAUSED',
    });
    expect(
      await harness({ rateOk: false }).driver.start({ tabId: TAB, mode: 'check', confirmShare: false }),
    ).toMatchObject({
      ok: false,
      why: 'RATE_LIMITED',
    });
    expect(
      await harness({ windowBusy: true }).driver.start({ tabId: TAB, mode: 'check', confirmShare: false }),
    ).toMatchObject({
      ok: false,
      why: 'BUSY',
    });
    expect(h.opens()).toBe(0);
    expect(h.rules.size).toBe(0);
  });

  it('guarded builds (in-page lane in every build): a branded browser is refused before anything opens (AM23)', async () => {
    const h = harness({ guarded: true, branded: true });
    expect(await h.driver.start({ tabId: TAB, mode: 'check', confirmShare: false })).toEqual({
      ok: false,
      why: 'BRANDED_BROWSER',
    });
    expect(h.opens()).toBe(0);
    expect(h.rules.size).toBe(0);
    // A live build ignores the brands (the window lane does too).
    expect((await harness({ guarded: false, branded: true }).run('check')).outcome).toBe('checked');
  });

  it('guarded builds: a page without the fake marker stops at the probe with GUARD_NOT_FAKE (SG4), no lock', async () => {
    const h = harness({ guarded: true, noMarker: true });
    const rec = await h.run('check');
    expect(rec.code).toBe('GUARD_NOT_FAKE');
    expect(rec.outcome).toBe('stopped');
    expect(h.locks).toEqual([]);
    expect(rec.rules.after).toEqual([]);
    // On the fake (marker present) a guarded check passes; a live build never asks for the marker.
    expect((await harness({ guarded: true }).run('check')).outcome).toBe('checked');
    expect((await harness({ noMarker: true }).run('check')).outcome).toBe('checked');
  });

  it('one run at a time', async () => {
    const h = harness();
    const first = await h.driver.start({ tabId: TAB, mode: 'check', confirmShare: false });
    expect(first.ok).toBe(true);
    expect(await h.driver.start({ tabId: TAB, mode: 'check', confirmShare: false })).toEqual({
      ok: false,
      why: 'BUSY',
    });
    await h.driver.idle();
  });

  it('XFO refused: FRAME_REFUSED, no lock, no agent, rules removed', async () => {
    const h = harness({ frame: 'xfo-refused' });
    const rec = await h.run('check');
    expect(rec.outcome).toBe('stopped');
    expect(rec.code).toBe('FRAME_REFUSED');
    expect(rec.frame.error).toBe('net::ERR_BLOCKED_BY_RESPONSE');
    expect(rec.frame.xfoSeen).toBe('DENY');
    expect(h.locks).toEqual([]);
    expect(h.log.some((l) => l.startsWith('agent:'))).toBe(false);
    expect(rec.rules.after).toEqual([]);
  });

  it('C15: "page isn\'t available" in the frame (no header, no account link) is FRAME_REFUSED in every mode, no lock, no tap', async () => {
    for (const mode of ['check', 'test', 'shareTest'] as const) {
      const h = harness({ unavailable: true });
      const rec = await h.run(mode);
      expect(rec.outcome, mode).toBe('stopped');
      expect(rec.code, mode).toBe('FRAME_REFUSED');
      expect(rec.detail, mode).toMatch(/page unavailable/);
      expect(rec.account.detected, mode).toBeNull();
      expect(h.locks).toEqual([]);
      expect(
        h.log.some((l) => l.includes(':agent/drive:')),
        mode,
      ).toBe(false);
      expect(rec.rules.after).toEqual([]);
      // The one wait for a late header or account came first (P5), then the second probe.
      expect(
        h.log.filter((l) => l.endsWith(':agent/watch')),
        mode,
      ).toHaveLength(1);
    }
    // The account link alone is msite: a check still passes with the story input missing, a test stops on it.
    expect((await harness({ lateInput: true }).run('check')).outcome).toBe('checked');
  });

  it('a login redirect in the frame stops with NOT_LOGGED_IN, no lock', async () => {
    const h = harness({ frame: 'login' });
    const rec = await h.run('check');
    expect(rec.code).toBe('NOT_LOGGED_IN');
    expect(h.locks).toEqual([]);
  });

  it('F8: the page itself moves to /challenge/ mid-run: KILLED_CHALLENGE and the lock', async () => {
    const h = harness({
      onStep: (step, d) => {
        if (step === 'insert') d.tabUpdated(TAB, `${HOME}challenge/?next=%2F`);
      },
    });
    const rec = await h.run('test');
    expect(rec.outcome).toBe('killed');
    expect(rec.code).toBe('KILLED_CHALLENGE');
    expect(h.locks).toEqual(['KILLED_CHALLENGE']);
    expect(rec.rules.after).toEqual([]);
  });

  it('the page went away (its port closed, the tab back on www): PAGE_LEFT, no lock', async () => {
    const h = harness({ onStep: (step, d) => step === 'open-entry' && d.pagePortClosed(TAB) });
    const rec = await h.run('test');
    expect(rec.code).toBe('PAGE_LEFT');
    expect(h.locks).toEqual([]);
  });

  it('the frame leaves www after it was open: KILLED_OFFHOST', async () => {
    const h = harness({
      onStep: (step, d) => {
        if (step !== 'open-entry') return;
        const runId = d.status().record?.runId ?? '';
        d.pageMessage(
          { v: 1, type: 'inpage/frame-path', runId, readable: false, path: null },
          { id: RID, tab: { id: TAB }, frameId: 0, url: HOME },
        );
      },
    });
    const rec = await h.run('test');
    expect(rec.code).toBe('KILLED_OFFHOST');
    expect(h.locks).toEqual(['KILLED_OFFHOST']);
  });

  it('agent messages: frame 0 is the window lane (null); a stale document is dropped', async () => {
    const h = harness({
      onStep: (step, d) => {
        if (step !== 'open-entry') return;
        const rec = d.status().record;
        expect(
          d.agentMessage(
            { v: 1, type: 'agent/event', event: 'input-appeared' },
            { id: RID, tab: { id: TAB }, frameId: 0 },
          ),
        ).toBeNull();
        void d
          .agentMessage(
            { v: 1, type: 'agent/event', event: 'input-appeared', handoffId: rec?.runId, nonce: 'x' },
            { id: RID, tab: { id: TAB }, frameId: FRAME, documentId: 'OLD', url: HOME },
          )
          ?.then((reply) => expect(reply).toEqual({ ok: false }));
      },
    });
    expect((await h.run('test')).outcome).toBe('tested');
  });

  it('ua: document installs 1001 on sub_frame only; xfoRule off installs no 1020', async () => {
    const h = harness({ toggles: { ua: 'document', xfoRule: 'off' }, frame: 'xfo-refused' });
    const rec = await h.run('check');
    expect(rec.rules.installed).not.toContain(1020);
    expect(h.log.find((l) => l.startsWith('rules:-29+1001'))).toBeDefined();
  });

  it('Stop: the owner stops a run, nothing is locked', async () => {
    const h = harness({ onStep: (step, d) => step === 'open-entry' && d.stop() });
    const rec = await h.run('test');
    expect(rec.code).toBe('STOPPED');
    expect(h.locks).toEqual([]);
    expect(rec.rules.after).toEqual([]);
  });
  it('post: no write block, the export (not the calibration card), Share once, configure 2xx JSON → posted', async () => {
    const h = harness({ shareNet: [upload(200), publish(200)] });
    const rec = await h.run('post');
    expect(rec.outcome).toBe('posted');
    expect(rec.code ?? null).toBeNull();
    expect(rec.writeBlocked).toBe(false);
    expect(rec.rules.installed).toEqual([1001, 1020, 1021]);
    expect(h.log).toContain(`b64:${PHOTO.b64}`);
    expect(rec.photo).toMatchObject({ source: 'export', mime: 'image/png' });
    expect(h.log.filter((l) => l.endsWith(':agent/drive:share'))).toHaveLength(1);
    expect(h.kinds).toEqual(['rate:post', 'open:post']);
    expect(h.locks).toEqual([]);
    expect(rec.rules.after).toEqual([]);
    expect(h.log).toContain(`send:${TAB}:0:inpage/remove-frame`);
  });

  it('post: configure 4xx → not posted (UPLOAD_FAILED), never a retry', async () => {
    const h = harness({ shareNet: [upload(200), publish(400)] });
    const rec = await h.run('post');
    expect(rec.outcome).toBe('notPosted');
    expect(rec.code).toBe('UPLOAD_FAILED');
    expect(h.log.filter((l) => l.endsWith(':agent/drive:share'))).toHaveLength(1);
  });

  it("post: a redirected or HTML publish answer is Couldn't confirm, never posted", async () => {
    const redirected = await harness({ shareNet: [upload(200), publish(200, { redirected: true })] }).run('post');
    expect(redirected.outcome).toBe('unknown');
    expect(redirected.code).toBe('OUTCOME_UNKNOWN');
    const html = await harness({ shareNet: [upload(200), publish(200, { type: 'text/html' })] }).run('post');
    expect(html.outcome).toBe('unknown');
  });

  it("post: Stop after Share is ignored; the page leaving after Share is Couldn't confirm", async () => {
    const stopped = harness({
      shareNet: [upload(200), publish(200)],
      onStep: (step, d) => step === 'share' && setTimeout(() => d.stop(), 1),
    });
    expect((await stopped.run('post')).outcome).toBe('posted');
    const left = harness({
      shareNet: [upload(200)],
      onStep: (step, d) => step === 'share' && setTimeout(() => d.tabRemoved(TAB), 1),
    });
    const rec = await left.run('post');
    expect(rec.outcome).toBe('unknown');
    expect(rec.code).toBe('OUTCOME_UNKNOWN');
    expect(rec.detail).toContain('PAGE_LEFT');
  });

  it('test with the export: the insert serves it, writes stay blocked', async () => {
    const h = harness();
    const rec = await h.run('test', false, PHOTO);
    expect(rec.outcome).toBe('tested');
    expect(h.log).toContain(`b64:${PHOTO.b64}`);
    expect(rec.rules.installed).toContain(1002);
  });
});

const frameTo = (d: InpageDriver, path: string) =>
  d.pageMessage(
    { v: 1, type: 'inpage/frame-path', runId: d.status().record?.runId ?? '', readable: true, path },
    { id: RID, tab: { id: TAB }, frameId: 0, url: HOME },
  );

describe('RS-1 the run’s session rules are read again right before Share', () => {
  it('Share test: the write block removed during the share dwell stops the run, Share never goes out, no lock', async () => {
    // Read 1: the check before the dwell; read 2: right before the share command.
    const h = harness({ dropRules: { read: 2, ids: [1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010] } });
    const rec = await h.run('shareTest');
    expect(rec.outcome).toBe('stopped');
    expect(rec.code).toBe('AGENT_UNREACHABLE');
    expect(rec.detail).toMatch(/before Share/);
    expect(rec.share).toBeNull();
    expect(h.log.some((l) => l.endsWith(':agent/drive:share'))).toBe(false);
    expect(h.locks).toEqual([]);
  });

  it('post: the Android profile (1001) or the frame rules removed during the dwell: no Share either', async () => {
    for (const ids of [[1001], [1020], [1021]]) {
      const h = harness({ shareNet: [upload(200), publish(200)], dropRules: { read: 2, ids } });
      const rec = await h.run('post');
      expect(rec.outcome, String(ids)).toBe('stopped');
      expect(rec.detail, String(ids)).toContain(`session rules gone: ${ids[0]}`);
      expect(h.log.some((l) => l.endsWith(':agent/drive:share'))).toBe(false);
    }
  });

  it('Share test: the write block gone while deciding is TEST_LEAK at once (kill, lock: the story may be live)', async () => {
    const h = harness({ dropRules: { read: 3, ids: [1002] } });
    const rec = await h.run('shareTest');
    expect(rec.outcome).toBe('killed');
    expect(rec.code).toBe('TEST_LEAK');
    expect(rec.detail).toMatch(/after Share/);
    expect(h.locks).toEqual(['TEST_LEAK']);
  });
});

describe('RS-2 / RL-1 after a post’s Share', () => {
  it('the frame moves to /challenge/ after Share: Couldn’t confirm with the lock, never "not posted"', async () => {
    const h = harness({
      shareNet: [upload(200)],
      onStep: (step, d) => step === 'share' && setTimeout(() => frameTo(d, '/challenge/'), 5),
    });
    const rec = await h.run('post');
    expect(rec.outcome).toBe('unknown');
    expect(rec.code).toBe('OUTCOME_UNKNOWN');
    expect(rec.detail).toMatch(/^KILLED_CHALLENGE: /);
    expect(rec.locked).toBe('KILLED_CHALLENGE');
    expect(h.locks).toEqual(['KILLED_CHALLENGE']);
  });

  it('Settings (/accounts/edit/) opened in the page after Share: posted, no lock, the frame kept until decided', async () => {
    const h = harness({
      shareNet: [upload(200), publish(200)],
      onStep: (step, d) => step === 'share' && setTimeout(() => d.tabUpdated(TAB, `${HOME}accounts/edit/`), 1),
    });
    const rec = await h.run('post');
    expect(rec.outcome).toBe('posted');
    expect(rec.locked).toBeNull();
    expect(h.locks).toEqual([]);
    expect(rec.pageUrls).toEqual(['/', '/accounts/edit/']);
  });

  it('a run started on Settings: tabs.onUpdated repeating that URL (title, status) changes nothing', async () => {
    const edit = `${HOME}accounts/edit/`;
    const h = harness({
      startUrl: edit,
      onStep: (step, d) => {
        if (step === 'open-entry' || step === 'insert') d.tabUpdated(TAB, edit);
      },
    });
    const rec = await h.run('test');
    expect(rec.outcome).toBe('tested');
    expect(h.locks).toEqual([]);
    expect(rec.pageUrls).toEqual(['/accounts/edit/']);
  });

  it('a real /challenge/ in the page after Share: the run decides first (the frame is not cut), then locks', async () => {
    const posted = harness({
      shareNet: [upload(200), publish(200)],
      onStep: (step, d) => step === 'share' && setTimeout(() => d.tabUpdated(TAB, `${HOME}challenge/?next=%2F`), 1),
    });
    const rec = await posted.run('post');
    expect(rec.outcome).toBe('posted');
    expect(rec.locked).toBe('KILLED_CHALLENGE');
    expect(posted.locks).toEqual(['KILLED_CHALLENGE']);
    const steps = rec.steps.map((s) => s.step);
    expect(steps.indexOf('page check')).toBeGreaterThan(steps.indexOf('share sent'));
    expect(steps.indexOf('decided')).toBeLessThan(steps.indexOf('closing'));

    // No answer yet: Couldn't confirm with the lock, and no 2-minute hold once the page showed a check.
    const pending = harness({
      shareNet: [upload(200)],
      onStep: (step, d) => step === 'share' && setTimeout(() => d.tabUpdated(TAB, `${HOME}challenge/`), 1),
    });
    const unk = await pending.run('post');
    expect(unk.outcome).toBe('unknown');
    expect(unk.locked).toBe('KILLED_CHALLENGE');
    expect(unk.steps.map((s) => s.step)).not.toContain('holding');
  });

  it('before Share the page’s /challenge/ still kills at once (F8)', async () => {
    const h = harness({ onStep: (step, d) => step === 'compose' && d.tabUpdated(TAB, `${HOME}challenge/`) });
    const rec = await h.run('post');
    expect(rec.outcome).toBe('killed');
    expect(rec.share).toBeNull();
    expect(h.locks).toEqual(['KILLED_CHALLENGE']);
  });
});

describe('RS-6 / RS-7 the kill switch at the edges of a run', () => {
  /** Fires `fn` once, a moment after the run logs `decided` (inside the Posted linger). */
  const onDecided = (d: InpageDriver, fn: () => void) => {
    let fired = false;
    d.subscribe((s) => {
      if (!fired && s.running && s.record?.steps.at(-1)?.step === 'decided') {
        fired = true;
        setTimeout(fn, 2);
      }
    });
    return () => fired;
  };

  it('RS-6: the page moves to /challenge/ during the Posted linger: posted, and the lane locks', async () => {
    const h = harness({ shareNet: [upload(200), publish(200)] });
    const fired = onDecided(h.driver, () => h.driver.tabUpdated(TAB, `${HOME}challenge/`));
    const rec = await h.run('post');
    expect(fired()).toBe(true);
    expect(rec.outcome).toBe('posted');
    expect(rec.locked).toBe('KILLED_CHALLENGE');
    expect(h.locks).toEqual(['KILLED_CHALLENGE']);
    const steps = rec.steps.map((s) => s.step);
    expect(steps.indexOf('page check')).toBeGreaterThan(steps.indexOf('decided'));
    expect(steps.indexOf('page check')).toBeLessThan(steps.indexOf('closing'));
  });

  it('RS-6: the frame moves to /challenge/ during the Posted linger: posted, and the lane locks', async () => {
    const h = harness({ shareNet: [upload(200), publish(200)] });
    const fired = onDecided(h.driver, () => frameTo(h.driver, '/challenge/'));
    const rec = await h.run('post');
    expect(fired()).toBe(true);
    expect(rec.outcome).toBe('posted');
    expect(rec.locked).toBe('KILLED_CHALLENGE');
    expect(h.locks).toEqual(['KILLED_CHALLENGE']);
  });

  it('RS-6: a plain Posted (nothing during the linger) locks nothing', async () => {
    const h = harness({ shareNet: [upload(200), publish(200)] });
    const rec = await h.run('post');
    expect(rec.outcome).toBe('posted');
    expect(rec.locked).toBeNull();
    expect(h.locks).toEqual([]);
  });

  it('RS-7: a page already on a security route gets no run: no rules, no frame, no open counted, and the lock', async () => {
    for (const [url, mode] of [
      [`${HOME}challenge/`, 'test'],
      [`${HOME}accounts/suspended/?next=%2F`, 'post'],
      [`${HOME}checkpoint/123/`, 'check'],
    ] as const) {
      const h = harness({ startUrl: url });
      const r = await h.driver.start({ tabId: TAB, mode, confirmShare: false, photo: mode === 'post' ? PHOTO : null });
      expect(r, url).toMatchObject({ ok: false, why: 'PAUSED' });
      expect(r.ok === false && typeof r.freeAt === 'number').toBe(true);
      expect(h.locks, url).toEqual(['KILLED_CHALLENGE']);
      expect(h.rules.size).toBe(0);
      expect(h.opens()).toBe(0);
      expect(h.log.filter((l) => l.startsWith('rules:') || l.includes('open-frame'))).toEqual([]);
      expect(h.driver.busy()).toBe(false);
    }
  });

  it('RS-7: a page on the login page gets NOT_LOGGED_IN, no lock; Settings still runs', async () => {
    const login = harness({ startUrl: `${HOME}accounts/login/?next=%2F` });
    expect(await login.driver.start({ tabId: TAB, mode: 'test', confirmShare: false })).toEqual({
      ok: false,
      why: 'NOT_LOGGED_IN',
    });
    expect(login.locks).toEqual([]);
    expect(login.rules.size).toBe(0);
    expect(login.opens()).toBe(0);
    const settingsPage = harness({ startUrl: `${HOME}accounts/edit/` });
    expect((await settingsPage.run('check')).outcome).toBe('checked');
  });
});

describe('RS-3 the in-flight marker and a restarted worker', () => {
  it('the marker is written at the start and again right before Share, and cleared once the record is saved', async () => {
    const h = harness({ shareNet: [upload(200), publish(200)] });
    const rec = await h.run('post');
    expect(h.inflight.map((x) => `${x.op}:${x.shared}`)).toEqual(['save:false', 'save:true', 'clear:false']);
    expect(h.inflight.every((x) => x.runId === rec.runId)).toBe(true);
    expect(h.log.indexOf('inflight:save:shared')).toBeLessThan(h.log.indexOf(`send:${TAB}:${FRAME}:agent/drive:share`));
    expect(h.log.at(-1)).toBe('inflight:clear');
  });

  it('a run lost after Share is Couldn’t confirm; before Share, Stopped; the driver shows it as the last result', async () => {
    const h = harness({ shareNet: [upload(200), publish(200)] });
    const done = await h.run('post');
    const atShare: InpageRecord = {
      ...done,
      outcome: null,
      code: null,
      detail: null,
      endedAt: null,
      share: { sent: true, done: false, refused: null, decision: null },
    };
    expect(isInflightRecord(atShare)).toBe(true);
    expect(isInflightRecord({ runId: 'x' })).toBe(false);
    const lost = restartedRecord(atShare, atShare.startedAt + 5000);
    expect(lost).toMatchObject({
      outcome: 'unknown',
      code: 'OUTCOME_UNKNOWN',
      detail: RESTARTED_DETAIL,
      restarted: true,
      endedAt: atShare.startedAt + 5000,
    });
    expect(restartedRecord({ ...atShare, share: null }, atShare.startedAt + 1)).toMatchObject({
      outcome: 'stopped',
      code: 'STOPPED',
    });
    const fresh = harness();
    fresh.driver.adopt(lost);
    expect(fresh.driver.status()).toEqual({ running: false, tabId: null, record: lost });
  });
});
