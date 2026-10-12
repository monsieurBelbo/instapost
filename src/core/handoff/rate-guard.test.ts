/**
 * U10 (strategy §7.11): 60 s spacing, 6 per rolling hour and 15 per local day, at the
 * boundaries; settings cannot loosen them. Time is injected (`now`, LocalDay), plus one run on
 * Vitest's fake clock to show the caps under a simulated session.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkRate,
  DEFAULT_RATE_CAPS,
  effectiveCaps,
  HOUR_MS,
  type LocalDay,
  nextDayStart,
  pruneOpens,
  type RateCaps,
} from './rate-guard.ts';

const MIN = 60_000;
const DAY = 24 * HOUR_MS;

/** A fixed-offset zone (no DST): UTC−3, the owner's es-AR default. */
const utcMinus3: LocalDay = { startOf: (t) => Math.floor((t - 3 * HOUR_MS) / DAY) * DAY + 3 * HOUR_MS };
/** Local midnight of 2026-10-12 in UTC−3 (03:00Z). */
const MIDNIGHT = Date.UTC(2026, 9, 12, 3);
const at = (h: number, m = 0, s = 0, ms = 0) => MIDNIGHT + h * HOUR_MS + m * MIN + s * 1000 + ms;
const caps: RateCaps = { ...DEFAULT_RATE_CAPS };

describe('U10 rate guard: spacing', () => {
  it('refuses 59.999 s after an open and allows at exactly 60 s', () => {
    const opens = [at(10)];
    expect(checkRate(opens, at(10, 0, 59, 999), caps, utcMinus3)).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
      rule: 'spacing',
      freeAt: at(10, 1),
    });
    expect(checkRate(opens, at(10, 1), caps, utcMinus3)).toEqual({ ok: true });
  });

  it('allows the very first open', () => {
    expect(checkRate([], at(0), caps, utcMinus3)).toEqual({ ok: true });
  });

  it('counts an open stamped in the future (clock moved back) against the spacing', () => {
    const d = checkRate([at(11)], at(10), caps, utcMinus3);
    expect(d).toMatchObject({ ok: false, rule: 'spacing', freeAt: at(11, 1) });
  });
});

describe('U10 rate guard: 6 per rolling hour', () => {
  const six = [0, 10, 20, 30, 40, 50].map((m) => at(9, m));

  it('allows the 6th open and refuses the 7th inside the hour', () => {
    expect(checkRate(six.slice(0, 5), at(9, 50), caps, utcMinus3)).toEqual({ ok: true });
    expect(checkRate(six, at(9, 59, 59, 999), caps, utcMinus3)).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
      rule: 'hour',
      freeAt: at(10),
    });
  });

  it('frees exactly one hour after the oldest open in the window', () => {
    expect(checkRate(six, at(10), caps, utcMinus3)).toEqual({ ok: true });
  });

  it('frees when enough opens leave the window, not just the oldest', () => {
    // 8 opens (allowed by a looser past) in the hour: the lane frees when only 5 remain.
    const eight = [0, 5, 10, 15, 20, 25, 30, 35].map((m) => at(9, m));
    expect(checkRate(eight, at(9, 50), caps, utcMinus3)).toMatchObject({ rule: 'hour', freeAt: at(10, 10) });
  });
});

describe('U10 rate guard: 15 per local day', () => {
  // 15 opens 61 min apart from 08:00: never more than one per hour, all on the same local day.
  const fifteen = Array.from({ length: 15 }, (_, i) => at(8) + i * 61 * MIN);

  it('refuses the 16th until the next local midnight, then allows', () => {
    expect(checkRate(fifteen.slice(0, 14), at(23, 30), caps, utcMinus3)).toEqual({ ok: true });
    expect(checkRate(fifteen, at(23, 30), caps, utcMinus3)).toEqual({
      ok: false,
      code: 'RATE_LIMITED',
      rule: 'day',
      freeAt: MIDNIGHT + DAY,
    });
    expect(checkRate(fifteen, MIDNIGHT + DAY - 1, caps, utcMinus3)).toMatchObject({ rule: 'day' });
    expect(checkRate(fifteen, MIDNIGHT + DAY, caps, utcMinus3)).toEqual({ ok: true });
  });

  it('uses the local day, not the UTC day', () => {
    // 23:45 local is 02:45Z on the 13th: a UTC day would have reset at 21:00 local and let it pass.
    expect(checkRate(fifteen, at(23, 45), caps, utcMinus3)).toMatchObject({ rule: 'day', freeAt: MIDNIGHT + DAY });
  });

  it('nextDayStart survives 23 h and 25 h days (DST)', () => {
    // A synthetic zone whose days are 23 h, then 25 h, then 24 h long.
    const starts = [0, 23 * HOUR_MS, 48 * HOUR_MS, 72 * HOUR_MS, 96 * HOUR_MS];
    const dst: LocalDay = { startOf: (t) => starts.filter((s) => s <= t).at(-1) ?? 0 };
    expect(nextDayStart(22 * HOUR_MS, dst)).toBe(23 * HOUR_MS);
    expect(nextDayStart(47 * HOUR_MS, dst)).toBe(48 * HOUR_MS);
    expect(nextDayStart(23 * HOUR_MS, dst)).toBe(48 * HOUR_MS);
  });
});

describe('U10 rate guard: several caps at once', () => {
  it('reports the rule that frees last, so every cap passes at freeAt', () => {
    const six = [0, 10, 20, 30, 40, 59].map((m) => at(9, m));
    const now = at(9, 59, 30);
    // spacing frees at 10:00:00, the hour at 10:00:00 too (oldest at 09:00): ties go to the later rule.
    expect(checkRate(six, now, caps, utcMinus3)).toMatchObject({ rule: 'hour', freeAt: at(10) });
    const strict = effectiveCaps({ minSpacingMs: 5 * MIN });
    expect(checkRate(six, now, strict, utcMinus3)).toMatchObject({ rule: 'spacing', freeAt: at(10, 4) });
    const d = checkRate(six, now, strict, utcMinus3);
    if (d.ok) throw new Error('expected a refusal');
    expect(checkRate(six, d.freeAt, strict, utcMinus3)).toEqual({ ok: true });
  });
});

describe('U10 settings can only make the caps stricter', () => {
  it('ignores looser values', () => {
    expect(effectiveCaps({ minSpacingMs: 1000, maxPerHour: 100, maxPerDay: 1000 })).toEqual(DEFAULT_RATE_CAPS);
  });

  it('takes stricter values, field by field', () => {
    expect(effectiveCaps({ minSpacingMs: 2 * MIN, maxPerHour: 3, maxPerDay: 5 })).toEqual({
      minSpacingMs: 2 * MIN,
      maxPerHour: 3,
      maxPerDay: 5,
    });
    expect(effectiveCaps({ maxPerHour: 2 })).toEqual({ ...DEFAULT_RATE_CAPS, maxPerHour: 2 });
  });

  it('ignores invalid values and floors fractional counts', () => {
    const junk = {
      minSpacingMs: Number.NaN,
      maxPerHour: 0,
      maxPerDay: Number.POSITIVE_INFINITY,
    };
    expect(effectiveCaps(junk)).toEqual(DEFAULT_RATE_CAPS);
    expect(effectiveCaps({ maxPerHour: -1, maxPerDay: '3' as unknown as number })).toEqual(DEFAULT_RATE_CAPS);
    expect(effectiveCaps({ maxPerHour: 3.7 })).toMatchObject({ maxPerHour: 3 });
    expect(effectiveCaps(null)).toEqual(DEFAULT_RATE_CAPS);
    expect(effectiveCaps(undefined)).toEqual(DEFAULT_RATE_CAPS);
  });

  it('a "looser" setting still refuses the 7th open in an hour and the 2nd within 60 s', () => {
    const loose = effectiveCaps({ minSpacingMs: 0, maxPerHour: 100, maxPerDay: 100 });
    const six = [0, 10, 20, 30, 40, 50].map((m) => at(9, m));
    expect(checkRate(six, at(9, 55), loose, utcMinus3)).toMatchObject({ ok: false, rule: 'hour' });
    expect(checkRate([at(9)], at(9, 0, 30), loose, utcMinus3)).toMatchObject({ ok: false, rule: 'spacing' });
  });
});

describe('U10 pruneOpens', () => {
  it('keeps what can still matter: the last hour, today, and the latest open', () => {
    const yesterday = MIDNIGHT - 2 * HOUR_MS;
    const opens = [at(12), yesterday, at(1), MIDNIGHT - DAY];
    // At 00:30 tomorrow: today's opens are gone, the hour window holds none, the latest stays.
    expect(pruneOpens(opens, MIDNIGHT + DAY + 30 * MIN, utcMinus3)).toEqual([at(12)]);
    // At 00:30 today: yesterday 22:00 is outside the hour; today's 01:00 and 12:00 are kept.
    expect(pruneOpens(opens, at(0, 30), utcMinus3)).toEqual([at(1), at(12)]);
    expect(pruneOpens([], at(0), utcMinus3)).toEqual([]);
  });

  it('never changes a decision', () => {
    const opens = [0, 10, 20, 30, 40, 50].map((m) => at(9, m)).concat([at(1), MIDNIGHT - 5 * HOUR_MS]);
    for (const now of [at(9, 55), at(10), at(23), MIDNIGHT + DAY]) {
      const strict = effectiveCaps({ minSpacingMs: 3 * HOUR_MS });
      for (const c of [caps, strict]) {
        expect(checkRate(pruneOpens(opens, now, utcMinus3), now, c, utcMinus3)).toEqual(
          checkRate(opens, now, c, utcMinus3),
        );
      }
    }
  });
});

describe('U10 on a fake clock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a story set of 8 frames opens at human pace: 6, then waits for the hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(at(9));
    const opens: number[] = [];
    const tryOpen = () => {
      const d = checkRate(opens, Date.now(), caps, utcMinus3);
      if (d.ok) opens.push(Date.now());
      return d;
    };
    for (let i = 0; i < 6; i++) {
      expect(tryOpen().ok).toBe(true);
      vi.advanceTimersByTime(30_000);
      // Too soon; after the 6th open the hour cap is what frees last.
      expect(tryOpen()).toMatchObject({ ok: false, rule: i < 5 ? 'spacing' : 'hour' });
      vi.advanceTimersByTime(30_000);
    }
    // 6 opens between 09:00 and 09:05: the 7th waits until 10:00.
    const d = tryOpen();
    expect(d).toEqual({ ok: false, code: 'RATE_LIMITED', rule: 'hour', freeAt: at(10) });
    vi.setSystemTime(at(10));
    expect(tryOpen().ok).toBe(true);
    expect(opens).toHaveLength(7);
  });
});
