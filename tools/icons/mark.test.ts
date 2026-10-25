/**
 * RL-5 (inpage-ui-spec.md FE9, FR12): the live icons are instapost's mark, not the flat violet square, and the
 * committed PNGs are what scripts/gen-icons.ts draws (run it after changing the mark).
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { liveIcon } from '../../scripts/gen-icons.ts';
import { MARK_COLOURS, markPixels } from './mark.ts';

const ROOT = new URL('../../', import.meta.url).pathname;

/** The pixels of an RGBA PNG that uses filter 0 on every row (as encodePng writes it). */
function decode(png: Buffer): { w: number; h: number; colourType: number; px: (x: number, y: number) => number[] } {
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const colourType = png[25] ?? -1;
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const len = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const ch = colourType === 6 ? 4 : 3;
  return {
    w,
    h,
    colourType,
    px: (x, y) => [...raw.subarray(y * (w * ch + 1) + 1 + x * ch, y * (w * ch + 1) + 1 + (x + 1) * ch)],
  };
}

describe('RL-5 the live icon is the FE9 mark', () => {
  it('a transparent corner, the dark tile, the light arrow and card, the jade dot', () => {
    const p = markPixels(128);
    expect(p(0, 0)[3]).toBe(0);
    expect(p(64, 120)).toEqual([...MARK_COLOURS.tile, 255]);
    // The arrow's shaft (12, 12.5 in mark units) and the card's left side (5.25, 12).
    const at = (u: number, v: number) =>
      p(Math.floor(64 + ((u - 12) * (128 * 0.78)) / 24), Math.floor(64 + ((v - 12) * (128 * 0.78)) / 24));
    expect(at(12, 12.5)).toEqual([...MARK_COLOURS.stroke, 255]);
    expect(at(5.25, 12)).toEqual([...MARK_COLOURS.stroke, 255]);
    expect(at(18.4, 4.6)).toEqual([...MARK_COLOURS.dot, 255]);
  });

  it('the committed live PNGs are the mark at every size (RGBA, not the flat violet square)', () => {
    for (const size of [16, 32, 48, 128]) {
      const file = readFileSync(`${ROOT}public/icons/live/${size}.png`);
      expect(file.equals(liveIcon(size)), `public/icons/live/${size}.png: run node scripts/gen-icons.ts`).toBe(true);
      const d = decode(file);
      expect([d.w, d.h, d.colourType]).toEqual([size, size, 6]);
      const colours = new Set<string>();
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) colours.add(d.px(x, y).join(','));
      expect(colours.has('106,27,154,255')).toBe(false);
      expect(colours.size).toBeGreaterThan(8);
    }
  });
});
