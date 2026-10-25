/**
 * docs/repost.md RV-2 (RP-19, RP-22): a repost arriving while the composer still holds a finished, undismissed
 * result (the Posted auto-close and closing do not dismiss it) dismisses that result, so the intake (loading,
 * the permission card) shows instead of the old result's rail acting on the new doc. A run in flight keeps
 * its view. The composer's state runs in node with the window bits it reads stubbed; the intake never fetches.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { RepostSource } from '../core/repost/source.ts';
import type { InpageRecord } from './driver.ts';

type State = typeof import('../../entrypoints/composer/state.ts');
type Repost = typeof import('../ui/repost-state.ts');
let S: State;
let R: Repost;

beforeAll(async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('location', { hash: '' });
  S = await import('../../entrypoints/composer/state.ts');
  R = await import('../ui/repost-state.ts');
  // The intake stays loading: no permission check, no GET resolves.
  const never = () => new Promise<never>(() => undefined);
  R.setIntakeDeps({ granted: never, get: never, decode: never, bitmap: never });
});

const SRC: RepostSource = {
  kind: 'post',
  author: 'some.user',
  code: 'C1aBcDeFgH',
  storyPk: null,
  media: [{ url: 'https://scontent-mad1-1.cdninstagram.com/v/t51.2885-15/a_1080.jpg', w: 1080 }],
  aspect: 0.8,
  avatar: null,
  slide: null,
  isOwn: false,
  consent: 'unknown',
  via: 'dialog',
  bar: 'seen',
};

function record(runId: string, outcome: InpageRecord['outcome']): InpageRecord {
  return {
    marker: 'instapost-inpage:modes=check,test,shareTest,post',
    runId,
    mode: 'post',
    writeBlocked: false,
    photo: null,
    toggles: { ua: 'tabwide', frame: 'auto', view: 'phone', xfoRule: 'on', fetchDest: 'document' },
    startedAt: 1000,
    endedAt: outcome ? 19_000 : null,
    outcome,
    code: null,
    detail: null,
    locked: null,
    tabId: 3,
    frame: null,
    rules: null,
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
  } as unknown as InpageRecord;
}

function show(rec: InpageRecord, running: boolean): void {
  S.tabId.value = 3;
  S.seen.value = new Set([...S.seen.value, rec.runId]);
  S.status.value = { running, tabId: 3, record: rec };
}

describe('RV-2 a repost after a result', () => {
  it('a finished, undismissed result is dismissed: the intake shows', () => {
    show(record('inp_a', 'posted'), false);
    S.autoClose.value = Date.now();
    S.seal.value = true;
    expect(S.view.value).toBe('result');
    expect(S.takeRepost(SRC)).toBe(true);
    expect(R.intake.value?.state).toBe('loading');
    expect(S.dismissed.value.has('inp_a')).toBe(true);
    expect(S.view.value).toBe('import');
    expect([S.autoClose.value, S.seal.value]).toEqual([null, false]);
  });
  it('a run in flight keeps its view; an invalid source changes nothing', () => {
    show(record('inp_b', null), true);
    expect(S.view.value).toBe('run');
    S.takeRepost(SRC);
    expect(S.dismissed.value.has('inp_b')).toBe(false);
    expect(S.view.value).toBe('run');
    show(record('inp_c', 'unknown'), false);
    expect(S.view.value).toBe('result');
    expect(S.takeRepost({ kind: 'post' })).toBe(false);
    expect(S.view.value).toBe('result');
  });
});
