/**
 * Fit maths for image layers (strategy §3.3). Pure; units are story px.
 *
 * - cover: base scale = max(1080/w, 1920/h); xf.scale is clamped to >= 1 and the translation
 *   is clamped so the frame is always covered (with rotation, coverage of the rotated image).
 * - contain: base scale = min(1080/w, 1920/h); no clamp.
 * - free: no clamps; base scale as contain.
 */
import type { FitMode, Xf } from '../model/story.ts';
import { cosSinDeg } from './transform.ts';

/** Width and height, in the px of whatever space the caller is in. */
export interface Size {
  w: number;
  h: number;
}
/** A position; story px unless stated otherwise. */
export interface Point {
  x: number;
  y: number;
}
/** Top-left corner plus size, axis-aligned. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The story frame, in story px. */
export const FRAME: Readonly<Size> = { w: 1080, h: 1920 };

/** Coverage tolerance in story px: float residue never counts as an exposed background. */
export const COVER_EPS_PX = 1e-6;
/** Scale ratios this close to 1 are treated as 1, so a fresh cover placement keeps scale exactly 1. */
const SCALE_EPS = 1e-9;

function assertSize(src: Size): void {
  if (!(src.w > 0 && src.h > 0 && Number.isFinite(src.w) && Number.isFinite(src.h))) {
    throw new RangeError(`BAD_SIZE: ${src.w}x${src.h}`);
  }
}

/** Story px per source px at xf.scale 1. Throws RangeError on an empty or non-finite size. */
export function baseScale(fit: FitMode, src: Size, frame: Size = FRAME): number {
  assertSize(src);
  const sx = frame.w / src.w;
  const sy = frame.h / src.h;
  return fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
}

/**
 * Initial placement: scale 1, rotation 0, and the focal point (0..1 in source space) at the
 * frame centre, then clamped (cover). Used on load and for "re-fit".
 */
export function initialXf(fit: FitMode, src: Size, focal: Point, frame: Size = FRAME): Xf {
  const base = baseScale(fit, src, frame);
  const fx = Math.min(1, Math.max(0, focal.x));
  const fy = Math.min(1, Math.max(0, focal.y));
  const xf: Xf = {
    cx: frame.w / 2 - (fx - 0.5) * src.w * base,
    cy: frame.h / 2 - (fy - 0.5) * src.h * base,
    scale: 1,
    rotDeg: 0,
  };
  return clampXf(fit, src, xf, frame);
}

/**
 * The smallest xf.scale at which a cover-fitted source, rotated by `rotDeg`, can cover the
 * frame: 1 unrotated, more when rotated (the frame's extent along the image's axes grows).
 */
export function minCoverScale(src: Size, rotDeg: number, frame: Size = FRAME): number {
  const base = baseScale('cover', src, frame);
  const [cos, sin] = cosSinDeg(rotDeg);
  const ac = Math.abs(cos);
  const as = Math.abs(sin);
  const needW = (frame.w * ac + frame.h * as) / (src.w * base);
  const needH = (frame.w * as + frame.h * ac) / (src.h * base);
  const need = Math.max(needW, needH);
  return need <= 1 + SCALE_EPS ? 1 : need;
}

const clamp = (v: number, lo: number, hi: number): number => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

/**
 * Applies the fit's clamps (cover only); contain and free return `xf` unchanged.
 * Cover: the scale is raised to minCoverScale() for the current rotation, then the centre is
 * moved to the nearest position at which the rotated image still covers all four frame corners.
 */
export function clampXf(fit: FitMode, src: Size, xf: Xf, frame: Size = FRAME): Xf {
  if (fit !== 'cover') return xf;
  const base = baseScale(fit, src, frame);
  const minScale = minCoverScale(src, xf.rotDeg, frame);
  const scale = Number.isFinite(xf.scale) ? Math.max(xf.scale, minScale) : minScale;
  const halfW = (src.w * base * scale) / 2;
  const halfH = (src.h * base * scale) / 2;
  const [cos, sin] = cosSinDeg(xf.rotDeg);
  // Work in the image's own axes (u along its width, v along its height): there the set of
  // centres that cover every frame corner is an axis-aligned box, so clamping is per axis.
  const toU = (x: number, y: number) => cos * x + sin * y;
  const toV = (x: number, y: number) => -sin * x + cos * y;
  const corners = [
    [0, 0],
    [frame.w, 0],
    [0, frame.h],
    [frame.w, frame.h],
  ] as const;
  const us = corners.map(([x, y]) => toU(x, y));
  const vs = corners.map(([x, y]) => toV(x, y));
  const cx0 = Number.isFinite(xf.cx) ? xf.cx : frame.w / 2;
  const cy0 = Number.isFinite(xf.cy) ? xf.cy : frame.h / 2;
  const u = clamp(toU(cx0, cy0), Math.max(...us) - halfW, Math.min(...us) + halfW);
  const v = clamp(toV(cx0, cy0), Math.max(...vs) - halfH, Math.min(...vs) + halfH);
  return { ...xf, scale, cx: cos * u - sin * v, cy: sin * u + cos * v };
}

/** True when the placed (rotated, scaled) source covers the whole frame. U1's property test uses it. */
export function coversFrame(fit: FitMode, src: Size, xf: Xf, frame: Size = FRAME): boolean {
  const s = baseScale(fit, src, frame) * xf.scale;
  const halfW = (src.w * s) / 2 + COVER_EPS_PX;
  const halfH = (src.h * s) / 2 + COVER_EPS_PX;
  const [cos, sin] = cosSinDeg(xf.rotDeg);
  for (const [x, y] of [
    [0, 0],
    [frame.w, 0],
    [0, frame.h],
    [frame.w, frame.h],
  ] as const) {
    const dx = x - xf.cx;
    const dy = y - xf.cy;
    if (Math.abs(cos * dx + sin * dy) > halfW || Math.abs(-sin * dx + cos * dy) > halfH) return false;
  }
  return true;
}
