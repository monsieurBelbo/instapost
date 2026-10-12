/**
 * A deterministic TextMeasurer for tests and headless checks (U4, U5): every grapheme cluster
 * advances by `advanceEm × sizePx`, and letter spacing is added between graphemes, as the
 * port specifies. No fonts, no DOM.
 */
import { type FontMetrics, type FontSpec, graphemes, type TextMeasurer } from './layout.ts';

/** Overrides for fixedAdvanceMeasurer(); all in em of the font's sizePx. */
export interface FixedMeasurerOptions {
  /** Advance per grapheme, in em. Default 0.5. */
  advanceEm?: number;
  /** Default 0.8 em. */
  ascentEm?: number;
  /** Default 0.2 em. */
  descentEm?: number;
}

/** A measurer where every grapheme is `advanceEm × sizePx` wide, plus letter spacing between graphemes. */
export function fixedAdvanceMeasurer(opts: FixedMeasurerOptions = {}): TextMeasurer {
  const { advanceEm = 0.5, ascentEm = 0.8, descentEm = 0.2 } = opts;
  return {
    measureWidth(text: string, font: FontSpec): number {
      const n = graphemes(text).length;
      return n === 0 ? 0 : n * advanceEm * font.sizePx + (n - 1) * font.letterSpacingPx;
    },
    fontMetrics(font: FontSpec): FontMetrics {
      return { ascent: ascentEm * font.sizePx, descent: descentEm * font.sizePx };
    },
  };
}
