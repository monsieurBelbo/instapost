/** Editor gesture maths (strategy §7.10 "Interaction"): pan, zoom about the pointer, rotate, hit tests. */
import { describe, expect, test } from 'vitest';
import { coversFrame, initialXf } from '../core/geometry/fit.ts';
import { applyToPoint, invert, layerMatrix } from '../core/geometry/transform.ts';
import type { ImageLayer } from '../core/model/story.ts';
import {
  clientToStory,
  fitStage,
  hitTextBlock,
  MAX_ZOOM,
  moveTextXf,
  panImageXf,
  rotateImageXf,
  rotateSliderGesture,
  setImageScaleXf,
  snapRotationToward,
  wheelZoomFactor,
  zoomImageXf,
} from './interaction.ts';

const SRC = { w: 4000, h: 3000 };
const cover = (): Pick<ImageLayer, 'fit' | 'xf'> => ({ fit: 'cover', xf: initialXf('cover', SRC, { x: 0.5, y: 0.5 }) });

/** Where source point `s` lands in story px for a placement. */
const storyOf = (xf: ImageLayer['xf'], s: { x: number; y: number }) =>
  applyToPoint(layerMatrix(SRC, 1920 / 3000, xf), s);

describe('stage', () => {
  test('fitStage keeps 9:16 inside the container', () => {
    expect(fitStage({ w: 1000, h: 900 })).toEqual({ w: 506, h: 900 });
    expect(fitStage({ w: 360, h: 2000 })).toEqual({ w: 360, h: 640 });
    expect(fitStage({ w: 0, h: 500 })).toEqual({ w: 0, h: 0 });
  });

  test('clientToStory maps the stage rect onto 1080x1920', () => {
    const rect = { left: 100, top: 50, width: 540, height: 960 };
    expect(clientToStory({ x: 100, y: 50 }, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToStory({ x: 640, y: 1010 }, rect)).toEqual({ x: 1080, y: 1920 });
    expect(clientToStory({ x: 370, y: 530 }, rect)).toEqual({ x: 540, y: 960 });
  });

  test('wheel factors: up zooms in, pinch is stronger, bounded per event', () => {
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false })).toBeGreaterThan(1);
    expect(wheelZoomFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false })).toBeLessThan(1);
    const wheel = wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: false });
    const pinch = wheelZoomFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true });
    expect(pinch).toBeGreaterThan(wheel);
    expect(wheelZoomFactor({ deltaY: -1e6, deltaMode: 0, ctrlKey: false })).toBe(2);
    expect(wheelZoomFactor({ deltaY: 1e6, deltaMode: 1, ctrlKey: false })).toBe(0.5);
  });
});

describe('image gestures', () => {
  test('pan moves the image and never exposes the background in cover', () => {
    const l = cover();
    const moved = panImageXf(l, SRC, -100, 0);
    expect(moved.cx).toBeCloseTo(l.xf.cx - 100, 9);
    const far = panImageXf(l, SRC, 1e5, 1e5);
    expect(coversFrame('cover', SRC, far)).toBe(true);
  });

  test('zoom keeps the pointer fixed (within ±0.5 px) and respects the limits', () => {
    const l = cover();
    const pointer = { x: 700, y: 1200 };
    const zoomed = zoomImageXf(l, SRC, pointer, 1.7);
    const before = invert(layerMatrix(SRC, 1920 / 3000, l.xf));
    if (!before) throw new Error('singular');
    const srcAtPointer = applyToPoint(before, pointer);
    const after = storyOf(zoomed, srcAtPointer);
    expect(Math.abs(after.x - pointer.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.y - pointer.y)).toBeLessThanOrEqual(0.5);
    expect(zoomed.scale).toBeCloseTo(1.7, 9);

    expect(zoomImageXf(l, SRC, pointer, 0.2).scale).toBe(1);
    expect(zoomImageXf(l, SRC, pointer, 100).scale).toBe(MAX_ZOOM);
    expect(coversFrame('cover', SRC, zoomImageXf({ fit: 'cover', xf: zoomed }, SRC, { x: 0, y: 0 }, 0.5))).toBe(true);
  });

  test('the zoom slider sets an absolute scale about the frame centre', () => {
    const l = cover();
    const xf = setImageScaleXf(l, SRC, 2.5);
    expect(xf.scale).toBeCloseTo(2.5, 9);
    expect(xf.cx).toBeCloseTo(540, 9);
    expect(xf.cy).toBeCloseTo(960, 9);
  });

  test('rotation snaps to 0 and ±90 within 3° when moving towards them, and keeps cover', () => {
    const l = cover();
    const at = (rotDeg: number) => ({ ...l, xf: { ...l.xf, rotDeg } });
    expect(rotateImageXf(at(10), SRC, 2.5).rotDeg).toBe(0);
    expect(rotateImageXf(l, SRC, -88).rotDeg).toBe(-90);
    const r = rotateImageXf(l, SRC, 30);
    expect(r.rotDeg).toBe(30);
    expect(r.scale).toBeGreaterThan(1);
    expect(coversFrame('cover', SRC, r)).toBe(true);
  });

  test('EDIT-1: keyboard steps of 0.5° leave every snap point and come back to it', () => {
    // A slider keypress moves the thumb one step from where the stored angle put it.
    const walk = (from: number, steps: number, step: number): number[] => {
      const out: number[] = [];
      let deg = from;
      for (let i = 0; i < steps; i++) {
        deg = snapRotationToward(deg, deg + step);
        out.push(deg);
      }
      return out;
    };
    // Off 0 upwards: every step is applied as typed, up to 4°.
    expect(walk(0, 8, 0.5)).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    // The mirror, and around ±90.
    expect(walk(0, 8, -0.5).at(-1)).toBe(-4);
    expect(walk(90, 8, 0.5)).toEqual([90.5, 91, 91.5, 92, 92.5, 93, 93.5, 94]);
    expect(walk(90, 8, -0.5).at(-1)).toBe(86);
    expect(walk(-90, 8, 0.5).at(-1)).toBe(-86);
    expect(walk(-90, 8, -0.5).at(-1)).toBe(-94);
    // Coming down from 10°, the snap catches at 3° (within tolerance, moving towards 0); the next
    // step leaves 0 on the other side.
    expect(walk(10, 16, -0.5)).toEqual([9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5, 0, -0.5, -1]);
    // Coming up to -90 from -80.
    expect(walk(-80, 15, -0.5).slice(12)).toEqual([-86.5, -90, -90.5]);
    // And through the rotation helper, on a real layer.
    const l = cover();
    expect(rotateImageXf(l, SRC, 0.5).rotDeg).toBe(0.5);
    expect(rotateImageXf({ ...l, xf: { ...l.xf, rotDeg: 87 } }, SRC, 87.5).rotDeg).toBe(90);
  });

  test('AM28 (R2U-2): a pointer drag towards a snap point stays snapped; the keyboard still leaves it', () => {
    /**
     * Drives the slider as the browser and Preact do: each input carries the pointer's raw value
     * (`raws`), the stored angle is what the previous input produced, and Preact resets the thumb to
     * it, so after a snap the browser may re-report the same raw value.
     */
    const drag = (stored: number, raws: number[]): number[] => {
      const g = rotateSliderGesture();
      g.start(stored);
      const out: number[] = [];
      let deg = stored;
      for (const raw of raws) {
        deg = g.input(deg, raw);
        out.push(deg);
      }
      g.end();
      return out;
    };
    // Slowly from 5° towards 0: once inside the tolerance it stays at 0 (it used to flip 0, 2.5, 0, 1.5…).
    expect(drag(5, [4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5])).toEqual([4.5, 4, 3.5, 0, 0, 0, 0, 0, 0]);
    // The thumb was reset to 0 and the browser re-reports the pointer's raw value: still 0.
    expect(drag(5, [3.5, 2.5, 2.5, 1.5, 1.5, 0.5])).toEqual([3.5, 0, 0, 0, 0, 0]);
    // From 87.5° up towards 90: snapped all the way, then free once dragged past it.
    expect(drag(87.5, [88, 88.5, 89, 89.5, 90, 90.5, 91])).toEqual([90, 90, 90, 90, 90, 90.5, 91]);
    // Leaving a snap point by pointer is never blocked.
    expect(drag(0, [0.5, 1.5, 2.5, 3.5])).toEqual([0.5, 1.5, 2.5, 3.5]);
    // Coarse steps from 10° down end at 0, not at 1°.
    expect(drag(10, [8.5, 7, 5.5, 4, 2.5, 1])).toEqual([8.5, 7, 5.5, 4, 0, 0]);

    // Keyboard: every keypress is its own gesture from the stored angle, so EDIT-1 holds.
    const keys = (from: number, steps: number, step: number): number[] => {
      const g = rotateSliderGesture();
      const out: number[] = [];
      let deg = from;
      for (let i = 0; i < steps; i++) {
        g.start(deg);
        deg = g.input(deg, deg + step);
        g.end();
        out.push(deg);
      }
      return out;
    };
    expect(keys(0, 4, 0.5)).toEqual([0.5, 1, 1.5, 2]);
    expect(keys(10, 16, -0.5)).toEqual([9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5, 0, -0.5, -1]);
    // An input with no gesture started (assistive technology) counts from the stored angle.
    expect(rotateSliderGesture().input(0, 0.5)).toBe(0.5);
  });

  test('rotation turns about the frame centre', () => {
    const l = { fit: 'free' as const, xf: { cx: 640, cy: 960, scale: 1, rotDeg: 0 } };
    const r = rotateImageXf(l, SRC, 90);
    expect(r.cx).toBeCloseTo(540, 9);
    expect(r.cy).toBeCloseTo(1060, 9);
  });
});

describe('text gestures', () => {
  test('moving text keeps its centre on the frame', () => {
    const xf = { cx: 540, cy: 960, scale: 1, rotDeg: 0 };
    expect(moveTextXf(xf, 100, -50)).toEqual({ cx: 640, cy: 910, scale: 1, rotDeg: 0 });
    expect(moveTextXf(xf, -5000, 5000)).toEqual({ cx: 0, cy: 1920, scale: 1, rotDeg: 0 });
  });

  test('hit test covers the block plus slop, rotation included', () => {
    const xf = { cx: 540, cy: 960, scale: 1, rotDeg: 0 };
    const block = { w: 400, h: 100 };
    expect(hitTextBlock(xf, block, { x: 540, y: 960 })).toBe(true);
    expect(hitTextBlock(xf, block, { x: 340 - 20, y: 960 })).toBe(true);
    expect(hitTextBlock(xf, block, { x: 340 - 30, y: 960 })).toBe(false);
    expect(hitTextBlock({ ...xf, rotDeg: 90 }, block, { x: 540, y: 960 - 190 })).toBe(true);
    expect(hitTextBlock({ ...xf, rotDeg: 90 }, block, { x: 540 + 190, y: 960 })).toBe(false);
    expect(hitTextBlock(xf, { w: 0, h: 0 }, { x: 540, y: 960 })).toBe(false);
  });
});
