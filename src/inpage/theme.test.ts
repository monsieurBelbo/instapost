/** inpage-ui-spec.md FT1, FT2: the scheme comes from Instagram's page background, not the OS. */
import { describe, expect, it } from 'vitest';
import { cssColor, PAGE_DEFAULTS, pagePalette, parseColor } from './theme.ts';

describe('page palette', () => {
  it('parses computed colours and Instagram triplets', () => {
    expect(parseColor('rgb(0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor('rgba(255, 255, 255, 0)')?.a).toBe(0);
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(cssColor('38,38,38')).toBe('rgb(38,38,38)');
    expect(cssColor('nonsense')).toBeNull();
  });

  it('dark background → dark scheme; light or unreadable → light', () => {
    expect(pagePalette({ background: 'rgb(0, 0, 0)', text: 'rgb(245, 245, 245)', vars: {} }).scheme).toBe('dark');
    expect(pagePalette({ background: 'rgb(255, 255, 255)', text: 'rgb(0, 0, 0)', vars: {} }).scheme).toBe('light');
    expect(pagePalette({ background: null, text: null, vars: {} })).toEqual(PAGE_DEFAULTS.light);
  });

  it('uses Instagram’s variables when present, and refuses a text colour that cannot be its text', () => {
    const p = pagePalette({ background: 'rgb(0, 0, 0)', text: 'rgb(0, 0, 0)', vars: { sep: '54,54,54' } });
    expect(p.text).toBe(PAGE_DEFAULTS.dark.text);
    expect(p.sep).toBe('rgb(54,54,54)');
  });
});
