/**
 * 2D affine transforms (strategy §3.3, U2). Pure.
 *
 * Mat2D uses the canvas setTransform order [a, b, c, d, e, f]:
 *   x' = a·x + c·y + e,  y' = b·x + d·y + f.
 * Story space is y-down, so a positive angle turns clockwise on screen.
 */
import type { Xf } from '../model/story.ts';
import type { Point, Size } from './fit.ts';

/** An affine matrix in canvas setTransform order (see the module comment). */
export type Mat2D = readonly [number, number, number, number, number, number];

/** The identity matrix. */
export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

/** Turns -0 into 0 so display lists serialise and compare cleanly. */
const z = (n: number): number => n + 0;
const mat = (a: number, b: number, c: number, d: number, e: number, f: number): Mat2D => [
  z(a),
  z(b),
  z(c),
  z(d),
  z(e),
  z(f),
];

/** [cos, sin] of an angle in degrees, exact for multiples of 90° (no 6e-17 residue). */
export function cosSinDeg(deg: number): readonly [number, number] {
  const quarter = deg / 90;
  if (Number.isInteger(quarter)) {
    switch (((quarter % 4) + 4) % 4) {
      case 0:
        return [1, 0];
      case 1:
        return [0, 1];
      case 2:
        return [-1, 0];
      default:
        return [0, -1];
    }
  }
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

/** Translation by (tx, ty). */
export const translation = (tx: number, ty: number): Mat2D => mat(1, 0, 0, 1, tx, ty);

/** Scaling about the origin; uniform when `sy` is omitted. */
export const scaling = (sx: number, sy: number = sx): Mat2D => mat(sx, 0, 0, sy, 0, 0);

/** Rotation about the origin; positive = clockwise on screen. */
export function rotation(deg: number): Mat2D {
  const [cos, sin] = cosSinDeg(deg);
  return mat(cos, sin, -sin, cos, 0, 0);
}

/** m·n: apply n first, then m. */
export function multiply(m: Mat2D, n: Mat2D): Mat2D {
  const [a, b, c, d, e, f] = m;
  const [na, nb, nc, nd, ne, nf] = n;
  return mat(
    a * na + c * nb,
    b * na + d * nb,
    a * nc + c * nd,
    b * nc + d * nd,
    a * ne + c * nf + e,
    b * ne + d * nf + f,
  );
}

/** Inverse, or null when singular. */
export function invert(m: Mat2D): Mat2D | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0 || !Number.isFinite(det)) return null;
  return mat(d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det);
}

/** m applied to a point. */
export function applyToPoint(m: Mat2D, p: Point): Point {
  const [a, b, c, d, e, f] = m;
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f };
}

/**
 * Source px → story px for a layer of natural size `src`:
 * translate(cx, cy) · rotate(rotDeg) · scale(base · xf.scale) · translate(−w/2, −h/2).
 * Text layers pass their block size and a base of 1.
 */
export function layerMatrix(src: Size, baseScale: number, xf: Xf): Mat2D {
  const [cos, sin] = cosSinDeg(xf.rotDeg);
  const s = baseScale * xf.scale;
  const a = cos * s;
  const b = sin * s;
  const c = -sin * s;
  const d = cos * s;
  const hw = src.w / 2;
  const hh = src.h / 2;
  return mat(a, b, c, d, xf.cx - a * hw - c * hh, xf.cy - b * hw - d * hh);
}

/** Multiplies xf.scale by `factor` keeping the story-px `pointer` fixed (±0.5 px). Clamping is the caller's job. */
export function zoomAbout(xf: Xf, pointer: Point, factor: number): Xf {
  // Scaling about the layer centre is isotropic, so the offset centre → pointer scales by
  // `factor` whatever the rotation; moving the centre by the difference pins the pointer.
  return {
    ...xf,
    scale: xf.scale * factor,
    cx: pointer.x + (xf.cx - pointer.x) * factor,
    cy: pointer.y + (xf.cy - pointer.y) * factor,
  };
}

/** Default snapRotation() tolerance (strategy §7.10). */
export const ROTATION_SNAP_TOL_DEG = 3;
const ROTATION_SNAPS = [-90, 0, 90] as const;

/**
 * Rotation slider snap: ±180° range, snaps to 0 and ±90 within `tolDeg` (default 3).
 * Values outside ±180 are wrapped into [−180, 180) first.
 */
export function snapRotation(deg: number, tolDeg: number = ROTATION_SNAP_TOL_DEG): number {
  const wrapped = deg > 180 || deg < -180 ? ((((deg + 180) % 360) + 360) % 360) - 180 : deg;
  for (const snap of ROTATION_SNAPS) if (Math.abs(wrapped - snap) <= tolDeg) return snap;
  return z(wrapped);
}
