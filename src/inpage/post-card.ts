/**
 * The in-page Post card (inpage-ui-spec.md FS4, ux.md §4.5 order) and the result card's run buttons (FS11).
 * Pure: the composer (entrypoints/composer/Rail.tsx) renders what these return, so the K-states, the
 * duplicate guard and the pace are unit-tested (post-card.test.ts).
 *
 * The first match wins, in the window lane's order (src/ui/post-card.ts): K4 paused, KL logged out, K7 a run
 * in another tab, K11 queued, K6 the setup test, K8 this story may already be posted (RL-13), K9 the hour or
 * day cap, K12 this story was posted (before K10, so the duplicate guard holds in the minute right after a
 * post; its button then queues), K10 the spacing (a click queues), K13 ready.
 *
 * RL-14: a result's Post story and Try again are paced like the Post card: during the spacing they read
 * `Post story · in 0:41` / `Try again · 0:41` and queue; under an hour or day cap they are disabled.
 */
import type { RateDecision } from '../core/handoff/rate-guard.ts';
import { clock, dateTime, mmss } from '../ui/copy.ts';
import type { InpageRecord } from './driver.ts';
import type { RunMode } from './messages.ts';
import type { ResultAction } from './run-view.ts';
import type { StoryStatus } from './story-guard.ts';
import { composerStrings as S } from './strings.ts';

export type InpagePostCardId = 'K4' | 'KL' | 'K7' | 'K11' | 'K6' | 'K8' | 'K9' | 'K12' | 'K10' | 'K13';

/** What the card's button (or its link) does. */
export type InpagePostAction = 'post' | 'queuePost' | 'setupTest' | 'cancelQueue' | 'checkStory' | 'showTab';

export interface InpagePostInput {
  now: number;
  /** K4: the kill-switch lock (epoch ms) while active. */
  pausedUntil: number | null;
  /** KL: the page reports logged out (null: unknown, the page shows no account yet). */
  loggedIn: boolean | null;
  /** K7: a run in another Instagram tab. */
  otherTab: boolean;
  /** K11: a queued run starts at this time. */
  queuedAt: number | null;
  /** The rate guard's decision for a post now. */
  rate: RateDecision | null;
  counts: { today: number; hour: number } | null;
  /** K6: no account learned yet (the setup test comes first). */
  firstRun: boolean;
  /** RL-13: the duplicate guard (story-guard.ts storyStatus) for the story on the stage. */
  story: StoryStatus | null;
  hasPhoto: boolean;
  fontsReady: boolean;
  /** Not connected, or a run is being prepared. */
  busy: boolean;
  preparing: RunMode | null;
  /** FS4's amber note, or null. */
  textWarning: string | null;
  handle: string | null;
}

export interface InpagePostCard {
  id: InpagePostCardId;
  title: string;
  icon: 'check' | 'q' | null;
  note: string;
  warn: boolean;
  label: string;
  /** The button shows ⌘↵. */
  kbd: boolean;
  /** Secondary-styled button (K11 Cancel, K12 Post again). */
  quiet: boolean;
  disabled: boolean;
  action: InpagePostAction | null;
  /** queuePost: the run may start at this time (the queue fires 400 ms after it). */
  freeAt?: number;
  /** A link after the note (K7 Show it, K8 It didn't post — post again). */
  link?: { label: string; action: InpagePostAction };
}

/** The queue fires this long after the spacing ends (the guard's clock and the composer's may differ a little). */
export const QUEUE_MARGIN_MS = 400;

const spacingLeft = (rate: RateDecision | null, now: number): number | null =>
  rate && !rate.ok && rate.rule === 'spacing' && rate.freeAt > now ? rate.freeAt : null;

export function inpagePostCard(i: InpagePostInput): InpagePostCard {
  const p = S.post;
  const t = i.now;
  const base = { icon: null, warn: false, kbd: false, quiet: false } as const;
  const postLabel = i.preparing === 'post' ? p.preparing : p.post;
  if (i.pausedUntil !== null && i.pausedUntil > t) {
    return {
      ...base,
      id: 'K4',
      title: p.pausedTitle,
      note: p.pausedNote,
      label: p.pausedButton(dateTime(i.pausedUntil)),
      disabled: true,
      action: null,
    };
  }
  if (i.loggedIn === false) {
    return {
      ...base,
      id: 'KL',
      title: p.loggedOutTitle,
      note: p.loggedOutNote,
      label: p.post,
      disabled: true,
      action: null,
    };
  }
  if (i.otherTab) {
    return {
      ...base,
      id: 'K7',
      title: p.otherTitle,
      note: p.otherNote,
      label: p.posting,
      disabled: true,
      action: null,
      link: { label: p.showIt, action: 'showTab' },
    };
  }
  if (i.queuedAt !== null) {
    return {
      ...base,
      id: 'K11',
      title: p.queuedTitle(mmss(i.queuedAt - t)),
      note: p.queuedNote,
      label: p.cancel,
      quiet: true,
      disabled: false,
      action: 'cancelQueue',
    };
  }
  if (i.firstRun) {
    return {
      ...base,
      id: 'K6',
      title: p.firstTitle,
      note: p.firstNote,
      label: i.preparing === 'test' ? p.preparing : p.firstButton,
      kbd: true,
      disabled: i.busy || !i.hasPhoto,
      action: 'setupTest',
    };
  }
  const rate = i.rate;
  const free = spacingLeft(rate, t);
  // RL-13 (K8): a Couldn't confirm of this very story within 24 h. Check first; posting again is a link.
  if (i.story?.kind === 'unknown') {
    return {
      ...base,
      id: 'K8',
      title: p.unconfirmedTitle,
      icon: 'q',
      note: p.unconfirmedNote(clock(i.story.at)),
      label: S.actions.checkStory,
      disabled: false,
      action: 'checkStory',
      link: { label: p.postAnyway, action: free !== null ? 'queuePost' : 'post' },
      ...(free !== null ? { freeAt: free } : {}),
    };
  }
  if (rate && !rate.ok && rate.freeAt > t && (rate.rule === 'hour' || rate.rule === 'day')) {
    return {
      ...base,
      id: 'K9',
      title: p.capTitle,
      note: rate.rule === 'day' ? p.capDay(i.counts?.today ?? 15) : p.capHour(i.counts?.hour ?? 6),
      label: p.capButton(clock(rate.freeAt)),
      disabled: true,
      action: null,
    };
  }
  // K12 before K10: right after a post (the likeliest moment for an accidental second one) the card says so.
  if (i.story?.kind === 'posted') {
    return {
      ...base,
      id: 'K12',
      title: p.postedAt(clock(i.story.at)),
      icon: 'check',
      note: p.postedNote,
      label: free !== null ? p.postAgainIn(mmss(free - t)) : p.postAgain,
      kbd: free === null,
      quiet: true,
      disabled: i.busy || !i.hasPhoto,
      action: free !== null ? 'queuePost' : 'post',
      ...(free !== null ? { freeAt: free } : {}),
    };
  }
  if (free !== null) {
    return {
      ...base,
      id: 'K10',
      title: p.ready,
      icon: 'check',
      note: p.spacingNote,
      label: p.spacingButton(mmss(free - t)),
      disabled: i.busy || !i.hasPhoto,
      action: 'queuePost',
      freeAt: free,
    };
  }
  return {
    ...base,
    id: 'K13',
    title: p.ready,
    icon: 'check',
    note: i.textWarning ?? p.readyNote(i.handle),
    warn: i.textWarning !== null,
    label: postLabel,
    kbd: true,
    disabled: i.busy || !i.hasPhoto || !i.fontsReady,
    action: 'post',
  };
}

// ---- the result card's run buttons (RL-14) --------------------------------------------------------------

/** The mode a result's Post story or Try again starts (a Share test is tried again as a test run). */
export function resultRunMode(a: 'post' | 'tryAgain', rec: Pick<InpageRecord, 'mode'>): RunMode {
  if (a === 'post') return 'post';
  return rec.mode === 'shareTest' ? 'test' : rec.mode;
}

export interface ResultRunButton {
  label: string;
  disabled: boolean;
  /** Spacing: the click queues the run for this time (plus QUEUE_MARGIN_MS) instead of starting it. */
  queueAt: number | null;
}

/**
 * A result's Post story / Try again, paced by the rate guard's decision for that run's kind (posts count
 * toward the caps, tests and checks only need the spacing).
 */
export function resultRunButton(
  a: 'post' | 'tryAgain',
  rate: RateDecision | null,
  now: number,
  preparing: boolean,
): ResultRunButton {
  const plain = a === 'post' ? S.actions.post : S.actions.tryAgain;
  if (preparing) return { label: S.post.preparing, disabled: true, queueAt: null };
  if (rate && !rate.ok && rate.freeAt > now) {
    if (rate.rule === 'spacing') {
      const left = mmss(rate.freeAt - now);
      return {
        label: a === 'post' ? S.post.spacingButton(left) : S.actions.tryAgainIn(left),
        disabled: false,
        queueAt: rate.freeAt,
      };
    }
    return { label: S.post.capButton(clock(rate.freeAt)), disabled: true, queueAt: null };
  }
  return { label: plain, disabled: false, queueAt: null };
}

/** Whether a result action starts a run (and so is paced). */
export const isRunAction = (a: ResultAction): a is 'post' | 'tryAgain' => a === 'post' || a === 'tryAgain';
