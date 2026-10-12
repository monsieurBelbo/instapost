/**
 * The DOM TextMeasurer (strategy §3.2): canvas measureText with the bundled fonts, so layout
 * and rasterisation agree to the pixel.
 *
 * The port's widths include letter spacing *between* graphemes. Canvas adds `letterSpacing`
 * after every grapheme cluster, the last one included (checked in Chrome 156), so the width is
 * measured with the drawing's own spacing and one trailing space is taken off. Measuring with
 * the same spacing as the draw keeps any spacing-dependent shaping identical.
 */
import type { FontMetrics, FontSpec, TextMeasurer } from '../core/text/layout.ts';
import { RasterError } from './errors.ts';
import { assertFontLoaded, cssFont } from './fonts.ts';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A measurer over `ctx` (default: a private 1x1 OffscreenCanvas). Throws FONT_NOT_LOADED for unloaded fonts. */
export function canvasMeasurer(ctx?: Ctx2D): TextMeasurer {
  const c = ctx ?? new OffscreenCanvas(1, 1).getContext('2d');
  if (!c) throw new RasterError('NO_CONTEXT', 'measurer: 2d context unavailable');
  const metrics = new Map<string, FontMetrics>();

  const setFont = (font: FontSpec, letterSpacingPx: number): void => {
    assertFontLoaded(font.fontId);
    c.font = cssFont(font);
    c.letterSpacing = `${letterSpacingPx}px`;
    c.fontKerning = 'normal';
  };

  return {
    measureWidth(text: string, font: FontSpec): number {
      if (text === '') return 0;
      setFont(font, font.letterSpacingPx);
      return c.measureText(text).width - font.letterSpacingPx;
    },
    fontMetrics(font: FontSpec): FontMetrics {
      const key = `${font.fontId}@${font.sizePx}`;
      let m = metrics.get(key);
      if (!m) {
        setFont(font, 0);
        const t = c.measureText('Hg');
        m = { ascent: t.fontBoundingBoxAscent, descent: t.fontBoundingBoxDescent };
        metrics.set(key, m);
      }
      return m;
    },
  };
}
