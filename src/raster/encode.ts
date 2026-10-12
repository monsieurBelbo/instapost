/**
 * Encoding through the core export policy (strategy §3.4 step 5): `convertToBlob` on the export
 * canvas, JPEG quality stepping for download and phone, one PNG for msite. Re-encoding drops
 * EXIF and GPS data by construction.
 */
import { type Encode, type ExportMime, type ExportPurpose, encodeWithPolicy } from '../core/export/policy.ts';
import { RasterError } from './errors.ts';

/** The policy's encoder port over an OffscreenCanvas. Rejects if the browser substitutes another format. */
export function canvasEncoder(canvas: OffscreenCanvas): Encode<Blob> {
  return async (mime, quality) => {
    const blob = await canvas.convertToBlob(quality === undefined ? { type: mime } : { type: mime, quality });
    if (blob.type !== mime) throw new Error(`encoder produced ${blob.type || 'no type'} instead of ${mime}`);
    return { size: blob.size, out: blob };
  };
}

export interface EncodedExport {
  blob: Blob;
  mime: ExportMime;
  /** JPEG quality used, null for PNG. */
  quality: number | null;
  bytes: number;
}

/** Runs the policy for `purpose`; EXPORT_TOO_LARGE when even q0.72 is over the limit. */
export async function encodeForPurpose(purpose: ExportPurpose, encode: Encode<Blob>): Promise<EncodedExport> {
  const r = await encodeWithPolicy(purpose, encode);
  if (!r.ok) throw new RasterError('EXPORT_TOO_LARGE', `smallest JPEG was ${r.smallestSize} bytes at quality 0.72`);
  return { blob: r.out, mime: r.mime, quality: r.quality, bytes: r.size };
}
