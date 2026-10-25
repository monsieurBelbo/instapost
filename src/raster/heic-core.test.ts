// docs/inpage.md §13.7: libheif (the same wasm the worker loads) decodes upright, irot and imir applied.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { heicColourSpace, iccDescription } from './heic-colour.ts';
import { decodePrimaryRgba, HeicError, type LibHeif } from './heic-core.ts';
import { MIRROR2_HEIC, P3_HEIC, PLAIN_HEIC, ROT6_HEIC } from './heic-fixtures.ts';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('libheif-js/libheif-wasm/libheif.wasm');
const factory = require('libheif-js/libheif-wasm/libheif.js') as (o: { wasmBinary: Uint8Array }) => LibHeif;
const lib = factory({ wasmBinary: readFileSync(wasmPath) });

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));

/** The dominant colour at (x, y): r, g or b. */
function at(img: { width: number; rgba: Uint8ClampedArray }, x: number, y: number): string {
  const o = (y * img.width + x) * 4;
  const [r = 0, g = 0, b = 0] = img.rgba.subarray(o, o + 3);
  return r > 128 ? 'r' : g > 128 ? 'g' : b > 128 ? 'b' : '?';
}
const corners = (img: { width: number; height: number; rgba: Uint8ClampedArray }) =>
  [at(img, 2, 2), at(img, img.width - 3, 2), at(img, 2, img.height - 3), at(img, img.width - 3, img.height - 3)].join(
    '',
  );

describe('decodePrimaryRgba', () => {
  test('a plain HEIC: 64×32, green top-left, red left, blue right', () => {
    const img = decodePrimaryRgba(lib, bytes(PLAIN_HEIC));
    expect([img.width, img.height]).toEqual([64, 32]);
    expect(img.rgba.length).toBe(64 * 32 * 4);
    expect(corners(img)).toBe('gbrb');
  });

  test('irot (orientation 6) comes out rotated 90° clockwise, portrait', () => {
    const img = decodePrimaryRgba(lib, bytes(ROT6_HEIC));
    expect([img.width, img.height]).toEqual([32, 64]);
    expect(corners(img)).toBe('rgbb');
  });

  test('imir (orientation 2) comes out mirrored', () => {
    const img = decodePrimaryRgba(lib, bytes(MIRROR2_HEIC));
    expect([img.width, img.height]).toEqual([64, 32]);
    expect(corners(img)).toBe('bgbr');
  });

  test('the pixels are a copy, not a view of the wasm heap', () => {
    const img = decodePrimaryRgba(lib, bytes(PLAIN_HEIC));
    expect(img.rgba.buffer.byteLength).toBe(64 * 32 * 4);
  });

  test('garbage and a bare ftyp are HeicError', () => {
    expect(() => decodePrimaryRgba(lib, new Uint8Array(64).fill(7))).toThrow(HeicError);
    const ftyp = bytes(PLAIN_HEIC).subarray(0, 36);
    expect(() => decodePrimaryRgba(lib, ftyp)).toThrow(/not a readable HEIF/);
  });
});

describe('heicColourSpace', () => {
  test('an ICC profile named Display P3 → display-p3; nclx BT.709/unspecified → srgb', () => {
    expect(heicColourSpace(bytes(P3_HEIC))).toBe('display-p3');
    expect(heicColourSpace(bytes(PLAIN_HEIC))).toBe('srgb');
    expect(heicColourSpace(new Uint8Array(10))).toBe('srgb');
  });

  test('nclx primaries 12 → display-p3', () => {
    const b = bytes(PLAIN_HEIC);
    const i = Buffer.from(b).indexOf('colrnclx');
    expect(i).toBeGreaterThan(0);
    const p3 = b.slice();
    p3[i + 8] = 0;
    p3[i + 9] = 12;
    expect(heicColourSpace(p3)).toBe('display-p3');
  });

  test('iccDescription reads a v4 mluc description', () => {
    const b = Buffer.from(bytes(P3_HEIC));
    const at = b.indexOf('prof') + 4;
    expect(iccDescription(new Uint8Array(b.subarray(at)))).toBe('Display P3');
  });
});
