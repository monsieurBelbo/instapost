/**
 * B1 (strategy §7.11): calibration sources generated in-test, rendered through compose() and
 * rasterize(). Cover puts the corner fiducials on exact story pixels (1:1 and 2:1); contain
 * leaves background bars; a 90° rotation moves markers where the maths says.
 */
import { describe, expect, test } from 'vitest';
import { initialXf, type Size } from '../core/geometry/fit.ts';
import type { Xf } from '../core/model/story.ts';
import { compose } from '../core/render/compose.ts';
import { fixedAdvanceMeasurer } from '../core/text/fixed-measurer.ts';
import { calibrationCanvas, cornerMarkers, findColor, type Marker, pixelAt } from './calibration.ts';
import { isRasterError } from './errors.ts';
import { type RasterSources, rasterize } from './rasterize.ts';
import { FIXTURE_FRAME, fixtureDoc, imageLayer, snapshot } from './test-fixtures.ts';

const BG = '#00ff7f';
const ASSET = 'a'.repeat(64);

async function render(src: OffscreenCanvas, fit: 'cover' | 'contain' | 'free', xf: Xf, scale = 1) {
  const bitmap = await createImageBitmap(src);
  const size: Size = { w: src.width, h: src.height };
  const doc = fixtureDoc([imageLayer(ASSET, fit, xf)], { kind: 'solid', color: BG });
  const ops = compose(doc, FIXTURE_FRAME, 0, 'export', {
    assetSize: (id) => (id === ASSET ? size : undefined),
    measurer: fixedAdvanceMeasurer(),
  });
  const out = new OffscreenCanvas(Math.round(1080 * scale), Math.round(1920 * scale));
  const ctx = out.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new Error('no ctx');
  const sources: RasterSources = { image: (id) => (id === ASSET ? bitmap : undefined) };
  rasterize(ops, ctx, scale, sources);
  return snapshot(ctx);
}

const centred = (fit: 'cover' | 'contain', size: Size): Xf => initialXf(fit, size, { x: 0.5, y: 0.5 });

describe('B1 rasterize: cover', () => {
  test('1:1 crop: corner fiducials land on exact story pixels, cropped markers vanish', async () => {
    // 1440x1920 under cover: base scale 1, 180 px cropped on each side.
    const size = { w: 1440, h: 1920 };
    const visible = cornerMarkers(1080, 1920, 24).map((m) => ({ ...m, rect: { ...m.rect, x: m.rect.x + 180 } }));
    const hidden: Marker = { name: 'hidden', color: '#ff00ff', rect: { x: 0, y: 900, w: 24, h: 24 } };
    const img = await render(calibrationCanvas(size.w, size.h, [...visible, hidden]), 'cover', centred('cover', size));

    for (const m of visible) {
      const hit = findColor(img, m.color, 8);
      expect(hit.bbox, m.name).toEqual({ x: m.rect.x - 180, y: m.rect.y, w: 24, h: 24 });
      expect(hit.count, m.name).toBe(24 * 24);
    }
    expect(findColor(img, hidden.color).count).toBe(0);
    // Cover: no background anywhere.
    expect(findColor(img, BG, 8).count).toBe(0);
  });

  test('2:1 downscale: fiducials land on the story corners (16 px each)', async () => {
    const size = { w: 2160, h: 3840 };
    const markers = cornerMarkers(size.w, size.h, 32);
    const img = await render(calibrationCanvas(size.w, size.h, markers), 'cover', centred('cover', size));
    const expected: Record<string, { x: number; y: number }> = {
      tl: { x: 8, y: 8 },
      tr: { x: 1072, y: 8 },
      bl: { x: 8, y: 1912 },
      br: { x: 1072, y: 1912 },
    };
    for (const m of markers) {
      const hit = findColor(img, m.color);
      const want = expected[m.name];
      expect(hit.centroid?.x, m.name).toBeCloseTo(want?.x ?? Number.NaN, 0);
      expect(hit.centroid?.y, m.name).toBeCloseTo(want?.y ?? Number.NaN, 0);
      expect(hit.bbox?.w, m.name).toBeGreaterThanOrEqual(15);
      expect(hit.bbox?.w, m.name).toBeLessThanOrEqual(17);
      expect(hit.bbox?.h, m.name).toBeGreaterThanOrEqual(15);
      expect(hit.bbox?.h, m.name).toBeLessThanOrEqual(17);
    }
    // The extreme corner pixels belong to their fiducial.
    expect(pixelAt(img, 0, 0).slice(0, 3)).toEqual([255, 0, 0]);
    expect(pixelAt(img, 1079, 1919).slice(0, 3)).toEqual([255, 255, 0]);
  });

  test('preview scale 0.5 maps the same story pixels to half-size canvas pixels', async () => {
    const size = { w: 1080, h: 1920 };
    const markers = cornerMarkers(1080, 1920, 40);
    const img = await render(calibrationCanvas(size.w, size.h, markers), 'cover', centred('cover', size), 0.5);
    expect(img.width).toBe(540);
    expect(findColor(img, '#ff0000').centroid).toEqual({ x: 10, y: 10 });
    expect(findColor(img, '#ffff00').centroid).toEqual({ x: 530, y: 950 });
  });
});

describe('B1 rasterize: contain', () => {
  test('a square source leaves background bars above and below', async () => {
    const size = { w: 1080, h: 1080 };
    const img = await render(calibrationCanvas(size.w, size.h, [], '#808080'), 'contain', centred('contain', size));
    // 1080x1080 at scale 1, centred: rows 420..1499 are image.
    expect(findColor(img, BG, 8).count).toBe(1080 * 840);
    for (const x of [0, 540, 1079]) {
      expect(pixelAt(img, x, 0).slice(0, 3)).toEqual([0, 255, 127]);
      expect(pixelAt(img, x, 419).slice(0, 3)).toEqual([0, 255, 127]);
      expect(pixelAt(img, x, 420).slice(0, 3)).toEqual([128, 128, 128]);
      expect(pixelAt(img, x, 1499).slice(0, 3)).toEqual([128, 128, 128]);
      expect(pixelAt(img, x, 1500).slice(0, 3)).toEqual([0, 255, 127]);
      expect(pixelAt(img, x, 1919).slice(0, 3)).toEqual([0, 255, 127]);
    }
  });
});

describe('B1 rasterize: rotation', () => {
  // A 1920 square, cover base scale 1. N sits 400 px above the centre, E 400 px right of it.
  const size = { w: 1920, h: 1920 };
  const markers: Marker[] = [
    { name: 'N', color: '#0000ff', rect: { x: 940, y: 540, w: 40, h: 40 } },
    { name: 'E', color: '#ffff00', rect: { x: 1340, y: 940, w: 40, h: 40 } },
  ];

  test('0°: markers at their unrotated story positions', async () => {
    const img = await render(calibrationCanvas(size.w, size.h, markers), 'cover', centred('cover', size));
    expect(findColor(img, '#0000ff').centroid).toEqual({ x: 540, y: 560 });
    expect(findColor(img, '#ffff00').centroid).toEqual({ x: 940, y: 960 });
  });

  test('90° clockwise about the centre: N moves to E, E moves to S', async () => {
    const xf = { ...centred('cover', size), rotDeg: 90 };
    const img = await render(calibrationCanvas(size.w, size.h, markers), 'cover', xf);
    const n = findColor(img, '#0000ff');
    const e = findColor(img, '#ffff00');
    expect(n.centroid).toEqual({ x: 940, y: 960 });
    expect(e.centroid).toEqual({ x: 540, y: 1360 });
    expect(n.count).toBe(1600);
    expect(e.count).toBe(1600);
  });
});

describe('B1 rasterize: preflight', () => {
  test('a missing bitmap throws MISSING_ASSET before drawing', async () => {
    const size = { w: 100, h: 100 };
    const doc = fixtureDoc([imageLayer(ASSET, 'cover', centred('cover', size))]);
    const ops = compose(doc, FIXTURE_FRAME, 0, 'export', { assetSize: () => size, measurer: fixedAdvanceMeasurer() });
    const out = new OffscreenCanvas(1080, 1920);
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    ctx.fillStyle = '#123456';
    ctx.fillRect(0, 0, 1080, 1920);
    let err: unknown;
    try {
      rasterize(ops, ctx, 1, { image: () => undefined });
    } catch (e) {
      err = e;
    }
    expect(isRasterError(err, 'MISSING_ASSET')).toBe(true);
    expect(pixelAt(snapshot(ctx), 5, 5).slice(0, 3)).toEqual([0x12, 0x34, 0x56]);
  });
});
