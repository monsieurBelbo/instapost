/**
 * Repost (docs/repost.md RP-24, RP-26): the card's geometry, in story px at user scale 1. The painter
 * (src/raster/card.ts) draws a CardSpec into a bitmap at PAINT_K (the largest user scale, so the card stays
 * sharp) with a transparent MARGIN on each side for the shadow; the editor places that bitmap as the frame's
 * image layer with `fit: 'free'` (cardXf), so compose(), rasterize() and StoryDoc schema 1 are unchanged.
 *
 * | style | card |
 * |---|---|
 * | card (posts, default) | white, radius 28, width 800; a 104 header (56 avatar at x 24, 16 gap, the handle at 34 px); the photo full width below (aspect clamped to 3:4…1.91:1), bottom corners clipped |
 * | photo | the photo alone, width 800, radius 28; "@author" 34 px white on a rgba(0,0,0,.45) pill (56 high, padding 20, radius 28), 16 below, left-aligned |
 * | dark  | as card on #121212, handle #f5f5f5 |
 * | story (mentions) | the story at 864 wide, 9:16, radius 32; a credit pill inside the bottom-left (inset 24, 52 high, 30 px text) |
 *
 * Credit off (own posts only): card and dark lose the header and keep a radius-28 photo on an 8 px border;
 * photo loses the handle. Every card has the shadow 0 12 40 rgba(0,0,0,.35). Pure.
 *
 * Placement (RP-26): the centre clamp keeps INSIDE_PER_AXIS of the card in the frame and, whenever the card
 * carries a credit, the credit's whole box (creditBox) inside the frame, clear of Instagram's top bar and reply
 * bar (CREDIT_INSET): a drag, the wheel or a nudge can never push the attribution out of the story (AM56).
 */
import { SAFE_TOP } from '../geometry/safe-zones.ts';

export type CardStyle = 'card' | 'photo' | 'dark' | 'story';
export type CardKind = 'post' | 'mention';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CardSpec {
  style: CardStyle;
  kind: CardKind;
  credit: boolean;
  /** The card's visual box (the shadow is outside), story px at user scale 1. */
  w: number;
  h: number;
  /** The backing plate (card, dark), or null. */
  plate: { box: Box; radius: number; fill: string } | null;
  /** The photo's box, its corner radii (tl, tr, br, bl) and the aspect it shows (centre-cropped to it). */
  photo: { box: Box; radii: [number, number, number, number]; aspect: number };
  header: {
    avatar: { cx: number; cy: number; d: number };
    handle: { x: number; cy: number; size: number; color: string; maxW: number };
  } | null;
  /** The photo style's "@author" below the photo, on its own backing pill (readable on any background). */
  below: {
    x: number;
    y: number;
    h: number;
    padX: number;
    radius: number;
    fill: string;
    size: number;
    color: string;
    /** The text's widest (the pill is at most the card's width). */
    maxW: number;
  } | null;
  /** The mention's credit pill. */
  pill: {
    x: number;
    y: number;
    h: number;
    padX: number;
    radius: number;
    fill: string;
    size: number;
    color: string;
  } | null;
  shadow: { y: number; blur: number; color: string };
  /** The credit text's size (story px at user scale 1). */
  creditPx: number;
}

/** The scale the bitmap is painted at (the largest user scale). */
export const PAINT_K = 1.3;
/** The bitmap's transparent margin on each side, story px at user scale 1 (the shadow's room). */
export const MARGIN = 64;
export const SCALE_RANGE: Readonly<Record<CardKind, { min: number; max: number }>> = {
  post: { min: 0.72, max: 1.3 },
  mention: { min: 0.8, max: 1.15 },
};
export const CARD_CENTRE: Readonly<Record<CardKind, { x: number; y: number }>> = {
  post: { x: 540, y: 900 },
  mention: { x: 540, y: 960 },
};
/** A post's photo shows between 3:4 and 1.91:1; outside that it is centre-cropped (never inside it). */
export const PHOTO_ASPECT = { min: 3 / 4, max: 1.91 } as const;
export const STORY_ASPECT = 9 / 16;
/** At least this share of the card's width and height stays inside the frame (≈ half its area). */
export const INSIDE_PER_AXIS = 0.71;
/** The smallest credit (story px) at the smallest scale (AM56). */
export const MIN_CREDIT_PX = 24;
/**
 * The credit's margins in the frame (story px): below Instagram's top bar (the safe zone's 270), above its reply
 * bar (200: the full 384 band would move the default mention card) and 16 from the sides (a card at the largest
 * scale still centres). Where a margin cannot hold, the frame's edge does.
 */
export const CREDIT_INSET = { top: SAFE_TOP, bottom: 200, side: 16 } as const;

const FRAME_W = 1080;
const FRAME_H = 1920;
const SHADOW = { y: 12, blur: 40, color: 'rgba(0,0,0,0.35)' } as const;
const POST_W = 800;
const HEADER_H = 104;
const AVATAR_D = 56;
const AVATAR_X = 24;
const HANDLE_PX = 34;
/** The photo style's credit pill under the photo. */
const BELOW = { gap: 16, h: 56, padX: 20, radius: 28, fill: 'rgba(0,0,0,0.45)' } as const;

export const POST_LOOKS: readonly CardStyle[] = ['card', 'photo', 'dark'];

/** The next look of a post (card → photo → dark → card); a mention has one look. */
export function nextLook(style: CardStyle, kind: CardKind): CardStyle {
  if (kind === 'mention') return 'story';
  const i = POST_LOOKS.indexOf(style);
  return POST_LOOKS[(i + 1) % POST_LOOKS.length] ?? 'card';
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function photoAspect(aspect: number, kind: CardKind): number {
  if (kind === 'mention') return STORY_ASPECT;
  return clamp(Number.isFinite(aspect) && aspect > 0 ? aspect : 1, PHOTO_ASPECT.min, PHOTO_ASPECT.max);
}

export function cardSpec(style: CardStyle, aspect: number, credit: boolean, kind: CardKind): CardSpec {
  if (kind === 'mention') {
    const w = 864;
    const h = Math.round(w / STORY_ASPECT);
    return {
      style: 'story',
      kind,
      credit: true,
      w,
      h,
      plate: null,
      photo: { box: { x: 0, y: 0, w, h }, radii: [32, 32, 32, 32], aspect: STORY_ASPECT },
      header: null,
      below: null,
      pill: {
        x: 24,
        y: h - 24 - 52,
        h: 52,
        padX: 20,
        radius: 26,
        fill: 'rgba(0,0,0,0.45)',
        size: 30,
        color: '#ffffff',
      },
      shadow: { ...SHADOW },
      creditPx: 30,
    };
  }
  const s: CardStyle = style === 'story' ? 'card' : style;
  const a = photoAspect(aspect, kind);
  if (s === 'photo') {
    const ph = Math.round(POST_W / a);
    return {
      style: s,
      kind,
      credit,
      w: POST_W,
      h: credit ? ph + BELOW.gap + BELOW.h : ph,
      plate: null,
      photo: { box: { x: 0, y: 0, w: POST_W, h: ph }, radii: [28, 28, 28, 28], aspect: a },
      header: null,
      below: credit
        ? {
            x: 0,
            y: ph + BELOW.gap,
            h: BELOW.h,
            padX: BELOW.padX,
            radius: BELOW.radius,
            fill: BELOW.fill,
            size: HANDLE_PX,
            color: '#ffffff',
            maxW: POST_W - 2 * BELOW.padX,
          }
        : null,
      pill: null,
      shadow: { ...SHADOW },
      creditPx: HANDLE_PX,
    };
  }
  const fill = s === 'dark' ? '#121212' : '#ffffff';
  const text = s === 'dark' ? '#f5f5f5' : '#000000';
  if (!credit) {
    const pw = POST_W - 16;
    const ph = Math.round(pw / a);
    return {
      style: s,
      kind,
      credit,
      w: POST_W,
      h: ph + 16,
      plate: { box: { x: 0, y: 0, w: POST_W, h: ph + 16 }, radius: 36, fill },
      photo: { box: { x: 8, y: 8, w: pw, h: ph }, radii: [28, 28, 28, 28], aspect: a },
      header: null,
      below: null,
      pill: null,
      shadow: { ...SHADOW },
      creditPx: HANDLE_PX,
    };
  }
  const ph = Math.round(POST_W / a);
  const hx = AVATAR_X + AVATAR_D + 16;
  return {
    style: s,
    kind,
    credit,
    w: POST_W,
    h: HEADER_H + ph,
    plate: { box: { x: 0, y: 0, w: POST_W, h: HEADER_H + ph }, radius: 28, fill },
    photo: { box: { x: 0, y: HEADER_H, w: POST_W, h: ph }, radii: [0, 0, 28, 28], aspect: a },
    header: {
      avatar: { cx: AVATAR_X + AVATAR_D / 2, cy: HEADER_H / 2, d: AVATAR_D },
      handle: { x: hx, cy: HEADER_H / 2, size: HANDLE_PX, color: text, maxW: POST_W - hx - 24 },
    },
    below: null,
    pill: null,
    shadow: { ...SHADOW },
    creditPx: HANDLE_PX,
  };
}

/** The bitmap's size for a spec painted at `k`, margins included. */
export function bitmapSize(spec: Pick<CardSpec, 'w' | 'h'>, k: number = PAINT_K): { w: number; h: number } {
  return { w: Math.ceil((spec.w + 2 * MARGIN) * k), h: Math.ceil((spec.h + 2 * MARGIN) * k) };
}

/** `fit: 'free'` base scale of a bitmap (compose's contain base). */
const freeBase = (bm: { w: number; h: number }): number => Math.min(FRAME_W / bm.w, FRAME_H / bm.h);

export const clampUserScale = (kind: CardKind, s: number): number =>
  clamp(Number.isFinite(s) ? s : 1, SCALE_RANGE[kind].min, SCALE_RANGE[kind].max);

/**
 * The credit's box on the card (story px at user scale 1), or null when the card has none: the header from the
 * avatar to the handle's end, the photo style's pill, the mention's pill. `drawnW` is the width the painter
 * measured (the handle's text; the pill's width), else the widest the credit can be.
 */
export function creditBox(spec: CardSpec, drawnW: number | null = null): Box | null {
  const w = (max: number): number =>
    drawnW === null || !Number.isFinite(drawnW) ? max : clamp(Math.ceil(drawnW), 0, max);
  if (spec.header) {
    const { avatar: av, handle } = spec.header;
    const x = av.cx - av.d / 2;
    return { x, y: 0, w: handle.x - x + w(handle.maxW), h: spec.photo.box.y };
  }
  if (spec.below) return { x: spec.below.x, y: spec.below.y, w: w(spec.w - spec.below.x), h: spec.below.h };
  if (spec.pill) return { x: spec.pill.x, y: spec.pill.y, w: w(spec.w - 2 * spec.pill.x), h: spec.pill.h };
  return null;
}

/**
 * The centre clamp: at least INSIDE_PER_AXIS of the card's width and height stays in the frame, and `credit`
 * (creditBox), when given, stays whole inside the frame within CREDIT_INSET (else within the frame's edge).
 * Where the two disagree the credit wins: AM56.
 */
export function clampCardCentre(
  centre: { x: number; y: number },
  spec: Pick<CardSpec, 'w' | 'h'>,
  userScale: number,
  credit: Box | null = null,
): { x: number; y: number } {
  const u = userScale;
  const axis = (
    c: number,
    size: number,
    frame: number,
    box: readonly [number, number] | null,
    inset: readonly [number, number],
  ): number => {
    const half = (size * u) / 2;
    const v = Number.isFinite(c) ? c : frame / 2;
    const aLo = half * (2 * INSIDE_PER_AXIS - 1);
    let lo = aLo > frame - aLo ? frame / 2 : aLo;
    let hi = aLo > frame - aLo ? frame / 2 : frame - aLo;
    if (box) {
      // The centres that keep [box0, box1] (card px) inside [i0, frame - i1].
      const within = (i0: number, i1: number): [number, number] => [
        i0 + half - box[0] * u,
        frame - i1 + half - box[1] * u,
      ];
      let [cLo, cHi] = within(inset[0], inset[1]);
      if (cLo > cHi) [cLo, cHi] = within(0, 0);
      if (cLo > cHi) cLo = cHi = (cLo + cHi) / 2;
      const both: [number, number] = [Math.max(lo, cLo), Math.min(hi, cHi)];
      [lo, hi] = both[0] <= both[1] ? both : [cLo, cHi];
    }
    return clamp(v, lo, hi);
  };
  return {
    x: axis(centre.x, spec.w, FRAME_W, credit && [credit.x, credit.x + credit.w], [
      CREDIT_INSET.side,
      CREDIT_INSET.side,
    ]),
    y: axis(centre.y, spec.h, FRAME_H, credit && [credit.y, credit.y + credit.h], [
      CREDIT_INSET.top,
      CREDIT_INSET.bottom,
    ]),
  };
}

/** The image layer's xf that shows the card at `userScale` centred at `centre` (unrotated). */
export function cardXf(
  spec: Pick<CardSpec, 'w' | 'h'>,
  userScale: number,
  centre: { x: number; y: number },
  k: number = PAINT_K,
): { cx: number; cy: number; scale: number; rotDeg: number } {
  const bm = bitmapSize(spec, k);
  return { cx: centre.x, cy: centre.y, scale: userScale / (k * freeBase(bm)), rotDeg: 0 };
}

/** The user scale an xf shows the card at (inverse of cardXf). */
export function userScaleOf(spec: Pick<CardSpec, 'w' | 'h'>, xfScale: number, k: number = PAINT_K): number {
  return xfScale * k * freeBase(bitmapSize(spec, k));
}

/** The editor's limiter for the card layer (drag, wheel, pinch, nudge): the scale range, then the centre clamp. */
export function clampCardXf(
  xf: { cx: number; cy: number; scale: number; rotDeg: number },
  spec: Pick<CardSpec, 'w' | 'h' | 'kind'>,
  credit: Box | null = null,
  k: number = PAINT_K,
): { cx: number; cy: number; scale: number; rotDeg: number } {
  const u = clampUserScale(spec.kind, userScaleOf(spec, xf.scale, k));
  const c = clampCardCentre({ x: xf.cx, y: xf.cy }, spec, u, credit);
  return cardXf(spec, u, c, k);
}

/** Whether story point `p` is on the card (its visual box at the layer's placement). */
export function onCard(
  spec: Pick<CardSpec, 'w' | 'h'>,
  xf: { cx: number; cy: number; scale: number },
  p: { x: number; y: number },
  k: number = PAINT_K,
): boolean {
  const u = userScaleOf(spec, xf.scale, k);
  return Math.abs(p.x - xf.cx) <= (spec.w * u) / 2 && Math.abs(p.y - xf.cy) <= (spec.h * u) / 2;
}

/** The centred source rect that shows `aspect` (w/h) of a `src`-sized photo. */
export function photoCrop(src: { w: number; h: number }, aspect: number): Box {
  const a = src.w / src.h;
  if (Math.abs(a - aspect) < 1e-3) return { x: 0, y: 0, w: src.w, h: src.h };
  if (a > aspect) {
    const w = src.h * aspect;
    return { x: (src.w - w) / 2, y: 0, w, h: src.h };
  }
  const h = src.w / aspect;
  return { x: 0, y: (src.h - h) / 2, w: src.w, h };
}
