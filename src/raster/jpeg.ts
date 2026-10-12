/**
 * Minimal JPEG marker walk, for the export report ("location and EXIF removed", strategy §3.4
 * step 5) and its test (B2). Reads segment headers up to the start of scan; never decodes.
 */

export interface JpegSegment {
  /** The marker's second byte, e.g. 0xe1 for APP1. */
  marker: number;
  /** Offset of the 0xFF marker byte. */
  offset: number;
  /** Payload length (without the marker and the length field). */
  length: number;
}

/** Marker segments from SOI up to and including SOS. Throws on a file that does not start with SOI. */
export function jpegSegments(bytes: Uint8Array): JpegSegment[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG (no SOI)');
  const out: JpegSegment[] = [];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) throw new Error(`JPEG: expected a marker at ${at}`);
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at++; // fill byte
      continue;
    }
    const length = (((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) - 2;
    out.push({ marker, offset: at, length });
    if (marker === 0xda) break; // SOS: entropy-coded data follows
    at += 4 + length;
  }
  return out;
}

/** True when the JPEG carries an APP1 `Exif\0\0` segment (where EXIF, GPS included, lives). */
export function jpegHasExif(bytes: Uint8Array): boolean {
  return jpegSegments(bytes).some(
    (s) =>
      s.marker === 0xe1 &&
      bytes[s.offset + 4] === 0x45 && // E
      bytes[s.offset + 5] === 0x78 && // x
      bytes[s.offset + 6] === 0x69 && // i
      bytes[s.offset + 7] === 0x66 && // f
      bytes[s.offset + 8] === 0 &&
      bytes[s.offset + 9] === 0,
  );
}

/** Pixel size from the first SOF segment, or null. */
export function jpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  for (const s of jpegSegments(bytes)) {
    const isSof = s.marker >= 0xc0 && s.marker <= 0xcf && s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc;
    if (!isSof) continue;
    const p = s.offset + 4;
    return {
      h: ((bytes[p + 1] ?? 0) << 8) | (bytes[p + 2] ?? 0),
      w: ((bytes[p + 3] ?? 0) << 8) | (bytes[p + 4] ?? 0),
    };
  }
  return null;
}
