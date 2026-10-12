/**
 * Stage geometry and gesture maths for the editor (strategy §7.10 "Interaction"). Pure: the
 * Stage component turns DOM events into these calls, and core/geometry does the clamping.
 *
 * - Pan: move the layer centre by the pointer delta in story px, then clamp (cover).
 * - Zoom (wheel, pinch, slider): about the pointer, scale limited to [min, MAX_ZOOM], then clamp.
 * - Rotate (slider): snapped to 0 and ±90 within 3° when moving towards that angle (moving away
 *   from it never snaps back, so the keyboard's 0.5° steps can leave a snap point), about the frame
 *   centre so what is in the middle of the stage stays there, then clamp (cover raises the scale).
 *   The direction is that of the gesture (rotateSliderGesture): a pointer drag keeps reporting where
 *   the pointer is, not where the snap put the thumb.
 */
import { clampXf, FRAME, minCoverScale, type Point, type Size } from '../core/geometry/fit.ts';
import {
  applyToPoint,
  cosSinDeg,
  invert,
  layerMatrix,
  ROTATION_SNAP_TOL_DEG,
  snapRotation,
  zoomAbout,
} from '../core/geometry/transform.ts';
import type { ImageLayer, Xf } from '../core/model/story.ts';

/** Largest xf.scale the editor allows (8× the fit's base scale). */
export const MAX_ZOOM = 8;
/** Smallest xf.scale for contain and free fits. */
export const MIN_FREE_ZOOM = 0.1;
/** Extra grab margin around a text block, in story px. */
export const TEXT_HIT_SLOP_PX = 24;

/** The largest 9:16 box inside `container` (CSS px, floored to whole px). */
export function fitStage(container: Size): Size {
  const h = Math.max(0, Math.min(container.h, (container.w * FRAME.h) / FRAME.w));
  const w = (h * FRAME.w) / FRAME.h;
  return { w: Math.floor(w), h: Math.floor(h) };
}

/** A client point to story px, given the stage canvas's bounding rect. */
export function clientToStory(p: Point, rect: { left: number; top: number; width: number; height: number }): Point {
  return {
    x: ((p.x - rect.left) * FRAME.w) / rect.width,
    y: ((p.y - rect.top) * FRAME.h) / rect.height,
  };
}

/** Story px per client px for the stage (same on both axes). */
export const storyPerClientPx = (rectWidth: number): number => FRAME.w / rectWidth;

/** Wheel or trackpad-pinch (`ctrlKey`) event → zoom factor, at most 2× per event either way. */
export function wheelZoomFactor(e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): number {
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  const k = e.ctrlKey ? 0.01 : 0.0015;
  return Math.min(2, Math.max(0.5, Math.exp(-px * k)));
}

/** The smallest scale the zoom controls may reach for this layer's fit and rotation. */
export function minZoom(layer: Pick<ImageLayer, 'fit' | 'xf'>, src: Size): number {
  return layer.fit === 'cover' ? minCoverScale(src, layer.xf.rotDeg) : MIN_FREE_ZOOM;
}

export function panImageXf(layer: Pick<ImageLayer, 'fit' | 'xf'>, src: Size, dx: number, dy: number): Xf {
  return clampXf(layer.fit, src, { ...layer.xf, cx: layer.xf.cx + dx, cy: layer.xf.cy + dy });
}

/** Zoom by `factor` about `pointer` (story px), limited to [minZoom, MAX_ZOOM]. */
export function zoomImageXf(layer: Pick<ImageLayer, 'fit' | 'xf'>, src: Size, pointer: Point, factor: number): Xf {
  const target = Math.min(MAX_ZOOM, Math.max(minZoom(layer, src), layer.xf.scale * factor));
  const xf = zoomAbout(layer.xf, pointer, target / layer.xf.scale);
  return clampXf(layer.fit, src, xf);
}

/** Zoom to an absolute scale (the slider), about the frame centre. */
export function setImageScaleXf(layer: Pick<ImageLayer, 'fit' | 'xf'>, src: Size, scale: number): Xf {
  return zoomImageXf(layer, src, { x: FRAME.w / 2, y: FRAME.h / 2 }, scale / layer.xf.scale);
}

/**
 * The slider's raw angle with the snap applied only when it moves towards the snap point: from
 * `prev`, `raw` snaps to S (0 or ±90, within the tolerance) only if it is closer to S than `prev`.
 * Moving away is applied as is, so the stored angle equals the slider's value and Preact never
 * resets the thumb (a keyboard step off 0° would otherwise snap straight back, EDIT-1).
 */
export function snapRotationToward(prev: number, raw: number): number {
  const wrapped = snapRotation(raw, 0);
  const snapped = snapRotation(raw);
  if (snapped === wrapped) return wrapped;
  if (Math.abs(wrapped - snapped) > ROTATION_SNAP_TOL_DEG) return wrapped;
  return Math.abs(wrapped - snapped) < Math.abs(prev - snapped) ? snapped : wrapped;
}

/**
 * The rotate slider's memory of one gesture (AM27, AM28). The snap's direction test compares each
 * raw value with the previous raw value of the same gesture, not with the stored (snapped) angle:
 * during a pointer drag the raw value follows the pointer, so comparing it with a snapped 0 would
 * un-snap on every event and leave the photo slightly tilted. A raw value repeated in a gesture
 * (the browser re-reporting the pointer after the snap moved the thumb) keeps the stored angle.
 * A gesture starts at pointerdown or keydown (from the stored angle, so a keyboard step behaves as
 * EDIT-1) and ends at `change`; an input with no gesture started counts from the stored angle.
 */
export interface RotateSliderGesture {
  /** pointerdown / keydown on the slider. */
  start(stored: number): void;
  /** An `input` event: the angle to store for the slider's raw value. */
  input(stored: number, raw: number): number;
  /** `change`: the gesture is over. */
  end(): void;
}

export function rotateSliderGesture(): RotateSliderGesture {
  let lastRaw: number | null = null;
  return {
    start(stored) {
      lastRaw = stored;
    },
    input(stored, raw) {
      if (lastRaw === raw) return stored;
      const prev = lastRaw ?? stored;
      lastRaw = raw;
      return snapRotationToward(prev, raw);
    },
    end() {
      lastRaw = null;
    },
  };
}

/** Rotate to `deg` (snapped towards 0/±90, see snapRotationToward), turning the layer centre about the frame centre. */
export function rotateImageXf(layer: Pick<ImageLayer, 'fit' | 'xf'>, src: Size, deg: number): Xf {
  return rotateImageToXf(layer, src, snapRotationToward(layer.xf.rotDeg, deg));
}

/** Rotate to exactly `rotDeg` (already snapped), turning the layer centre about the frame centre. */
export function rotateImageToXf(layer: Pick<ImageLayer, 'fit' | 'xf'>, src: Size, rotDeg: number): Xf {
  const [cos, sin] = cosSinDeg(rotDeg - layer.xf.rotDeg);
  const ox = layer.xf.cx - FRAME.w / 2;
  const oy = layer.xf.cy - FRAME.h / 2;
  const xf = { ...layer.xf, rotDeg, cx: FRAME.w / 2 + cos * ox - sin * oy, cy: FRAME.h / 2 + sin * ox + cos * oy };
  return clampXf(layer.fit, src, xf);
}

/** Move a text layer, keeping its centre on the frame. */
export function moveTextXf(xf: Xf, dx: number, dy: number): Xf {
  return {
    ...xf,
    cx: Math.min(FRAME.w, Math.max(0, xf.cx + dx)),
    cy: Math.min(FRAME.h, Math.max(0, xf.cy + dy)),
  };
}

/** True when story point `p` falls on a text block of `block` size placed by `xf` (plus slop). */
export function hitTextBlock(xf: Xf, block: Size, p: Point, slop: number = TEXT_HIT_SLOP_PX): boolean {
  if (block.w <= 0 || block.h <= 0) return false;
  const inv = invert(layerMatrix(block, 1, xf));
  if (!inv) return false;
  const local = applyToPoint(inv, p);
  const s = slop / Math.max(1e-9, Math.abs(xf.scale));
  return local.x >= -s && local.y >= -s && local.x <= block.w + s && local.y <= block.h + s;
}
