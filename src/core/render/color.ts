/**
 * Colour helpers for the display list. Colours in a StoryDoc are CSS hex strings
 * (`#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`, strategy §3.3).
 */

export interface Rgba {
  /** 0..255 */
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parses a CSS hex colour, or returns null. */
export function parseHexColor(color: string): Rgba | null {
  const m = HEX.exec(color.trim());
  const hex = m?.[1];
  if (!hex) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
  const byte = (i: number): number => Number.parseInt(full.slice(i, i + 2), 16);
  return { r: byte(0), g: byte(2), b: byte(4), a: full.length === 8 ? byte(6) / 255 : 1 };
}

/** WCAG relative luminance (0 = black, 1 = white), ignoring alpha. */
export function relativeLuminance(c: Rgba): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * Black or white, whichever has the higher WCAG contrast against `color`. Unparseable input
 * gives black.
 */
export function contrastColor(color: string): '#000000' | '#ffffff' {
  const c = parseHexColor(color);
  if (!c) return '#000000';
  const l = relativeLuminance(c);
  // Contrast with black (l + 0.05) / 0.05 beats white 1.05 / (l + 0.05) above l ≈ 0.179.
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}
