/**
 * compose(): StoryDoc → display list (strategy §3.4 step 2, U5). Pure and time-parametric
 * so video plugs in later (V2). Placeholders and guides are emitted only for `preview`.
 */
import { baseScale, FRAME, type Size } from '../geometry/fit.ts';
import { marginBands, safeZones } from '../geometry/safe-zones.ts';
import { layerMatrix } from '../geometry/transform.ts';
import { type Fill, type Frame, findFrame, type Layer, type StoryDoc, type TextLayer } from '../model/story.ts';
import { layoutText, type TextMeasurer } from '../text/layout.ts';
import { contrastColor } from './color.ts';
import type { DrawOp } from './ops.ts';

/** `preview` adds placeholders and guides; `export` is exactly what gets encoded. */
export type ComposeTarget = 'preview' | 'export';

/** What compose() needs beyond the StoryDoc itself. */
export interface ComposeEnv {
  /** Natural, upright size of an asset (IndexedDB `assets` w/h), or undefined if unknown. */
  assetSize(assetId: string): Size | undefined;
  measurer: TextMeasurer;
  /** Preview guides; ignored for `export`. Default `{ safe: true, adSafe: false }`. */
  guides?: { safe: boolean; adSafe: boolean };
}

/** Guides used when ComposeEnv.guides is omitted. */
export const DEFAULT_GUIDES: Readonly<{ safe: boolean; adSafe: boolean }> = { safe: true, adSafe: false };

/** Why compose() threw. */
export type ComposeErrorCode = 'UNKNOWN_FRAME' | 'UNKNOWN_ASSET' | 'NOT_IMPLEMENTED';

/** compose() failures. The message starts with the code, e.g. `NOT_IMPLEMENTED: VideoLayer vid1`. */
export class ComposeError extends Error {
  readonly code: ComposeErrorCode;
  constructor(code: ComposeErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ComposeError';
    this.code = code;
  }
}

/**
 * The glyph colour and the style's second colour (DrawOp `boxColor`) for a text layer:
 * - plain: `color`, no second colour;
 * - highlight: `color` on a box of `boxColor` (default: black or white, contrasting `color`);
 * - inverse: the box takes `color` and the glyphs take `boxColor` (same default);
 * - outline: `color` stroked with `boxColor` (same default);
 * - glow: `color` with a glow of `boxColor` (default: `color` itself).
 */
export function resolveTextColors(layer: Pick<TextLayer, 'style' | 'color' | 'boxColor'>): {
  color: string;
  boxColor: string | null;
} {
  const second = layer.boxColor ?? contrastColor(layer.color);
  switch (layer.style) {
    case 'plain':
      return { color: layer.color, boxColor: null };
    case 'inverse':
      return { color: second, boxColor: layer.color };
    case 'glow':
      return { color: layer.color, boxColor: layer.boxColor ?? layer.color };
    default:
      return { color: layer.color, boxColor: second };
  }
}

/**
 * Whether a layer shows at `tMs`. Timing is ignored on photo frames; on timed frames a layer
 * shows in [startMs ?? 0, endMs ?? ∞).
 */
export function isLayerActive(layer: Layer, frame: Frame, tMs: number): boolean {
  if (frame.durationMs === null || layer.kind === 'placeholder') return true;
  return tMs >= (layer.startMs ?? 0) && tMs < (layer.endMs ?? Infinity);
}

const FULL_FRAME = { x: 0, y: 0, w: FRAME.w, h: FRAME.h } as const;

function sizeOf(env: ComposeEnv, assetId: string): Size {
  const size = env.assetSize(assetId);
  if (!size) throw new ComposeError('UNKNOWN_ASSET', assetId);
  return size;
}

/**
 * How much bigger than an exact cover the blurred copy is drawn (EDIT-3). A canvas blur samples
 * transparent pixels beyond the drawn image, so an exact cover fades to transparent along the
 * frame edges (black in the JPEG, alpha in the msite PNG). Overscanning by 3σ (σ = radius for CSS
 * blur) on every side keeps real pixels under the whole kernel.
 */
export function blurOverscan(radiusPx: number): number {
  return 1 + (6 * Math.max(0, radiusPx)) / Math.min(FRAME.w, FRAME.h);
}

function backgroundOp(fill: Fill, env: ComposeEnv): DrawOp {
  switch (fill.kind) {
    case 'solid':
      return { op: 'fillRect', rect: { ...FULL_FRAME }, color: fill.color };
    case 'gradient':
      return { op: 'linearGradient', rect: { ...FULL_FRAME }, from: fill.from, to: fill.to, angleDeg: fill.angleDeg };
    case 'blur': {
      const srcSize = sizeOf(env, fill.assetId);
      const centred = { cx: FRAME.w / 2, cy: FRAME.h / 2, scale: blurOverscan(fill.radiusPx), rotDeg: 0 };
      return {
        op: 'blurredImage',
        assetId: fill.assetId,
        srcSize,
        matrix: layerMatrix(srcSize, baseScale('cover', srcSize), centred),
        radiusPx: fill.radiusPx,
        dim: fill.dim,
      };
    }
  }
}

/** The op for one layer, or null when it draws nothing for this target. */
function layerOp(layer: Layer, target: ComposeTarget, env: ComposeEnv): DrawOp | null {
  switch (layer.kind) {
    case 'image': {
      // xf is the source of truth: drawn as stored, clamping is the editor's job.
      const srcSize = sizeOf(env, layer.assetId);
      const matrix = layerMatrix(srcSize, baseScale(layer.fit, srcSize), layer.xf);
      return { op: 'image', layerId: layer.id, assetId: layer.assetId, srcSize, matrix };
    }
    case 'text': {
      const layout = layoutText(layer, env.measurer);
      if (layout.lines.length === 0) return null;
      const { color, boxColor } = resolveTextColors(layer);
      return {
        op: 'text',
        layerId: layer.id,
        matrix: layerMatrix({ w: layout.width, h: layout.height }, 1, layer.xf),
        font: { fontId: layer.fontId, sizePx: layer.sizePx, letterSpacingPx: layer.letterSpacingPx },
        color,
        align: layer.align,
        style: layer.style,
        boxColor,
        lines: layout.lines,
      };
    }
    case 'placeholder':
      if (target !== 'preview') return null;
      return {
        op: 'placeholder',
        layerId: layer.id,
        purpose: layer.purpose,
        rect: { ...layer.rect },
        label: layer.label,
      };
    case 'video':
      throw new ComposeError('NOT_IMPLEMENTED', `VideoLayer ${layer.id}`);
  }
}

/**
 * Background first, then layers bottom to top. Throws on an unknown frame id or asset,
 * and `NOT_IMPLEMENTED` for a VideoLayer until V1 (whatever `tMs`). Empty text layers emit
 * nothing. For `preview`, the guides come last (on top of everything): `safe` then `adSafe`,
 * each with its four margin bands (top, bottom, left, right).
 */
export function compose(doc: StoryDoc, frameId: string, tMs: number, target: ComposeTarget, env: ComposeEnv): DrawOp[] {
  const frame = findFrame(doc, frameId);
  if (!frame) throw new ComposeError('UNKNOWN_FRAME', frameId);

  const ops: DrawOp[] = [backgroundOp(frame.background, env)];
  for (const layer of frame.layers) {
    if (layer.kind === 'video') throw new ComposeError('NOT_IMPLEMENTED', `VideoLayer ${layer.id}`);
    if (!isLayerActive(layer, frame, tMs)) continue;
    const op = layerOp(layer, target, env);
    if (op) ops.push(op);
  }

  if (target === 'preview') {
    const guides = env.guides ?? DEFAULT_GUIDES;
    if (guides.safe) ops.push({ op: 'guide', kind: 'safe', rects: marginBands(safeZones(false)) });
    if (guides.adSafe) ops.push({ op: 'guide', kind: 'adSafe', rects: marginBands(safeZones(true)) });
  }
  return ops;
}
