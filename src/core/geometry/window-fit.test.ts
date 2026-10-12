/**
 * U13 (strategy §7.11): availHeight 945 and frame delta 62 give a 9:16 inner size of at most
 * 875 tall; always portrait; SCREEN_TOO_SMALL; the profile overrides the default. Plus the
 * numbers measured in spike S8 (docs/contract.md) on the owner's 1512x982@2 screen.
 */
import { describe, expect, it } from 'vitest';
import {
  type ComposerProfile,
  DEFAULT_INNER_H,
  FIRST_GUESS_EXTRA_H,
  firstGuess,
  innerRatio,
  MIN_INNER_H,
  type ScreenAvail,
  type WindowFitResult,
  windowFit,
} from './window-fit.ts';

const screen = (availWidth: number, availHeight: number, availLeft = 0, availTop = 0): ScreenAvail => ({
  availLeft,
  availTop,
  availWidth,
  availHeight,
});

function ok(r: WindowFitResult) {
  if (!r.ok) throw new Error(`expected a fit, got ${r.code}`);
  return r;
}

describe('U13 window fit', () => {
  it('availHeight 945 and frame delta 62: a 9:16 inner size at most 875 tall', () => {
    const r = ok(windowFit(screen(1512, 945), { w: 0, h: 62 }));
    expect(r.inner.h).toBeLessThanOrEqual(875);
    expect(r.inner).toEqual({ w: 492, h: 875 });
    expect(r.inner.w).toBe(Math.round((875 * 9) / 16));
    expect(r.outer.height).toBe(875 + 62);
    expect(r.outer.width).toBe(492);
  });

  it('S8, owner screen: avail 1512x949 at top 33, delta 0x32 → inner 511x909, centred', () => {
    const r = ok(windowFit(screen(1512, 949, 0, 33), { w: 0, h: 32 }));
    expect(r.inner).toEqual({ w: 511, h: 909 });
    expect(r.outer).toEqual({ left: 501, top: 37, width: 511, height: 941 });
  });

  it('caps the inner height at the default 932 on a tall screen', () => {
    const r = ok(windowFit(screen(2560, 1400, 100, 25), { w: 2, h: 32 }));
    expect(r.inner).toEqual({ w: 524, h: DEFAULT_INNER_H });
    expect(r.outer).toEqual({
      left: 100 + Math.round((2560 - 526) / 2),
      top: 25 + Math.round((1400 - 964) / 2),
      width: 526,
      height: 964,
    });
  });

  it('is always portrait, on wide-short screens and with a landscape profile', () => {
    const screens = [screen(3840, 700), screen(1024, 768), screen(800, 1280), screen(1512, 949)];
    const profiles: (ComposerProfile | null)[] = [
      null,
      { innerW: 1200, innerH: 800, capturedAt: 1 },
      { innerW: 799, innerH: 800, capturedAt: 1 },
    ];
    for (const s of screens) {
      for (const p of profiles) {
        for (const r of [windowFit(s, { w: 0, h: 32 }, p), firstGuess(s, p)]) {
          if (r.ok) expect(r.inner.w, JSON.stringify({ s, p })).toBeLessThan(r.inner.h);
        }
      }
    }
    expect(innerRatio({ innerW: 1200, innerH: 800, capturedAt: 1 })).toBe(9 / 16);
  });

  it('keeps the window inside a narrow screen by lowering the height', () => {
    const r = ok(windowFit(screen(500, 1200), { w: 4, h: 32 }));
    expect(r.inner.w + 4).toBeLessThanOrEqual(500 - 8);
    expect(r.inner.h).toBeLessThan(DEFAULT_INNER_H);
    expect(r.outer.left).toBeGreaterThanOrEqual(0);
  });

  describe('SCREEN_TOO_SMALL', () => {
    it('below 640 px of inner height', () => {
      expect(windowFit(screen(1366, 700), { w: 0, h: 62 })).toEqual({
        ok: false,
        code: 'SCREEN_TOO_SMALL',
        maxInnerH: 630,
      });
    });

    it('exactly 640 still fits', () => {
      expect(ok(windowFit(screen(1366, 640 + 32 + 8), { w: 0, h: 32 })).inner.h).toBe(MIN_INNER_H);
    });

    it('plain headless Chrome (800x600) is too small, as S8 observed', () => {
      expect(windowFit(screen(800, 600), { w: 0, h: 32 }).ok).toBe(false);
    });
  });

  describe('composerProfile', () => {
    const profile: ComposerProfile = { innerW: 412, innerH: 860, capturedAt: 1_760_000_000_000 };

    it('overrides the default height and ratio', () => {
      const r = ok(windowFit(screen(1512, 949, 0, 33), { w: 0, h: 32 }, profile));
      expect(r.inner).toEqual({ w: 412, h: 860 });
    });

    it('is still capped by the screen, keeping its ratio', () => {
      const tall: ComposerProfile = { innerW: 430, innerH: 932, capturedAt: 1 };
      const r = ok(windowFit(screen(1512, 949, 0, 33), { w: 0, h: 32 }, tall));
      expect(r.inner).toEqual({ w: Math.round((909 * 430) / 932), h: 909 });
    });
  });

  describe('firstGuess (step 1)', () => {
    it('uses an 80 px frame guess, which one windowFit refit then corrects', () => {
      const s = screen(1512, 949, 0, 33);
      const guess = ok(firstGuess(s));
      expect(guess.inner.h).toBe(949 - FIRST_GUESS_EXTRA_H - 8);
      expect(guess.outer.height).toBe(guess.inner.h + FIRST_GUESS_EXTRA_H);
      expect(guess.inner.w).toBeLessThan(guess.inner.h);
      expect(ok(windowFit(s, { w: 0, h: 32 })).inner).toEqual({ w: 511, h: 909 });
    });

    it('does not reject a screen the measured frame would fit', () => {
      // 680 − 80 − 8 < 640, but 680 − 32 − 8 = 640 fits once measured.
      const s = screen(1280, 680);
      expect(firstGuess(s).ok).toBe(true);
      expect(windowFit(s, { w: 0, h: 32 }).ok).toBe(true);
    });

    it('rejects a screen no popup could fit', () => {
      expect(firstGuess(screen(800, 600))).toEqual({ ok: false, code: 'SCREEN_TOO_SMALL', maxInnerH: 592 });
    });
  });
});
