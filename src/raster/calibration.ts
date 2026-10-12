/**
 * Calibration sources and marker detection (B1; later reused to measure the composer's
 * resampling, L5/P10). A source is a flat background with solid, uniquely coloured marker
 * rectangles; after rendering, each marker is found again by colour, so a test can assert
 * where a pixel of the source landed without knowing anything about the pipeline in between.
 */
import type { Point, Rect } from '../core/geometry/fit.ts';
import { parseHexColor } from '../core/render/color.ts';

export interface Marker {
  name: string;
  /** `#rrggbb`; pick colours far apart from each other and from the background. */
  color: string;
  /** In source px. */
  rect: Rect;
}

/** Distinct, saturated marker colours (far apart in RGB). */
export const MARKER_COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'] as const;

/** Squares of `size` px in the four corners of a w×h source, `inset` px from the edges: tl, tr, bl, br. */
export function cornerMarkers(w: number, h: number, size: number, inset = 0): Marker[] {
  const [tl = '', tr = '', bl = '', br = ''] = MARKER_COLORS;
  return [
    { name: 'tl', color: tl, rect: { x: inset, y: inset, w: size, h: size } },
    { name: 'tr', color: tr, rect: { x: w - inset - size, y: inset, w: size, h: size } },
    { name: 'bl', color: bl, rect: { x: inset, y: h - inset - size, w: size, h: size } },
    { name: 'br', color: br, rect: { x: w - inset - size, y: h - inset - size, w: size, h: size } },
  ];
}

/** A w×h canvas filled with `background` and the markers drawn on top. */
export function calibrationCanvas(
  w: number,
  h: number,
  markers: readonly Marker[],
  background = '#808080',
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error('calibration: 2d context unavailable');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, w, h);
  for (const m of markers) {
    ctx.fillStyle = m.color;
    ctx.fillRect(m.rect.x, m.rect.y, m.rect.w, m.rect.h);
  }
  return canvas;
}

export interface ColorHits {
  count: number;
  /** Bounding box of the matching pixels (x, y of the first; w, h in px), or null. */
  bbox: Rect | null;
  /** Mean position of the matching pixels' centres, or null. */
  centroid: Point | null;
}

/** Pixels within `tolerance` (max channel difference, alpha ignored) of `color`. */
export function findColor(img: ImageData, color: string, tolerance = 48): ColorHits {
  const c = parseHexColor(color);
  if (!c) throw new Error(`findColor: bad colour ${color}`);
  const { data, width, height } = img;
  let count = 0;
  let sx = 0;
  let sy = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const d = Math.max(
        Math.abs((data[i] ?? 0) - c.r),
        Math.abs((data[i + 1] ?? 0) - c.g),
        Math.abs((data[i + 2] ?? 0) - c.b),
      );
      if (d > tolerance) continue;
      count++;
      sx += x + 0.5;
      sy += y + 0.5;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (count === 0) return { count, bbox: null, centroid: null };
  return { count, bbox: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, centroid: { x: sx / count, y: sy / count } };
}

/** The RGBA of one pixel. */
export function pixelAt(img: ImageData, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0, img.data[i + 3] ?? 0];
}
