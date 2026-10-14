/**
 * U27 (ux.md §4.5, IU3): the Post card's state, K1–K13, the first match wins. Only the button and the note
 * change; a run in progress (K7) and a queued post (K11) come before the one-time setup test (K6) and the
 * duplicate guard (K8).
 */
import { describe, expect, it } from 'vitest';
import type { Lane } from '../core/handoff/state.ts';
import { clock } from './copy.ts';
import { type PostCardInput, postCardState } from './post-card.ts';

const NOW = Date.UTC(2026, 9, 13, 12);
const lane = (kind: Lane['kind'], over: Partial<Lane> = {}): Lane => ({
  kind,
  today: 1,
  hour: 1,
  caps: { hour: 6, day: 15 },
  ...over,
});
const ready: PostCardInput = {
  hasPhoto: true,
  fontsReady: true,
  phoneOnly: null,
  pausedUntil: null,
  brandedTestBuild: null,
  testPassed: true,
  lane: lane('ready'),
  story: null,
  now: NOW,
};
const id = (over: Partial<PostCardInput>) => postCardState({ ...ready, ...over }).id;

describe('U27 the Post card', () => {
  it('K13: ready to post', () => {
    expect(postCardState(ready)).toMatchObject({ id: 'K13', label: 'Post story', action: 'post', disabled: false });
  });

  it('K1, K2: no photo, then no font yet: disabled, nothing to do', () => {
    expect(postCardState({ ...ready, hasPhoto: false })).toMatchObject({ id: 'K1', disabled: true, action: null });
    expect(postCardState({ ...ready, fontsReady: false })).toMatchObject({ id: 'K2', disabled: true });
    // The first match wins.
    expect(id({ hasPhoto: false, fontsReady: false, pausedUntil: NOW + 1 })).toBe('K1');
  });

  it('K3: a frame only the phone can post sends to the phone', () => {
    expect(postCardState({ ...ready, phoneOnly: 'Music needs the phone.' })).toMatchObject({
      id: 'K3',
      action: 'sendToPhone',
      note: 'Music needs the phone.',
    });
  });

  it('K4: paused by the kill switch until a date; an expired pause no longer counts', () => {
    expect(postCardState({ ...ready, pausedUntil: NOW + 86_400_000 })).toMatchObject({ id: 'K4', disabled: true });
    expect(id({ pausedUntil: NOW - 1 })).toBe('K13');
  });

  it('K5: a test build in a branded browser', () => {
    expect(postCardState({ ...ready, brandedTestBuild: 'Arc' }).note).toContain('Arc');
  });

  it('K7 and K11 come before the setup test: a running test or a queued post shows itself', () => {
    expect(postCardState({ ...ready, testPassed: false, lane: lane('busy', { handoffId: 'hof_1' }) })).toMatchObject({
      id: 'K7',
      label: 'Posting…',
      disabled: true,
      link: { action: 'showRun' },
    });
    expect(
      postCardState({ ...ready, testPassed: false, lane: lane('queued', { freeAt: NOW + 42_000 }) }),
    ).toMatchObject({ id: 'K11', label: 'Cancel', action: 'cancelQueue', note: 'Starting in 0:42…' });
  });

  it('K7 says what is running, and when the last run’s window is only held open', () => {
    const busy = lane('busy', { handoffId: 'hof_1' });
    expect(postCardState({ ...ready, lane: busy, busy: { mode: 'test', held: false } }).label).toBe('Testing…');
    expect(postCardState({ ...ready, lane: busy, busy: { mode: 'check', held: false } }).label).toBe('Checking…');
    expect(postCardState({ ...ready, lane: busy, busy: { mode: 'post', held: false } }).label).toBe('Posting…');
    expect(postCardState({ ...ready, lane: busy, busy: { mode: 'test', held: 'offerManual' } })).toMatchObject({
      label: 'Instagram window open',
      note: expect.stringContaining('Press Done'),
    });
  });

  it('AP-10: a window held while Instagram may still upload: no “Press Done” (Done keeps it), its close time', () => {
    const busy = lane('busy', { handoffId: 'hof_1' });
    const closeAt = NOW + 14 * 60_000;
    const k7 = postCardState({ ...ready, lane: busy, busy: { mode: 'post', held: 'upload', closeAt } });
    expect(k7).toMatchObject({ id: 'K7', label: 'Instagram window open', disabled: true });
    expect(k7.note).not.toContain('Done');
    expect(k7.note).toContain('may still be uploading');
    expect(k7.note).toContain(clock(closeAt));
    expect(postCardState({ ...ready, lane: busy, busy: { mode: 'post', held: 'close' } }).note).toContain('Press Done');
  });

  it('K6: one setup test before the first post', () => {
    expect(postCardState({ ...ready, testPassed: false })).toMatchObject({
      id: 'K6',
      label: 'Run setup test',
      action: 'setupTest',
    });
  });

  it('K8: this story may already be posted (Couldn’t confirm): Check my story first, posting again is a link', () => {
    const k8 = postCardState({ ...ready, story: { kind: 'unknown', at: NOW - 60_000 } });
    expect(k8).toMatchObject({ id: 'K8', action: 'checkStory', link: { action: 'post' } });
    // It comes before the pace states.
    expect(id({ story: { kind: 'unknown', at: NOW }, lane: lane('hourly', { freeAt: NOW + 600_000 }) })).toBe('K8');
  });

  it('K9: the hourly or daily cap: disabled until a time', () => {
    expect(postCardState({ ...ready, lane: lane('hourly', { freeAt: NOW + 600_000 }) })).toMatchObject({
      id: 'K9',
      disabled: true,
      note: '6 posts in the past hour.',
    });
    expect(postCardState({ ...ready, lane: lane('daily', { freeAt: NOW + 6e7 }) }).note).toContain('daily limit');
  });

  it('K10: within the 60 s spacing the button queues the post', () => {
    expect(postCardState({ ...ready, lane: lane('spacing', { freeAt: NOW + 25_000 }) })).toMatchObject({
      id: 'K10',
      label: 'Post story · in 0:25',
      action: 'queuePost',
      disabled: false,
    });
  });

  it('K12: this story was posted: Post again, quiet', () => {
    expect(postCardState({ ...ready, story: { kind: 'posted', at: NOW - 60_000 } })).toMatchObject({
      id: 'K12',
      label: 'Post again',
      action: 'post',
      quiet: true,
    });
  });

  it('K12 wins over K10: right after a post the card says so, and Post again waits for the spacing', () => {
    expect(
      postCardState({
        ...ready,
        story: { kind: 'posted', at: NOW - 5000 },
        lane: lane('spacing', { freeAt: NOW + 42_000 }),
      }),
    ).toMatchObject({ id: 'K12', label: 'Post again · in 0:42', action: 'queuePost', quiet: true, disabled: false });
  });

  it('every state has a note, and a disabled state never has an action', () => {
    const inputs: Partial<PostCardInput>[] = [
      { hasPhoto: false },
      { fontsReady: false },
      { phoneOnly: 'x' },
      { pausedUntil: NOW + 1 },
      { brandedTestBuild: 'Chrome' },
      { testPassed: false },
      { lane: lane('busy') },
      { story: { kind: 'unknown', at: NOW } },
      { lane: lane('hourly', { freeAt: NOW + 1 }) },
      { lane: lane('spacing', { freeAt: NOW + 1 }) },
      { lane: lane('queued', { freeAt: NOW + 1 }) },
      { story: { kind: 'posted', at: NOW } },
      {},
    ];
    const ids = new Set<string>();
    for (const over of inputs) {
      const s = postCardState({ ...ready, ...over });
      ids.add(s.id);
      expect(s.note.length, s.id).toBeGreaterThan(0);
      if (s.disabled) expect(s.action, s.id).toBeNull();
    }
    expect(ids.size).toBe(13);
  });
});
