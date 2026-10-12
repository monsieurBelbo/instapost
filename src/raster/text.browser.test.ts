/**
 * B4 (strategy §7.11): with the canvas measurer, the rendered text shows exactly as many lines
 * as the layout computed, and highlight boxes are drawn behind the glyphs.
 */
import { beforeAll, describe, expect, test } from 'vitest';
import type { TextLayer } from '../core/model/story.ts';
import { compose } from '../core/render/compose.ts';
import type { DrawOp } from '../core/render/ops.ts';
import { layoutText } from '../core/text/layout.ts';
import { findColor } from './calibration.ts';
import { DEFAULT_FONT_ID, loadFont } from './fonts.ts';
import { canvasMeasurer } from './measurer-canvas.ts';
import { rasterize } from './rasterize.ts';
import { FIXTURE_FRAME, fixtureDoc, snapshot, textLayer } from './test-fixtures.ts';

beforeAll(async () => {
  await loadFont(DEFAULT_FONT_ID);
});

function render(layer: TextLayer): { img: ImageData; ops: DrawOp[] } {
  const doc = fixtureDoc([layer], { kind: 'solid', color: '#ffffff' });
  const ops = compose(doc, FIXTURE_FRAME, 0, 'export', { assetSize: () => undefined, measurer: canvasMeasurer() });
  const ctx = new OffscreenCanvas(1080, 1920).getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error('no ctx');
  rasterize(ops, ctx, 1, { image: () => undefined });
  return { img: snapshot(ctx), ops };
}

/** Horizontal bands of rows that contain at least one dark pixel. */
function inkBands(img: ImageData): number {
  let bands = 0;
  let inBand = false;
  for (let y = 0; y < img.height; y++) {
    let ink = false;
    for (let x = 0; x < img.width && !ink; x++) {
      const i = (y * img.width + x) * 4;
      ink = (img.data[i] ?? 255) < 128 && (img.data[i + 1] ?? 255) < 128;
    }
    if (ink && !inBand) bands++;
    inBand = ink;
  }
  return bands;
}

describe('B4 canvas measurer', () => {
  test('widths count letter spacing between graphemes only', () => {
    const m = canvasMeasurer();
    const font = { fontId: DEFAULT_FONT_ID, sizePx: 40, letterSpacingPx: 0 };
    const spaced = { ...font, letterSpacingPx: 10 };
    expect(m.measureWidth('ab', spaced) - m.measureWidth('ab', font)).toBeCloseTo(10, 6);
    expect(m.measureWidth('abc', spaced) - m.measureWidth('abc', font)).toBeCloseTo(20, 6);
    // One grapheme cluster, so no gap at all.
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466);
    expect(m.measureWidth(family, spaced)).toBeCloseTo(m.measureWidth(family, font), 6);
    expect(m.measureWidth('', spaced)).toBe(0);
    const metrics = m.fontMetrics(font);
    expect(metrics.ascent).toBeGreaterThan(0);
    expect(metrics.descent).toBeGreaterThan(0);
  });

  test("the rendered line count equals the layout's", () => {
    const layer = textLayer({
      text: 'Instrument Sans wraps this sentence across several lines\nand keeps an explicit break',
      sizePx: 72,
      maxWidthPx: 620,
      lineHeight: 1.4,
    });
    const layout = layoutText(layer, canvasMeasurer());
    expect(layout.lines.length).toBeGreaterThanOrEqual(4);
    for (const line of layout.lines) expect(line.width).toBeLessThanOrEqual(620 + 1e-6);
    const { img } = render(layer);
    expect(inkBands(img)).toBe(layout.lines.length);
  });

  test('a single long line does not wrap when maxWidthPx allows it', () => {
    const layer = textLayer({ text: 'Short line', sizePx: 64, maxWidthPx: 1000 });
    expect(layoutText(layer, canvasMeasurer()).lines).toHaveLength(1);
    expect(inkBands(render(layer).img)).toBe(1);
  });
});

describe('B4 highlight', () => {
  const base = { text: 'Highlight sits\nbehind glyphs', sizePx: 96, color: '#0000ff', boxColor: '#ffff00' } as const;

  test('boxes are drawn behind the glyphs, inside the laid-out boxes', () => {
    const plain = render(textLayer({ ...base, style: 'plain' }));
    const high = render(textLayer({ ...base, style: 'highlight' }));
    const op = high.ops.find((o) => o.op === 'text');
    if (op?.op !== 'text') throw new Error('no text op');

    // Box union in story px (no rotation, scale 1: the matrix is a translation).
    const [, , , , e, f] = op.matrix;
    const boxes = op.lines.flatMap((l) => (l.box ? [l.box] : []));
    expect(boxes).toHaveLength(2);
    const x0 = Math.min(...boxes.map((b) => b.x)) + e;
    const y0 = Math.min(...boxes.map((b) => b.y)) + f;
    const x1 = Math.max(...boxes.map((b) => b.x + b.w)) + e;
    const y1 = Math.max(...boxes.map((b) => b.y + b.h)) + f;

    const yellow = findColor(high.img, '#ffff00', 24);
    expect(yellow.count).toBeGreaterThan(1000);
    const yb = yellow.bbox;
    expect(yb).not.toBeNull();
    if (!yb) return;
    expect(Math.abs(yb.x - x0)).toBeLessThanOrEqual(2);
    expect(Math.abs(yb.y - y0)).toBeLessThanOrEqual(2);
    expect(Math.abs(yb.x + yb.w - x1)).toBeLessThanOrEqual(2);
    expect(Math.abs(yb.y + yb.h - y1)).toBeLessThanOrEqual(2);

    // Glyph coverage is 1 - r/255 both for blue on white and for blue on yellow. Every solid
    // glyph pixel of the plain render must still be a glyph pixel over the box (yellow drawn on
    // top of a glyph would bring r back to 255).
    const coverage = (d: Uint8ClampedArray, i: number) => 1 - (d[i] ?? 255) / 255;
    let glyph = 0;
    let hidden = 0;
    for (let i = 0; i < plain.img.data.length; i += 4) {
      if (coverage(plain.img.data, i) < 0.9) continue;
      glyph++;
      if (coverage(high.img.data, i) < 0.8) hidden++;
    }
    expect(glyph).toBeGreaterThan(500);
    expect(hidden).toBe(0);
    // And the glyphs sit inside the boxes.
    const blue = findColor(high.img, '#0000ff', 60);
    expect(blue.bbox && blue.bbox.x >= x0 && blue.bbox.y >= y0).toBe(true);
    expect(blue.bbox && blue.bbox.x + blue.bbox.w <= x1 && blue.bbox.y + blue.bbox.h <= y1).toBe(true);
  });
});
