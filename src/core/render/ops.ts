/**
 * The display list (strategy §3.1 point 5, §3.4). Serialisable data only: no functions,
 * no bitmaps. One rasteriser (src/raster/rasterize.ts) draws it for preview and export.
 * Ops are drawn in order onto a 1080x1920 story-px surface; matrices map an op's local
 * space into story px.
 */
import type { Rect, Size } from '../geometry/fit.ts';
import type { Mat2D } from '../geometry/transform.ts';
import type { PlaceholderPurpose, TextAlign, TextStyle } from '../model/story.ts';
import type { FontSpec, LaidOutLine } from '../text/layout.ts';

/** One drawing instruction, in story px. */
export type DrawOp =
  | { op: 'fillRect'; rect: Rect; color: string }
  | { op: 'linearGradient'; rect: Rect; from: string; to: string; angleDeg: number }
  /** Cover-fitted, blurred copy of an asset, darkened by `dim` (0..1). */
  | { op: 'blurredImage'; assetId: string; srcSize: Size; matrix: Mat2D; radiusPx: number; dim: number }
  /** `matrix` maps source px (natural, upright size `srcSize`) to story px. */
  | { op: 'image'; layerId: string; assetId: string; srcSize: Size; matrix: Mat2D }
  /**
   * `matrix` maps the text block's local space (TextLayout) to story px. Lines are already
   * aligned: draw each one left-aligned at (x, baseline) with `font` (letter spacing included);
   * `align` is informational. `color` fills the glyphs; `boxColor` is the style's second colour
   * (compose.ts resolveTextColors): the line boxes for highlight and inverse, the stroke for
   * outline, the glow for glow, null for plain.
   */
  | {
      op: 'text';
      layerId: string;
      matrix: Mat2D;
      font: FontSpec;
      color: string;
      align: TextAlign;
      style: TextStyle;
      boxColor: string | null;
      lines: LaidOutLine[];
    }
  /** Preview only. */
  | { op: 'placeholder'; layerId: string; purpose: PlaceholderPurpose; rect: Rect; label: string }
  /** Preview only: safe-zone margin bands, in the order top, bottom, left, right. */
  | { op: 'guide'; kind: 'safe' | 'adSafe'; rects: Rect[] };

/** The `op` discriminant. */
export type DrawOpKind = DrawOp['op'];

/** Ops compose() emits only for the `preview` target. */
export const PREVIEW_ONLY_OPS: readonly DrawOpKind[] = ['placeholder', 'guide'];

/** True for ops that never reach an export. */
export const isPreviewOnly = (op: DrawOp): boolean => PREVIEW_ONLY_OPS.includes(op.op);
