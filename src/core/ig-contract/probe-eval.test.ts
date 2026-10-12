/**
 * Part of U9 (strategy §7.11): the §3.6 step-7 table, row by row and in order, plus the AM2
 * strict re-probe and the preflight summary (§3.9 item 1) built from the same report.
 */
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, type ProbeReport, preflightOf } from './contract.ts';
import { evaluateProbe, isDesktopShell, type ProbeDecision, type ProbeEvalInput } from './probe-eval.ts';

const COMPOSER = 'https://www.instagram.com/create/story/';

const goodProbe = (over: Partial<ProbeReport> = {}): ProbeReport => ({
  marker: true,
  isMobile: true,
  inner: { w: 511, h: 909 },
  dpr: 2,
  portrait: true,
  swControlled: false,
  storyInput: 'present',
  acceptOk: true,
  acceptSeen: ['image/avif,image/jpeg,image/png'],
  canvas: { w: 1022, h: 1818, css: { x: 0, y: 0, w: 511, h: 909 } },
  lang: 'en',
  ...over,
});

const input = (over: Partial<ProbeEvalInput> = {}, probe: Partial<ProbeReport> = {}): ProbeEvalInput => ({
  probe: goodProbe(probe),
  guarded: true,
  mode: 'post',
  assistedInsert: true,
  url: COMPOSER,
  refitUsed: false,
  strict: false,
  ...over,
});

const decide = (over: Partial<ProbeEvalInput> = {}, probe: Partial<ProbeReport> = {}): ProbeDecision =>
  evaluateProbe(input(over, probe)).decision;

describe('U9 probe evaluation (§3.6 step 7)', () => {
  it.each<[string, Partial<ProbeEvalInput>, Partial<ProbeReport>, ProbeDecision]>([
    ['row 1: guarded without marker', {}, { marker: false }, { kind: 'fail', code: 'GUARD_NOT_FAKE' }],
    [
      'row 1 beats every later row',
      {},
      { marker: false, isMobile: false, portrait: false },
      { kind: 'fail', code: 'GUARD_NOT_FAKE' },
    ],
    ['row 2: live without marker carries on', { guarded: false }, { marker: false }, { kind: 'h1' }],
    [
      'row 3: login URL',
      { url: 'https://www.instagram.com/accounts/login/' },
      {},
      { kind: 'fail', code: 'NOT_LOGGED_IN' },
    ],
    [
      'row 3 before row 4',
      { url: 'https://www.instagram.com/accounts/login/' },
      { isMobile: false },
      { kind: 'fail', code: 'NOT_LOGGED_IN' },
    ],
    ['row 4: is_mobile false', {}, { isMobile: false }, { kind: 'fail', code: 'DESKTOP_SHELL' }],
    ['row 4: SW-controlled', {}, { swControlled: true }, { kind: 'fail', code: 'DESKTOP_SHELL' }],
    ['row 4: unknown passes the first probe', {}, { isMobile: 'unknown' }, { kind: 'h1' }],
    [
      'row 4: unknown fails a re-probe (AM2)',
      { strict: true },
      { isMobile: 'unknown' },
      { kind: 'fail', code: 'DESKTOP_SHELL' },
    ],
    ['row 4: SW unknown never fails', { strict: true }, { swControlled: 'unknown' }, { kind: 'h1' }],
    ['row 4 before row 5', {}, { isMobile: false, portrait: false }, { kind: 'fail', code: 'DESKTOP_SHELL' }],
    ['row 5: landscape refits once', {}, { portrait: false }, { kind: 'refit' }],
    [
      'row 5: still landscape → LANDSCAPE',
      { refitUsed: true },
      { portrait: false },
      { kind: 'fail', code: 'LANDSCAPE' },
    ],
    ['row 6: probe mode is done', { mode: 'probe' }, {}, { kind: 'probe-done' }],
    ['row 6 before row 7', { mode: 'probe' }, { storyInput: 'absent' }, { kind: 'probe-done' }],
    ['row 7: H1 disabled', { assistedInsert: false }, {}, { kind: 'h0', reason: null }],
    ['row 7: H1 disabled hides drift', { assistedInsert: false }, { acceptOk: false }, { kind: 'h0', reason: null }],
    ['row 7: input missing', {}, { storyInput: 'absent', acceptOk: false }, { kind: 'h0', reason: 'INPUT_MISSING' }],
    ['row 7: accept drift', {}, { acceptOk: false }, { kind: 'h0', reason: 'ACCEPT_DRIFT' }],
    ['row 8: H1', {}, {}, { kind: 'h1' }],
    ['URL unknown skips row 3', { url: undefined }, {}, { kind: 'h1' }],
  ])('%s', (_name, over, probe, decision) => {
    expect(decide(over, probe)).toEqual(decision);
  });

  it('row 2: the banner shows only for a live build that sees the marker', () => {
    expect(evaluateProbe(input({ guarded: false })).banner).toBe(true);
    expect(evaluateProbe(input({ guarded: false }, { marker: false })).banner).toBe(false);
    expect(evaluateProbe(input({ guarded: true })).banner).toBe(false);
    // The banner never hides a later failure.
    expect(evaluateProbe(input({ guarded: false }, { isMobile: false }))).toEqual({
      decision: { kind: 'fail', code: 'DESKTOP_SHELL' },
      banner: true,
    });
  });

  it('probe mode never yields an injection, whatever the report says', () => {
    for (const storyInput of ['present', 'absent'] as const) {
      for (const acceptOk of [true, false]) {
        const d = decide({ mode: 'probe' }, { storyInput, acceptOk });
        expect(d.kind).not.toBe('h1');
      }
    }
  });

  it('isDesktopShell: strict only changes the unknown case', () => {
    expect(isDesktopShell(goodProbe(), false)).toBe(false);
    expect(isDesktopShell(goodProbe(), true)).toBe(false);
    expect(isDesktopShell(goodProbe({ isMobile: 'unknown' }), false)).toBe(false);
    expect(isDesktopShell(goodProbe({ isMobile: 'unknown' }), true)).toBe(true);
    expect(isDesktopShell(goodProbe({ isMobile: false }), false)).toBe(true);
  });
});

describe('preflightOf (§3.9 item 1)', () => {
  it('summarises a good probe as all-pass', () => {
    const p = preflightOf(goodProbe(), COMPOSER, 'direct');
    expect(p).toEqual({
      contractVersion: CONTRACT_VERSION,
      C1: 'pass',
      C2: 'pass',
      C3: 'pass',
      C4: 'pass',
      C5: 'pass',
      C8: { inner: { w: 511, h: 909 }, dpr: 2, canvas: { w: 1022, h: 1818, css: { x: 0, y: 0, w: 511, h: 909 } } },
      swControlled: false,
    });
  });

  it('reports failures and unknowns', () => {
    const p = preflightOf(
      goodProbe({ isMobile: 'unknown', portrait: false, acceptOk: false, canvas: undefined, swControlled: 'unknown' }),
      'https://www.instagram.com/accounts/login/',
      'homeOnly',
    );
    expect(p).toMatchObject({ C1: 'unknown', C2: 'fail', C3: 'fail', C4: 'fail', C5: 'fail', swControlled: 'unknown' });
    expect(p.C8.canvas).toBeNull();
    expect(preflightOf(goodProbe({ isMobile: false }), undefined, null)).toMatchObject({
      C1: 'fail',
      C2: 'unknown',
      C5: 'unknown',
    });
  });

  it('AM13: C8 comes from the ready report when given; C1–C5 stay with the deciding probe', () => {
    const deciding = goodProbe({ storyInput: 'absent', acceptOk: false, canvas: undefined });
    const ready = goodProbe({ dpr: 1, canvas: { w: 1080, h: 1920, css: { x: 4, y: 0, w: 503, h: 894 } } });
    const p = preflightOf(deciding, COMPOSER, 'direct', ready);
    expect(p.C4).toBe('fail');
    expect(p.C8).toEqual({ inner: ready.inner, dpr: 1, canvas: ready.canvas });
    expect(p.C8.canvas).not.toBe(ready.canvas);
  });
});
