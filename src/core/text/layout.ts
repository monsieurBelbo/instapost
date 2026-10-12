/**
 * Text layout behind a TextMeasurer port (strategy §3.2, §4, U4). Pure: the DOM measurer
 * (src/raster/measurer-canvas.ts) and the fixed-advance test measurer both implement the port.
 *
 * Wrapping uses Intl.Segmenter: break at word boundaries, fall back to grapheme boundaries
 * for a word wider than maxWidthPx, never split a grapheme cluster (👨‍👩‍👧‍👦, 🇦🇷, e + U+0301).
 * `\n` always breaks. Empty text gives no lines.
 *
 * Block geometry: the block is as wide as its widest line (plus the box padding for boxed
 * styles) and `lines × lineHeightPx` tall. Each line owns a slot of lineHeightPx; the baseline
 * sits in the slot like CSS half-leading. Boxes fill their slot vertically, so the boxes of
 * consecutive lines touch without overlapping (even translucent ones shade evenly).
 */
import type { Rect } from '../geometry/fit.ts';
import type { TextLayer, TextStyle } from '../model/story.ts';

/** What a measurer and the rasteriser need to select and space a font. */
export interface FontSpec {
  fontId: string;
  sizePx: number;
  letterSpacingPx: number;
}

/** Vertical font metrics at the spec's size, in px. */
export interface FontMetrics {
  /** Above the baseline, positive. */
  ascent: number;
  /** Below the baseline, positive. */
  descent: number;
}

/** Port. Widths include letter spacing between graphemes. */
export interface TextMeasurer {
  measureWidth(text: string, font: FontSpec): number;
  fontMetrics(font: FontSpec): FontMetrics;
}

/** The TextLayer fields layout depends on (a whole TextLayer is accepted). */
export type TextLayoutInput = Pick<
  TextLayer,
  'text' | 'fontId' | 'sizePx' | 'letterSpacingPx' | 'lineHeight' | 'maxWidthPx' | 'align' | 'style'
>;

/**
 * One laid-out line in the text block's local space (origin = block top-left, before the
 * layer's xf is applied). `box` is the highlight/inverse background box, null for other styles.
 * `x` is where the line's first glyph starts (alignment is already applied), so a rasteriser
 * draws every line left-aligned at (x, baseline). Empty lines (blank paragraphs) keep their
 * slot, with text '' and no box.
 */
export interface LaidOutLine {
  text: string;
  x: number;
  baseline: number;
  width: number;
  box: Rect | null;
}

/** layoutText() result, in block-local px. */
export interface TextLayout {
  lines: LaidOutLine[];
  /** Block size; the layer's xf centres this block. */
  width: number;
  height: number;
  lineHeightPx: number;
}

/** Horizontal box padding on each side of a line, in em (× sizePx). */
export const BOX_PAD_X_EM = 0.25;
/** Suggested corner radius for boxes, in em; the rasteriser draws the rounding. */
export const BOX_RADIUS_EM = 0.2;

/** Styles that draw a background box per line. */
export const hasLineBoxes = (style: TextStyle): boolean => style === 'highlight' || style === 'inverse';

/** Fixed locale: UAX #29 default rules, so layout does not depend on the machine's locale. */
const SEGMENTER_LOCALE = 'en';
let graphemeSegmenter: Intl.Segmenter | undefined;
let wordSegmenter: Intl.Segmenter | undefined;

/** Grapheme clusters via Intl.Segmenter. */
export function graphemes(text: string): string[] {
  graphemeSegmenter ??= new Intl.Segmenter(SEGMENTER_LOCALE, { granularity: 'grapheme' });
  return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
}

/** Paragraph separators: CRLF, CR, LF, U+2028, U+2029. */
const PARAGRAPH_BREAK = /\r\n|[\n\r\u2028\u2029]/;
/** Breakable spaces; NBSP, figure space and narrow NBSP are deliberately absent. */
const SPACE_RUN = /^[\t\v\f \u1680\u2000-\u2006\u2008-\u200a\u205f\u3000]+$/;
const TRAILING_SPACES = /[\t\v\f \u1680\u2000-\u2006\u2008-\u200a\u205f\u3000]+$/;
/** Measurement slack, so a line measured at exactly maxWidthPx still fits. */
const FIT_EPS_PX = 1e-6;

const trimEndSpaces = (s: string): string => s.replace(TRAILING_SPACES, '');

/**
 * Splits a paragraph into unbreakable chunks, each carrying its trailing spaces. A break is
 * allowed before a non-space word segment that follows spaces, or between two word-like
 * segments (CJK and Thai words, which abut without spaces). Punctuation and emoji stay glued
 * to their neighbours.
 */
function breakChunks(paragraph: string): string[] {
  wordSegmenter ??= new Intl.Segmenter(SEGMENTER_LOCALE, { granularity: 'word' });
  const chunks: string[] = [];
  let current = '';
  let prevSpace = false;
  let prevWord = false;
  for (const seg of wordSegmenter.segment(paragraph)) {
    const space = SPACE_RUN.test(seg.segment);
    const word = seg.isWordLike === true;
    if (current !== '' && !space && (prevSpace || (prevWord && word))) {
      chunks.push(current);
      current = '';
    }
    current += seg.segment;
    prevSpace = space;
    prevWord = word;
  }
  if (current !== '') chunks.push(current);
  return chunks;
}

/** Greedy grapheme fill for a chunk wider than the line; every piece holds at least one grapheme. */
function splitByGraphemes(text: string, fits: (s: string) => boolean): string[] {
  const pieces: string[] = [];
  let current = '';
  for (const g of graphemes(text)) {
    if (current !== '' && !fits(current + g)) {
      pieces.push(current);
      current = g;
    } else {
      current += g;
    }
  }
  pieces.push(current);
  return pieces;
}

/** Greedy word wrap of one paragraph; returns at least one (possibly empty) line, trailing spaces trimmed. */
function wrapParagraph(paragraph: string, fits: (s: string) => boolean): string[] {
  const lines: string[] = [];
  let line = '';
  for (const chunk of breakChunks(paragraph)) {
    if (line !== '' && fits(line + chunk)) {
      line += chunk;
      continue;
    }
    // Leading spaces that do not fit with the next word are dropped rather than left on a line of their own.
    if (trimEndSpaces(line) !== '') lines.push(line);
    line = '';
    if (fits(chunk)) {
      line = chunk;
      continue;
    }
    const body = trimEndSpaces(chunk);
    const pieces = splitByGraphemes(body, fits);
    lines.push(...pieces.slice(0, -1));
    line = (pieces.at(-1) ?? '') + chunk.slice(body.length);
  }
  lines.push(line);
  return lines.map(trimEndSpaces);
}

/**
 * Lays out a text layer's text in block-local px. A non-positive or non-finite maxWidthPx
 * means no wrapping (explicit `\n` only). Text made only of spaces and line breaks gives no
 * lines, like empty text.
 */
export function layoutText(input: TextLayoutInput, measurer: TextMeasurer): TextLayout {
  const font: FontSpec = { fontId: input.fontId, sizePx: input.sizePx, letterSpacingPx: input.letterSpacingPx };
  const lineHeightPx = input.sizePx * input.lineHeight;
  if (input.text.split(PARAGRAPH_BREAK).every((p) => trimEndSpaces(p) === '')) {
    return { lines: [], width: 0, height: 0, lineHeightPx };
  }

  const widths = new Map<string, number>();
  const measure = (s: string): number => {
    let w = widths.get(s);
    if (w === undefined) {
      w = s === '' ? 0 : measurer.measureWidth(s, font);
      widths.set(s, w);
    }
    return w;
  };
  const maxW = input.maxWidthPx > 0 && Number.isFinite(input.maxWidthPx) ? input.maxWidthPx : Infinity;
  const fits = (s: string): boolean => measure(trimEndSpaces(s)) <= maxW + FIT_EPS_PX;

  const texts = input.text.split(PARAGRAPH_BREAK).flatMap((p) => wrapParagraph(p, fits));
  const lineWidths = texts.map(measure);
  const contentW = Math.max(0, ...lineWidths);
  const boxed = hasLineBoxes(input.style);
  const padX = boxed ? BOX_PAD_X_EM * input.sizePx : 0;
  const { ascent, descent } = measurer.fontMetrics(font);
  const baselineInSlot = (lineHeightPx - (ascent + descent)) / 2 + ascent;

  const lines = texts.map((text, i): LaidOutLine => {
    const width = lineWidths[i] ?? 0;
    const slack = contentW - width;
    const x = padX + (input.align === 'left' ? 0 : input.align === 'center' ? slack / 2 : slack);
    const top = i * lineHeightPx;
    const box = boxed && text !== '' ? { x: x - padX, y: top, w: width + 2 * padX, h: lineHeightPx } : null;
    return { text, x, baseline: top + baselineInSlot, width, box };
  });
  return { lines, width: contentW + 2 * padX, height: lines.length * lineHeightPx, lineHeightPx };
}
