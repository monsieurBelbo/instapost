/**
 * RL-5 (inpage-ui-spec.md FE9, FR12): instapost's mark as the live build's toolbar and extensions-page icon,
 * replacing the flat violet square: the portrait card with an up arrow (entrypoints/composer/icons.tsx `Mark`,
 * 24-unit grid) and the jade dot with a ring, drawn light on a dark rounded tile so it reads on light and dark
 * toolbars alike. Rasterised here with supersampled coverage (no canvas, no dependencies): RGBA pixels.
 */

type Vec = readonly [number, number];
export type Rgba = readonly [number, number, number, number];

/** The tile, the strokes and the dot (FE9: the jade accent, the dark theme's). */
export const MARK_COLOURS = {
  tile: [22, 22, 22] as const,
  stroke: [245, 245, 245] as const,
  dot: [61, 214, 190] as const,
};

/** Signed distance from `p` to a rounded rectangle (centre `c`, half-size `b`, corner radius `r`). */
function roundRect(p: Vec, c: Vec, b: Vec, r: number): number {
  const qx = Math.abs(p[0] - c[0]) - (b[0] - r);
  const qy = Math.abs(p[1] - c[1]) - (b[1] - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Distance from `p` to the segment a–b. */
function segment(p: Vec, a: Vec, b: Vec): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// The mark (icons.tsx): <rect x=5.25 y=2.75 w=13.5 h=18.5 rx=3.75/>, <path d="M12 16V9.2M9.2 11.8 12 9l2.8 2.8"/>,
// <circle cx=18.4 cy=4.6 r=3/> with a 2-unit ring in the surface colour.
const CARD = { c: [12, 12] as Vec, b: [6.75, 9.25] as Vec, r: 3.75 };
const ARROW: readonly [Vec, Vec][] = [
  [
    [12, 16],
    [12, 9.2],
  ],
  [
    [9.2, 11.8],
    [12, 9],
  ],
  [
    [12, 9],
    [14.8, 11.8],
  ],
];
const DOT = { c: [18.4, 4.6] as Vec, r: 3, ring: 2 };

/** The mark's stroke in 24-unit space: thicker at toolbar sizes so it stays legible. */
export const strokeUnits = (size: number): number => (size <= 16 ? 2.75 : size <= 32 ? 2.4 : 2);

/** The colour at one point of a `size` px icon (RGBA, alpha 0 outside the tile). */
function sample(x: number, y: number, size: number): Rgba {
  const half = size / 2;
  if (roundRect([x, y], [half, half], [half, half], size * 0.225) > 0) return [0, 0, 0, 0];
  // Mark units → pixels: the mark's 24-unit box, at 78 % of the tile, centred on the card.
  const k = (size * 0.78) / 24;
  const p: Vec = [12 + (x - half) / k, 12 + (y - half) / k];
  const w = strokeUnits(size) / 2;
  const dDot = Math.hypot(p[0] - DOT.c[0], p[1] - DOT.c[1]);
  if (dDot <= DOT.r) return [...MARK_COLOURS.dot, 255];
  if (dDot <= DOT.r + DOT.ring) return [...MARK_COLOURS.tile, 255];
  const onCard = Math.abs(roundRect(p, CARD.c, CARD.b, CARD.r)) <= w;
  const onArrow = ARROW.some(([a, b]) => segment(p, a, b) <= w);
  return onCard || onArrow ? [...MARK_COLOURS.stroke, 255] : [...MARK_COLOURS.tile, 255];
}

/** The mark at `size` px: a pixel function (straight RGBA), 8×8 supersampled. */
export function markPixels(size: number, ss = 8): (x: number, y: number) => Rgba {
  return (x, y) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let j = 0; j < ss; j++) {
      for (let i = 0; i < ss; i++) {
        const s = sample(x + (i + 0.5) / ss, y + (j + 0.5) / ss, size);
        const al = s[3] / 255;
        r += s[0] * al;
        g += s[1] * al;
        b += s[2] * al;
        a += al;
      }
    }
    if (a === 0) return [0, 0, 0, 0];
    return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / (ss * ss)) * 255)];
  };
}
