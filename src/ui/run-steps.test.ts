/**
 * U20 (ux.md §4.6, IU4): the run view's five steps from a status or a shown result. While running, the
 * status's step is active, earlier ones done, later ones pending; once the result is known, the step times
 * say what was established and the first step without its time is where the run ended.
 */
import { describe, expect, it } from 'vitest';
import type { AccountFacts, RunResult, StepTimes } from '../core/handoff/state.ts';
import { ERROR_COPY, STEP_COPY, slow20Text, slow60Text, uploadingText } from './copy.ts';
import { type StepSource, stepOrder, stepsFrom } from './run-steps.ts';

const T = Date.UTC(2026, 9, 13, 12);
const steps = (n: number): StepTimes => {
  const all: StepTimes = {
    opened: T,
    instagram: T + 3500,
    account: T + 3700,
    armed: T + 5100,
    composer: T + 7400,
    share: T + 9600,
    confirmed: T + 11_400,
  };
  const keys = ['instagram', 'account', 'composer', 'share', 'confirmed'] as const;
  const out: StepTimes = { opened: T };
  for (const k of keys.slice(0, n)) out[k] = all[k];
  if (n >= 3) out.armed = all.armed;
  return out;
};
const account: AccountFacts = {
  detected: 'testuser',
  candidates: 1,
  expected: 'testuser',
  decision: 'ok',
  confirmedBy: 'match',
};
const result = (r: Partial<RunResult> & Pick<RunResult, 'kind'>): RunResult => ({ alarms: [], at: T + 12_000, ...r });
const view = (src: Partial<StepSource> & Pick<StepSource, 'phase'>, now = T + 10_000) =>
  stepsFrom({ mode: 'post', startedAt: T, account, ...src }, now);
const statuses = (src: Partial<StepSource> & Pick<StepSource, 'phase'>, now?: number) =>
  view(src, now).map((s) => s.status);

describe('U20 while running', () => {
  it('queued: every step pending', () => {
    expect(statuses({ phase: 'queued' })).toEqual(['pending', 'pending', 'pending', 'pending', 'pending']);
  });

  it('the status’s step is active, earlier ones done, later ones pending', () => {
    const v = view({ phase: 'inserting', step: 'story', steps: steps(2) });
    expect(v.map((s) => s.status)).toEqual(['done', 'done', 'active', 'pending', 'pending']);
    expect(v[1]?.text).toBe('Logged in as @testuser');
    expect(v[2]).toMatchObject({ text: STEP_COPY.story.active, since: T + 3700 });
  });

  it('the account prompt waits for the owner', () => {
    const v = view({ phase: 'awaitingAccount', step: 'account', steps: steps(1) });
    expect(v[1]).toMatchObject({ status: 'waiting', text: 'Waiting for your answer…' });
  });

  it('Finish by hand: the owner’s turn, not a spinner', () => {
    const v = view({ phase: 'manual', step: 'story', steps: steps(2) });
    expect(v[2]).toMatchObject({ status: 'waiting', text: 'Your turn in the Instagram window…' });
  });

  it('confirming: Instagram is uploading, with a note after 20 s and another after 60 s', () => {
    const src = { phase: 'confirmingUpload' as const, step: 'confirm' as const, steps: steps(4) };
    expect(view(src, T + 9600 + 5000)[4]).toMatchObject({ status: 'active', text: uploadingText() });
    expect(view(src, T + 9600 + 5000)[4]?.note).toBeUndefined();
    expect(view(src, T + 9600 + 21_000)[4]?.note).toBe(slow20Text());
    expect(view(src, T + 9600 + 61_000)[4]?.note).toBe(slow60Text());
  });

  it('the Instagram step shows the window it got', () => {
    const v = view({
      phase: 'probing',
      step: 'account',
      steps: steps(1),
      window: {
        screen: { availLeft: 0, availTop: 0, availWidth: 1512, availHeight: 949 },
        requested: { left: 0, top: 0, width: 511, height: 941 },
        created: null,
        createdTab: null,
        frameDelta: null,
        updates: [],
        attempts: 1,
        manualResize: false,
        finalTab: { w: 511, h: 909 },
        zoom: 1,
      },
    });
    expect(v[0]?.text).toBe('Instagram open — mobile site, 511 × 909');
  });

  it('a test run’s later steps say what a test does: Share found, not pressed; Confirm skipped', () => {
    const v = view({ phase: 'openingEntry', mode: 'test', step: 'story', steps: steps(2) });
    expect(v[3]).toMatchObject({ status: 'pending', text: 'Finds Share, doesn’t press it' });
    expect(v[4]).toMatchObject({ status: 'pending', text: 'Skipped in a test run' });
    const st = view({ phase: 'openingEntry', mode: 'shareTest', step: 'story', steps: steps(2) });
    expect(st[3]?.text).toBe('Presses Share with publishing blocked');
  });

  it('a check has two steps', () => {
    expect(stepOrder('check')).toEqual(['instagram', 'account']);
    expect(view({ phase: 'probing', mode: 'check', step: 'instagram' })).toHaveLength(2);
  });
});

describe('U20 once the result is known', () => {
  it('Posted: every step done; Facebook only when Instagram cross-posted', () => {
    const v = view({ phase: 'finished', steps: steps(5), result: result({ kind: 'posted' }) });
    expect(v.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(v[3]?.text).toBe('Shared');
    const fb = view({
      phase: 'finished',
      steps: steps(5),
      result: result({ kind: 'posted', facebook: true }),
      compose: {
        onComposer: true,
        drawn: true,
        landscape: false,
        controls: 1,
        variant: 'v2',
        fbAuto: true,
        settled: true,
        settleMs: 1500,
        canvas: null,
        imageScore: null,
      },
    });
    expect(fb[3]?.text).toBe('Shared · also to Facebook');
  });

  it('a test passes at the composer: Share found but not pressed, Confirm skipped', () => {
    const v = view({ phase: 'finished', mode: 'test', steps: steps(3), result: result({ kind: 'tested' }) });
    expect(v.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done', 'skipped']);
    expect(v[3]?.text).toBe(STEP_COPY.share.test);
    expect(v[4]?.text).toBe(STEP_COPY.confirm.test);
  });

  it('a Share test: Share pressed with publishing blocked, the upload blocked as expected', () => {
    const v = view({ phase: 'finished', mode: 'shareTest', steps: steps(5), result: result({ kind: 'shareTested' }) });
    expect(v.map((s) => s.text)).toEqual([
      expect.any(String),
      expect.any(String),
      expect.any(String),
      STEP_COPY.share.shareTest,
      STEP_COPY.confirm.shareTest,
    ]);
  });

  it('Not posted before Share: the step that failed carries the code’s title, the rest stay pending', () => {
    const v = view({
      phase: 'finished',
      steps: steps(2),
      result: result({ kind: 'notPosted', code: 'STORY_ENTRY_MISSING' }),
    });
    expect(v.map((s) => s.status)).toEqual(['done', 'done', 'failed', 'pending', 'pending']);
    expect(v[2]?.text).toBe(ERROR_COPY.STORY_ENTRY_MISSING.title);
    // Steps never reached say nothing (no "Pressing Share…" under a failure).
    expect(v[3]?.text).toBe('');
    expect(v[4]?.text).toBe('');
  });

  it('Couldn’t confirm after Share: Share done, Confirm unknown', () => {
    const v = view({
      phase: 'finished',
      steps: steps(4),
      result: result({ kind: 'unknown', code: 'OUTCOME_UNKNOWN', why: 'no-upload-seen' }),
    });
    expect(v.map((s) => s.status)).toEqual(['done', 'done', 'done', 'done', 'unknown']);
    expect(v[4]?.text).toBe('Couldn’t confirm');
  });

  it('a test leak is named as such', () => {
    const v = view({ phase: 'finished', steps: steps(4), result: result({ kind: 'unknown', code: 'TEST_LEAK' }) });
    expect(v[4]).toMatchObject({ status: 'unknown', text: ERROR_COPY.TEST_LEAK.title });
  });

  it('a stop is where the run was', () => {
    const v = view({ phase: 'idle', steps: steps(1), result: result({ kind: 'stopped', stoppedBy: 'owner' }) });
    expect(v.map((s) => s.status)).toEqual(['done', 'skipped', 'pending', 'pending', 'pending']);
  });

  it('a check: both steps done', () => {
    const v = view({ phase: 'finished', mode: 'check', steps: steps(2), result: result({ kind: 'checked' }) });
    expect(v.map((s) => s.status)).toEqual(['done', 'done']);
  });

  it('AP-9: a Post story that ended as a Share test (a guarded build) reads as a Share test', () => {
    const v = view({ phase: 'finished', mode: 'post', steps: steps(5), result: result({ kind: 'shareTested' }) });
    expect(v[3]?.text).toBe(STEP_COPY.share.shareTest);
    expect(v[4]?.text).toBe(STEP_COPY.confirm.shareTest);
    expect(v.map((s) => s.text).join(' ')).not.toContain('Instagram confirmed');
    expect(v.map((s) => s.text)).not.toContain('Shared');
  });

  it('AP-3: an owner’s mark is not Instagram’s confirmation', () => {
    const marked = result({ kind: 'posted', why: 'no-upload-seen', markedBy: 'owner' });
    const v = view({ phase: 'finished', steps: steps(4), result: marked });
    expect(v[4]?.text).toBe('Marked as posted by you');
    expect(v.map((s) => s.text).join(' ')).not.toContain('Instagram confirmed');
    const not = view({
      phase: 'finished',
      steps: steps(4),
      result: result({ kind: 'notPosted', code: 'OUTCOME_UNKNOWN', markedBy: 'owner' }),
    });
    expect(not[4]).toMatchObject({ status: 'failed', text: 'Marked as not posted by you' });
  });
});
