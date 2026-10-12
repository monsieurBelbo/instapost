/**
 * Export (strategy §3.4): compose(…, 'export') → rasterize onto a fresh 1080x1920 sRGB
 * OffscreenCanvas at scale 1 → encode through the core policy (JPEG stepping or PNG).
 */
import { type Encode, EXPORT_H, EXPORT_W, type ExportPurpose } from '../core/export/policy.ts';
import type { Size } from '../core/geometry/fit.ts';
import type { StoryDoc } from '../core/model/story.ts';
import { compose } from '../core/render/compose.ts';
import type { TextMeasurer } from '../core/text/layout.ts';
import { canvasEncoder, type EncodedExport, encodeForPurpose } from './encode.ts';
import { RasterError } from './errors.ts';
import { type RasterSources, rasterize } from './rasterize.ts';

export interface ExportDeps {
  /** Full-size, upright bitmaps (not the proxies). */
  sources: RasterSources;
  assetSize(assetId: string): Size | undefined;
  measurer: TextMeasurer;
  /** Test seam: wraps the canvas encoder (e.g. to observe the quality steps). */
  wrapEncoder?: (encode: Encode<Blob>) => Encode<Blob>;
}

export interface RenderedExport extends EncodedExport {
  purpose: ExportPurpose;
  w: typeof EXPORT_W;
  h: typeof EXPORT_H;
}

/** The export raster of one frame, at exactly 1080x1920 in sRGB. */
export function renderExportCanvas(doc: StoryDoc, frameId: string, deps: ExportDeps): OffscreenCanvas {
  const ops = compose(doc, frameId, 0, 'export', { assetSize: deps.assetSize, measurer: deps.measurer });
  const canvas = new OffscreenCanvas(EXPORT_W, EXPORT_H);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new RasterError('NO_CONTEXT', 'export: 2d context unavailable');
  rasterize(ops, ctx, 1, deps.sources);
  return canvas;
}

/** Renders and encodes a frame for `purpose`. Throws FONT_NOT_LOADED, MISSING_ASSET or EXPORT_TOO_LARGE. */
export async function exportFrame(
  doc: StoryDoc,
  frameId: string,
  purpose: ExportPurpose,
  deps: ExportDeps,
): Promise<RenderedExport> {
  const canvas = renderExportCanvas(doc, frameId, deps);
  const base = canvasEncoder(canvas);
  const encoded = await encodeForPurpose(purpose, deps.wrapEncoder ? deps.wrapEncoder(base) : base);
  return { ...encoded, purpose, w: EXPORT_W, h: EXPORT_H };
}
