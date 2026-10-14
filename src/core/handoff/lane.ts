/**
 * The lane (ux.md §4.5 K4, K7, K9–K11, §8): what a click on Post story would do now, from the state, the
 * rate guard and the lock. Pure. The background pushes it as `handoff/lane` on connect and after every
 * transition, so the Post card knows before the click.
 *
 * Priority: paused (kill-switch lock) > busy (a hand-off runs) > queued > daily > hourly > spacing > ready.
 */
import type { RateCaps, RateCounts, RateDecision } from './rate-guard.ts';
import type { HandoffState, Lane } from './state.ts';

export function laneOf(
  state: HandoffState,
  rate: RateDecision,
  counts: RateCounts,
  caps: RateCaps,
  lockedUntil: number | null,
  now: number,
): Lane {
  const base = { today: counts.today, hour: counts.hour, caps: { hour: caps.maxPerHour, day: caps.maxPerDay } };
  if (lockedUntil !== null && lockedUntil > now) return { kind: 'paused', freeAt: lockedUntil, ...base };
  if (state.phase === 'queued') return { kind: 'queued', freeAt: state.startAt, handoffId: state.handoffId, ...base };
  if (state.phase !== 'idle') return { kind: 'busy', handoffId: state.handoffId, ...base };
  if (rate.ok) return { kind: 'ready', ...base };
  const kind = rate.rule === 'day' ? 'daily' : rate.rule === 'hour' ? 'hourly' : 'spacing';
  return { kind, freeAt: rate.freeAt, ...base };
}
