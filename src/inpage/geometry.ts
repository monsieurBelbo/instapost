/**
 * The in-page UI's geometry (inpage-ui-spec.md FC3, FS7, FS8). Pure, shared by the composer (which lays out
 * its dialog) and the content script (which places the engine frame over the dialog's stage, or in the
 * chip's thumbnail): both compute the same rects from the same viewport, so no slot has to travel between
 * them. Viewport coordinates, CSS px.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rect with the corner radius the engine gets there. */
export interface Slot extends Rect {
  r: number;
}

export const HEAD_H = 44;
export const RAIL_W = 340;
export const RAIL_W_NARROW = 300;
export const STAGE_MIN_W = 225;
export const IMPORT_MIN_W = 420;
export const CHIP_H = 76;
export const CHIP_W = 240;
export const CHIP_COMPACT_W = 48;
export const CHIP_INSET = 16;
/** The chip's thumbnail: 6 px in from its top-left corner, 36×64. */
export const THUMB = { x: 6, y: 6, w: 36, h: 64 } as const;

export interface DialogLayout {
  /** The vertical margin (48, or 24 under 760 tall). */
  mv: number;
  bodyH: number;
  stageW: number;
  railW: number;
  dlgW: number;
  dlgH: number;
  left: number;
  top: number;
  /** The stage (the export, black, flush with the dialog's bottom-left corner). */
  stage: Rect;
}

/** FC3: the dialog for a W×H viewport; the import view is narrower (max(stageW, 420)). */
export function dialogLayout(W: number, H: number, importView = false): DialogLayout {
  const mv = H >= 760 ? 48 : 24;
  let bodyH = Math.min(900, Math.max(400, H - 2 * mv - HEAD_H));
  const railW = W >= 1000 ? RAIL_W : RAIL_W_NARROW;
  let stageW = Math.round((bodyH * 9) / 16);
  const maxW = W - 128;
  if (stageW + railW > maxW) {
    stageW = Math.max(STAGE_MIN_W, maxW - railW);
    bodyH = Math.round((stageW * 16) / 9);
  }
  const dlgW = importView ? Math.max(stageW, IMPORT_MIN_W) : stageW + railW;
  const dlgH = bodyH + HEAD_H;
  const left = Math.round((W - dlgW) / 2);
  const top = Math.round((H - dlgH) / 2);
  return { mv, bodyH, stageW, railW, dlgW, dlgH, left, top, stage: { x: left, y: top + HEAD_H, w: stageW, h: bodyH } };
}

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/** FS7 Small: bottom right of the stage, 12-px inset, width clamp(30 % of the stage, 96, 140), 9:16. */
export function pipSlot(stage: Rect): Slot {
  const w = Math.round(clamp(stage.w * 0.3, 96, 140));
  const h = Math.round((w * 16) / 9);
  return { x: stage.x + stage.w - 12 - w, y: stage.y + stage.h - 12 - h, w, h, r: 10 };
}

/** FS7 Large: centred in the stage under a 48-px caption band, height stage − 60. */
export function largeSlot(stage: Rect): Slot {
  const h = stage.h - 60;
  const w = Math.round((h * 9) / 16);
  return { x: stage.x + Math.round((stage.w - w) / 2), y: stage.y + 48, w, h, r: 12 };
}

export type PreviewMode = 'small' | 'large' | 'hidden';

/** Where the live phone goes while the dialog is open. */
export function previewSlot(stage: Rect, mode: PreviewMode): Slot {
  if (mode === 'large') return largeSlot(stage);
  if (mode === 'hidden') return { ...stage, r: 0 };
  return pipSlot(stage);
}

export interface ChipPlace {
  rect: Rect;
  /** Thumbnail only (the collapsed nav). */
  compact: boolean;
}

/**
 * FS8: the chip replaces the entry in its slot (76 high, the entry's width; 48 wide in the collapsed nav)
 * when the slot has room (≥ 84 from its top), else 240×76 at the top right, 16-px inset.
 */
export function chipPlace(
  entry: { kind: 'row' | 'tile' | 'corner' | 'none'; rect: Rect; room: number } | null,
  W: number,
  rtl = false,
): ChipPlace {
  if (entry && (entry.kind === 'row' || entry.kind === 'tile') && entry.room >= CHIP_H + 8) {
    const compact = entry.kind === 'tile';
    return {
      rect: { x: entry.rect.x, y: entry.rect.y, w: compact ? CHIP_COMPACT_W : entry.rect.w, h: CHIP_H },
      compact,
    };
  }
  // The top-right fallback; top left when the page is right to left (RL-9).
  const x = rtl ? CHIP_INSET : W - CHIP_INSET - CHIP_W;
  return { rect: { x, y: CHIP_INSET, w: CHIP_W, h: CHIP_H }, compact: false };
}

/** The chip's thumbnail rect (where the live phone glides when the dialog is hidden). */
export function thumbSlot(chip: Rect): Slot {
  return { x: chip.x + THUMB.x, y: chip.y + THUMB.y, w: THUMB.w, h: THUMB.h, r: 6 };
}
