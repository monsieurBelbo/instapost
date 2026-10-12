/**
 * B2 (strategy §7.11): the export is a 1080x1920 `image/jpeg` (download, phone) or `image/png`
 * (msite); a noise image stays within 8 MB through quality stepping; the output carries no APP1
 * `Exif` segment even when the source did (EXIF and GPS are stripped by re-encoding).
 */
import { describe, expect, test } from 'vitest';
import { type Encode, JPEG_QUALITY_STEPS, MAX_EXPORT_BYTES } from '../core/export/policy.ts';
import { initialXf, type Size } from '../core/geometry/fit.ts';
import { fixedAdvanceMeasurer } from '../core/text/fixed-measurer.ts';
import { decodeImage } from './decode.ts';
import { canvasEncoder } from './encode.ts';
import { isRasterError } from './errors.ts';
import { type ExportDeps, exportFrame, renderExportCanvas } from './export.ts';
import { jpegHasExif, jpegSegments, jpegSize } from './jpeg.ts';
import {
  bytesOf,
  exifApp1,
  FIXTURE_FRAME,
  fixtureDoc,
  imageLayer,
  insertAfterSoi,
  noiseCanvas,
  paintedBlob,
} from './test-fixtures.ts';

const ASSET = 'b'.repeat(64);

function depsFor(bitmap: ImageBitmap, wrapEncoder?: ExportDeps['wrapEncoder']): ExportDeps {
  const size: Size = { w: bitmap.width, h: bitmap.height };
  return {
    sources: { image: (id) => (id === ASSET ? bitmap : undefined) },
    assetSize: (id) => (id === ASSET ? size : undefined),
    measurer: fixedAdvanceMeasurer(),
    ...(wrapEncoder ? { wrapEncoder } : {}),
  };
}

const docFor = (bitmap: ImageBitmap) => {
  const size = { w: bitmap.width, h: bitmap.height };
  return fixtureDoc([imageLayer(ASSET, 'cover', initialXf('cover', size, { x: 0.5, y: 0.5 }))]);
};

async function decodedSize(blob: Blob): Promise<Size> {
  const bmp = await createImageBitmap(blob);
  const size = { w: bmp.width, h: bmp.height };
  bmp.close();
  return size;
}

/** Records every encoder call; `inflate` multiplies the size the policy sees (the blob is untouched). */
function recording(inflate = 1) {
  const attempts: { quality: number | undefined; realSize: number }[] = [];
  const wrap =
    (encode: Encode<Blob>): Encode<Blob> =>
    async (mime, quality) => {
      const r = await encode(mime, quality);
      attempts.push({ quality, realSize: r.size });
      return { size: Math.floor(r.size * inflate), out: r.out };
    };
  return { attempts, wrap };
}

describe('B2 export: JPEG', () => {
  test('download is a 1080x1920 image/jpeg at q0.92 when it fits', async () => {
    const src = await paintedBlob(
      4000,
      3000,
      (ctx) => {
        const g = ctx.createLinearGradient(0, 0, 4000, 3000);
        g.addColorStop(0, '#1d3557');
        g.addColorStop(1, '#e63946');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 4000, 3000);
      },
      'image/jpeg',
      0.9,
    );
    const { bitmap } = await decodeImage(src);
    const out = await exportFrame(docFor(bitmap), FIXTURE_FRAME, 'download', depsFor(bitmap));
    expect(out.mime).toBe('image/jpeg');
    expect(out.blob.type).toBe('image/jpeg');
    expect(out.quality).toBe(0.92);
    expect(out.bytes).toBe(out.blob.size);
    expect(out.bytes).toBeLessThanOrEqual(MAX_EXPORT_BYTES);
    expect({ w: out.w, h: out.h }).toEqual({ w: 1080, h: 1920 });
    const bytes = await bytesOf(out.blob);
    expect(jpegSize(bytes)).toEqual({ w: 1080, h: 1920 });
    expect(await decodedSize(out.blob)).toEqual({ w: 1080, h: 1920 });
  });

  test('a noise image stays within 8 MB, and stepping lowers the real size', async () => {
    const bitmap = await createImageBitmap(noiseCanvas(1080, 1920, 7));
    const plain = await exportFrame(docFor(bitmap), FIXTURE_FRAME, 'phone', depsFor(bitmap));
    expect(plain.bytes).toBeLessThanOrEqual(MAX_EXPORT_BYTES);

    // Real JPEG sizes at the first three steps, then a policy run that sees them inflated so
    // that 0.92 and 0.88 are "too large" and 0.84 is exactly at the limit.
    const canvas = renderExportCanvas(docFor(bitmap), FIXTURE_FRAME, depsFor(bitmap));
    const enc = canvasEncoder(canvas);
    const real = await Promise.all([0.92, 0.88, 0.84].map(async (q) => (await enc('image/jpeg', q)).size));
    const [s92 = 0, s88 = 0, s84 = 0] = real;
    expect(s92).toBeGreaterThan(s88);
    expect(s88).toBeGreaterThan(s84);

    const { attempts, wrap } = recording(MAX_EXPORT_BYTES / s84);
    const stepped = await exportFrame(docFor(bitmap), FIXTURE_FRAME, 'phone', depsFor(bitmap, wrap));
    expect(attempts.map((a) => a.quality)).toEqual([0.92, 0.88, 0.84]);
    expect(stepped.quality).toBe(0.84);
    expect(stepped.blob.size).toBe(s84);
    expect(await decodedSize(stepped.blob)).toEqual({ w: 1080, h: 1920 });
  });

  test('EXPORT_TOO_LARGE after the last step, never below 0.72', async () => {
    const bitmap = await createImageBitmap(noiseCanvas(540, 960, 3));
    const { attempts, wrap } = recording(1e6);
    let err: unknown;
    try {
      await exportFrame(docFor(bitmap), FIXTURE_FRAME, 'download', depsFor(bitmap, wrap));
    } catch (e) {
      err = e;
    }
    expect(isRasterError(err, 'EXPORT_TOO_LARGE')).toBe(true);
    expect(attempts.map((a) => a.quality)).toEqual([...JPEG_QUALITY_STEPS]);
  });

  test('no APP1 Exif in the output, even from a source with Exif and GPS', async () => {
    const plain = await bytesOf(
      await paintedBlob(
        1200,
        1600,
        (ctx) => {
          ctx.fillStyle = '#3366cc';
          ctx.fillRect(0, 0, 1200, 1600);
        },
        'image/jpeg',
        0.9,
      ),
    );
    const withExif = insertAfterSoi(plain, exifApp1(1, true));
    expect(jpegHasExif(withExif)).toBe(true);

    const { bitmap } = await decodeImage(new Blob([withExif.slice().buffer], { type: 'image/jpeg' }));
    const out = await exportFrame(docFor(bitmap), FIXTURE_FRAME, 'download', depsFor(bitmap));
    const bytes = await bytesOf(out.blob);
    expect(jpegHasExif(bytes)).toBe(false);
    expect(jpegSegments(bytes).some((s) => s.marker === 0xe1)).toBe(false);
  });
});

describe('B2 export: PNG', () => {
  test('msite is one 1080x1920 image/png encode', async () => {
    const bitmap = await createImageBitmap(noiseCanvas(300, 300, 5));
    const { attempts, wrap } = recording();
    const out = await exportFrame(docFor(bitmap), FIXTURE_FRAME, 'msite', depsFor(bitmap, wrap));
    expect(out.mime).toBe('image/png');
    expect(out.blob.type).toBe('image/png');
    expect(out.quality).toBeNull();
    expect(attempts).toHaveLength(1);
    const head = await bytesOf(out.blob.slice(0, 8));
    expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await decodedSize(out.blob)).toEqual({ w: 1080, h: 1920 });
  });
});

describe('B2 export: every background fill is opaque (EDIT-3)', () => {
  /** A landscape photo: under a cover fit it meets the frame exactly at the top and bottom. */
  async function landscape(): Promise<ImageBitmap> {
    const c = new OffscreenCanvas(4000, 3000);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const g = ctx.createLinearGradient(0, 0, 4000, 0);
    g.addColorStop(0, '#d9a441');
    g.addColorStop(1, '#3a7bd5');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4000, 3000);
    return createImageBitmap(c);
  }

  const pixels = (canvas: OffscreenCanvas): Uint8ClampedArray => {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const minAlpha = (d: Uint8ClampedArray): number => {
    let min = 255;
    for (let i = 3; i < d.length; i += 4) min = Math.min(min, d[i] ?? 0);
    return min;
  };
  /** Mean luma of row `y` of a 1080-wide RGBA buffer. */
  const rowLuma = (d: Uint8ClampedArray, y: number): number => {
    let sum = 0;
    for (let x = 0; x < 1080; x++) {
      const i = (y * 1080 + x) * 4;
      sum += 0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0);
    }
    return sum / 1080;
  };

  test('a blurred background reaches the frame edges with full alpha and no dark fringe', async () => {
    const bitmap = await landscape();
    const doc = fixtureDoc([], { kind: 'blur', assetId: ASSET, radiusPx: 40, dim: 0 });
    const d = pixels(renderExportCanvas(doc, FIXTURE_FRAME, depsFor(bitmap)));
    expect(minAlpha(d)).toBe(255);
    // The top and bottom rows look like the rows 200 px in (an exact cover faded them to black).
    expect(Math.abs(rowLuma(d, 0) - rowLuma(d, 200))).toBeLessThan(4);
    expect(Math.abs(rowLuma(d, 1919) - rowLuma(d, 1719))).toBeLessThan(4);
  });

  test.each([
    { kind: 'solid', color: '#123456' },
    { kind: 'gradient', from: '#ff0000', to: '#0000ff', angleDeg: 30 },
  ] as const)('a $kind background is opaque everywhere', async (fill) => {
    const bitmap = await landscape();
    const d = pixels(renderExportCanvas(fixtureDoc([], fill), FIXTURE_FRAME, depsFor(bitmap)));
    expect(minAlpha(d)).toBe(255);
  });
});
