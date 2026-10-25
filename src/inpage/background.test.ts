/**
 * The in-page lane's background: the window lane's composer window is told to stay out of the in-page lane
 * (`inpage/attach`), so that lane's Instagram page gets no host, entry or observer from the content script.
 * RS-3: a run a previous worker lost is reported from its in-flight marker (storage.local). RL-10: the toolbar
 * shortcut is read from the browser, or none.
 */
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { HandoffState } from '../core/handoff/state.ts';
import { actionShortcut } from '../platform/commands.ts';
import { markRecord, REINJECT_TRIES, recoverLostRun, toggleOrInject, windowLaneTab } from './background.ts';
import { INFLIGHT_KEY, INPAGE_DRIVER_MARKER, type InpageRecord, RESTARTED_DETAIL } from './driver.ts';
import { DEFAULT_TOGGLES } from './messages.ts';

describe('windowLaneTab', () => {
  it('names the window lane’s composer tab while that lane has one, and nothing otherwise', () => {
    expect(windowLaneTab({ phase: 'idle', last: null })).toBeNull();
    expect(windowLaneTab({ phase: 'navigating', tabId: 42 } as unknown as HandoffState)).toBe(42);
    expect(windowLaneTab({ phase: 'closing', tabId: null } as unknown as HandoffState)).toBeNull();
  });
});

const T0 = Date.UTC(2026, 9, 16, 12);
function snapshot(over: Partial<InpageRecord> = {}): InpageRecord {
  return {
    marker: INPAGE_DRIVER_MARKER,
    runId: 'inp_lost',
    mode: 'post',
    writeBlocked: false,
    photo: { source: 'export', mime: 'image/png', bytes: 6 },
    toggles: DEFAULT_TOGGLES,
    startedAt: T0,
    endedAt: null,
    outcome: null,
    code: null,
    detail: null,
    locked: null,
    tabId: 5,
    frame: {
      id: 7,
      documentId: 'D',
      box: { w: 540, h: 960 },
      dpr: 2,
      scale: 0.8,
      loaded: true,
      readable: true,
      urls: ['/'],
      paths: ['/', '/create/story/'],
      status: 200,
      xfoSeen: null,
      error: null,
      otherSubFrames: 0,
    },
    rules: { installed: [1001, 1020, 1021], after: null, ua: DEFAULT_TOGGLES.ua },
    orientation: null,
    probe: null,
    readyProbe: null,
    account: { detected: 'owner', expected: 'owner', decision: 'ok' },
    entry: null,
    compose: null,
    share: { sent: true, done: false, refused: null, decision: null },
    net: [],
    pageUrls: ['/'],
    steps: [{ step: 'share sent', t: 20_000 }],
    ...over,
  };
}
const stored = async () =>
  (await fakeBrowser.storage.local.get(['inpageRecords', INFLIGHT_KEY])) as Record<string, unknown>;

describe('RL-13 the owner’s mark is written onto the stored record', () => {
  it('It posted / It didn’t post on a post’s Couldn’t confirm; other records are left alone', async () => {
    const unk = snapshot({ runId: 'inp_unk', outcome: 'unknown', code: 'OUTCOME_UNKNOWN', endedAt: T0 });
    const posted = snapshot({ runId: 'inp_ok', outcome: 'posted', endedAt: T0 });
    await fakeBrowser.storage.local.set({ inpageRecords: [unk, posted] });
    await markRecord('inp_unk', 'posted', T0 + 5);
    await markRecord('inp_ok', 'notPosted', T0 + 6);
    const list = (await stored()).inpageRecords as InpageRecord[];
    expect(list[0]).toMatchObject({ runId: 'inp_unk', mark: 'posted', markedAt: T0 + 5 });
    expect(list[1]).toEqual(posted);
    await markRecord('inp_unk', 'notPosted', T0 + 7);
    expect(((await stored()).inpageRecords as InpageRecord[])[0]?.mark).toBe('notPosted');
  });
});

describe('RS-3 a run lost with its worker', () => {
  it('no marker: nothing to report', async () => {
    expect(await recoverLostRun(T0)).toBeNull();
    expect(await stored()).toEqual({});
  });

  it('a marker after Share becomes a Couldn’t confirm record (saved), and the marker goes', async () => {
    await fakeBrowser.storage.local.set({ [INFLIGHT_KEY]: snapshot() });
    const rec = await recoverLostRun(T0 + 30_000);
    expect(rec).toMatchObject({
      runId: 'inp_lost',
      outcome: 'unknown',
      code: 'OUTCOME_UNKNOWN',
      detail: RESTARTED_DETAIL,
      endedAt: T0 + 30_000,
      restarted: true,
    });
    const s = await stored();
    expect(s[INFLIGHT_KEY]).toBeUndefined();
    expect(s.inpageRecords).toEqual([rec]);
  });

  it('a marker before Share is Stopped; a run whose record was saved, or garbage, is not reported again', async () => {
    await fakeBrowser.storage.local.set({ [INFLIGHT_KEY]: snapshot({ share: null }) });
    expect(await recoverLostRun(T0)).toMatchObject({ outcome: 'stopped', code: 'STOPPED' });
    await fakeBrowser.storage.local.set({ [INFLIGHT_KEY]: snapshot({ share: null }) });
    expect(await recoverLostRun(T0)).toBeNull();
    await fakeBrowser.storage.local.set({ [INFLIGHT_KEY]: { runId: 'x', marker: 'nope' } });
    expect(await recoverLostRun(T0)).toBeNull();
    // This worker's own run (it started first) is not lost: its marker stays.
    await fakeBrowser.storage.local.set({ [INFLIGHT_KEY]: snapshot({ runId: 'inp_now' }) });
    expect(await recoverLostRun(T0, (id) => id === 'inp_now')).toBeNull();
    expect((await stored())[INFLIGHT_KEY]).toMatchObject({ runId: 'inp_now' });
    await fakeBrowser.storage.local.remove(INFLIGHT_KEY);
    const s = await stored();
    expect(s[INFLIGHT_KEY]).toBeUndefined();
    expect((s.inpageRecords as unknown[]).length).toBe(1);
  });
});

describe('RL-10 the toolbar shortcut', () => {
  it('as the browser has it, or null when none is set or the API fails', async () => {
    const spy = vi.spyOn(fakeBrowser.commands, 'getAll') as unknown as {
      mockResolvedValue(v: unknown): void;
      mockRejectedValue(e: unknown): void;
    };
    spy.mockResolvedValue([{ name: '_execute_action', shortcut: '⌥⇧S' }]);
    expect(await actionShortcut()).toBe('⌥⇧S');
    spy.mockResolvedValue([{ name: '_execute_action', shortcut: '' }]);
    expect(await actionShortcut()).toBeNull();
    spy.mockResolvedValue([]);
    expect(await actionShortcut()).toBeNull();
    spy.mockRejectedValue(new Error('no commands'));
    expect(await actionShortcut()).toBeNull();
  });
});

describe('FX14 (RL-2) the toolbar on an Instagram tab without the content script', () => {
  function io(answers: boolean[], injectFails = false) {
    const calls: string[] = [];
    return {
      calls,
      toggle: async () => {
        calls.push('toggle');
        return answers.shift() ?? false;
      },
      inject: async () => {
        calls.push('inject');
        if (injectFails) throw new Error('cannot inject');
      },
      sleep: async () => undefined,
    };
  }

  it('toggles at once when the script is there; else injects it and asks again while it attaches', async () => {
    const there = io([true]);
    expect(await toggleOrInject(there)).toBe('toggled');
    expect(there.calls).toEqual(['toggle']);
    const late = io([false, false, false, true]);
    expect(await toggleOrInject(late)).toBe('toggled');
    expect(late.calls).toEqual(['toggle', 'inject', 'toggle', 'toggle', 'toggle']);
  });

  it('reload when the injection fails or the script never answers', async () => {
    const refused = io([false], true);
    expect(await toggleOrInject(refused)).toBe('reload');
    expect(refused.calls).toEqual(['toggle', 'inject']);
    const silent = io([]);
    expect(await toggleOrInject(silent)).toBe('reload');
    expect(silent.calls.filter((c) => c === 'toggle')).toHaveLength(1 + REINJECT_TRIES);
  });
});
