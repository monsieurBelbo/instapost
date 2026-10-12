/**
 * Export format and size policy (strategy §3.4 step 5, U6).
 * - download and phone lanes: JPEG, quality stepping 0.92 → 0.88 → … → 0.72 until the file is
 *   at most MAX_EXPORT_BYTES, otherwise EXPORT_TOO_LARGE;
 * - msite lane: one PNG encode, no quality stepping and no size cap (none is specified;
 *   Instagram's own re-encode stays the only lossy step).
 */

export type ExportPurpose = 'msite' | 'phone' | 'download';
/** The two encodings the policy produces. */
export type ExportMime = 'image/jpeg' | 'image/png';

/** Export raster size, equal to the story frame. */
export const EXPORT_W = 1080;
export const EXPORT_H = 1920;
/** "8 MB or less" (research §3.1). The decimal reading is the stricter one, so it is used. */
export const MAX_EXPORT_BYTES = 8_000_000;
/** Tried in order; the policy never encodes JPEG below the last step. */
export const JPEG_QUALITY_STEPS = [0.92, 0.88, 0.84, 0.8, 0.76, 0.72] as const;

/** PNG for the msite lane, JPEG for download and phone. */
export const formatFor = (purpose: ExportPurpose): ExportMime => (purpose === 'msite' ? 'image/png' : 'image/jpeg');

/** Port: the raster side's encoder (convertToBlob). `T` is the encoded payload, e.g. a Blob. */
export type Encode<T> = (mime: ExportMime, quality: number | undefined) => Promise<{ size: number; out: T }>;

/** The first encode within the limit, or EXPORT_TOO_LARGE with the smallest size tried. */
export type EncodeResult<T> =
  | { ok: true; mime: ExportMime; quality: number | null; size: number; out: T }
  | { ok: false; code: 'EXPORT_TOO_LARGE'; smallestSize: number };

/**
 * Runs the policy for `purpose` with an injected encoder; stops at the first result within the
 * limit. JPEG steps run in order and never go below 0.72; `smallestSize` reports the smallest
 * attempt when every step is too large. Encoder rejections propagate unchanged.
 */
export async function encodeWithPolicy<T>(purpose: ExportPurpose, encode: Encode<T>): Promise<EncodeResult<T>> {
  const mime = formatFor(purpose);
  if (mime === 'image/png') {
    const { size, out } = await encode(mime, undefined);
    return { ok: true, mime, quality: null, size, out };
  }
  let smallestSize = Infinity;
  for (const quality of JPEG_QUALITY_STEPS) {
    const { size, out } = await encode(mime, quality);
    if (size <= MAX_EXPORT_BYTES) return { ok: true, mime, quality, size, out };
    smallestSize = Math.min(smallestSize, size);
  }
  return { ok: false, code: 'EXPORT_TOO_LARGE', smallestSize };
}
