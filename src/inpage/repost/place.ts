/**
 * Repost (docs/repost.md RP-6, RP-7, RP-9, RP-10): where the Add to story entries go, in viewport px. Pure.
 *
 * - stripPlace: the Share dialog's strip, the panel's width (280–560, centred on it), 56 high, 8 below the
 *   panel; 8 above when there is less than 64 below; none when there is no room either side.
 * - popoverPlace: the fallback pill, 8 right of the Share control and centred on it; above it, centred, when
 *   it would overflow; none when neither fits.
 * - fallbackPlace: the pill when a Share dialog is open but the strip has no room (or its panel is not found):
 *   never over the dialog. 8 right of it, else 8 left, top-aligned with it (inside the viewport); else the
 *   popover's place if that misses the dialog; else none. Without a dialog, popoverPlace.
 * - mentionPillPlace: inside the DM preview's bottom edge: centred, min(w − 16, 200) × 32, 8 from the bottom
 *   when the preview is at least 132 wide; else a 32 round "+" 6 inside the bottom-right corner.
 * - viewerPillPlace: 12 right of the story's media, bottom-aligned; else 12 left of it; else none.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  w: number;
  h: number;
}

export const STRIP = { minW: 280, maxW: 560, h: 56, gap: 8, room: 64 } as const;
export const POPOVER = { h: 36, gap: 8 } as const;
export const PILL = { wideMin: 132, maxW: 200, h: 32, inset: 8, round: 32, roundInset: 6 } as const;
export const VIEWER = { gap: 12 } as const;
const EDGE = 8;

const clamp = (v: number, lo: number, hi: number): number => (lo > hi ? lo : Math.min(hi, Math.max(lo, v)));

export function stripPlace(panel: Rect, vp: Size): Rect | null {
  const w = clamp(panel.w, STRIP.minW, STRIP.maxW);
  const x = clamp(panel.x + panel.w / 2 - w / 2, EDGE, vp.w - w - EDGE);
  const bottom = panel.y + panel.h;
  if (vp.h - bottom >= STRIP.room) return { x, y: bottom + STRIP.gap, w, h: STRIP.h };
  if (panel.y >= STRIP.room) return { x, y: panel.y - STRIP.gap - STRIP.h, w, h: STRIP.h };
  return null;
}

export function popoverPlace(control: Rect, pill: Size, vp: Size): Rect | null {
  const h = pill.h;
  const right = { x: control.x + control.w + POPOVER.gap, y: control.y + control.h / 2 - h / 2, w: pill.w, h };
  if (right.x + right.w <= vp.w - EDGE && right.y >= EDGE && right.y + h <= vp.h - EDGE) return right;
  const above = {
    x: clamp(control.x + control.w / 2 - pill.w / 2, EDGE, vp.w - pill.w - EDGE),
    y: control.y - POPOVER.gap - h,
    w: pill.w,
    h,
  };
  if (above.y >= EDGE && pill.w <= vp.w - 2 * EDGE) return above;
  return null;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function fallbackPlace(control: Rect, pill: Size, vp: Size, dialog: Rect | null): Rect | null {
  if (!dialog) return popoverPlace(control, pill, vp);
  const y = clamp(dialog.y, EDGE, vp.h - pill.h - EDGE);
  if (y + pill.h <= vp.h - EDGE) {
    const right = { x: dialog.x + dialog.w + POPOVER.gap, y, w: pill.w, h: pill.h };
    if (right.x + right.w <= vp.w - EDGE) return right;
    const left = { x: dialog.x - POPOVER.gap - pill.w, y, w: pill.w, h: pill.h };
    if (left.x >= EDGE) return left;
  }
  const near = popoverPlace(control, pill, vp);
  return near && !overlaps(near, dialog) ? near : null;
}

export type MentionPill = Rect & { kind: 'wide' | 'round' };

export function mentionPillPlace(preview: Rect): MentionPill {
  if (preview.w >= PILL.wideMin) {
    const w = Math.min(preview.w - 16, PILL.maxW);
    return {
      kind: 'wide',
      x: preview.x + (preview.w - w) / 2,
      y: preview.y + preview.h - PILL.inset - PILL.h,
      w,
      h: PILL.h,
    };
  }
  return {
    kind: 'round',
    x: preview.x + preview.w - PILL.roundInset - PILL.round,
    y: preview.y + preview.h - PILL.roundInset - PILL.round,
    w: PILL.round,
    h: PILL.round,
  };
}

/** `blocked(r)` says whether a candidate rect is occluded (an Instagram control at its centre). */
export function viewerPillPlace(media: Rect, pill: Size, vp: Size, blocked: (r: Rect) => boolean): Rect | null {
  const y = media.y + media.h - pill.h;
  if (y < EDGE || y + pill.h > vp.h) return null;
  const right = { x: media.x + media.w + VIEWER.gap, y, w: pill.w, h: pill.h };
  if (right.x + right.w <= vp.w - EDGE && !blocked(right)) return right;
  const left = { x: media.x - VIEWER.gap - pill.w, y, w: pill.w, h: pill.h };
  if (left.x >= EDGE && !blocked(left)) return left;
  return null;
}
