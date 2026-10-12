/**
 * Pixel helpers for E2E (strategy §6.3 "semantic probes", §7.9). Images are decoded with
 * createImageBitmap on an `about:blank` page of the sealed context, from bytes the test passes
 * in, never fetched from the extension or the fake, so the comparison sees exactly the files.
 */
import type { BrowserContext, Page } from '@playwright/test';

export interface Decoded {
  w: number;
  h: number;
}

/** A blank page for decoding; closed by the caller (or with the context). */
async function blank(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('about:blank');
  return page;
}

/** Natural size of an encoded image. */
export async function decodeSize(context: BrowserContext, bytes: Buffer): Promise<Decoded> {
  const page = await blank(context);
  try {
    return await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([u8]));
      const out = { w: bmp.width, h: bmp.height };
      bmp.close();
      return out;
    }, bytes.toString('base64'));
  } finally {
    await page.close();
  }
}

/**
 * PSNR in dB over RGB between two encoded images of the same size (Infinity when identical).
 * Throws when the sizes differ: a resampled story is a geometry failure, not a quality number.
 */
export async function psnr(context: BrowserContext, a: Buffer, b: Buffer): Promise<number> {
  const page = await blank(context);
  try {
    const result = await page.evaluate(
      async ([b64a, b64b]) => {
        const pixels = async (b64: string) => {
          const bin = atob(b64);
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          const bmp = await createImageBitmap(new Blob([u8]), { colorSpaceConversion: 'none' });
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
          if (!ctx) throw new Error('psnr: no 2d context');
          ctx.drawImage(bmp, 0, 0);
          const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
          const out = { w: bmp.width, h: bmp.height, data };
          bmp.close();
          return out;
        };
        const [pa, pb] = await Promise.all([pixels(b64a), pixels(b64b)]);
        if (pa.w !== pb.w || pa.h !== pb.h) return { error: `size ${pa.w}x${pa.h} != ${pb.w}x${pb.h}` };
        let sum = 0;
        for (let i = 0; i < pa.data.length; i += 4) {
          for (let c = 0; c < 3; c++) {
            const d = (pa.data[i + c] ?? 0) - (pb.data[i + c] ?? 0);
            sum += d * d;
          }
        }
        const mse = sum / ((pa.data.length / 4) * 3);
        return { mse };
      },
      [a.toString('base64'), b.toString('base64')] as const,
    );
    if ('error' in result) throw new Error(`psnr: ${result.error}`);
    return result.mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / result.mse);
  } finally {
    await page.close();
  }
}

/**
 * A smooth synthetic photo (gradients, soft shapes and a few hard edges), encoded in the page.
 * Smooth content keeps JPEG round trips well above the 38 dB bar while hard edges still catch
 * any crop or resample.
 */
export async function syntheticImage(
  context: BrowserContext,
  w: number,
  h: number,
  type: 'image/jpeg' | 'image/png',
): Promise<Buffer> {
  const page = await blank(context);
  try {
    const b64 = await page.evaluate(
      async ({ w, h, type }) => {
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('syntheticImage: no 2d context');
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#1d3557');
        g.addColorStop(0.5, '#a8dadc');
        g.addColorStop(1, '#e63946');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        const r = ctx.createRadialGradient(w * 0.35, h * 0.4, 0, w * 0.35, h * 0.4, Math.min(w, h) * 0.35);
        r.addColorStop(0, 'rgba(255,240,200,0.9)');
        r.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.fillStyle = r;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#f1faee';
        ctx.fillRect(Math.round(w * 0.6), Math.round(h * 0.15), Math.round(w * 0.25), Math.round(h * 0.2));
        ctx.fillStyle = '#457b9d';
        ctx.beginPath();
        ctx.arc(w * 0.7, h * 0.7, Math.min(w, h) * 0.12, 0, Math.PI * 2);
        ctx.fill();
        const blob = await canvas.convertToBlob(type === 'image/jpeg' ? { type, quality: 0.95 } : { type });
        const u8 = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return btoa(bin);
      },
      { w, h, type },
    );
    return Buffer.from(b64, 'base64');
  } finally {
    await page.close();
  }
}
