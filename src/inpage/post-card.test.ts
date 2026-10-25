/**
 * The in-page Post card (FS4) and the result card's run buttons (FS11), pure (post-card.ts):
 * - RL-13: K8 (this story may already be posted) and K12 (posted) from the stored records, so they hold after
 *   the page reload of View story / Check my story; K12 holds through the spacing right after a post.
 * - RL-14: a result's Post story / Try again are paced: queued during the spacing, disabled under a cap.
 */
import { describe, expect, it } from 'vitest';
import type { RateDecision } from '../core/handoff/rate-guard.ts';
import type { InpageRecord } from './driver.ts';
import { type InpagePostInput, inpagePostCard, resultRunButton, resultRunMode } from './post-card.ts';
import { storyStatus } from './story-guard.ts';

const NOW = Date.UTC(2026, 9, 15, 12);
const SHA = 'a'.repeat(64);

const input = (over: Partial<InpagePostInput> = {}): InpagePostInput => ({
  now: NOW,
  pausedUntil: null,
  loggedIn: true,
  otherTab: false,
  queuedAt: null,
  rate: { ok: true },
  counts: { today: 1, hour: 1 },
  firstRun: false,
  story: null,
  hasPhoto: true,
  fontsReady: true,
  busy: false,
  preparing: null,
  textWarning: null,
  handle: 'owner',
  ...over,
});

const spacing = (left: number): RateDecision => ({
  ok: false,
  code: 'RATE_LIMITED',
  rule: 'spacing',
  freeAt: NOW + left,
});
const hourCap: RateDecision = { ok: false, code: 'RATE_LIMITED', rule: 'hour', freeAt: NOW + 20 * 60_000 };

/** A stored post record of the story SHA (as storage.local gives it back after a page load). */
function stored(outcome: InpageRecord['outcome'], code: string | null): InpageRecord {
  const r = {
    runId: 'inp_1',
    mode: 'post',
    photo: { source: 'export', mime: 'image/png', bytes: 1, sha256: SHA },
    startedAt: NOW - 120_000,
    endedAt: NOW - 100_000,
    outcome,
    code,
    share: { sent: true, done: true, refused: null, decision: null },
  };
  return JSON.parse(JSON.stringify(r)) as InpageRecord;
}

describe('RL-13 K8 and K12 in the in-page Post card', () => {
  it('a Couldn’t confirm of this story after a reload: K8, Check my story first, posting again is a link', () => {
    const story = storyStatus({ sha256: SHA, docHash: null }, NOW, [stored('unknown', 'OUTCOME_UNKNOWN')]);
    const c = inpagePostCard(input({ story }));
    expect(c).toMatchObject({ id: 'K8', icon: 'q', action: 'checkStory', disabled: false });
    expect(c.title).toBe('This story may already be posted');
    expect(c.note).toMatch(/, not confirmed\.$/);
    expect(c.link).toEqual({ label: 'It didn’t post — post again', action: 'post' });
    // During the spacing the link queues.
    const paced = inpagePostCard(input({ story, rate: spacing(30_000) }));
    expect(paced.link?.action).toBe('queuePost');
    expect(paced.freeAt).toBe(NOW + 30_000);
  });

  it('a Posted of this story after a reload: K12, Post again (quiet); in the spacing it reads Post again · in and queues', () => {
    const story = storyStatus({ sha256: SHA, docHash: null }, NOW, [stored('posted', null)]);
    const c = inpagePostCard(input({ story }));
    expect(c).toMatchObject({ id: 'K12', action: 'post', quiet: true, kbd: true, label: 'Post again' });
    expect(c.note).toBe('You posted this story already.');
    const paced = inpagePostCard(input({ story, rate: spacing(41_000) }));
    expect(paced).toMatchObject({
      id: 'K12',
      action: 'queuePost',
      label: 'Post again · in 0:41',
      freeAt: NOW + 41_000,
    });
  });

  it('another story: K13, or K10 during the spacing (a click queues)', () => {
    expect(inpagePostCard(input())).toMatchObject({ id: 'K13', action: 'post', label: 'Post story' });
    expect(inpagePostCard(input({ rate: spacing(42_000) }))).toMatchObject({
      id: 'K10',
      action: 'queuePost',
      label: 'Post story · in 0:42',
    });
  });

  it('the order: paused, logged out, another tab, queued, setup test, K8, the cap, K12', () => {
    const k8 = { kind: 'unknown' as const, at: NOW - 1000, runId: 'inp_1' };
    expect(inpagePostCard(input({ story: k8, pausedUntil: NOW + 1000 })).id).toBe('K4');
    expect(inpagePostCard(input({ story: k8, loggedIn: false })).id).toBe('KL');
    expect(inpagePostCard(input({ story: k8, otherTab: true })).id).toBe('K7');
    expect(inpagePostCard(input({ story: k8, queuedAt: NOW + 5000 }))).toMatchObject({
      id: 'K11',
      action: 'cancelQueue',
    });
    expect(inpagePostCard(input({ story: k8, firstRun: true })).id).toBe('K6');
    expect(inpagePostCard(input({ story: k8, rate: hourCap })).id).toBe('K8');
    const k12 = { ...k8, kind: 'posted' as const };
    expect(inpagePostCard(input({ story: k12, rate: hourCap }))).toMatchObject({ id: 'K9', disabled: true });
  });
});

describe('RL-14 the result card’s Post story and Try again are paced', () => {
  it('the setup test passed 25 s ago: Post story reads "Post story · in 0:35" and queues, it is not refused', () => {
    const b = resultRunButton('post', spacing(35_000), NOW, false);
    expect(b).toEqual({ label: 'Post story · in 0:35', disabled: false, queueAt: NOW + 35_000 });
  });

  it('a failure within the minute: Try again · 0:41, queued; free: Try again; capped: Available at, disabled', () => {
    expect(resultRunButton('tryAgain', spacing(41_000), NOW, false)).toEqual({
      label: 'Try again · 0:41',
      disabled: false,
      queueAt: NOW + 41_000,
    });
    expect(resultRunButton('tryAgain', { ok: true }, NOW, false)).toEqual({
      label: 'Try again',
      disabled: false,
      queueAt: null,
    });
    const capped = resultRunButton('post', hourCap, NOW, false);
    expect(capped.disabled).toBe(true);
    expect(capped.queueAt).toBeNull();
    expect(capped.label).toMatch(/^Available at /);
    expect(resultRunButton('post', { ok: true }, NOW, true)).toMatchObject({ label: 'Preparing…', disabled: true });
  });

  it('the mode tried again: a post as a post, a Share test as a test run, a check as a check', () => {
    expect(resultRunMode('post', { mode: 'test' })).toBe('post');
    expect(resultRunMode('tryAgain', { mode: 'post' })).toBe('post');
    expect(resultRunMode('tryAgain', { mode: 'shareTest' })).toBe('test');
    expect(resultRunMode('tryAgain', { mode: 'check' })).toBe('check');
  });
});
