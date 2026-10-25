/**
 * RL-13: the in-page duplicate guard over the stored run records (K8, K12): the same story (export SHA-256 or
 * doc hash) posted, or Couldn't confirm, within 24 h; the owner's marks correct it. The records are what
 * storage.local keeps, so this is the state after View story / Check my story reloads the page.
 */
import { describe, expect, it } from 'vitest';
import type { InpageRecord } from './driver.ts';
import { applyMark, DUPLICATE_WINDOW_MS, markedKind, storyStatus, withRecord } from './story-guard.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const DOC_A = 'd'.repeat(64);
const T0 = Date.UTC(2026, 9, 15, 12);

function rec(over: Partial<InpageRecord> = {}): InpageRecord {
  return {
    marker: 'instapost-inpage:modes=check,test,shareTest,post',
    runId: 'inp_1',
    mode: 'post',
    writeBlocked: false,
    photo: { source: 'export', mime: 'image/png', bytes: 10, sha256: A, docHash: DOC_A },
    toggles: { ua: 'tabwide', frame: 'auto', view: 'phone', xfoRule: 'on', fetchDest: 'document' },
    startedAt: T0 - 20_000,
    endedAt: T0,
    outcome: 'unknown',
    code: 'OUTCOME_UNKNOWN',
    detail: 'configure-5xx',
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
    rules: { installed: [], after: [], ua: 'tabwide' },
    orientation: null,
    probe: null,
    readyProbe: null,
    account: { detected: 'owner', expected: 'owner', decision: 'ok' },
    entry: null,
    compose: null,
    share: { sent: true, done: true, refused: null, decision: 'unknown configure-5xx' },
    net: [],
    pageUrls: [],
    steps: [],
    ...over,
  };
}

/** What the composer reads after a page load: the stored list, as JSON round-trips it. */
const reloaded = (list: InpageRecord[]): InpageRecord[] => JSON.parse(JSON.stringify(list)) as InpageRecord[];

describe('RL-13 the in-page duplicate guard', () => {
  it('K8: a Couldn’t confirm of the same export within 24 h, after a reload', () => {
    const list = reloaded([rec()]);
    expect(storyStatus({ sha256: A, docHash: null }, T0 + 60_000, list)).toEqual({
      kind: 'unknown',
      at: T0,
      runId: 'inp_1',
    });
    // The doc hash alone matches too (a re-render that changed the PNG bytes).
    expect(storyStatus({ sha256: B, docHash: DOC_A }, T0 + 60_000, list)?.kind).toBe('unknown');
    // Another story, or 24 h later: no guard.
    expect(storyStatus({ sha256: B, docHash: null }, T0 + 60_000, list)).toBeNull();
    expect(storyStatus({ sha256: A, docHash: null }, T0 + DUPLICATE_WINDOW_MS + 1, list)).toBeNull();
    expect(storyStatus(null, T0, list)).toBeNull();
    expect(storyStatus({ sha256: null, docHash: null }, T0, list)).toBeNull();
  });

  it('K12: a Posted of the same export survives the reload; a later run of it decides', () => {
    const posted = rec({ runId: 'inp_2', outcome: 'posted', code: null, detail: 'configure 200' });
    expect(storyStatus({ sha256: A, docHash: null }, T0 + 1000, reloaded([posted]))?.kind).toBe('posted');
    // Couldn't confirm, then posted again (It didn't post — post again): the latest run wins.
    const later = { ...posted, endedAt: T0 + 5000, startedAt: T0 + 3000 };
    expect(storyStatus({ sha256: A, docHash: null }, T0 + 6000, [rec(), later])).toMatchObject({
      kind: 'posted',
      runId: 'inp_2',
    });
  });

  it('tests and checks never count, nor a post that could not have posted', () => {
    const test = rec({ mode: 'test', writeBlocked: true, outcome: 'tested', code: null });
    const notPosted = rec({ outcome: 'notPosted', code: 'UPLOAD_FAILED' });
    const stopped = rec({ outcome: 'stopped', code: 'PAGE_IN_USE', share: null });
    for (const r of [test, notPosted, stopped]) expect(storyStatus({ sha256: A, docHash: DOC_A }, T0, [r])).toBeNull();
    // A stop after Share is "may be live" (run-view mayBeLive): it counts as Couldn't confirm.
    const afterShare = rec({ outcome: 'stopped', code: 'PAGE_LEFT' });
    expect(storyStatus({ sha256: A, docHash: null }, T0, [afterShare])?.kind).toBe('unknown');
  });

  it('the owner’s marks: It posted → K12, It didn’t post → no guard; only on a post’s Couldn’t confirm', () => {
    const list = [rec(), rec({ runId: 'inp_9', mode: 'test', outcome: 'tested', code: null })];
    const yes = applyMark(list, 'inp_1', 'posted', T0 + 10);
    expect(yes[0]).toMatchObject({ mark: 'posted', markedAt: T0 + 10 });
    expect(markedKind(yes[0] as InpageRecord)).toBe('posted');
    expect(storyStatus({ sha256: A, docHash: null }, T0 + 20, reloaded(yes))?.kind).toBe('posted');
    const no = applyMark(yes, 'inp_1', 'notPosted', T0 + 30);
    expect(markedKind(no[0] as InpageRecord)).toBe('failed');
    expect(storyStatus({ sha256: A, docHash: null }, T0 + 40, reloaded(no))).toBeNull();
    // A test (or any record that is not a post's Couldn't confirm) is never marked.
    expect(applyMark(list, 'inp_9', 'posted', T0)[1]).toBe(list[1]);
    expect(applyMark(list, 'inp_x', 'posted', T0)).toEqual(list);
  });

  it('withRecord adds a result the store does not have yet, or replaces it by run id', () => {
    const a = rec();
    const b = rec({ runId: 'inp_2' });
    expect(withRecord([a], b).map((r) => r.runId)).toEqual(['inp_1', 'inp_2']);
    expect(withRecord([a, b], { ...a, mark: 'posted' }).map((r) => [r.runId, r.mark ?? null])).toEqual([
      ['inp_2', null],
      ['inp_1', 'posted'],
    ]);
  });
});
