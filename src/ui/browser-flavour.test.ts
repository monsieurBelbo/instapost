/** P6 (2026-10-12): the editor's browser flavour, Arc recognised by its palette properties. */
import { describe, expect, test } from 'vitest';
import { flavourOf, hasArcPalette } from './browser-flavour.ts';

/** A CSSStyleDeclaration stand-in: the listed custom properties with their values. */
function style(props: Record<string, string> = {}) {
  const names = Object.keys(props);
  return {
    length: names.length,
    item: (i: number) => names[i] ?? '',
    getPropertyValue: (n: string) => props[n] ?? '',
  };
}

const ARC_BRANDS = ['Chromium', 'Not(A:Brand'];

describe('P6 browser flavour', () => {
  test('Arc: an --arc-palette-* property inline or computed on the root', () => {
    expect(hasArcPalette({ inline: style({ '--arc-palette-title': '#fff' }), computed: style() })).toBe(true);
    expect(hasArcPalette({ inline: style(), computed: style({ '--arc-palette-background': '#101010' }) })).toBe(true);
    // Computed styles that do not enumerate custom properties: the known names are read directly.
    const opaque = {
      length: 0,
      item: () => '',
      getPropertyValue: (n: string) => (n === '--arc-palette-focus' ? ' #0af' : ''),
    };
    expect(hasArcPalette({ inline: null, computed: opaque })).toBe(true);
    expect(hasArcPalette({ inline: style({ '--brand-color': 'red' }), computed: style() })).toBe(false);
    expect(hasArcPalette({ inline: null, computed: null })).toBe(false);
  });

  test('the same brands are Arc with the palette and Chromium without it', () => {
    const arcRoot = style({ '--arc-palette-title': '#fff' });
    expect(flavourOf({ brands: ARC_BRANDS, inline: arcRoot, computed: style() })).toBe('arc');
    expect(flavourOf({ brands: ARC_BRANDS, inline: style(), computed: style() })).toBe('chromium');
    expect(flavourOf({ brands: ['Google Chrome', 'Chromium'], inline: style(), computed: style() })).toBe('chrome');
    expect(flavourOf({ brands: null, inline: null, computed: null })).toBe('unknown');
  });
});
