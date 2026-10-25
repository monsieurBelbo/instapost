/**
 * The composer's run state (entrypoints/composer/state.ts) in node, with the export cache and the panel port
 * faked:
 * - RS-5: a queued post takes its export at the press; when the queue fires it sends exactly that photo, even
 *   though the stage changed meanwhile (the owner pasted the next photo or kept typing).
 * - RL-14: a start leaves the current result up until the new run is seen starting; a refused start (the
 *   spacing, say) leaves the result and its explanation in place.
 * - RL-13: It posted · It didn't post write the mark (ui/mark), update the guard and dismiss the result.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { InpageRecord, InpageStatus } from './driver.ts';

const fake = vi.hoisted(() => ({
  /** What freshExport() returns next (the stage as it is at that moment). */
  next: null as null | { blob: Blob; url: string; sha256: string; docHash: string; sample: string | null },
}));

vi.mock('../ui/export-cache.ts', async () => {
  const { signal } = await import('@preact/signals');
  return {
    exportCache: signal(null),
    exportStale: signal(false),
    exportError: signal(null),
    freshExport: async () => fake.next,
    scheduleExport: () => undefined,
  };
});

type State = typeof import('../../entrypoints/composer/state.ts');
let S: State;
let image: typeof import('../ui/editor-state.ts')['image'];
const sent: Record<string, unknown>[] = [];
const toBackground: ((m: unknown) => void)[] = [];

const exportOf = (bytes: number[], hex: string) => ({
  blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
  url: `blob:${hex}`,
  sha256: hex.repeat(64),
  docHash: hex.repeat(64),
  sample: null,
});
const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');

beforeAll(async () => {
  vi.stubGlobal('location', { hash: '' });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => setTimeout(f, 0));
  vi.spyOn(fakeBrowser.runtime, 'connect').mockImplementation(
    () =>
      ({
        postMessage: (m: Record<string, unknown>) => sent.push(m),
        onMessage: { addListener: (l: (m: unknown) => void) => toBackground.push(l) },
        onDisconnect: { addListener: () => undefined },
        disconnect: () => undefined,
      }) as never,
  );
  S = await import('../../entrypoints/composer/state.ts');
  image = (await import('../ui/editor-state.ts')).image;
  S.connect();
  for (const l of toBackground) l({ v: 1, type: 'ui/hello', tabId: 3 });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const fromBackground = (m: unknown) => {
  for (const l of toBackground) l(m);
};

function record(over: Partial<InpageRecord>): InpageRecord {
  return {
    marker: 'instapost-inpage:modes=check,test,shareTest,post',
    runId: 'inp_1',
    mode: 'post',
    writeBlocked: false,
    photo: null,
    toggles: { ua: 'tabwide', frame: 'auto', view: 'phone', xfoRule: 'on', fetchDest: 'document' },
    startedAt: Date.now() - 20_000,
    endedAt: null,
    outcome: null,
    code: null,
    detail: null,
    locked: null,
    tabId: 3,
    frame: {
      id: 5,
      documentId: null,
      box: null,
      dpr: null,
      scale: null,
      loaded: true,
      readable: true,
      urls: [],
      paths: [],
      status: 200,
      xfoSeen: null,
      error: null,
      otherSubFrames: 0,
    },
    rules: { installed: [], after: null, ua: 'tabwide' },
    orientation: null,
    probe: null,
    readyProbe: null,
    account: { detected: 'owner', expected: 'owner', decision: 'ok' },
    entry: null,
    compose: null,
    share: null,
    net: [],
    pageUrls: [],
    steps: [{ step: 'start', t: 0 }],
    ...over,
  };
}
const status = (running: boolean, rec: InpageRecord): InpageStatus => ({ running, tabId: 3, record: rec });

describe('RS-5 a queued post posts what the owner pressed Post on', () => {
  it('the export is taken at the press; the stage changing before the queue fires changes nothing', async () => {
    image.value = { assetId: 'a1' } as never;
    fake.next = exportOf([1, 2, 3], 'a');
    expect(await S.queueRun('post', Date.now() + 30_000)).toBe(true);
    expect(S.queued.value?.photo?.b64).toBe(b64([1, 2, 3]));
    expect(S.queuedAt.value).toBeGreaterThan(Date.now() + 30_000);
    expect(S.queued.value?.thumb).toMatch(/^blob:/);

    // The owner pastes the next photo (or keeps typing) while it waits: the stage's export is another one now.
    fake.next = exportOf([9, 9, 9, 9], 'b');
    sent.length = 0;
    S.fireQueue();
    await vi.waitFor(() => expect(sent.some((m) => m.type === 'run/start')).toBe(true));
    const startMsg = sent.find((m) => m.type === 'run/start') as { mode: string; photo: Record<string, unknown> };
    expect(startMsg.mode).toBe('post');
    expect(startMsg.photo.b64).toBe(b64([1, 2, 3]));
    expect(startMsg.photo.sha256).toBe('a'.repeat(64));
    expect(S.queued.value).toBeNull();
    // A refusal ends the preparation (the driver answered).
    fromBackground({ v: 1, type: 'run/refused', why: 'BUSY' });
    expect(S.preparing.value).toBeNull();
  });

  it('Cancel drops the queue and its photo', async () => {
    image.value = { assetId: 'a1' } as never;
    fake.next = exportOf([4, 5], 'c');
    expect(await S.queueRun('post', Date.now() + 30_000)).toBe(true);
    S.cancelQueue();
    expect(S.queued.value).toBeNull();
    expect(S.queuedAt.value).toBeNull();
  });
});

describe('RL-14 the result stays until the next run is seen starting', () => {
  it('a refused Try again keeps the failure on screen; a started one replaces it', async () => {
    image.value = { assetId: 'a1' } as never;
    fake.next = exportOf([7], 'd');
    const failed = record({ runId: 'inp_fail', outcome: 'stopped', code: 'PAGE_IN_USE', endedAt: Date.now() });
    fromBackground({ v: 1, type: 'run/status', status: status(true, { ...failed, outcome: null, code: null }) });
    fromBackground({ v: 1, type: 'run/status', status: status(false, failed) });
    expect(S.view.value).toBe('result');

    sent.length = 0;
    await S.start('post');
    expect(sent.some((m) => m.type === 'run/start')).toBe(true);
    // Refused (the spacing): the result and its explanation are still there.
    fromBackground({ v: 1, type: 'run/refused', why: 'RATE_LIMITED', freeAt: Date.now() + 30_000 });
    expect(S.view.value).toBe('result');
    expect(S.ownRun.value?.runId).toBe('inp_fail');

    // Started: the new run's first status replaces it.
    await S.start('post');
    fromBackground({ v: 1, type: 'run/status', status: status(true, record({ runId: 'inp_next' })) });
    expect(S.view.value).toBe('run');
    expect(S.dismissed.value.has('inp_fail')).toBe(true);
  });
});

describe('RL-13 It posted · It didn’t post', () => {
  it('writes the mark onto the record (ui/mark), updates the guard and dismisses the result', () => {
    const unk = record({
      runId: 'inp_unk',
      outcome: 'unknown',
      code: 'OUTCOME_UNKNOWN',
      endedAt: Date.now(),
      photo: { source: 'export', mime: 'image/png', bytes: 1, sha256: 'e'.repeat(64) },
      share: { sent: true, done: true, refused: null, decision: null },
    });
    fromBackground({ v: 1, type: 'run/status', status: status(true, { ...unk, outcome: null, code: null }) });
    fromBackground({ v: 1, type: 'run/status', status: status(false, unk) });
    expect(S.view.value).not.toBe('run');
    sent.length = 0;
    S.markRun(unk, 'posted');
    expect(sent).toContainEqual({ v: 1, type: 'ui/mark', runId: 'inp_unk', mark: 'posted' });
    expect(S.records.value.find((r) => r.runId === 'inp_unk')?.mark).toBe('posted');
    expect(S.dismissed.value.has('inp_unk')).toBe(true);
  });
});
