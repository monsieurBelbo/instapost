/**
 * B3 (strategy §7.11): Instrument Sans loads from the bundled woff2 (public/fonts); a font that is
 * not loaded throws FONT_NOT_LOADED from the rasteriser and the measurer, before any pixel changes.
 * Tests run in order: the first ones see the font unloaded.
 */
import { describe, expect, test } from 'vitest';
import { compose } from '../core/render/compose.ts';
import { fixedAdvanceMeasurer } from '../core/text/fixed-measurer.ts';
import { pixelAt } from './calibration.ts';
import { isRasterError } from './errors.ts';
import { assertFontLoaded, cssFont, DEFAULT_FONT_ID, FONTS, fontSet, isFontLoaded, loadFont } from './fonts.ts';
import { canvasMeasurer } from './measurer-canvas.ts';
import { rasterize } from './rasterize.ts';
import { FIXTURE_FRAME, fixtureDoc, snapshot, textLayer } from './test-fixtures.ts';

const FONT = { fontId: DEFAULT_FONT_ID, sizePx: 48, letterSpacingPx: 0 };

function catchErr(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

/** Text ops for a one-text-layer doc, laid out with the fixed measurer (so compose never needs the font). */
function textOps(fontId: string) {
  const doc = fixtureDoc([textLayer({ fontId, text: 'Hello' })], { kind: 'solid', color: '#ffffff' });
  return compose(doc, FIXTURE_FRAME, 0, 'export', { assetSize: () => undefined, measurer: fixedAdvanceMeasurer() });
}

function paintedCtx(): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(1080, 1920).getContext('2d');
  if (!ctx) throw new Error('no ctx');
  ctx.fillStyle = '#123456';
  ctx.fillRect(0, 0, 1080, 1920);
  return ctx;
}

describe('B3 fonts', () => {
  test('before loading, the bundled font is not loaded although FontFaceSet.check() says true', () => {
    expect(fontSet().check(cssFont(FONT))).toBe(true); // why check() alone is not enough
    expect(isFontLoaded(DEFAULT_FONT_ID)).toBe(false);
    expect(
      isRasterError(
        catchErr(() => assertFontLoaded(DEFAULT_FONT_ID)),
        'FONT_NOT_LOADED',
      ),
    ).toBe(true);
  });

  test('an unloaded font throws FONT_NOT_LOADED from rasterize before drawing', () => {
    const ctx = paintedCtx();
    const err = catchErr(() => rasterize(textOps(DEFAULT_FONT_ID), ctx, 1, { image: () => undefined }));
    expect(isRasterError(err, 'FONT_NOT_LOADED')).toBe(true);
    expect(pixelAt(snapshot(ctx), 540, 960).slice(0, 3)).toEqual([0x12, 0x34, 0x56]);
  });

  test('an unloaded font throws FONT_NOT_LOADED from the canvas measurer', () => {
    const err = catchErr(() => canvasMeasurer().measureWidth('Hello', FONT));
    expect(isRasterError(err, 'FONT_NOT_LOADED')).toBe(true);
  });

  test('Instrument Sans loads from the bundled woff2', async () => {
    const res = await fetch(FONTS[DEFAULT_FONT_ID]?.url ?? '');
    expect(res.status).toBe(200);
    const magic = new Uint8Array(await res.arrayBuffer()).subarray(0, 4);
    expect(String.fromCharCode(...magic)).toBe('wOF2');

    const face = await loadFont(DEFAULT_FONT_ID);
    expect(face.status).toBe('loaded');
    expect(face.family.replaceAll('"', '')).toBe(FONTS[DEFAULT_FONT_ID]?.family);
    expect(fontSet().has(face)).toBe(true);
    expect(isFontLoaded(DEFAULT_FONT_ID)).toBe(true);
    expect(await loadFont(DEFAULT_FONT_ID)).toBe(face);

    // The real face is in use: its advances differ from a fallback family's.
    const ctx = new OffscreenCanvas(1, 1).getContext('2d');
    if (!ctx) throw new Error('no ctx');
    ctx.font = cssFont(FONT);
    const bundled = ctx.measureText('Instrument Sans').width;
    ctx.font = '600 48px monospace';
    const fallback = ctx.measureText('Instrument Sans').width;
    expect(bundled).not.toBeCloseTo(fallback, 0);
    // The variable weight axis follows the weight.
    ctx.font = `400 48px "${FONTS[DEFAULT_FONT_ID]?.family}"`;
    expect(ctx.measureText('Instrument Sans').width).toBeLessThan(bundled);
  });

  test('once loaded, rasterize draws the text', () => {
    const ctx = paintedCtx();
    rasterize(textOps(DEFAULT_FONT_ID), ctx, 1, { image: () => undefined });
    const img = snapshot(ctx);
    let dark = 0;
    for (let y = 900; y < 1020; y++) for (let x = 300; x < 780; x++) if ((pixelAt(img, x, y)[0] ?? 255) < 64) dark++;
    expect(dark).toBeGreaterThan(200);
  });

  test('a font id the build does not bundle stays FONT_NOT_LOADED', async () => {
    expect(
      isRasterError(
        catchErr(() => rasterize(textOps('gabarito'), paintedCtx(), 1, { image: () => undefined })),
        'FONT_NOT_LOADED',
      ),
    ).toBe(true);
    let err: unknown;
    try {
      await loadFont('gabarito');
    } catch (e) {
      err = e;
    }
    expect(isRasterError(err, 'FONT_NOT_LOADED')).toBe(true);
  });
});
