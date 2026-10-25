/**
 * The colour space of a HEIF's pixels, from its `colr` properties (ISO/IEC 23008-12 §6.5.5, ISO 14496-12
 * §12.1.5). libheif decodes the numbers only: an iPhone's HEIC carries Display P3 values (an ICC profile
 * named "Display P3", or nclx primaries 12), which read as sRGB look washed out. The worker tags its
 * ImageData with what this returns, and the canvas converts to sRGB.
 *
 * Anything that is not recognisably P3 is treated as sRGB (BT.709 primaries, the default).
 */

export type HeicColourSpace = 'srgb' | 'display-p3';

const u32 = (b: Uint8Array, at: number): number =>
  (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
const u16 = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const fourcc = (b: Uint8Array, at: number): string =>
  String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);

interface Box {
  type: string;
  /** First byte of the payload. */
  body: number;
  end: number;
}

function* boxes(b: Uint8Array, start: number, end: number): Generator<Box> {
  let at = start;
  while (at + 8 <= end) {
    let size = u32(b, at);
    const type = fourcc(b, at + 4);
    let body = at + 8;
    if (size === 1) {
      // 64-bit largesize; a HEIF's header boxes never need more than 32 bits of it.
      size = u32(b, at + 12) + u32(b, at + 8) * 2 ** 32;
      body = at + 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < 8 || at + size > end) return;
    yield { type, body, end: at + size };
    at += size;
  }
}

const find = (b: Uint8Array, start: number, end: number, type: string): Box | null => {
  for (const x of boxes(b, start, end)) if (x.type === type) return x;
  return null;
};

/** The ICC profile's description (`desc`, v2 text or v4 `mluc` UTF-16BE), or ''. */
export function iccDescription(icc: Uint8Array): string {
  if (icc.length < 132) return '';
  const count = u32(icc, 128);
  for (let i = 0; i < count && 132 + i * 12 + 12 <= icc.length; i++) {
    const e = 132 + i * 12;
    if (fourcc(icc, e) !== 'desc') continue;
    const off = u32(icc, e + 4);
    const len = u32(icc, e + 8);
    if (off + len > icc.length || len < 12) return '';
    const kind = fourcc(icc, off);
    if (kind === 'desc') {
      const n = u32(icc, off + 8);
      return String.fromCharCode(...icc.subarray(off + 12, Math.min(off + 12 + n, off + len))).replace(/\0+$/, '');
    }
    if (kind === 'mluc' && len >= 28) {
      const recLen = u32(icc, off + 20);
      const recOff = u32(icc, off + 24);
      let s = '';
      for (let k = 0; k + 1 < recLen && off + recOff + k + 1 < off + len; k += 2) {
        s += String.fromCharCode(u16(icc, off + recOff + k));
      }
      return s;
    }
    return '';
  }
  return '';
}

/** nclx colour_primaries that mean Display P3 (12: SMPTE EG 432-1, P3 D65; 11: DCI-P3 is close enough). */
const P3_PRIMARIES = new Set([11, 12]);

/** The colour space a HEIF's pixel values are in (see the module comment). */
export function heicColourSpace(b: Uint8Array): HeicColourSpace {
  const meta = find(b, 0, b.length, 'meta');
  if (!meta) return 'srgb';
  // `meta` is a FullBox: 4 bytes of version and flags before its children.
  const iprp = find(b, meta.body + 4, meta.end, 'iprp');
  const ipco = iprp ? find(b, iprp.body, iprp.end, 'ipco') : null;
  if (!ipco) return 'srgb';
  for (const x of boxes(b, ipco.body, ipco.end)) {
    if (x.type !== 'colr') continue;
    const kind = fourcc(b, x.body);
    if (kind === 'nclx' && P3_PRIMARIES.has(u16(b, x.body + 4))) return 'display-p3';
    if ((kind === 'prof' || kind === 'rICC') && /\bP3\b/i.test(iccDescription(b.subarray(x.body + 4, x.end)))) {
      return 'display-p3';
    }
  }
  return 'srgb';
}
