/**
 * B5 (strategy §7.11): generated JPEG, PNG and WebP blobs decode at full size and upright; the
 * interaction proxy is at most 2160 px on the long side; anything else is DECODE_FAILED.
 */
import { describe, expect, test } from 'vitest';
import { findColor } from './calibration.ts';
import { decodeImage, makeProxy, PROXY_MAX_SIDE, proxySize, sniffImageMime } from './decode.ts';
import { isRasterError } from './errors.ts';
import { bytesOf, exifApp1, insertAfterSoi, paintedBlob } from './test-fixtures.ts';

/** Red top-left quadrant on blue, so orientation is visible. */
const quadrant = (w: number, h: number) => (ctx: OffscreenCanvasRenderingContext2D) => {
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, w / 2, h / 2);
};

async function decodeErr(blob: Blob): Promise<unknown> {
  try {
    await decodeImage(blob);
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('B5 decode', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp'] as const) {
    test(`${mime} decodes at full size`, async () => {
      const blob = await paintedBlob(640, 360, quadrant(640, 360), mime, 0.9);
      expect(blob.type).toBe(mime);
      const d = await decodeImage(blob);
      expect(d.mime).toBe(mime);
      expect(d.size).toEqual({ w: 640, h: 360 });
      expect({ w: d.bitmap.width, h: d.bitmap.height }).toEqual(d.size);
    });
  }

  test('the format is sniffed from the bytes, not the declared type', async () => {
    const png = await paintedBlob(10, 10, quadrant(10, 10), 'image/png');
    const mislabelled = new Blob([await png.arrayBuffer()], { type: 'image/jpeg' });
    expect((await decodeImage(mislabelled)).mime).toBe('image/png');
  });

  test('EXIF orientation 6 is applied: the bitmap is upright', async () => {
    const jpeg = await bytesOf(await paintedBlob(300, 200, quadrant(300, 200), 'image/jpeg', 0.95));
    const rotated = insertAfterSoi(jpeg, exifApp1(6, false));
    const d = await decodeImage(new Blob([rotated.slice().buffer], { type: 'image/jpeg' }));
    expect(d.size).toEqual({ w: 200, h: 300 });
    // Orientation 6 = rotate 90° clockwise to display: the stored top-left goes to the top-right.
    const ctx = new OffscreenCanvas(200, 300).getContext('2d');
    if (!ctx) throw new Error('no ctx');
    ctx.drawImage(d.bitmap, 0, 0);
    const red = findColor(ctx.getImageData(0, 0, 200, 300), '#ff0000', 40);
    expect(red.centroid?.x).toBeGreaterThan(130);
    expect(red.centroid?.y).toBeLessThan(80);
  });

  test('the proxy is at most 2160 px on the long side', async () => {
    const big = await decodeImage(await paintedBlob(4000, 3000, quadrant(4000, 3000), 'image/jpeg', 0.8));
    const proxy = await makeProxy(big.bitmap);
    expect({ w: proxy.width, h: proxy.height }).toEqual({ w: 2160, h: 1620 });
    expect(Math.max(proxy.width, proxy.height)).toBeLessThanOrEqual(PROXY_MAX_SIDE);
    // The full bitmap stays full size for export.
    expect({ w: big.bitmap.width, h: big.bitmap.height }).toEqual({ w: 4000, h: 3000 });

    const small = await decodeImage(await paintedBlob(1000, 800, quadrant(1000, 800), 'image/png'));
    expect(await makeProxy(small.bitmap)).toBe(small.bitmap);
  });

  test('proxySize keeps the aspect for portrait, landscape and extreme sources', () => {
    expect(proxySize({ w: 3024, h: 4032 })).toEqual({ w: 1620, h: 2160 });
    expect(proxySize({ w: 6000, h: 1000 })).toEqual({ w: 2160, h: 360 });
    expect(proxySize({ w: 2160, h: 2160 })).toEqual({ w: 2160, h: 2160 });
    expect(proxySize({ w: 100000, h: 10 })).toEqual({ w: 2160, h: 1 });
  });

  test('garbage, HEIC and truncated-looking files are DECODE_FAILED', async () => {
    const garbage = new Blob([new Uint8Array(64).fill(7)], { type: 'image/jpeg' });
    expect(isRasterError(await decodeErr(garbage), 'DECODE_FAILED')).toBe(true);

    const jpegMagicOnly = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 3, 4, 5, 6])]);
    expect(isRasterError(await decodeErr(jpegMagicOnly), 'DECODE_FAILED')).toBe(true);

    const heic = new Uint8Array(32);
    heic.set([0, 0, 0, 24], 0);
    heic.set(
      [...'ftypheic'].map((c) => c.charCodeAt(0)),
      4,
    );
    heic.set(
      [...'mif1heic'].map((c) => c.charCodeAt(0)),
      16,
    );
    const err = await decodeErr(new Blob([heic]));
    expect(isRasterError(err, 'DECODE_FAILED')).toBe(true);
    expect(String(err)).toContain('HEIC');
  });

  test('sniffImageMime recognises AVIF and HEIC brands', () => {
    const ftyp = (major: string, compat: string[]) => {
      const len = 16 + compat.length * 4;
      const b = new Uint8Array(len);
      b.set([0, 0, 0, len], 0);
      b.set(
        [...`ftyp${major}`].map((c) => c.charCodeAt(0)),
        4,
      );
      compat.forEach((c, i) => {
        b.set(
          [...c].map((ch) => ch.charCodeAt(0)),
          16 + i * 4,
        );
      });
      return b;
    };
    expect(sniffImageMime(ftyp('avif', ['mif1', 'miaf']))).toBe('image/avif');
    expect(sniffImageMime(ftyp('mif1', ['avif']))).toBe('image/avif');
    expect(sniffImageMime(ftyp('heic', ['mif1']))).toBe('image/heic');
    expect(sniffImageMime(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
