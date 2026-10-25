/**
 * Repost (docs/repost.md RP-24, RP-26): paints a CardSpec (src/core/repost/card-layout.ts) into a bitmap at
 * PAINT_K with a transparent MARGIN on each side, Canvas 2D on an OffscreenCanvas: the plate and the photo
 * (centre-cropped only outside the spec's aspect range) with the shadow 0 12 40 rgba(0,0,0,.35), the header's
 * avatar (or the author's initial on `avatarFill`) and handle, the photo style's "@author" pill, or the
 * mention's credit pill. Text is the bundled Instrument Sans 600 (no new font). Never draws a link glyph, a
 * "View post" mark or anything that looks tappable (research.md §6.3). It reports the credit's drawn width, so
 * the editor's clamp keeps exactly that box in the frame (card-layout creditBox).
 */
import { type Box, bitmapSize, type CardSpec, MARGIN, PAINT_K, photoCrop } from '../core/repost/card-layout.ts';
import { cssFont, DEFAULT_FONT_ID, isFontLoaded, loadFont } from './fonts.ts';

type Source = CanvasImageSource & { width: number; height: number };

export interface CardArt {
  spec: CardSpec;
  photo: Source;
  avatar: Source | null;
  author: string;
  /** The no-avatar circle's colour (the palette's `to`). */
  avatarFill: string;
  k?: number;
}

export interface PaintedCard {
  bitmap: ImageBitmap;
  /** The credit's drawn width, story px at scale 1 (the handle's text, or the pill's), or null without one. */
  creditW: number | null;
}

type Ctx = OffscreenCanvasRenderingContext2D;

function rounded(ctx: Ctx, b: Box, r: number | [number, number, number, number]): void {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, r);
}

function ellipsize(ctx: Ctx, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

/** Draws `src` covering `b` (centre-cropped to its aspect). */
function cover(ctx: Ctx, src: Source, b: Box, aspect: number = b.w / b.h): void {
  const c = photoCrop({ w: src.width, h: src.height }, aspect);
  ctx.drawImage(src, c.x, c.y, c.w, c.h, b.x, b.y, b.w, b.h);
}

export async function paintCard(art: CardArt): Promise<PaintedCard> {
  const { spec } = art;
  const k = art.k ?? PAINT_K;
  const bm = bitmapSize(spec, k);
  await loadFont(DEFAULT_FONT_ID).catch(() => undefined);
  const font = (px: number): string =>
    isFontLoaded(DEFAULT_FONT_ID) ? cssFont({ fontId: DEFAULT_FONT_ID, sizePx: px }) : `600 ${px}px sans-serif`;
  const canvas = new OffscreenCanvas(bm.w, bm.h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('card: no 2D context');
  ctx.setTransform(k, 0, 0, k, MARGIN * k, MARGIN * k);
  ctx.imageSmoothingQuality = 'high';
  const sh = spec.shadow;
  let creditW: number | null = null;
  // Canvas shadows ignore the transform: device px.
  const shadowed = (draw: () => void) => {
    ctx.save();
    ctx.shadowColor = sh.color;
    ctx.shadowBlur = sh.blur * k;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = sh.y * k;
    draw();
    ctx.restore();
  };

  // The plate (card, dark), or the photo's own shape, carries the shadow.
  if (spec.plate) {
    const p = spec.plate;
    shadowed(() => {
      rounded(ctx, p.box, p.radius);
      ctx.fillStyle = p.fill;
      ctx.fill();
    });
  } else {
    shadowed(() => {
      rounded(ctx, spec.photo.box, spec.photo.radii);
      ctx.fillStyle = '#000000';
      ctx.fill();
    });
  }

  // The photo.
  ctx.save();
  rounded(ctx, spec.photo.box, spec.photo.radii);
  ctx.clip();
  cover(ctx, art.photo, spec.photo.box, spec.photo.aspect);
  ctx.restore();

  // The header: avatar and handle (no @, as in the app).
  if (spec.header) {
    const { avatar: av, handle } = spec.header;
    const box = { x: av.cx - av.d / 2, y: av.cy - av.d / 2, w: av.d, h: av.d };
    ctx.save();
    ctx.beginPath();
    ctx.arc(av.cx, av.cy, av.d / 2, 0, Math.PI * 2);
    ctx.clip();
    if (art.avatar) cover(ctx, art.avatar, box);
    else {
      ctx.fillStyle = art.avatarFill;
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = '#ffffff';
      ctx.font = font(28);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(art.author.slice(0, 1).toUpperCase(), av.cx, av.cy + 1);
    }
    ctx.restore();
    ctx.font = font(handle.size);
    ctx.fillStyle = handle.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const text = ellipsize(ctx, art.author, handle.maxW);
    creditW = Math.ceil(ctx.measureText(text).width);
    ctx.fillText(text, handle.x, handle.cy);
  }

  // The photo style's "@author" below the photo, on its pill: white on a dark backing reads on any background
  // (a light photo's Colours, Blur), where white with a shadow did not.
  if (spec.below) {
    const b = spec.below;
    ctx.font = font(b.size);
    const text = ellipsize(ctx, `@${art.author}`, b.maxW);
    const w = Math.ceil(ctx.measureText(text).width) + 2 * b.padX;
    creditW = w;
    rounded(ctx, { x: b.x, y: b.y, w, h: b.h }, b.radius);
    ctx.fillStyle = b.fill;
    ctx.fill();
    ctx.fillStyle = b.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, b.x + b.padX, b.y + b.h / 2 + 1);
  }

  // The mention's credit pill.
  if (spec.pill) {
    const p = spec.pill;
    ctx.font = font(p.size);
    const text = ellipsize(ctx, `@${art.author}`, spec.w - 2 * p.x - 2 * p.padX);
    const w = Math.ceil(ctx.measureText(text).width) + 2 * p.padX;
    creditW = w;
    rounded(ctx, { x: p.x, y: p.y, w, h: p.h }, p.radius);
    ctx.fillStyle = p.fill;
    ctx.fill();
    ctx.fillStyle = p.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, p.x + p.padX, p.y + p.h / 2 + 1);
  }

  return { bitmap: canvas.transferToImageBitmap(), creditW };
}
