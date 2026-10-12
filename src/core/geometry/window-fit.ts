/**
 * Composer popup sizing (strategy §3.6 step 1 and 3, §7.10, U13). Pure.
 *
 * Target inner height = min(profile?.innerH ?? 932, availHeight − frameDelta.h − 8);
 * inner width = round(h × 9/16), or h × the profile's ratio when a composerProfile exists;
 * below 640 px of inner height → SCREEN_TOO_SMALL; the window is centred in the available area.
 *
 * Measured on the owner's 1512x982@2 screen (docs/contract.md S8): avail 1512x949 at top 33,
 * frame delta 0x32, fitted inner 511x909, reached with one windows.update.
 */
import type { Size } from './fit.ts';

/** `screen.avail*` from the editor, sent in handoff/start. */
export interface ScreenAvail {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}

/** windows.create / windows.update geometry (outer size). */
export interface WindowBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Outer minus inner size of the popup, measured once via tabs.get (step 3). */
export interface FrameDelta {
  w: number;
  h: number;
}

/** Measured composer viewport (calibration, L5/D7), stored in settings as `composerProfile`. */
export interface ComposerProfile {
  innerW: number;
  innerH: number;
  capturedAt: number;
}

/** Target inner height without a composerProfile. */
export const DEFAULT_INNER_H = 932;
/** Below this inner height the fit fails with SCREEN_TOO_SMALL. */
export const MIN_INNER_H = 640;
/** Kept free below the window (and beside it on narrow screens). */
export const SCREEN_MARGIN = 8;
/** First guess for the frame height before it is measured. */
export const FIRST_GUESS_EXTRA_H = 80;

/** `inner` is the content size the popup will have; `outer` is what windows.create/update take. */
export type WindowFitResult =
  | { ok: true; inner: Size; outer: WindowBox }
  | { ok: false; code: 'SCREEN_TOO_SMALL'; maxInnerH: number };

/** 9:16, the story aspect. */
export const DEFAULT_RATIO = 9 / 16;

/** inner width / inner height: the profile's when it is a sane portrait ratio, else 9:16. */
export function innerRatio(profile?: ComposerProfile | null): number {
  if (!profile) return DEFAULT_RATIO;
  const r = profile.innerW / profile.innerH;
  return Number.isFinite(r) && r > 0 && r < 1 ? r : DEFAULT_RATIO;
}

/** Inner size under an inner-height ceiling, also kept inside the available width. */
function innerFor(
  screen: ScreenAvail,
  delta: FrameDelta,
  maxInnerH: number,
  profile: ComposerProfile | null | undefined,
): Size {
  const ratio = innerRatio(profile);
  let h = Math.floor(Math.min(profile?.innerH ?? DEFAULT_INNER_H, maxInnerH));
  const maxInnerW = screen.availWidth - delta.w - SCREEN_MARGIN;
  if (Math.round(h * ratio) > maxInnerW) h = Math.floor(maxInnerW / ratio);
  // Strictly portrait even for a near-square profile ratio.
  return { w: Math.min(Math.round(h * ratio), h - 1), h };
}

/** Outer box for an inner size, centred in the available area. */
function centred(screen: ScreenAvail, inner: Size, delta: FrameDelta): WindowBox {
  const width = inner.w + delta.w;
  const height = inner.h + delta.h;
  return {
    left: screen.availLeft + Math.round((screen.availWidth - width) / 2),
    top: screen.availTop + Math.round((screen.availHeight - height) / 2),
    width,
    height,
  };
}

/**
 * Step 1: the outer box for windows.create, using FIRST_GUESS_EXTRA_H as the frame height.
 * The guess overestimates the real frame (32 px in S8), so SCREEN_TOO_SMALL here is decided
 * with no frame at all: it is returned only when no popup could reach MIN_INNER_H. Otherwise
 * the guess is returned and windowFit() with the measured delta makes the final call.
 */
export function firstGuess(screen: ScreenAvail, profile?: ComposerProfile | null): WindowFitResult {
  const noFrame: FrameDelta = { w: 0, h: 0 };
  const best = innerFor(screen, noFrame, screen.availHeight - SCREEN_MARGIN, profile);
  if (best.h < MIN_INNER_H) return { ok: false, code: 'SCREEN_TOO_SMALL', maxInnerH: best.h };
  const guessDelta: FrameDelta = { w: 0, h: FIRST_GUESS_EXTRA_H };
  const inner = innerFor(screen, guessDelta, screen.availHeight - FIRST_GUESS_EXTRA_H - SCREEN_MARGIN, profile);
  return { ok: true, inner, outer: centred(screen, inner, guessDelta) };
}

/**
 * Step 3: the exact outer box once the frame delta is known. Always portrait. The inner width
 * is also kept within availWidth − delta.w − 8 (lowering the height to keep the ratio).
 * `maxInnerH` in the error is the inner height the fit reached: the screen's limit, unless a
 * profile asked for less.
 */
export function windowFit(screen: ScreenAvail, delta: FrameDelta, profile?: ComposerProfile | null): WindowFitResult {
  const inner = innerFor(screen, delta, screen.availHeight - delta.h - SCREEN_MARGIN, profile);
  if (inner.h < MIN_INNER_H) return { ok: false, code: 'SCREEN_TOO_SMALL', maxInnerH: inner.h };
  return { ok: true, inner, outer: centred(screen, inner, delta) };
}
