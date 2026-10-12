/**
 * U4 (strategy §7.11): with a fixed-advance fake measurer, layout wraps at maxWidthPx,
 * honours `\n`, never splits 👨‍👩‍👧‍👦, 🇦🇷 or e + U+0301, gives one highlight box per line,
 * and gives no lines for empty text.
 */
import { describe, expect, it } from 'vitest';
import { fixedAdvanceMeasurer } from './fixed-measurer.ts';
import { BOX_PAD_X_EM, graphemes, layoutText, type TextLayoutInput } from './layout.ts';

// Built from code points so the source shows exactly which clusters are tested.
const FAMILY = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466);
const FLAG_AR = String.fromCodePoint(0x1f1e6, 0x1f1f7);
const E_ACUTE = `e${String.fromCodePoint(0x301)}`;

/** 20 px font, 0.5 em advance: every grapheme is exactly 10 px wide. */
const measurer = fixedAdvanceMeasurer();
const base: TextLayoutInput = {
  text: '',
  fontId: 'test-sans',
  sizePx: 20,
  letterSpacingPx: 0,
  lineHeight: 1.25,
  maxWidthPx: 95,
  align: 'left',
  style: 'plain',
};
const layout = (over: Partial<TextLayoutInput>) => layoutText({ ...base, ...over }, measurer);
const texts = (over: Partial<TextLayoutInput>) => layout(over).lines.map((l) => l.text);

describe('U4 text layout', () => {
  describe('wrapping', () => {
    it('wraps at maxWidthPx on word boundaries', () => {
      const l = layout({ text: 'aaaa bbbb cccc dd' });
      expect(l.lines.map((x) => x.text)).toEqual(['aaaa bbbb', 'cccc dd']);
      expect(l.lines.map((x) => x.width)).toEqual([90, 70]);
      for (const line of l.lines) expect(line.width).toBeLessThanOrEqual(95);
    });

    it('counts letter spacing between graphemes', () => {
      // 'aaaa bbbb' = 9 × 10 + 8 × 2 = 106 > 95.
      expect(texts({ text: 'aaaa bbbb cccc dd', letterSpacingPx: 2 })).toEqual(['aaaa', 'bbbb', 'cccc dd']);
    });

    it('a line exactly maxWidthPx wide still fits', () => {
      expect(texts({ text: 'aaaa bbbb cc', maxWidthPx: 90 })).toEqual(['aaaa bbbb', 'cc']);
    });

    it('falls back to grapheme boundaries for a word wider than the line', () => {
      expect(texts({ text: 'abcdefghijkl xy', maxWidthPx: 45 })).toEqual(['abcd', 'efgh', 'ijkl', 'xy']);
      expect(texts({ text: 'ab abcdefgh', maxWidthPx: 45 })).toEqual(['ab', 'abcd', 'efgh']);
    });

    it('keeps punctuation with its word', () => {
      expect(texts({ text: 'hello, world', maxWidthPx: 65 })).toEqual(['hello,', 'world']);
    });

    it('wraps CJK text between words without spaces, within the width', () => {
      const text = '日本語のテキスト';
      const lines = texts({ text, maxWidthPx: 45 });
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.join('')).toBe(text);
      for (const line of layout({ text, maxWidthPx: 45 }).lines) expect(line.width).toBeLessThanOrEqual(45);
    });

    it('does not wrap when maxWidthPx is 0 or not finite', () => {
      expect(texts({ text: 'aaaa bbbb cccc dd', maxWidthPx: 0 })).toEqual(['aaaa bbbb cccc dd']);
      expect(texts({ text: 'aaaa bbbb cccc dd', maxWidthPx: Number.POSITIVE_INFINITY })).toEqual(['aaaa bbbb cccc dd']);
    });

    it('trims trailing spaces at line ends and keeps leading ones', () => {
      expect(texts({ text: '  ab   ', maxWidthPx: 0 })).toEqual(['  ab']);
    });
  });

  describe('explicit line breaks', () => {
    it('honours \\n, \\r\\n and blank lines', () => {
      expect(texts({ text: 'ab\ncd' })).toEqual(['ab', 'cd']);
      expect(texts({ text: 'ab\r\ncd' })).toEqual(['ab', 'cd']);
      const l = layout({ text: 'ab\n\ncd', style: 'highlight' });
      expect(l.lines.map((x) => x.text)).toEqual(['ab', '', 'cd']);
      expect(l.lines[1]?.box).toBeNull();
      expect(l.height).toBe(3 * 25);
    });

    it('wraps each paragraph on its own', () => {
      expect(texts({ text: 'aaaa bbbb cccc\ndd' })).toEqual(['aaaa bbbb', 'cccc', 'dd']);
    });
  });

  describe('grapheme clusters are never split', () => {
    it('graphemes() keeps clusters whole', () => {
      expect(graphemes(`${FAMILY}${FLAG_AR}${E_ACUTE}x`)).toEqual([FAMILY, FLAG_AR, E_ACUTE, 'x']);
      expect(graphemes('')).toEqual([]);
    });

    it.each([
      ['family ZWJ sequence', FAMILY],
      ['flag 🇦🇷', FLAG_AR],
      ['e + U+0301', E_ACUTE],
    ])('%s', (_name, cluster) => {
      // Two clusters (20 px) fit in 25 px; a code-point split would cut each cluster.
      const text = cluster.repeat(5);
      const lines = texts({ text, maxWidthPx: 25 });
      expect(lines).toEqual([cluster + cluster, cluster + cluster, cluster]);
      expect(lines.join('')).toBe(text);
      for (const line of lines) for (const g of graphemes(line)) expect(g).toBe(cluster);
    });

    it('mixed with letters and no spaces', () => {
      expect(texts({ text: `ab${FAMILY}cd`, maxWidthPx: 25 })).toEqual(['ab', `${FAMILY}c`, 'd']);
      expect(texts({ text: `caf${E_ACUTE} ${FLAG_AR}${FLAG_AR}`, maxWidthPx: 45 })).toEqual([
        `caf${E_ACUTE}`,
        FLAG_AR + FLAG_AR,
      ]);
    });
  });

  describe('boxes and geometry', () => {
    const padX = BOX_PAD_X_EM * 20;

    it('one highlight box per line, behind the line, slots touching', () => {
      const l = layout({ text: 'aaaa bbbb cccc dd', style: 'highlight' });
      expect(l.lines).toHaveLength(2);
      l.lines.forEach((line, i) => {
        expect(line.box).not.toBeNull();
        if (!line.box) return;
        expect(line.box).toEqual({ x: line.x - padX, y: i * 25, w: line.width + 2 * padX, h: 25 });
        expect(line.baseline).toBeGreaterThan(line.box.y);
        expect(line.baseline).toBeLessThan(line.box.y + line.box.h);
      });
      expect(l.width).toBe(90 + 2 * padX);
      expect(l.height).toBe(50);
    });

    it.each([
      ['plain', false],
      ['highlight', true],
      ['inverse', true],
      ['outline', false],
      ['glow', false],
    ] as const)('style %s has line boxes: %s', (style, boxed) => {
      for (const line of layout({ text: 'aaaa bbbb cccc dd', style }).lines) expect(line.box !== null).toBe(boxed);
    });

    it('aligns lines inside the block', () => {
      const xs = (align: TextLayoutInput['align']) =>
        layout({ text: 'aaaa bbbb cccc dd', align }).lines.map((l) => l.x);
      expect(xs('left')).toEqual([0, 0]);
      expect(xs('center')).toEqual([0, 10]);
      expect(xs('right')).toEqual([0, 20]);
      expect(layout({ text: 'aaaa bbbb cccc dd', align: 'center', style: 'highlight' }).lines.map((l) => l.x)).toEqual([
        padX,
        padX + 10,
      ]);
    });

    it('places baselines with CSS half-leading', () => {
      // slot 25, ascent 16, descent 4 → (25 − 20) / 2 + 16 = 18.5.
      expect(layout({ text: 'ab\ncd' }).lines.map((l) => l.baseline)).toEqual([18.5, 43.5]);
      expect(layout({ text: 'ab' }).lineHeightPx).toBe(25);
    });
  });

  describe('empty text', () => {
    it.each(['', '   ', '\n', ' \n \n'])('%j gives no lines', (text) => {
      expect(layout({ text, style: 'highlight' })).toEqual({ lines: [], width: 0, height: 0, lineHeightPx: 25 });
    });
  });
});
