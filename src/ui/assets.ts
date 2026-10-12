/**
 * Image import for the editor (strategy §3.4 step 1, §7.10 "Load"): the original bytes go to
 * IndexedDB `assets`, keyed by SHA-256; the decoded full-size bitmap is kept for export and a
 * ≤2160 px proxy drives the preview and interaction.
 */
import type { Size } from '../core/geometry/fit.ts';
import type { AssetId } from '../core/model/ids.ts';
import { type AssetRecord, putAssetIfAbsent } from '../platform/idb.ts';
import { decodeImage, type ImageMime, makeProxy } from '../raster/decode.ts';
import { sha256Hex } from './hash.ts';

export interface LoadedImage {
  assetId: AssetId;
  mime: ImageMime;
  /** Natural, upright size. */
  size: Size;
  /** Full size, for export. */
  full: ImageBitmap;
  /** At most 2160 px on the long side (may be `full` itself), for the preview. */
  proxy: ImageBitmap;
  /** False when IndexedDB refused the original (editing and export still work). */
  stored: boolean;
}

/** Decodes `file` (DECODE_FAILED on anything unsupported) and stores the original. */
export async function importImage(
  file: Blob,
  store: (record: AssetRecord) => Promise<void> = putAssetIfAbsent,
): Promise<LoadedImage> {
  const decoded = await decodeImage(file);
  try {
    const assetId = await sha256Hex(await file.arrayBuffer());
    const proxy = await makeProxy(decoded.bitmap);
    let stored = true;
    try {
      // slice() re-types the Blob with the sniffed mime and drops the File's name.
      await store({
        id: assetId,
        blob: file.slice(0, file.size, decoded.mime),
        w: decoded.size.w,
        h: decoded.size.h,
        mime: decoded.mime,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.warn('[instapost] the original could not be stored', err);
      stored = false;
    }
    return { assetId, mime: decoded.mime, size: decoded.size, full: decoded.bitmap, proxy, stored };
  } catch (err) {
    decoded.bitmap.close();
    throw err;
  }
}

/** Frees both bitmaps. */
export function releaseImage(img: LoadedImage): void {
  if (img.proxy !== img.full) img.proxy.close();
  img.full.close();
}
