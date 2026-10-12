/**
 * U3 (strategy §7.11): default rects 270/384/65; strict 672; containment helper.
 */
import { describe, expect, it } from 'vitest';
import type { Rect } from './fit.ts';
import { containsRect, marginBands, safeZones } from './safe-zones.ts';

const area = (r: Rect) => r.w * r.h;

describe('U3 safe zones', () => {
  it('default: top 270, bottom 384, sides 65', () => {
    expect(safeZones()).toEqual({
      safe: { x: 65, y: 270, w: 950, h: 1266 },
      top: { x: 0, y: 0, w: 1080, h: 270 },
      bottom: { x: 0, y: 1536, w: 1080, h: 384 },
      left: { x: 0, y: 270, w: 65, h: 1266 },
      right: { x: 1015, y: 270, w: 65, h: 1266 },
    });
  });

  it('strict: the bottom band grows to 672, the rest is unchanged', () => {
    const z = safeZones(true);
    expect(z.bottom).toEqual({ x: 0, y: 1248, w: 1080, h: 672 });
    expect(z.safe).toEqual({ x: 65, y: 270, w: 950, h: 978 });
    expect(z.top).toEqual(safeZones().top);
    expect(z.left.h).toBe(978);
    expect(containsRect(safeZones().safe, z.safe)).toBe(true);
  });

  it.each([false, true])('strict=%s: the safe area and the four bands tile the frame', (strict) => {
    const z = safeZones(strict);
    expect(area(z.safe) + marginBands(z).reduce((sum, r) => sum + area(r), 0)).toBe(1080 * 1920);
    expect(marginBands(z)).toEqual([z.top, z.bottom, z.left, z.right]);
  });

  describe('containsRect', () => {
    const outer = { x: 65, y: 270, w: 950, h: 1266 };

    it('accepts a rect inside, edges inclusive', () => {
      expect(containsRect(outer, { x: 100, y: 300, w: 200, h: 100 })).toBe(true);
      expect(containsRect(outer, outer)).toBe(true);
    });

    it.each([
      ['left', { x: 64, y: 300, w: 10, h: 10 }],
      ['top', { x: 100, y: 269, w: 10, h: 10 }],
      ['right', { x: 1006, y: 300, w: 10, h: 10 }],
      ['bottom', { x: 100, y: 1527, w: 10, h: 10 }],
      ['larger', { x: 0, y: 0, w: 1080, h: 1920 }],
    ])('rejects a rect crossing the %s edge', (_edge, inner) => {
      expect(containsRect(outer, inner)).toBe(false);
    });
  });
});
