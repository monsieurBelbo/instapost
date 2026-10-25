/**
 * Image import for the editor (strategy §3.4 step 1, §7.10 "Load"): the original bytes go to
 * IndexedDB `assets`, keyed by SHA-256; the decoded full-size bitmap is kept for export and a
 * ≤2160 px proxy drives the preview and interaction.
 *
 * HEIC (docs/inpage.md §13.7): the asset keeps the HEIC's SHA-256 as its id but stores the worker's JPEG
 * of the decoded pixels (browsers can't show a HEIC in Recent photos), written when it arrives, after the
 * photo is already on the stage. The same HEIC imported again decodes that JPEG natively instead.
 */
import type { Size } from '../core/geometry/fit.ts';
import type { AssetId } from '../core/model/ids.ts';
import { type AssetRecord, getAsset, putAssetIfAbsent } from '../platform/idb.ts';
import { type DecodedImage, type DecodeOptions, decodeImage, isHeic, makeProxy } from '../raster/decode.ts';
import { sha256Hex } from './hash.ts';

export interface LoadedImage {
  assetId: AssetId;
  mime: DecodedImage['mime'];
  /** Natural, upright size. */
  size: Size;
  /** Full size, for export. */
  full: ImageBitmap;
  /** At most 2160 px on the long side (may be `full` itself), for the preview. */
  proxy: ImageBitmap;
  /** False when IndexedDB refused the original (editing and export still work). */
  stored: boolean;
}

export interface ImportOptions extends DecodeOptions {
  /** The asset id when it is already known (Recent photos, a draft): skips hashing and keeps the id. */
  assetId?: AssetId;
}

/** A HEIC imported before: its stored JPEG, decoded natively (no worker). */
async function convertedBefore(file: Blob, assetId: AssetId): Promise<DecodedImage | null> {
  try {
    if (!(await isHeic(file))) return null;
    const a = await getAsset(assetId);
    if (!a || a.mime === 'image/heic') return null;
    return await decodeImage(a.blob);
  } catch {
    return null;
  }
}

/** Decodes `file` (DECODE_FAILED on anything unsupported) and stores the original. */
export async function importImage(
  file: Blob,
  store: (record: AssetRecord) => Promise<void> = putAssetIfAbsent,
  opts: ImportOptions = {},
): Promise<LoadedImage> {
  const assetId = opts.assetId ?? (await sha256Hex(await file.arrayBuffer()));
  const decoded = (await convertedBefore(file, assetId)) ?? (await decodeImage(file, opts));
  try {
    const proxy = await makeProxy(decoded.bitmap);
    const record = (blob: Blob): AssetRecord => ({
      id: assetId,
      blob,
      w: decoded.size.w,
      h: decoded.size.h,
      mime: blob.type || decoded.mime,
      createdAt: Date.now(),
    });
    let stored = true;
    if (decoded.standIn) {
      // HEIC: the JPEG follows the bitmap; storing it must not hold the photo back.
      void decoded.standIn
        .then((jpeg) => (jpeg ? store(record(jpeg)) : undefined))
        .catch((err: unknown) => console.warn('[instapost] the converted original could not be stored', err));
    } else {
      try {
        // slice() re-types the Blob with the sniffed mime and drops the File's name.
        await store(record(file.slice(0, file.size, decoded.mime)));
      } catch (err) {
        console.warn('[instapost] the original could not be stored', err);
        stored = false;
      }
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
