/**
 * U1 (strategy §7.11): cover, contain and free base scale and placement; a seeded property
 * test that cover never exposes the background; focal placement.
 */
import { describe, expect, it } from 'vitest';
import type { FitMode, Xf } from '../model/story.ts';
import { baseScale, clampXf, coversFrame, initialXf, minCoverScale, type Rect, type Size } from './fit.ts';
import { applyToPoint, layerMatrix, snapRotation, zoomAbout } from './transform.ts';

/** mulberry32: small, seedable, good enough for property tests. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Axis-aligned bounds of the placed source, in story px. */
function placedRect(fit: FitMode, src: Size, xf: Xf): Rect {
  const m = layerMatrix(src, baseScale(fit, src), xf);
  const pts = [
    { x: 0, y: 0 },
    { x: src.w, y: 0 },
    { x: 0, y: src.h },
    { x: src.w, y: src.h },
  ].map((p) => applyToPoint(m, p));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const SOURCES: Record<string, Size> = {
  '4000x3000': { w: 4000, h: 3000 },
  '3024x4032': { w: 3024, h: 4032 },
  '1080x1920': { w: 1080, h: 1920 },
  '1000x1000': { w: 1000, h: 1000 },
  '6000x1000': { w: 6000, h: 1000 },
};
const src = (key: string): Size => {
  const s = SOURCES[key];
  if (!s) throw new Error(key);
  return s;
};

const CENTRE = { x: 0.5, y: 0.5 };

describe('U1 fit', () => {
  // [source, cover base, cover placed rect, contain base, contain placed rect]
  const table: [string, number, Rect, number, Rect][] = [
    ['4000x3000', 0.64, { x: -740, y: 0, w: 2560, h: 1920 }, 0.27, { x: 0, y: 555, w: 1080, h: 810 }],
    ['3024x4032', 10 / 21, { x: -180, y: 0, w: 1440, h: 1920 }, 5 / 14, { x: 0, y: 240, w: 1080, h: 1440 }],
    ['1080x1920', 1, { x: 0, y: 0, w: 1080, h: 1920 }, 1, { x: 0, y: 0, w: 1080, h: 1920 }],
    ['1000x1000', 1.92, { x: -420, y: 0, w: 1920, h: 1920 }, 1.08, { x: 0, y: 420, w: 1080, h: 1080 }],
    ['6000x1000', 1.92, { x: -5220, y: 0, w: 11520, h: 1920 }, 0.18, { x: 0, y: 870, w: 1080, h: 180 }],
  ];

  const expectRect = (actual: Rect, expected: Rect) => {
    expect(actual.x).toBeCloseTo(expected.x, 6);
    expect(actual.y).toBeCloseTo(expected.y, 6);
    expect(actual.w).toBeCloseTo(expected.w, 6);
    expect(actual.h).toBeCloseTo(expected.h, 6);
  };

  it.each(table)(
    '%s: base scale and centred placement for cover, contain and free',
    (key, cover, coverRect, contain, containRect) => {
      const s = src(key);
      expect(baseScale('cover', s)).toBeCloseTo(cover, 12);
      expect(baseScale('contain', s)).toBeCloseTo(contain, 12);
      expect(baseScale('free', s)).toBeCloseTo(contain, 12);

      for (const fit of ['cover', 'contain', 'free'] as const) {
        const xf = initialXf(fit, s, CENTRE);
        expect(xf).toEqual({ cx: 540, cy: 960, scale: 1, rotDeg: 0 });
        expectRect(placedRect(fit, s, xf), fit === 'cover' ? coverRect : containRect);
      }
      expect(coversFrame('cover', s, initialXf('cover', s, CENTRE))).toBe(true);
      expect(coversFrame('contain', s, initialXf('contain', s, CENTRE))).toBe(key === '1080x1920');
    },
  );

  it('rejects empty or non-finite source sizes', () => {
    expect(() => baseScale('cover', { w: 0, h: 100 })).toThrow(RangeError);
    expect(() => baseScale('contain', { w: 100, h: Number.NaN })).toThrow(/BAD_SIZE/);
  });

  describe('focal (0.25, 0.5)', () => {
    const focal = { x: 0.25, y: 0.5 };
    const focalStoryPx = (fit: FitMode, s: Size) =>
      applyToPoint(layerMatrix(s, baseScale(fit, s), initialXf(fit, s, focal)), { x: focal.x * s.w, y: focal.y * s.h });

    it.each(['4000x3000', '6000x1000'])('cover %s: lands at the frame centre (not clamped)', (key) => {
      const p = focalStoryPx('cover', src(key));
      expect(p.x).toBeCloseTo(540, 9);
      expect(p.y).toBeCloseTo(960, 9);
    });

    it.each(['3024x4032', '1000x1000', '1080x1920'])('cover %s: clamped, the left edge sits flush at x = 0', (key) => {
      const s = src(key);
      const xf = initialXf('cover', s, focal);
      expect(placedRect('cover', s, xf).x).toBeCloseTo(0, 9);
      expect(coversFrame('cover', s, xf)).toBe(true);
      // Clamped: the focal point stays left of centre rather than exposing the background.
      const p = focalStoryPx('cover', s);
      expect(p.x).toBeLessThan(540);
      expect(p.y).toBeCloseTo(960, 9);
    });

    it.each(['contain', 'free'] as const)('%s: always lands at the frame centre (no clamp)', (fit) => {
      for (const key of Object.keys(SOURCES)) {
        const p = focalStoryPx(fit, src(key));
        expect(p.x).toBeCloseTo(540, 9);
        expect(p.y).toBeCloseTo(960, 9);
      }
    });
  });

  describe('clampXf', () => {
    it('leaves contain and free untouched', () => {
      const wild: Xf = { cx: -5000, cy: 9000, scale: 0.01, rotDeg: 33 };
      expect(clampXf('contain', src('4000x3000'), wild)).toBe(wild);
      expect(clampXf('free', src('4000x3000'), wild)).toBe(wild);
    });

    it('cover: scale below 1 goes back to exactly 1, re-centred to cover', () => {
      const s = src('4000x3000');
      const xf = clampXf('cover', s, { cx: 540, cy: 2000, scale: 0.5, rotDeg: 0 });
      expect(xf.scale).toBe(1);
      expect(xf.cy).toBe(960);
      expect(coversFrame('cover', s, xf)).toBe(true);
    });

    it('cover: a valid placement is unchanged', () => {
      const s = src('4000x3000');
      const xf: Xf = { cx: 600, cy: 900, scale: 1.5, rotDeg: 0 };
      expect(clampXf('cover', s, xf)).toEqual(xf);
    });

    it('cover: rotation raises the scale to the minimum that still covers', () => {
      const s = src('1080x1920');
      expect(minCoverScale(s, 0)).toBe(1);
      // At 90° the 1080x1920 frame needs the image's width to span 1920 and its height 1080 → 1920/1080.
      expect(minCoverScale(s, 90)).toBeCloseTo(1920 / 1080, 12);
      const xf = clampXf('cover', s, { cx: 540, cy: 960, scale: 1, rotDeg: 90 });
      expect(xf.scale).toBeCloseTo(1920 / 1080, 12);
      expect(coversFrame('cover', s, xf)).toBe(true);
    });
  });

  describe('seeded property: cover never exposes the background', () => {
    const STEPS = 200;

    it.each(Object.keys(SOURCES))('%s: 200 random pans and zooms', (key) => {
      const s = src(key);
      const next = rng(0x5eed + key.length * 7919);
      let xf = initialXf('cover', s, CENTRE);
      for (let i = 0; i < STEPS; i++) {
        if (next() < 0.5) {
          xf = { ...xf, cx: xf.cx + (next() - 0.5) * 3000, cy: xf.cy + (next() - 0.5) * 3000 };
        } else {
          const pointer = { x: next() * 1080, y: next() * 1920 };
          xf = zoomAbout(xf, pointer, Math.exp((next() - 0.5) * 2));
        }
        xf = clampXf('cover', s, xf);
        expect(xf.scale, `step ${i}`).toBeGreaterThanOrEqual(1);
        expect(coversFrame('cover', s, xf), `step ${i}: ${JSON.stringify(xf)}`).toBe(true);
      }
    });

    it.each(Object.keys(SOURCES))('%s: 200 random pans, zooms and rotations', (key) => {
      const s = src(key);
      const next = rng(0xc0ffee + key.length * 104729);
      let xf = initialXf('cover', s, CENTRE);
      for (let i = 0; i < STEPS; i++) {
        const r = next();
        if (r < 0.4) {
          xf = { ...xf, cx: xf.cx + (next() - 0.5) * 3000, cy: xf.cy + (next() - 0.5) * 3000 };
        } else if (r < 0.8) {
          xf = zoomAbout(xf, { x: next() * 1080, y: next() * 1920 }, Math.exp((next() - 0.5) * 2));
        } else {
          xf = { ...xf, rotDeg: snapRotation((next() - 0.5) * 360) };
        }
        xf = clampXf('cover', s, xf);
        expect(coversFrame('cover', s, xf), `step ${i}: ${JSON.stringify(xf)}`).toBe(true);
      }
    });

    it('coversFrame detects exposure (sanity check of the oracle)', () => {
      const s = src('4000x3000');
      expect(coversFrame('cover', s, { cx: 540, cy: 961, scale: 1, rotDeg: 0 })).toBe(false);
      expect(coversFrame('cover', s, { cx: 540, cy: 960, scale: 1, rotDeg: 1 })).toBe(false);
      expect(coversFrame('cover', s, { cx: 1281, cy: 960, scale: 1, rotDeg: 0 })).toBe(false);
    });
  });
});
