/**
 * Generated fixtures for the raster browser tests (B1–B5). Nothing here ships: only tests import it.
 * Everything is generated in-test (no binary fixtures in the repo).
 */
import type { Fill, ImageLayer, Layer, StoryDoc, TextLayer } from '../core/model/story.ts';

/** Seeded PRNG (mulberry32), so noise fixtures are identical on every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A w×h canvas of seeded RGB noise (worst case for JPEG size). */
export function noiseCanvas(w: number, h: number, seed = 1): OffscreenCanvas {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('noiseCanvas: no 2d context');
  const img = ctx.createImageData(w, h);
  const rnd = mulberry32(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (rnd() * 0x1000000) | 0;
    img.data[i] = v & 0xff;
    img.data[i + 1] = (v >>> 8) & 0xff;
    img.data[i + 2] = (v >>> 16) & 0xff;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** A canvas painted by `paint`, encoded as `type`. */
export async function paintedBlob(
  w: number,
  h: number,
  paint: (ctx: OffscreenCanvasRenderingContext2D) => void,
  type: string,
  quality?: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('paintedBlob: no 2d context');
  paint(ctx);
  return await canvas.convertToBlob(quality === undefined ? { type } : { type, quality });
}

export const bytesOf = async (blob: Blob): Promise<Uint8Array> => new Uint8Array(await blob.arrayBuffer());

/**
 * An APP1 `Exif` segment (big-endian TIFF) with IFD0 Orientation and, when `gps`, a GPS IFD
 * holding GPSLatitudeRef 'N' (enough for "carries location data").
 */
export function exifApp1(orientation: number, gps = true): Uint8Array {
  const entries = gps ? 2 : 1;
  const ifd0Len = 2 + entries * 12 + 4;
  const gpsLen = gps ? 2 + 12 + 4 : 0;
  const tiffLen = 8 + ifd0Len + gpsLen;
  const tiff = new DataView(new ArrayBuffer(tiffLen));
  tiff.setUint16(0, 0x4d4d); // 'MM'
  tiff.setUint16(2, 42);
  tiff.setUint32(4, 8);
  let at = 8;
  tiff.setUint16(at, entries);
  at += 2;
  // Orientation: SHORT, count 1, value left-justified.
  tiff.setUint16(at, 0x0112);
  tiff.setUint16(at + 2, 3);
  tiff.setUint32(at + 4, 1);
  tiff.setUint16(at + 8, orientation);
  at += 12;
  if (gps) {
    // GPSInfo IFD pointer: LONG offset.
    tiff.setUint16(at, 0x8825);
    tiff.setUint16(at + 2, 4);
    tiff.setUint32(at + 4, 1);
    tiff.setUint32(at + 8, 8 + ifd0Len);
    at += 12;
  }
  tiff.setUint32(at, 0); // no IFD1
  at += 4;
  if (gps) {
    tiff.setUint16(at, 1);
    tiff.setUint16(at + 2, 0x0001); // GPSLatitudeRef
    tiff.setUint16(at + 4, 2); // ASCII
    tiff.setUint32(at + 6, 2);
    tiff.setUint8(at + 10, 0x4e); // 'N'
    tiff.setUint32(at + 14, 0);
  }
  const payloadLen = 6 + tiffLen;
  const seg = new Uint8Array(4 + payloadLen);
  seg.set([0xff, 0xe1, ((payloadLen + 2) >> 8) & 0xff, (payloadLen + 2) & 0xff], 0);
  seg.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4); // 'Exif\0\0'
  seg.set(new Uint8Array(tiff.buffer), 10);
  return seg;
}

/** `jpeg` with `segment` inserted right after SOI. */
export function insertAfterSoi(jpeg: Uint8Array, segment: Uint8Array): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('insertAfterSoi: not a JPEG');
  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(segment, 2);
  out.set(jpeg.subarray(2), 2 + segment.length);
  return out;
}

/** A one-frame StoryDoc with the given layers. */
export function fixtureDoc(layers: Layer[], background: Fill = { kind: 'solid', color: '#00ff7f' }): StoryDoc {
  return {
    id: 'doc_fixture',
    schema: 1,
    size: { w: 1080, h: 1920 },
    frames: [{ id: 'frm_fixture', durationMs: null, background, layers, audience: 'all' }],
    createdAt: 0,
    updatedAt: 0,
  };
}
export const FIXTURE_FRAME = 'frm_fixture';

export function imageLayer(assetId: string, fit: ImageLayer['fit'], xf: ImageLayer['xf']): ImageLayer {
  return { kind: 'image', id: 'lyr_image', assetId, fit, focal: { x: 0.5, y: 0.5 }, xf };
}

export function textLayer(over: Partial<TextLayer> = {}): TextLayer {
  return {
    kind: 'text',
    id: 'lyr_text',
    text: 'Hello',
    fontId: 'instrument-sans',
    sizePx: 72,
    color: '#000000',
    align: 'center',
    style: 'plain',
    letterSpacingPx: 0,
    lineHeight: 1.4,
    maxWidthPx: 900,
    xf: { cx: 540, cy: 960, scale: 1, rotDeg: 0 },
    ...over,
  };
}

/** The whole surface of a 2D context as ImageData. */
export function snapshot(ctx: OffscreenCanvasRenderingContext2D): ImageData {
  return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
}
