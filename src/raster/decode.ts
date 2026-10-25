/**
 * Image import (strategy §3.4 step 1): JPEG, PNG, WebP and AVIF are decoded natively with
 * `createImageBitmap(blob, {imageOrientation: 'from-image'})`, once, at full size and upright
 * (EXIF orientation applied). Decoding once and cropping later avoids the EXIF sub-region bug.
 * A proxy of at most 2160 px on the long side drives interaction; exports use the full bitmap.
 *
 * The format is sniffed from the bytes, not trusted from the file name or `blob.type`.
 * HEIC/HEIF (docs/inpage.md §13.7) goes to the libheif worker (heic.ts) when an entrypoint turned it on with
 * enableHeic (the in-page composer does); the loader is a dynamic import, so heic.ts, its worker and the wasm
 * exist only in builds that call it, and load on the first HEIC. Elsewhere HEIC is recognised only to say
 * it is unsupported.
 */
import type { Size } from '../core/geometry/fit.ts';
import { RasterError } from './errors.ts';

export const SUPPORTED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export type ImageMime = (typeof SUPPORTED_MIMES)[number];
/** For `<input accept>`. */
export const ACCEPT_ATTR = SUPPORTED_MIMES.join(',');

interface HeicModule {
  decodeHeic(blob: Blob): Promise<{ bitmap: ImageBitmap; size: Size; jpeg: Promise<Blob | null> }>;
}
let loadHeic: (() => Promise<HeicModule>) | null = null;

/** Turns HEIC/HEIF import on: `load` is `() => import('…/raster/heic.ts')`, called on the first HEIC. */
export function enableHeic(load: () => Promise<HeicModule>): void {
  loadHeic = load;
}

/** `<input accept>` with HEIC/HEIF when it is on (macOS needs the extensions: Finder types HEIC unevenly). */
export const acceptAttr = (): string =>
  loadHeic ? [...SUPPORTED_MIMES, 'image/heic', 'image/heif', '.heic', '.heif'].join(',') : ACCEPT_ATTR;

/** Long-side limit of the interaction proxy. */
export const PROXY_MAX_SIDE = 2160;

const ascii = (b: Uint8Array, at: number, s: string): boolean => {
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};

const AVIF_BRANDS = ['avif', 'avis'];
/** HEIF brands of a HEIC/HEIF (ISO/IEC 23008-12): iPhones write `heic` (plus `mif1`), cameras `heix`, `mif1`… */
export const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'];

/** The ISO-BMFF major and compatible brands of an `ftyp` box at offset 0, or []. */
function ftypBrands(b: Uint8Array): string[] {
  if (b.length < 16 || !ascii(b, 4, 'ftyp')) return [];
  const boxSize = Math.min(b.length, ((b[0] ?? 0) << 24) | ((b[1] ?? 0) << 16) | ((b[2] ?? 0) << 8) | (b[3] ?? 0));
  const brands: string[] = [];
  for (let at = 8; at + 4 <= boxSize; at += at === 8 ? 8 : 4) {
    brands.push(String.fromCharCode(...b.subarray(at, at + 4)));
  }
  return brands;
}

/** Image format from the first bytes (≥ 32 recommended), or null when unknown. */
export function sniffImageMime(head: Uint8Array): ImageMime | 'image/heic' | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (ascii(head, 0, '\x89PNG\r\n\x1a\n')) return 'image/png';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')) return 'image/webp';
  const brands = ftypBrands(head);
  if (brands.some((b) => AVIF_BRANDS.includes(b))) return 'image/avif';
  if (brands.some((b) => HEIC_BRANDS.includes(b))) return 'image/heic';
  return null;
}

export interface DecodedImage {
  /** Full size, upright. */
  bitmap: ImageBitmap;
  /** Natural, upright size (what compose()'s assetSize reports). */
  size: Size;
  mime: ImageMime | 'image/heic';
  /**
   * HEIC only: a JPEG of the decoded pixels, to store as the original instead of the file (browsers can't
   * show a HEIC in Recent photos). Resolves after the bitmap, null when there is none.
   */
  standIn?: Promise<Blob | null>;
}

export interface DecodeOptions {
  /** Called when the file is a HEIC and conversion starts (the UI says "Converting HEIC…"). */
  onConvert?: () => void;
}

const HEIC_NAME = /\.(heic|heif|hif)$/i;
const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];

/** A HEIC/HEIF by its name or its type, without reading it (macOS types a dragged HEIC unevenly). */
export function heicByLabel(f: { name?: string; type: string }): boolean {
  return HEIC_TYPES.includes(f.type.toLowerCase()) || HEIC_NAME.test(f.name ?? '');
}

/**
 * Whether a dropped or pasted file is a photo to open: an image/* type or a HEIC/HEIF name; anything else
 * (a HEIC typed '' or application/octet-stream, no extension) by its first bytes (JPEG, PNG, WebP, AVIF,
 * or an ftyp brand in HEIC_BRANDS).
 */
export async function isPhotoFile(f: Blob & { name?: string }): Promise<boolean> {
  if (f.type.toLowerCase().startsWith('image/') || heicByLabel(f)) return true;
  try {
    return sniffImageMime(new Uint8Array(await f.slice(0, 64).arrayBuffer())) !== null;
  } catch {
    return false;
  }
}

/** Whether the first bytes are a HEIC/HEIF. */
export async function isHeic(blob: Blob): Promise<boolean> {
  return sniffImageMime(new Uint8Array(await blob.slice(0, 64).arrayBuffer())) === 'image/heic';
}

/** Decodes a supported image; DECODE_FAILED for anything else or a corrupt file. */
export async function decodeImage(blob: Blob, opts: DecodeOptions = {}): Promise<DecodedImage> {
  const head = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
  const mime = sniffImageMime(head);
  if (mime === 'image/heic') {
    if (!loadHeic) throw new RasterError('DECODE_FAILED', 'HEIC is not supported in this build');
    opts.onConvert?.();
    const { decodeHeic } = await loadHeic();
    const d = await decodeHeic(blob);
    return { bitmap: d.bitmap, size: d.size, mime, standIn: d.jpeg };
  }
  if (mime === null)
    throw new RasterError('DECODE_FAILED', `not a JPEG, PNG, WebP or AVIF file (${blob.type || 'no type'})`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (cause) {
    throw new RasterError('DECODE_FAILED', `${mime} could not be decoded`, { cause });
  }
  if (bitmap.width === 0 || bitmap.height === 0) {
    bitmap.close();
    throw new RasterError('DECODE_FAILED', `${mime} has no pixels`);
  }
  return { bitmap, size: { w: bitmap.width, h: bitmap.height }, mime };
}

/** The proxy size: the long side at most `maxSide`, aspect kept, each side at least 1 px. */
export function proxySize(size: Size, maxSide: number = PROXY_MAX_SIDE): Size {
  const k = Math.min(1, maxSide / Math.max(size.w, size.h));
  if (k === 1) return { w: size.w, h: size.h };
  return { w: Math.max(1, Math.round(size.w * k)), h: Math.max(1, Math.round(size.h * k)) };
}

/** A downscaled copy for interaction, or `bitmap` itself when it is already small enough. */
export async function makeProxy(bitmap: ImageBitmap, maxSide: number = PROXY_MAX_SIDE): Promise<ImageBitmap> {
  const { w, h } = proxySize({ w: bitmap.width, h: bitmap.height }, maxSide);
  if (w === bitmap.width && h === bitmap.height) return bitmap;
  return await createImageBitmap(bitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
}
