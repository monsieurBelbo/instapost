/** @jsxImportSource react */
/**
 * Composer canvas geometry (strategy §6.1 `geometry` and `insets` knobs, §7.6). Pure functions;
 * StoryComposer applies them and publishes the result as ground truth in
 * `document.documentElement.dataset.fakeGeometry`.
 *
 * - `viewportDpr`: CSS box = largest 9:16 box inside innerWidth × (innerHeight − insets);
 *   backing = round(css × devicePixelRatio).
 * - `source`: CSS box as viewportDpr; backing = the largest 9:16 box inside the source, at the
 *   source's own resolution (no resampling of a 1080x1920 export).
 * - `fixed:WxH`: backing W×H; CSS box = largest W:H box inside the available area.
 * - `cssFixed:WxH`: CSS box W×H; backing = round(css × devicePixelRatio).
 *
 * CSS boxes are whole pixels, centred in the available area below the top inset, so the
 * canvas's getBoundingClientRect() equals the ground truth exactly.
 */
import { type GeometryModel, parseGeometryModel } from '../knobs.ts';
import type { Crop, Rect, Size } from '../protocol.ts';

export interface GeometryInput {
  model: GeometryModel;
  insets: readonly [number, number];
  inner: Size;
  dpr: number;
  source: Size;
}

/** Largest box with aspect num:den inside `avail`, whole pixels. */
export function fitAspect(avail: Size, num: number, den: number): Size {
  const w = Math.max(0, Math.floor(avail.w));
  const h = Math.max(0, Math.floor(avail.h));
  if (w * den >= h * num) return { w: Math.min(w, Math.round((h * num) / den)), h };
  return { w, h: Math.min(h, Math.floor((w * den) / num)) };
}

export function computeGeometry(i: GeometryInput): { canvas: Size; css: Rect } {
  const parsed = parseGeometryModel(i.model);
  if (!parsed) throw new Error(`fake-ig: invalid geometry model ${i.model}`);
  const [top, bottom] = i.insets;
  const avail: Size = { w: i.inner.w, h: Math.max(0, i.inner.h - top - bottom) };
  const scale = (s: Size): Size => ({ w: Math.round(s.w * i.dpr), h: Math.round(s.h * i.dpr) });
  let box: Size;
  let canvas: Size;
  switch (parsed.kind) {
    case 'viewportDpr':
      box = fitAspect(avail, 9, 16);
      canvas = scale(box);
      break;
    case 'source':
      box = fitAspect(avail, 9, 16);
      canvas = fitAspect(i.source, 9, 16);
      break;
    case 'fixed':
      box = fitAspect(avail, parsed.w, parsed.h);
      canvas = { w: parsed.w, h: parsed.h };
      break;
    case 'cssFixed':
      box = { w: parsed.w, h: parsed.h };
      canvas = scale(box);
      break;
  }
  const css: Rect = {
    x: Math.floor((avail.w - box.w) / 2),
    y: top + Math.floor((avail.h - box.h) / 2),
    w: box.w,
    h: box.h,
  };
  return { canvas, css };
}

/** Centred cover crop of `source` to the aspect of `canvas` (research §2 fn 7, getCropInfo). */
export function coverCrop(source: Size, canvas: Size): Crop {
  if (source.w * canvas.h > source.h * canvas.w) {
    const sw = (source.h * canvas.w) / canvas.h;
    return { sx: (source.w - sw) / 2, sy: 0, sw, sh: source.h };
  }
  const sh = (source.w * canvas.h) / canvas.w;
  return { sx: 0, sy: (source.h - sh) / 2, sw: source.w, sh };
}
