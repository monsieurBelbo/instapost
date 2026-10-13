/**
 * Part of U9 (strategy §7.11): the §3.6 step-7 table, row by row and in order, plus the AM2
 * strict re-probe and the preflight summary (§3.9 item 1) built from the same report. 2026-10-12:
 * P1 (SW control is diagnostics), P3 (row 4b, the interception tripwire), P4 (row 5, msite's
 * 767 CSS px width) and U1 (C4 judged only when the decision reached it). AM37: row 5b (C3b, the
 * composer's screen-orientation gate) and the preflight's C3b beside C3 (C3a, the viewport).
 */
import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION, type ProbeReport, preflightOf } from './contract.ts';
import {
  composerMayReadLandscape,
  evaluateProbe,
  isDesktopShell,
  isMobileLayout,
  type ProbeDecision,
  type ProbeEvalInput,
  swIntercepts,
} from './probe-eval.ts';

const COMPOSER = 'https://www.instagram.com/create/story/';

const goodProbe = (over: Partial<ProbeReport> = {}): ProbeReport => ({
  marker: true,
  isMobile: true,
  inner: { w: 511, h: 909 },
  dpr: 2,
  portrait: true,
  swControlled: false,
  swIntercepted: false,
  navType: 'reload',
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
    // P1: Instagram's worker claims every logged-in page (F2): control alone never fails.
    ['row 4: SW-controlled is diagnostics only (P1)', {}, { swControlled: true }, { kind: 'h1' }],
    ['row 4: SW-controlled on a re-probe too', { strict: true }, { swControlled: true }, { kind: 'h1' }],
    ['row 4b: a worker intercepted requests', {}, { swIntercepted: true }, { kind: 'fail', code: 'SW_INTERCEPTS' }],
    [
      'row 4b also on a controlled page',
      {},
      { swIntercepted: true, swControlled: true },
      { kind: 'fail', code: 'SW_INTERCEPTS' },
    ],
    ['row 4b: interception unknown never fails', {}, { swIntercepted: 'unknown' }, { kind: 'h1' }],
    ['row 4 before row 4b', {}, { isMobile: false, swIntercepted: true }, { kind: 'fail', code: 'DESKTOP_SHELL' }],
    ['row 4b before row 5', {}, { swIntercepted: true, portrait: false }, { kind: 'fail', code: 'SW_INTERCEPTS' }],
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
    // P4: msite has the + → Story entry only at ≤ 767 CSS px (F3).
    ['row 5: 767 wide and portrait is fine', {}, { inner: { w: 767, h: 1200 } }, { kind: 'h1' }],
    ['row 5: wider than 767 refits once', {}, { inner: { w: 768, h: 1200 } }, { kind: 'refit' }],
    [
      'row 5: still wider than 767 → LAYOUT_TOO_WIDE',
      { refitUsed: true },
      { inner: { w: 800, h: 1200 } },
      { kind: 'fail', code: 'LAYOUT_TOO_WIDE' },
    ],
    [
      'row 5: the live run’s 1512x902 after the refit → LAYOUT_TOO_WIDE (width first)',
      { refitUsed: true },
      { inner: { w: 1512, h: 902 }, portrait: false },
      { kind: 'fail', code: 'LAYOUT_TOO_WIDE' },
    ],
    [
      'row 5: narrow but landscape after the refit → LANDSCAPE',
      { refitUsed: true },
      { inner: { w: 700, h: 600 }, portrait: false },
      { kind: 'fail', code: 'LANDSCAPE' },
    ],
    // AM37 (C3b): the composer reads the screen orientation; landscape there hides Share.
    [
      'row 5b: on the composer, a landscape screen (shim off) → SCREEN_LANDSCAPE',
      {},
      { orientation: { type: 'landscape-primary', shim: 'off' } },
      { kind: 'fail', code: 'SCREEN_LANDSCAPE' },
    ],
    [
      'row 5b: landscape-secondary counts too',
      {},
      { orientation: { type: 'landscape-secondary', shim: 'failed' } },
      { kind: 'fail', code: 'SCREEN_LANDSCAPE' },
    ],
    [
      'row 5b: the shim installed → portrait-primary passes',
      {},
      { orientation: { type: 'portrait-primary', shim: 'installed' } },
      { kind: 'h1' },
    ],
    [
      'row 5b: no orientation reported never fails',
      {},
      { orientation: { type: null, shim: 'absent' } },
      { kind: 'h1' },
    ],
    // SH-2: an unreadable reading (the shim threw, or its result was malformed) fails closed there.
    [
      'row 5b: on the composer, an unreadable reading (null, failed) → SCREEN_LANDSCAPE',
      {},
      { orientation: { type: null, shim: 'failed' } },
      { kind: 'fail', code: 'SCREEN_LANDSCAPE' },
    ],
    [
      'row 5b: an unreadable reading on home is only recorded',
      { url: 'https://www.instagram.com/' },
      { orientation: { type: null, shim: 'failed' } },
      { kind: 'h1' },
    ],
    // SH-1: the shim installed itself after the composer had mounted (the reducer marks the reading).
    [
      'row 5b: on the composer, a shim installed after the composer mounted → SCREEN_LANDSCAPE',
      {},
      { orientation: { type: 'portrait-primary', shim: 'installed', afterComposerMount: true } },
      { kind: 'fail', code: 'SCREEN_LANDSCAPE' },
    ],
    [
      'row 5b: on home the composer is not mounted yet: only recorded',
      { url: 'https://www.instagram.com/' },
      { orientation: { type: 'landscape-primary', shim: 'off' } },
      { kind: 'h1' },
    ],
    [
      'row 5b: probe mode on the composer fails too (a post would be blocked)',
      { mode: 'probe' },
      { orientation: { type: 'landscape-primary', shim: 'failed' } },
      { kind: 'fail', code: 'SCREEN_LANDSCAPE' },
    ],
    [
      'row 5 before row 5b',
      {},
      { portrait: false, orientation: { type: 'landscape-primary', shim: 'off' } },
      { kind: 'refit' },
    ],
    [
      'row 4b before row 5b',
      {},
      { swIntercepted: true, orientation: { type: 'landscape-primary', shim: 'off' } },
      { kind: 'fail', code: 'SW_INTERCEPTS' },
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
      c4Reached: false,
    });
  });

  it('U1: C4 is reached only by rows 6–8', () => {
    const reached = (over: Partial<ProbeEvalInput>, probe: Partial<ProbeReport>) =>
      evaluateProbe(input(over, probe)).c4Reached;
    expect(reached({}, {})).toBe(true);
    expect(reached({ mode: 'probe' }, {})).toBe(true);
    expect(reached({ assistedInsert: false }, { storyInput: 'absent' })).toBe(true);
    expect(reached({}, { storyInput: 'absent' })).toBe(true);
    expect(reached({}, { marker: false })).toBe(false);
    expect(reached({ url: 'https://www.instagram.com/accounts/login/' }, {})).toBe(false);
    expect(reached({}, { isMobile: false })).toBe(false);
    expect(reached({}, { swIntercepted: true })).toBe(false);
    expect(reached({}, { inner: { w: 1512, h: 902 }, portrait: false })).toBe(false);
    expect(reached({}, { orientation: { type: 'landscape-primary', shim: 'off' } })).toBe(false);
  });

  it('AM37 composerMayReadLandscape: the composer URL and a landscape, unreadable or late reading', () => {
    const landscape = { type: 'landscape-primary', shim: 'off' } as const;
    expect(composerMayReadLandscape(landscape, COMPOSER)).toBe(true);
    expect(composerMayReadLandscape(landscape, `${COMPOSER}?x=1`)).toBe(true);
    expect(composerMayReadLandscape(landscape, 'https://www.instagram.com/')).toBe(false);
    expect(composerMayReadLandscape(landscape, undefined)).toBe(false);
    expect(composerMayReadLandscape({ type: 'portrait-primary', shim: 'present' }, COMPOSER)).toBe(false);
    expect(composerMayReadLandscape({ type: null, shim: 'absent' }, COMPOSER)).toBe(false);
    expect(composerMayReadLandscape(null, COMPOSER)).toBe(false);
    expect(composerMayReadLandscape(undefined, COMPOSER)).toBe(false);
    // SH-2: the reading every malformed or throwing shim result becomes (protocol.ts toPageOrientation).
    expect(composerMayReadLandscape({ type: null, shim: 'failed' }, COMPOSER)).toBe(true);
    expect(composerMayReadLandscape({ type: null, shim: 'failed' }, 'https://www.instagram.com/')).toBe(false);
    // …but a failed shim that still read a portrait type is portrait (another own `type` that reads so).
    expect(composerMayReadLandscape({ type: 'portrait-primary', shim: 'failed' }, COMPOSER)).toBe(false);
    // SH-1: installed only after the composer mounted, so the composer read the landscape screen.
    const late = { type: 'portrait-primary', shim: 'installed', afterComposerMount: true } as const;
    expect(composerMayReadLandscape(late, COMPOSER)).toBe(true);
    expect(composerMayReadLandscape(late, 'https://www.instagram.com/')).toBe(false);
  });

  it('isMobileLayout and swIntercepts', () => {
    expect(isMobileLayout(goodProbe())).toBe(true);
    expect(isMobileLayout(goodProbe({ inner: { w: 768, h: 1200 } }))).toBe(false);
    expect(isMobileLayout(goodProbe({ portrait: false }))).toBe(false);
    expect(swIntercepts(goodProbe({ swIntercepted: true }))).toBe(true);
    expect(swIntercepts(goodProbe({ swIntercepted: 'unknown' }))).toBe(false);
  });

  it('probe mode never yields an injection, whatever the report says', () => {
    for (const storyInput of ['present', 'absent'] as const) {
      for (const acceptOk of [true, false]) {
        const d = decide({ mode: 'probe' }, { storyInput, acceptOk });
        expect(d.kind).not.toBe('h1');
      }
    }
  });

  it('isDesktopShell: strict only changes the unknown case; SW control never counts (P1)', () => {
    expect(isDesktopShell(goodProbe({ swControlled: true }), false)).toBe(false);
    expect(isDesktopShell(goodProbe({ swControlled: true }), true)).toBe(false);
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
      // AM37: no orientation on the report (an earlier build's, or before the shim ran): unknown.
      C3b: 'unknown',
      C4: 'pass',
      C5: 'pass',
      C8: { inner: { w: 511, h: 909 }, dpr: 2, canvas: { w: 1022, h: 1818, css: { x: 0, y: 0, w: 511, h: 909 } } },
      swControlled: false,
      swIntercepted: false,
    });
  });

  it('AM37: C3b passes when the page reads portrait (shim or not), fails when it reads landscape', () => {
    const c3b = (orientation: ProbeReport['orientation']) =>
      preflightOf(goodProbe({ orientation }), COMPOSER, 'homeOnly').C3b;
    expect(c3b({ type: 'portrait-primary', shim: 'installed' })).toBe('pass');
    expect(c3b({ type: 'portrait-primary', shim: 'present' })).toBe('pass');
    expect(c3b({ type: 'portrait-secondary', shim: 'portrait' })).toBe('pass');
    expect(c3b({ type: null, shim: 'absent' })).toBe('pass');
    expect(c3b({ type: 'landscape-primary', shim: 'off' })).toBe('fail');
    expect(c3b({ type: 'landscape-primary', shim: 'failed' })).toBe('fail');
    // SH-2: an unreadable reading is no pass: the page's real type is unknown.
    expect(c3b({ type: null, shim: 'failed' })).toBe('unknown');
    expect(c3b({ type: 'portrait-primary', shim: 'failed' })).toBe('pass');
    // SH-1: the page reads portrait now, but the composer read the landscape screen when it mounted.
    expect(c3b({ type: 'portrait-primary', shim: 'installed', afterComposerMount: true })).toBe('fail');
    expect(c3b(undefined)).toBe('unknown');
    // C3a (the viewport) is independent of it: the live finding was a portrait window, landscape screen.
    const live = preflightOf(
      goodProbe({ inner: { w: 503, h: 894 }, orientation: { type: 'landscape-primary', shim: 'off' } }),
      COMPOSER,
      'homeOnly',
    );
    expect(live).toMatchObject({ C3: 'pass', C3b: 'fail' });
  });

  it('U1: C4 is unknown when the decision never reached it', () => {
    const p = preflightOf(goodProbe({ storyInput: 'absent', acceptOk: false }), COMPOSER, 'homeOnly', null, false);
    expect(p).toMatchObject({ C4: 'unknown', C5: 'fail' });
    expect(preflightOf(goodProbe(), COMPOSER, 'direct', null, false).C4).toBe('unknown');
    expect(preflightOf(goodProbe({ storyInput: 'absent' }), COMPOSER, 'direct', null, true).C4).toBe('fail');
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
