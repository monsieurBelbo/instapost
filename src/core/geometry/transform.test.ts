/**
 * U2 (strategy §7.11): zooming about a pointer keeps that point fixed (±0.5 px); rotation
 * about the centre; the matrix compose/invert round trip. Also the rotation slider snap.
 */
import { describe, expect, it } from 'vitest';
import type { Xf } from '../model/story.ts';
import type { Point } from './fit.ts';
import {
  applyToPoint,
  cosSinDeg,
  IDENTITY,
  invert,
  layerMatrix,
  type Mat2D,
  multiply,
  rotation,
  scaling,
  snapRotation,
  translation,
  zoomAbout,
} from './transform.ts';

const expectPoint = (actual: Point, expected: Point, digits = 9) => {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
};

const expectMat = (actual: Mat2D, expected: Mat2D, digits = 9) => {
  actual.forEach((v, i) => {
    expect(v).toBeCloseTo(expected[i] ?? Number.NaN, digits);
  });
};

describe('U2 transform', () => {
  describe('compose and invert', () => {
    it('multiply(m, n) applies n first, then m', () => {
      const p = { x: 1, y: 1 };
      expectPoint(applyToPoint(multiply(translation(10, 0), scaling(2)), p), { x: 12, y: 2 });
      expectPoint(applyToPoint(multiply(scaling(2), translation(10, 0)), p), { x: 22, y: 2 });
      expect(multiply(IDENTITY, rotation(30))).toEqual(rotation(30));
    });

    it('round-trips: m · m⁻¹ = I and m⁻¹(m(p)) = p for assorted matrices', () => {
      const xfs: Xf[] = [
        { cx: 540, cy: 960, scale: 1, rotDeg: 0 },
        { cx: -200, cy: 3000, scale: 0.37, rotDeg: 17.5 },
        { cx: 1234.5, cy: -88, scale: 4.2, rotDeg: -133 },
        { cx: 10, cy: 20, scale: 2, rotDeg: 90 },
      ];
      for (const xf of xfs) {
        const m = layerMatrix({ w: 4032, h: 3024 }, 0.476, xf);
        const inv = invert(m);
        expect(inv).not.toBeNull();
        if (!inv) continue;
        expectMat(multiply(m, inv), IDENTITY);
        expectMat(multiply(inv, m), IDENTITY);
        for (const p of [
          { x: 0, y: 0 },
          { x: 4032, y: 3024 },
          { x: 1000.25, y: -77 },
        ]) {
          expectPoint(applyToPoint(inv, applyToPoint(m, p)), p, 6);
        }
      }
    });

    it('a singular matrix has no inverse', () => {
      expect(invert([0, 0, 0, 0, 5, 5])).toBeNull();
      expect(invert(scaling(0, 1))).toBeNull();
    });

    it('never produces -0 (clean snapshots)', () => {
      for (const v of [...rotation(180), ...layerMatrix({ w: 10, h: 10 }, 1, { cx: 5, cy: 5, scale: 1, rotDeg: 0 })]) {
        expect(Object.is(v, -0)).toBe(false);
      }
    });
  });

  describe('rotation about the centre', () => {
    const src = { w: 100, h: 200 };
    const at = (rotDeg: number) => layerMatrix(src, 1, { cx: 540, cy: 960, scale: 1, rotDeg });

    it('keeps the source centre on (cx, cy) at any angle', () => {
      for (const deg of [0, 30, 90, -45, 180, 271])
        expectPoint(applyToPoint(at(deg), { x: 50, y: 100 }), { x: 540, y: 960 });
    });

    it('turns clockwise on screen for positive angles', () => {
      // The top-left corner sits 50 left and 100 above the centre; 90° clockwise puts it 100 right and 50 above.
      expectPoint(applyToPoint(at(90), { x: 0, y: 0 }), { x: 640, y: 910 });
      expectPoint(applyToPoint(at(-90), { x: 0, y: 0 }), { x: 440, y: 1010 });
      expectPoint(applyToPoint(at(180), { x: 0, y: 0 }), { x: 590, y: 1060 });
    });

    it('preserves the distance to the centre', () => {
      const p = applyToPoint(at(37), { x: 0, y: 0 });
      expect(Math.hypot(p.x - 540, p.y - 960)).toBeCloseTo(Math.hypot(50, 100), 9);
    });

    it('cosSinDeg is exact on multiples of 90°', () => {
      expect(cosSinDeg(90)).toEqual([0, 1]);
      expect(cosSinDeg(-90)).toEqual([0, -1]);
      expect(cosSinDeg(180)).toEqual([-1, 0]);
      expect(cosSinDeg(450)).toEqual([0, 1]);
    });
  });

  describe('zoomAbout keeps the pointer fixed (±0.5 px)', () => {
    const src = { w: 4000, h: 3000 };
    const base = 0.64;
    const cases: [Xf, Point, number][] = [
      [{ cx: 540, cy: 960, scale: 1, rotDeg: 0 }, { x: 100, y: 1800 }, 1.25],
      [{ cx: 700, cy: 800, scale: 2.5, rotDeg: 0 }, { x: 1079, y: 0 }, 0.5],
      [{ cx: 540, cy: 960, scale: 1.3, rotDeg: 33 }, { x: 300, y: 400 }, 3],
      [{ cx: -100, cy: 2000, scale: 0.8, rotDeg: -120 }, { x: 540, y: 960 }, 1.01],
    ];

    it.each(cases)('xf %o, pointer %o, factor %d', (xf, pointer, factor) => {
      const before = layerMatrix(src, base, xf);
      const inv = invert(before);
      if (!inv) throw new Error('singular');
      const underPointer = applyToPoint(inv, pointer);
      const zoomed = zoomAbout(xf, pointer, factor);
      expect(zoomed.scale).toBeCloseTo(xf.scale * factor, 12);
      expect(zoomed.rotDeg).toBe(xf.rotDeg);
      const after = applyToPoint(layerMatrix(src, base, zoomed), underPointer);
      expect(Math.abs(after.x - pointer.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(after.y - pointer.y)).toBeLessThanOrEqual(0.5);
    });
  });

  describe('snapRotation', () => {
    it.each([
      [0, 0],
      [2, 0],
      [-3, 0],
      [3.01, 3.01],
      [88, 90],
      [-92.5, -90],
      [45, 45],
      [180, 180],
      [-180, -180],
      [270, -90],
      [-181, 179],
      [361, 0],
    ])('%d° → %d°', (input, expected) => {
      expect(snapRotation(input)).toBeCloseTo(expected, 9);
    });

    it('honours a custom tolerance', () => {
      expect(snapRotation(5, 6)).toBe(0);
      expect(snapRotation(2, 1)).toBe(2);
    });
  });
});
