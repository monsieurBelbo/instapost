/**
 * U26 (ux.md §4.11, IU9): History's rows from hand-off records (this build's and earlier ones) and the
 * duplicate guard behind K8/K12: the same story (export SHA-256 or doc version) posted, or Couldn't confirm,
 * by a post in the last 24 h. Tests and checks never count; the latest matching run decides.
 */
import { describe, expect, it } from 'vitest';
import type { HandoffRecord, RunResult } from '../core/handoff/state.ts';
import { dayLabel, type HistoryRow, rowKind, storyStatus, toRow } from './history.ts';

const NOW = new Date(2026, 9, 13, 15, 0).getTime();
const H = 60 * 60 * 1000;

function rec(over: Partial<HandoffRecord> = {}): HandoffRecord {
  return {
    id: 'hof_1',
    exportId: 'exp_1',
    mode: 'post',
    chMode: 'full',
    phaseLog: [],
    outcome: 'posted',
    startedAt: NOW - 20_000,
    endedAt: NOW,
    ...over,
  };
}
const result = (r: Partial<RunResult> & Pick<RunResult, 'kind'>): RunResult => ({ alarms: [], at: NOW, ...r });
const row = (over: Partial<HistoryRow>): HistoryRow => ({
  ...toRow(rec()),
  exportSha256: 'sha-a',
  docHash: 'doc-a',
  ...over,
});

describe('U26 rows', () => {
  it('this build’s records: the result decides the kind, the account and the code', () => {
    const r = toRow(
      rec({
        result: result({ kind: 'notPosted', code: 'STORY_ENTRY_MISSING', account: 'testuser' }),
        outcome: 'failed:STORY_ENTRY_MISSING',
        durationMs: 9000,
        exportSha256: 'sha',
      }),
    );
    expect(r).toMatchObject({
      kind: 'notPosted',
      code: 'STORY_ENTRY_MISSING',
      account: 'testuser',
      durationMs: 9000,
      exportSha256: 'sha',
      marked: false,
    });
    expect(toRow(rec({ result: result({ kind: 'posted' }), markedBy: 'owner' })).marked).toBe(true);
    // AP-3: the mark travels on the result too (lastResult has no record around it).
    expect(toRow(rec({ result: result({ kind: 'posted', markedBy: 'owner' }) })).marked).toBe(true);
  });

  it('records of earlier builds: the outcome decides', () => {
    const kinds = (
      [
        ['posted-confirmed', 'posted'],
        ['posted', 'posted'],
        ['unknown', 'unknown'],
        ['abandoned', 'stopped'],
        ['cancelled', 'stopped'],
        ['failed:TIMEOUT', 'notPosted'],
        ['killed:KILLED_CHALLENGE', 'notPosted'],
        ['not-posted', 'notPosted'],
        ['tested', 'tested'],
        ['share-tested', 'shareTested'],
        ['checked', 'checked'],
      ] as const
    ).map(([outcome, kind]) => [rowKind(rec({ outcome })), kind]);
    for (const [got, want] of kinds) expect(got).toBe(want);
    expect(toRow(rec({ outcome: 'failed:TIMEOUT' })).code).toBe('TIMEOUT');
    expect(toRow(rec({ outcome: 'killed:KILLED_CHALLENGE' })).code).toBe('KILLED_CHALLENGE');
    expect(toRow(rec({ mode: 'probe', outcome: 'abandoned', level: 'H0' }))).toMatchObject({
      mode: 'probe',
      kind: 'stopped',
      durationMs: 20_000,
    });
  });
});

describe('U26 the duplicate guard (K8, K12)', () => {
  it('nothing to match without a hash', () => {
    expect(storyStatus(null, null, NOW, [row({ kind: 'posted' })])).toBeNull();
  });

  it('a post of the same export or the same doc version within 24 h', () => {
    expect(storyStatus('sha-a', null, NOW, [row({ kind: 'posted', at: NOW - H })])).toEqual({
      kind: 'posted',
      at: NOW - H,
    });
    expect(storyStatus(null, 'doc-a', NOW, [row({ kind: 'unknown', at: NOW - H })])).toEqual({
      kind: 'unknown',
      at: NOW - H,
    });
    expect(storyStatus('sha-b', 'doc-b', NOW, [row({ kind: 'posted' })])).toBeNull();
  });

  it('older than 24 h, a test, a check, or a failure never counts', () => {
    expect(storyStatus('sha-a', null, NOW, [row({ kind: 'posted', at: NOW - 25 * H })])).toBeNull();
    expect(storyStatus('sha-a', null, NOW, [row({ kind: 'shareTested', mode: 'shareTest' })])).toBeNull();
    expect(storyStatus('sha-a', null, NOW, [row({ kind: 'tested', mode: 'test' })])).toBeNull();
    expect(storyStatus('sha-a', null, NOW, [row({ kind: 'checked', mode: 'check' })])).toBeNull();
    expect(storyStatus('sha-a', null, NOW, [row({ kind: 'notPosted' })])).toBeNull();
  });

  it('the latest matching post decides: marked “It didn’t post” after a Couldn’t confirm clears the guard', () => {
    const unknown = row({ id: 'a', kind: 'unknown', at: NOW - 2 * H });
    const posted = row({ id: 'b', kind: 'posted', at: NOW - H });
    expect(storyStatus('sha-a', null, NOW, [unknown, posted])).toEqual({ kind: 'posted', at: NOW - H });
    const marked = row({ id: 'a', kind: 'notPosted', at: NOW - 2 * H, marked: true });
    expect(storyStatus('sha-a', null, NOW, [marked])).toBeNull();
  });
});

describe('U26 day labels', () => {
  it('Today, Yesterday, then a date', () => {
    expect(dayLabel(NOW - H, NOW)).toBe('Today');
    expect(dayLabel(NOW - 20 * H, NOW)).toBe('Yesterday');
    expect(dayLabel(NOW - 72 * H, NOW)).not.toMatch(/Today|Yesterday/);
  });
});
