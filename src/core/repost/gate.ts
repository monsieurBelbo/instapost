/**
 * Repost (docs/repost.md RP-8): the state of an Add to story entry (the Share dialog's strip, the fallback
 * popover, the DM and viewer pills). The first matching row wins:
 *
 * | state      | when                                                   | shows                     |
 * |------------|--------------------------------------------------------|---------------------------|
 * | off        | Settings → Show Add to story is off                    | nothing                   |
 * | unreadable | no author, no permalink or no valid CDN candidate       | nothing (fail closed)     |
 * | expired    | a mention 24 h old or older                            | disabled, expired         |
 * | video      | the chosen media is a video, or a reel                 | disabled, Videos later    |
 * | blocked    | sharing known disabled (RP-16), not the owner's own    | disabled, doesn't allow   |
 * | busy       | a run is in progress in any tab                        | disabled, wait            |
 * | ready      | otherwise                                              | enabled                   |
 *
 * Pure.
 */
import type { ReshareVerdict } from './ssr-flags.ts';

export type EntryState = 'off' | 'unreadable' | 'expired' | 'video' | 'blocked' | 'busy' | 'ready';

/** A mention can be reposted while the story is under this old (Instagram's 24 h). */
export const MENTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface EntryFacts {
  pref: boolean;
  readable: boolean;
  video: boolean;
  consent: ReshareVerdict;
  isOwn: boolean;
  busy: boolean;
  /** Mentions: the story's age (ms), when the page shows it. */
  ageMs?: number | null;
}

export function entryState(f: EntryFacts): EntryState {
  if (!f.pref) return 'off';
  if (!f.readable) return 'unreadable';
  if (typeof f.ageMs === 'number' && f.ageMs >= MENTION_MAX_AGE_MS) return 'expired';
  if (f.video) return 'video';
  if (f.consent === 'blocked' && !f.isOwn) return 'blocked';
  if (f.busy) return 'busy';
  return 'ready';
}

/** Whether the entry shows at all (off and unreadable show nothing). */
export const entryShown = (s: EntryState): boolean => s !== 'off' && s !== 'unreadable';
/** Whether the entry is clickable. */
export const entryEnabled = (s: EntryState): boolean => s === 'ready';
