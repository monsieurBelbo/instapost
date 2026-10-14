/**
 * Composer popup sizing (strategy §3.6 step 1 and 3, §7.10, U13). Pure.
 *
 * Target inner height = min(profile?.innerH ?? 932, availHeight − frameDelta.h − 8);
 * inner width = round(h × 9/16), or h × the profile's ratio when a composerProfile exists;
 * W4 (2026-10-12): the inner width never exceeds MSITE_MAX_CSS_WIDTH (767 CSS px, × the tab zoom in
 * window pixels), lowering the height to keep the ratio, because msite has no story entry above it;
 * below 640 px of inner height → SCREEN_TOO_SMALL. ux.md §4.6 (2026-10-13): the window is docked at the
 * right edge of the available area, at its top (`docked`), so the editor's run view stays visible beside it.
 *
 * Measured on the owner's 1512x982@2 screen (docs/contract.md S8): avail 1512x949 at top 33,
 * frame delta 0x32, fitted inner 511x909, reached with one windows.update. Arc (2026-10-12 live run,
 * F1) ignores the bounds of windows.create and has a 0x47 frame; windows.update with
 * `state:'normal'` is honoured there.
 */
import { MSITE_MAX_CSS_WIDTH } from '../ig-contract/contract.ts';
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
/** W2: the tab counts as fitted when each side is within this many px of the target inner size. */
export const FIT_TOLERANCE_PX = 2;

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

/** A usable tab zoom factor (tabs.getZoom), else 1. */
export function zoomOf(zoom: number | null | undefined): number {
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom >= 0.25 && zoom <= 5 ? zoom : 1;
}

/** W4: the widest inner size (window px) that is still at most MSITE_MAX_CSS_WIDTH CSS px at `zoom`. */
export function maxMsiteInnerW(zoom?: number | null): number {
  return Math.floor(MSITE_MAX_CSS_WIDTH * zoomOf(zoom));
}

/** Inner size under an inner-height ceiling, also kept inside the available width and the msite width. */
function innerFor(
  screen: ScreenAvail,
  delta: FrameDelta,
  maxInnerH: number,
  profile: ComposerProfile | null | undefined,
  zoom?: number | null,
): Size {
  const ratio = innerRatio(profile);
  let h = Math.floor(Math.min(profile?.innerH ?? DEFAULT_INNER_H, maxInnerH));
  const maxInnerW = Math.min(screen.availWidth - delta.w - SCREEN_MARGIN, maxMsiteInnerW(zoom));
  // `round(h × ratio) <= maxInnerW` once h <= (maxInnerW + 0.5) / ratio; floor keeps it below.
  if (Math.round(h * ratio) > maxInnerW) h = Math.floor(maxInnerW / ratio);
  // Strictly portrait even for a near-square profile ratio.
  return { w: Math.min(Math.round(h * ratio), h - 1), h };
}

/**
 * ux.md §4.6: the outer box for an inner size, docked at the right edge of the available area and at its
 * top (`availLeft`/`availTop` may be negative on a secondary display). Never left of the area.
 */
export function docked(screen: ScreenAvail, inner: Size, delta: FrameDelta): WindowBox {
  const width = inner.w + delta.w;
  const height = inner.h + delta.h;
  return {
    left: screen.availLeft + Math.max(0, Math.round(screen.availWidth - width)),
    top: screen.availTop,
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
  return { ok: true, inner, outer: docked(screen, inner, guessDelta) };
}

/**
 * Step 3: the exact outer box once the frame delta is known. Always portrait. The inner width
 * is also kept within availWidth − delta.w − 8 (lowering the height to keep the ratio).
 * `maxInnerH` in the error is the inner height the fit reached: the screen's limit, unless a
 * profile asked for less.
 */
export function windowFit(
  screen: ScreenAvail,
  delta: FrameDelta,
  profile?: ComposerProfile | null,
  zoom?: number | null,
): WindowFitResult {
  const inner = innerFor(screen, delta, screen.availHeight - delta.h - SCREEN_MARGIN, profile, zoom);
  if (inner.h < MIN_INNER_H) return { ok: false, code: 'SCREEN_TOO_SMALL', maxInnerH: inner.h };
  return { ok: true, inner, outer: docked(screen, inner, delta) };
}

/** Outer minus inner size, never negative; null when either size is not a finite number. */
export function frameDeltaOf(inner: Size, outer: Pick<WindowBox, 'width' | 'height'>): FrameDelta | null {
  const w = outer.width - inner.w;
  const h = outer.height - inner.h;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { w: Math.max(0, w), h: Math.max(0, h) };
}

/** W2: the tab reached the target inner size, within FIT_TOLERANCE_PX on each side. */
export function isFitted(tab: Size, target: Size): boolean {
  return Math.abs(tab.w - target.w) <= FIT_TOLERANCE_PX && Math.abs(tab.h - target.h) <= FIT_TOLERANCE_PX;
}

/**
 * W3: a tab size the composer can work in, whatever windowFit asked for: at most the msite width
 * (MSITE_MAX_CSS_WIDTH at `zoom`), portrait (height >= width, C3) and at least MIN_INNER_H tall.
 */
export function isUsableInner(tab: Size, zoom?: number | null): boolean {
  return tab.w > 0 && tab.w <= maxMsiteInnerW(zoom) && tab.h >= tab.w && tab.h >= MIN_INNER_H;
}
