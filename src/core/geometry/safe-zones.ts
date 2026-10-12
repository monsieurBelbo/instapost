/**
 * Safe-zone guides on the 1080x1920 frame (research §3.2, strategy §4, U3).
 * Organic defaults: top 270, bottom 384, sides 65. Strict "ad-safe" bottom: 672.
 */
import { FRAME, type Rect, type Size } from './fit.ts';

/** Margin bands in story px. */
export const SAFE_TOP = 270;
export const SAFE_BOTTOM = 384;
export const SAFE_SIDE = 65;
export const AD_SAFE_BOTTOM = 672;

/** Guide geometry on the frame, in story px. */
export interface SafeZones {
  /** The area inside all margins. */
  safe: Rect;
  /** The four margin bands (what the overlay shades). */
  top: Rect;
  bottom: Rect;
  left: Rect;
  right: Rect;
}

/**
 * Zones for the default guide, or with the strict 672 px bottom when `strict`.
 * The top and bottom bands span the full width; the side bands fill the height between them,
 * so the five rects tile the frame without overlap.
 */
export function safeZones(strict = false, frame: Size = FRAME): SafeZones {
  const bottomH = strict ? AD_SAFE_BOTTOM : SAFE_BOTTOM;
  const midH = frame.h - SAFE_TOP - bottomH;
  return {
    safe: { x: SAFE_SIDE, y: SAFE_TOP, w: frame.w - 2 * SAFE_SIDE, h: midH },
    top: { x: 0, y: 0, w: frame.w, h: SAFE_TOP },
    bottom: { x: 0, y: frame.h - bottomH, w: frame.w, h: bottomH },
    left: { x: 0, y: SAFE_TOP, w: SAFE_SIDE, h: midH },
    right: { x: frame.w - SAFE_SIDE, y: SAFE_TOP, w: SAFE_SIDE, h: midH },
  };
}

/** The four margin bands in a fixed order: top, bottom, left, right. */
export const marginBands = (zones: SafeZones): Rect[] => [zones.top, zones.bottom, zones.left, zones.right];

/** True when `inner` lies entirely inside `outer` (edges inclusive). */
export function containsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}
