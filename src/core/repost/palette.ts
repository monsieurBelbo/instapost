/**
 * Repost (docs/repost.md RP-27): the Colours background, a top-to-bottom gradient taken from the photo. From a
 * 16×16 RGBA cover sample: the mean of rows 0–3 (`from`) and of rows 12–15 (`to`), each mixed 15% toward
 * black; when their relative luminances differ by less than 0.08, `from` is lightened and `to` darkened by
 * 12%, so the gradient never reads flat. Pure.
 */

export interface Palette {
  from: string;
  to: string;
}

export const SAMPLE = 16;
type Rgb = [number, number, number];

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const hex = (c: Rgb): string => `#${c.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('')}`;

function rowsMean(px: ArrayLike<number>, first: number, last: number): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = first; y <= last; y++) {
    for (let x = 0; x < SAMPLE; x++) {
      const i = (y * SAMPLE + x) * 4;
      r += px[i] ?? 0;
      g += px[i + 1] ?? 0;
      b += px[i + 2] ?? 0;
      n++;
    }
  }
  return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n];
}

const lin = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** WCAG relative luminance, 0..1. */
export const luminance = (c: Rgb): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);

const mix = (c: Rgb, to: number, k: number): Rgb => [
  c[0] + (to - c[0]) * k,
  c[1] + (to - c[1]) * k,
  c[2] + (to - c[2]) * k,
];

export function palette(sample: ArrayLike<number>): Palette {
  let from = mix(rowsMean(sample, 0, 3), 0, 0.15);
  let to = mix(rowsMean(sample, 12, 15), 0, 0.15);
  if (Math.abs(luminance(from) - luminance(to)) < 0.08) {
    from = mix(from, 255, 0.12);
    to = mix(to, 0, 0.12);
  }
  return { from: hex(from), to: hex(to) };
}

/** `#rrggbb` as RGB (the painter's fallback avatar uses `to`). */
export function rgbOf(c: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m
    ? [Number.parseInt(m[1] ?? '0', 16), Number.parseInt(m[2] ?? '0', 16), Number.parseInt(m[3] ?? '0', 16)]
    : [0, 0, 0];
}
