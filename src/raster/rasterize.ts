/**
 * The one rasteriser for preview and export (strategy §3.4 step 3): draws a display list from
 * compose() onto a 2D context. Story px map to canvas px by `scale` (1 for the 1080x1920
 * export; the stage's backing px per story px for the preview).
 *
 * Before touching a pixel it checks every font the list uses (FONT_NOT_LOADED) and every asset
 * it draws (MISSING_ASSET). Image sources may be smaller than their natural size (the ≤2160 px
 * proxy): they are stretched to `srcSize`, so the op's matrix stays the single source of truth.
 */
import { FRAME, type Rect } from '../core/geometry/fit.ts';
import { type Mat2D, multiply, scaling } from '../core/geometry/transform.ts';
import type { DrawOp } from '../core/render/ops.ts';
import { BOX_RADIUS_EM, hasLineBoxes } from '../core/text/layout.ts';
import { RasterError } from './errors.ts';
import { assertFontLoaded, cssFont, DEFAULT_FONT_ID, isFontLoaded } from './fonts.ts';
import type { Ctx2D } from './measurer-canvas.ts';

export type { Ctx2D };

/** Decoded images by asset id: the full-size bitmap for export, the proxy for preview. */
export interface RasterSources {
  image(assetId: string): CanvasImageSource | undefined;
}

/** Outline stroke width, in em (the stroke is centred on the glyph edge, so half shows outside). */
export const OUTLINE_EM = 0.16;
/** Glow blur radius, in em. */
export const GLOW_EM = 0.35;

type Op<K extends DrawOp['op']> = Extract<DrawOp, { op: K }>;

function setMatrix(ctx: Ctx2D, scale: number, m: Mat2D): void {
  const [a, b, c, d, e, f] = multiply(scaling(scale), m);
  ctx.setTransform(a, b, c, d, e, f);
}

/** Canvas px per local unit along the matrix (its uniform scale), for filters that ignore the transform. */
const matrixScale = (m: Mat2D): number => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

function source(sources: RasterSources, assetId: string): CanvasImageSource {
  const src = sources.image(assetId);
  if (!src) throw new RasterError('MISSING_ASSET', assetId);
  return src;
}

function preflight(ops: readonly DrawOp[], sources: RasterSources): void {
  for (const op of ops) {
    if (op.op === 'text') assertFontLoaded(op.font.fontId);
    if (op.op === 'image' || op.op === 'blurredImage') source(sources, op.assetId);
  }
}

/**
 * CSS linear-gradient semantics: 0° points up, 90° right; the gradient line passes through the
 * rect's centre and is long enough for its corners to get the end colours.
 */
function drawGradient(ctx: Ctx2D, op: Op<'linearGradient'>): void {
  const { x, y, w, h } = op.rect;
  const rad = (op.angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = Math.abs((w / 2) * dx) + Math.abs((h / 2) * dy);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  g.addColorStop(0, op.from);
  g.addColorStop(1, op.to);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function drawImage(ctx: Ctx2D, scale: number, op: Op<'image'> | Op<'blurredImage'>, src: CanvasImageSource): void {
  setMatrix(ctx, scale, op.matrix);
  ctx.drawImage(src, 0, 0, op.srcSize.w, op.srcSize.h);
}

function drawBlurred(ctx: Ctx2D, scale: number, op: Op<'blurredImage'>, src: CanvasImageSource): void {
  ctx.save();
  // Filters work in canvas px; radiusPx is in story px.
  ctx.filter = `blur(${op.radiusPx * scale}px)`;
  drawImage(ctx, scale, op, src);
  ctx.restore();
  if (op.dim > 0) {
    setMatrix(ctx, scale, [1, 0, 0, 1, 0, 0]);
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, op.dim)})`;
    ctx.fillRect(0, 0, FRAME.w, FRAME.h);
  }
}

function roundedRect(ctx: Ctx2D, r: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)));
}

function drawText(ctx: Ctx2D, scale: number, op: Op<'text'>): void {
  setMatrix(ctx, scale, op.matrix);
  ctx.font = cssFont(op.font);
  ctx.letterSpacing = `${op.font.letterSpacingPx}px`;
  ctx.fontKerning = 'normal';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const size = op.font.sizePx;

  if (hasLineBoxes(op.style) && op.boxColor) {
    ctx.fillStyle = op.boxColor;
    for (const line of op.lines) {
      if (!line.box) continue;
      roundedRect(ctx, line.box, BOX_RADIUS_EM * size);
      ctx.fill();
    }
  }
  if (op.style === 'outline' && op.boxColor) {
    ctx.strokeStyle = op.boxColor;
    ctx.lineWidth = OUTLINE_EM * size;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    for (const line of op.lines) if (line.text) ctx.strokeText(line.text, line.x, line.baseline);
  }
  ctx.fillStyle = op.color;
  if (op.style === 'glow' && op.boxColor) {
    ctx.save();
    ctx.shadowColor = op.boxColor;
    // shadowBlur ignores the transform: convert em to canvas px.
    ctx.shadowBlur = GLOW_EM * size * scale * matrixScale(op.matrix);
    for (let pass = 0; pass < 2; pass++) {
      for (const line of op.lines) if (line.text) ctx.fillText(line.text, line.x, line.baseline);
    }
    ctx.restore();
  }
  for (const line of op.lines) if (line.text) ctx.fillText(line.text, line.x, line.baseline);
}

/** Preview only: a dashed, translucent box with its label, so the space stays free for a sticker. */
function drawPlaceholder(ctx: Ctx2D, scale: number, op: Op<'placeholder'>): void {
  setMatrix(ctx, scale, [1, 0, 0, 1, 0, 0]);
  const { x, y, w, h } = op.rect;
  roundedRect(ctx, op.rect, 24);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fill();
  ctx.setLineDash([16, 12]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.stroke();
  ctx.setLineDash([]);
  const sizePx = Math.max(20, Math.min(44, h * 0.3));
  ctx.font = isFontLoaded(DEFAULT_FONT_ID)
    ? cssFont({ fontId: DEFAULT_FONT_ID, sizePx })
    : `600 ${sizePx}px system-ui, sans-serif`;
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillText(op.label, x + w / 2, y + h / 2, w - 24);
}

/** Preview only: shade the margin bands and outline the safe area. */
function drawGuide(ctx: Ctx2D, scale: number, op: Op<'guide'>): void {
  setMatrix(ctx, scale, [1, 0, 0, 1, 0, 0]);
  const strict = op.kind === 'adSafe';
  ctx.fillStyle = strict ? 'rgba(255, 64, 64, 0.16)' : 'rgba(0, 0, 0, 0.38)';
  for (const r of op.rects) ctx.fillRect(r.x, r.y, r.w, r.h);
  const [top, bottom, left, right] = op.rects;
  if (!top || !bottom || !left || !right) return;
  ctx.setLineDash(strict ? [6, 10] : [14, 10]);
  ctx.lineWidth = Math.max(1, 2 / scale);
  ctx.strokeStyle = strict ? 'rgba(255, 96, 96, 0.9)' : 'rgba(255, 255, 255, 0.75)';
  ctx.strokeRect(left.x + left.w, top.y + top.h, right.x - (left.x + left.w), bottom.y - (top.y + top.h));
  ctx.setLineDash([]);
}

/**
 * Draws `ops` in order onto `ctx`, clearing it first. `scale` = canvas px per story px.
 * Throws FONT_NOT_LOADED or MISSING_ASSET before drawing anything.
 */
export function rasterize(ops: readonly DrawOp[], ctx: Ctx2D, scale: number, sources: RasterSources): void {
  preflight(ops, sources);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (const op of ops) {
    switch (op.op) {
      case 'fillRect':
        setMatrix(ctx, scale, [1, 0, 0, 1, 0, 0]);
        ctx.fillStyle = op.color;
        ctx.fillRect(op.rect.x, op.rect.y, op.rect.w, op.rect.h);
        break;
      case 'linearGradient':
        setMatrix(ctx, scale, [1, 0, 0, 1, 0, 0]);
        drawGradient(ctx, op);
        break;
      case 'blurredImage':
        drawBlurred(ctx, scale, op, source(sources, op.assetId));
        break;
      case 'image':
        drawImage(ctx, scale, op, source(sources, op.assetId));
        break;
      case 'text':
        drawText(ctx, scale, op);
        break;
      case 'placeholder':
        drawPlaceholder(ctx, scale, op);
        break;
      case 'guide':
        drawGuide(ctx, scale, op);
        break;
    }
  }
  ctx.restore();
}
