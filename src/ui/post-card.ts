/**
 * The Post card's state (ux.md §4.5, K1–K13, IU3). Pure: the first matching state wins. Only the button and
 * the note change; there are no dialogs.
 *
 * Order, as specified with three adjustments: K7 (a run in progress) and K11 (queued) come before K6 (the
 * one-time setup test) and K8, so a running setup test or a queued post shows its own state rather than
 * the "Run setup test" or "Check my story" buttons; and K12 (this story was posted) comes before K10 (the
 * 60 s spacing), so the duplicate guard holds in the minute right after a post (its button then queues).
 */
import type { HandoffMode, Lane } from '../core/handoff/state.ts';
import { clock, mmss, POST_NOTES } from './copy.ts';

export type PostCardStateId =
  | 'K1'
  | 'K2'
  | 'K3'
  | 'K4'
  | 'K5'
  | 'K6'
  | 'K7'
  | 'K8'
  | 'K9'
  | 'K10'
  | 'K11'
  | 'K12'
  | 'K13';

/** What the primary button does. */
export type PostAction = 'post' | 'queuePost' | 'setupTest' | 'sendToPhone' | 'checkStory' | 'cancelQueue' | 'showRun';

export interface PostCardInput {
  hasPhoto: boolean;
  fontsReady: boolean;
  /** K3: why this frame can only go from the phone (LANE_REASON_TEXT), or null. */
  phoneOnly: string | null;
  /** K4: the kill-switch lock (epoch ms) when active. */
  pausedUntil: number | null;
  /** K5: a guarded build in a branded browser: its name. */
  brandedTestBuild: string | null;
  /** OD10: a setup test passed on this install. */
  testPassed: boolean;
  lane: Lane | null;
  /** The duplicate guard (history.ts storyStatus): this story's last run within 24 h. */
  story: { kind: 'unknown' | 'posted'; at: number } | null;
  /**
   * K7: the running hand-off as this editor knows it: its mode; `held`: its result is in and the window is
   * still open, and why (AP-10): `upload` while Instagram may still upload (Done does not close it, until
   * `closeAt`), `offerManual` for Finish by hand, `close` closing on its own in a moment; false: running.
   */
  busy?: { mode: HandoffMode; held: false | 'upload' | 'offerManual' | 'close'; closeAt?: number | null } | null;
  now: number;
}

export interface PostCardState {
  id: PostCardStateId;
  label: string;
  action: PostAction | null;
  disabled: boolean;
  note: string;
  /** A secondary link under the note (K7 "Show it", K8 "It didn't post — post again"). */
  link?: { label: string; action: PostAction };
  /** Secondary-styled primary (K12 Post again). */
  quiet?: boolean;
}

export function postCardState(i: PostCardInput): PostCardState {
  if (!i.hasPhoto) return { id: 'K1', label: 'Post story', action: null, disabled: true, note: POST_NOTES.K1 };
  if (!i.fontsReady) return { id: 'K2', label: 'Post story', action: null, disabled: true, note: POST_NOTES.K2 };
  if (i.phoneOnly)
    return { id: 'K3', label: 'Send to phone…', action: 'sendToPhone', disabled: false, note: i.phoneOnly };
  if (i.pausedUntil !== null && i.pausedUntil > i.now) {
    return {
      id: 'K4',
      label: `Paused until ${new Date(i.pausedUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`,
      action: null,
      disabled: true,
      note: 'Desktop posting is paused. See the banner above.',
    };
  }
  if (i.brandedTestBuild) {
    return { id: 'K5', label: 'Post story', action: null, disabled: true, note: POST_NOTES.K5(i.brandedTestBuild) };
  }
  const lane = i.lane;
  if (lane?.kind === 'busy') {
    const b = i.busy ?? null;
    const label = b?.held
      ? 'Instagram window open'
      : b?.mode === 'test' || b?.mode === 'shareTest'
        ? 'Testing…'
        : b?.mode === 'check'
          ? 'Checking…'
          : 'Posting…';
    const note = b?.held
      ? b.held === 'upload'
        ? POST_NOTES.K7upload(b.closeAt ? clock(b.closeAt) : 'a later time')
        : POST_NOTES.K7held
      : b?.mode === 'test' || b?.mode === 'shareTest'
        ? POST_NOTES.K7test
        : b?.mode === 'check'
          ? POST_NOTES.K7check
          : POST_NOTES.K7;
    return { id: 'K7', label, action: null, disabled: true, note, link: { label: 'Show it', action: 'showRun' } };
  }
  if (lane?.kind === 'queued') {
    const left = (lane.freeAt ?? i.now) - i.now;
    return { id: 'K11', label: 'Cancel', action: 'cancelQueue', disabled: false, note: POST_NOTES.K11(mmss(left)) };
  }
  if (!i.testPassed)
    return { id: 'K6', label: 'Run setup test', action: 'setupTest', disabled: false, note: POST_NOTES.K6 };
  if (i.story?.kind === 'unknown') {
    return {
      id: 'K8',
      label: 'Check my story ↗',
      action: 'checkStory',
      disabled: false,
      note: POST_NOTES.K8(clock(i.story.at)),
      link: { label: 'It didn’t post — post again', action: 'post' },
    };
  }
  if (lane?.kind === 'hourly' || lane?.kind === 'daily') {
    return {
      id: 'K9',
      label: `Available at ${lane.freeAt ? clock(lane.freeAt) : 'later'}`,
      action: null,
      disabled: true,
      note: lane.kind === 'daily' ? POST_NOTES.K9day : POST_NOTES.K9hour,
    };
  }
  const spacing = lane?.kind === 'spacing' && lane.freeAt !== undefined && lane.freeAt - i.now <= 60_000;
  // The duplicate guard wins over the spacing: right after a post (the likeliest moment for an accidental
  // second one) the card says the story was posted, and Post again still waits for the spacing.
  if (i.story?.kind === 'posted') {
    const left = spacing && lane?.freeAt !== undefined ? lane.freeAt - i.now : null;
    return {
      id: 'K12',
      label: left !== null ? `Post again · in ${mmss(left)}` : 'Post again',
      action: left !== null ? 'queuePost' : 'post',
      disabled: false,
      note: POST_NOTES.K12(clock(i.story.at)),
      quiet: true,
    };
  }
  if (spacing && lane?.freeAt !== undefined) {
    return {
      id: 'K10',
      label: `Post story · in ${mmss(lane.freeAt - i.now)}`,
      action: 'queuePost',
      disabled: false,
      note: POST_NOTES.K10,
    };
  }
  return { id: 'K13', label: 'Post story', action: 'post', disabled: false, note: POST_NOTES.K13 };
}
