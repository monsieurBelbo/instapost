/**
 * Human-pace caps on composer opens, all modes, `probe` included (strategy §3.6, SG9, U10).
 * Settings may only make them stricter. The open log (epoch ms) lives in storage.local so
 * the caps survive browser restarts.
 */

export interface RateCaps {
  /** Minimum time between two composer opens. */
  minSpacingMs: number;
  /** Rolling 60-minute window. */
  maxPerHour: number;
  /** Local calendar day. */
  maxPerDay: number;
}

export const DEFAULT_RATE_CAPS: Readonly<RateCaps> = { minSpacingMs: 60_000, maxPerHour: 6, maxPerDay: 15 };
export const HOUR_MS = 3_600_000;

/** Local-day boundaries, injected so tests do not depend on the machine's time zone. */
export interface LocalDay {
  /** Epoch ms of local midnight at or before `t`. */
  startOf(t: number): number;
}

export type RateDecision =
  | { ok: true }
  | { ok: false; code: 'RATE_LIMITED'; rule: 'spacing' | 'hour' | 'day'; freeAt: number };

/** A user value that may replace the default: a finite number (counts: at least 1, floored). */
function stricterCount(def: number, user: unknown): number {
  if (typeof user !== 'number' || !Number.isFinite(user) || user < 1) return def;
  return Math.min(def, Math.floor(user));
}
function stricterSpacing(def: number, user: unknown): number {
  if (typeof user !== 'number' || !Number.isFinite(user) || user < 0) return def;
  return Math.max(def, user);
}

/**
 * Merges user caps with the defaults, field by field, keeping the stricter value
 * (max spacing, min counts). Invalid or looser user values are ignored. Counts below 1 are
 * invalid (the lane is disabled by the msite lock, not by a zero cap), non-integers are floored.
 */
export function effectiveCaps(user?: Partial<RateCaps> | null): RateCaps {
  return {
    minSpacingMs: stricterSpacing(DEFAULT_RATE_CAPS.minSpacingMs, user?.minSpacingMs),
    maxPerHour: stricterCount(DEFAULT_RATE_CAPS.maxPerHour, user?.maxPerHour),
    maxPerDay: stricterCount(DEFAULT_RATE_CAPS.maxPerDay, user?.maxPerDay),
  };
}

/**
 * Start of the next local day. `startOf(today) + 26 h` always lands inside tomorrow, since a
 * local day lasts 23–25 h across DST changes.
 */
export function nextDayStart(now: number, day: LocalDay): number {
  return day.startOf(day.startOf(now) + 26 * HOUR_MS);
}

/**
 * Whether a composer may open at `now`, given previous opens. `freeAt` says when the lane frees
 * up: the latest of the violated rules' free times, so every cap passes at `freeAt` (absent
 * new opens). The rolling hour is `(now − 1 h, now]`: an open exactly 1 h ago no longer counts.
 * Opens timestamped after `now` (a clock that went back) count against every cap.
 */
export function checkRate(opens: readonly number[], now: number, caps: RateCaps, day: LocalDay): RateDecision {
  const limits: { rule: 'spacing' | 'hour' | 'day'; freeAt: number }[] = [];
  if (opens.length > 0) limits.push({ rule: 'spacing', freeAt: Math.max(...opens) + caps.minSpacingMs });

  const inHour = opens.filter((t) => t > now - HOUR_MS).sort((a, b) => a - b);
  if (inHour.length >= caps.maxPerHour) {
    // The lane frees once only maxPerHour − 1 opens remain inside the window.
    limits.push({ rule: 'hour', freeAt: (inHour[inHour.length - caps.maxPerHour] ?? now) + HOUR_MS });
  }

  const today = day.startOf(now);
  if (opens.filter((t) => t >= today).length >= caps.maxPerDay) {
    limits.push({ rule: 'day', freeAt: nextDayStart(now, day) });
  }

  const blocking = limits.filter((l) => l.freeAt > now);
  if (blocking.length === 0) return { ok: true };
  const worst = blocking.reduce((a, b) => (b.freeAt >= a.freeAt ? b : a));
  return { ok: false, code: 'RATE_LIMITED', rule: worst.rule, freeAt: worst.freeAt };
}

/**
 * Test runs (check, setup test, Share test) are exempt from the hourly and daily caps (owner,
 * 2026-10-14): only the spacing applies, measured from the latest Instagram load of either kind.
 * Real posts keep every cap, plus the same spacing after a test run.
 */
export function checkRateFor(
  kind: 'post' | 'test',
  opens: readonly number[],
  lastTestOpen: number | null,
  now: number,
  caps: RateCaps,
  day: LocalDay,
): RateDecision {
  const spacingFree = lastTestOpen === null ? null : lastTestOpen + caps.minSpacingMs;
  if (kind === 'test') {
    const latest = Math.max(lastTestOpen ?? Number.NEGATIVE_INFINITY, ...opens);
    const freeAt = latest + caps.minSpacingMs;
    return Number.isFinite(latest) && freeAt > now
      ? { ok: false, code: 'RATE_LIMITED', rule: 'spacing', freeAt }
      : { ok: true };
  }
  const d = checkRate(opens, now, caps, day);
  if (spacingFree === null || spacingFree <= now) return d;
  if (d.ok) return { ok: false, code: 'RATE_LIMITED', rule: 'spacing', freeAt: spacingFree };
  return spacingFree > d.freeAt ? { ...d, rule: 'spacing', freeAt: spacingFree } : d;
}

/**
 * Drops entries that can no longer affect any cap (older than both the hour window and the
 * local day). The most recent open is always kept, so a stricter user spacing longer than an
 * hour still sees it. Returned in ascending order.
 */
export function pruneOpens(opens: readonly number[], now: number, day: LocalDay): number[] {
  if (opens.length === 0) return [];
  const latest = Math.max(...opens);
  const today = day.startOf(now);
  return opens.filter((t) => t === latest || t > now - HOUR_MS || t >= today).sort((a, b) => a - b);
}

/** UX §4.10/§4.11: opens counted against the caps at `now` (the rolling hour and the local day). */
export interface RateCounts {
  hour: number;
  today: number;
}

export function rateCounts(opens: readonly number[], now: number, day: LocalDay): RateCounts {
  const today = day.startOf(now);
  return {
    hour: opens.filter((t) => t > now - HOUR_MS).length,
    today: opens.filter((t) => t >= today).length,
  };
}
