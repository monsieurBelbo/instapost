/**
 * U24 (ux.md §4.5 K4/K7/K9–K11, §4.10, §2 "Human pace"): the lane's priorities, the rate counts, and the
 * human-pace dwell bounds.
 */
import { describe, expect, it } from 'vitest';
import { DWELL_MS, dwellMs } from './dwell.ts';
import { laneOf } from './lane.ts';
import { checkRate, DEFAULT_RATE_CAPS, HOUR_MS, rateCounts } from './rate-guard.ts';
import { type HandoffState, IDLE } from './state.ts';

const T0 = Date.UTC(2026, 9, 13, 12);
const day = { startOf: (t: number) => t - (t % 86_400_000) };
const counts = { hour: 2, today: 5 };
const queued: HandoffState = {
  phase: 'queued',
  handoffId: 'hof_q',
  request: {
    exportId: 'exp_1',
    mode: 'post',
    screen: { availLeft: 0, availTop: 0, availWidth: 1512, availHeight: 949 },
    browser: 'arc',
  },
  startAt: T0 + 30_000,
  queuedAt: T0,
};
const busy = { phase: 'opening', handoffId: 'hof_b' } as unknown as HandoffState;

describe('U24 laneOf', () => {
  it('paused beats everything, then a run in progress, then the queue', () => {
    expect(laneOf(busy, { ok: true }, counts, DEFAULT_RATE_CAPS, T0 + 1000, T0)).toMatchObject({
      kind: 'paused',
      freeAt: T0 + 1000,
    });
    expect(laneOf(busy, { ok: true }, counts, DEFAULT_RATE_CAPS, null, T0)).toMatchObject({
      kind: 'busy',
      handoffId: 'hof_b',
    });
    expect(laneOf(queued, { ok: true }, counts, DEFAULT_RATE_CAPS, null, T0)).toMatchObject({
      kind: 'queued',
      freeAt: T0 + 30_000,
      handoffId: 'hof_q',
    });
    // An expired lock no longer pauses.
    expect(laneOf(IDLE, { ok: true }, counts, DEFAULT_RATE_CAPS, T0 - 1, T0).kind).toBe('ready');
  });

  it('the caps: daily, hourly, then the 60 s spacing; ready otherwise', () => {
    const lane = (rule: 'spacing' | 'hour' | 'day') =>
      laneOf(IDLE, { ok: false, code: 'RATE_LIMITED', rule, freeAt: T0 + 9 }, counts, DEFAULT_RATE_CAPS, null, T0);
    expect(lane('day')).toMatchObject({ kind: 'daily', freeAt: T0 + 9 });
    expect(lane('hour')).toMatchObject({ kind: 'hourly' });
    expect(lane('spacing')).toMatchObject({ kind: 'spacing' });
    expect(laneOf(IDLE, { ok: true }, counts, DEFAULT_RATE_CAPS, null, T0)).toEqual({
      kind: 'ready',
      today: 5,
      hour: 2,
      caps: { hour: 6, day: 15 },
    });
  });

  it('spacing-only blocks are what the queue may wait for; the hour cap is not', () => {
    const one = checkRate([T0 - 10_000], T0, DEFAULT_RATE_CAPS, day);
    expect(one).toMatchObject({ ok: false, rule: 'spacing', freeAt: T0 + 50_000 });
    const six = Array.from({ length: 6 }, (_, i) => T0 - 50 * 60_000 + i * 61_000);
    expect(checkRate(six, T0, DEFAULT_RATE_CAPS, day)).toMatchObject({ ok: false, rule: 'hour' });
  });

  it('rateCounts: the rolling hour and the local day', () => {
    const opens = [T0 - HOUR_MS - 1, T0 - HOUR_MS + 1, T0 - 1000, T0 - 13 * HOUR_MS];
    expect(rateCounts(opens, T0, day)).toEqual({ hour: 2, today: 3 });
    expect(rateCounts([], T0, day)).toEqual({ hour: 0, today: 0 });
  });
});

describe('U24 the human-pace dwell', () => {
  it('stays in its bounds for any random value', () => {
    for (const kind of ['entry', 'insert', 'share'] as const) {
      const [min, max] = DWELL_MS[kind];
      for (const r of [0, 0.25, 0.5, 0.999, -1, 2, Number.NaN]) {
        const ms = dwellMs(kind, () => r);
        expect(ms, `${kind} ${r}`).toBeGreaterThanOrEqual(min);
        expect(ms, `${kind} ${r}`).toBeLessThanOrEqual(max);
      }
    }
    // Share waits at least 2 s.
    expect(dwellMs('share', () => 0)).toBe(2000);
  });

  it('a guarded E2E scale shortens it (0 = none); anything else is ignored', () => {
    expect(dwellMs('insert', () => 0.5, 0)).toBe(0);
    expect(dwellMs('insert', () => 0.5, 0.1)).toBe(225);
    expect(dwellMs('insert', () => 0.5, 1)).toBe(2250);
    expect(dwellMs('insert', () => 0.5, -1)).toBe(2250);
  });
});
