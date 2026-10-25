/**
 * The engine frame's size (docs/inpage.md §3.11). Pure.
 *
 * The frame's layout viewport is its CSS box, so instapost chooses it instead of fitting a window to the
 * screen: W = min(720, floor(1080 ÷ dpr)), made even, never below 320; H = W × 16 ÷ 9. At DPR 2 (the
 * MacBook) that is 540×960, at DPR 1 (the ultrawide) 720×1280. W stays at most 767 CSS px, so msite renders
 * its mobile header with + → Story (F3), and H > W, so C3a passes. What the owner sees is the frame scaled
 * down with a CSS transform, which changes neither the viewport, nor the DPR, nor the canvas sizes.
 */

export interface Box {
  w: number;
  h: number;
}

export const FRAME_MAX_W = 720;
export const FRAME_MIN_W = 320;
/** The story's short side in device pixels: W × DPR reaches 1080 when it can. */
export const STORY_W_PX = 1080;

/** The Developer `frame` toggle (docs/inpage.md §10.3; guarded builds only). */
export const FRAME_TOGGLES = ['auto', '540x960', '412x732'] as const;
export type FrameToggle = (typeof FRAME_TOGGLES)[number];

/** W×H for a frame on a display (and page zoom) of `dpr` device pixels per CSS px. */
export function frameBox(dpr: number): Box {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  let w = Math.min(FRAME_MAX_W, Math.floor(STORY_W_PX / d));
  w -= w % 2;
  w = Math.max(FRAME_MIN_W, w);
  return { w, h: Math.round((w * 16) / 9) };
}

/** The box a toggle asks for at `dpr`. */
export function frameBoxFor(toggle: FrameToggle, dpr: number): Box {
  if (toggle === '540x960') return { w: 540, h: 960 };
  if (toggle === '412x732') return { w: 412, h: 732 };
  return frameBox(dpr);
}

export interface Scaled extends Box {
  /** The CSS scale applied to the frame's container, at most 1. */
  scale: number;
}

/** The largest scale (at most 1) at which `box` fits inside `area`, and the size it then takes. */
export function scaleToFit(box: Box, area: Box): Scaled {
  if (box.w <= 0 || box.h <= 0) return { scale: 0, w: 0, h: 0 };
  const scale = Math.max(0, Math.min(1, area.w / box.w, area.h / box.h));
  return { scale, w: Math.floor(box.w * scale), h: Math.floor(box.h * scale) };
}
