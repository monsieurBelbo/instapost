/**
 * U5 (strategy §7.11): display-list snapshot for a fixture doc (image, text, music
 * placeholder). Placeholder and guides appear only in `preview`. VideoLayer throws
 * NOT_IMPLEMENTED. Plus backgrounds, timing and text colour resolution.
 */
import { describe, expect, it } from 'vitest';
import { applyToPoint } from '../geometry/transform.ts';
import type { Frame, Layer, StoryDoc, TextLayer } from '../model/story.ts';
import { fixedAdvanceMeasurer } from '../text/fixed-measurer.ts';
import { contrastColor, parseHexColor } from './color.ts';
import { type ComposeEnv, ComposeError, compose, resolveTextColors } from './compose.ts';
import { type DrawOp, isPreviewOnly } from './ops.ts';

const IMG = 'a'.repeat(64);
const BG = 'b'.repeat(64);
const ASSETS: Record<string, { w: number; h: number }> = { [IMG]: { w: 4000, h: 3000 }, [BG]: { w: 3024, h: 4032 } };

const env = (over: Partial<ComposeEnv> = {}): ComposeEnv => ({
  assetSize: (id) => ASSETS[id],
  measurer: fixedAdvanceMeasurer(),
  ...over,
});

const imageLayer: Layer = {
  kind: 'image',
  id: 'lyr_image',
  assetId: IMG,
  fit: 'cover',
  focal: { x: 0.5, y: 0.5 },
  xf: { cx: 540, cy: 960, scale: 1, rotDeg: 0 },
};
const textLayer: TextLayer = {
  kind: 'text',
  id: 'lyr_text',
  text: 'Hola mundo\ndesde instapost',
  fontId: 'instrument-sans',
  sizePx: 64,
  color: '#ffffff',
  align: 'center',
  style: 'highlight',
  boxColor: '#e4405f',
  letterSpacingPx: 0,
  lineHeight: 1.2,
  maxWidthPx: 900,
  xf: { cx: 540, cy: 1400, scale: 1.25, rotDeg: -4 },
};
const musicPlaceholder: Layer = {
  kind: 'placeholder',
  id: 'lyr_music',
  purpose: 'music',
  rect: { x: 290, y: 300, w: 500, h: 140 },
  label: 'Music sticker',
};

const frame = (over: Partial<Frame> = {}): Frame => ({
  id: 'frm_1',
  durationMs: null,
  background: { kind: 'solid', color: '#101010' },
  layers: [imageLayer, textLayer, musicPlaceholder],
  audience: 'all',
  ...over,
});
const docWith = (...frames: Frame[]): StoryDoc => ({
  id: 'doc_fixture',
  schema: 1,
  size: { w: 1080, h: 1920 },
  frames,
  createdAt: 0,
  updatedAt: 0,
});
const fixture = docWith(frame());
const kinds = (ops: DrawOp[]) => ops.map((o) => o.op);

describe('U5 compose', () => {
  it('display-list snapshot (preview)', () => {
    expect(compose(fixture, 'frm_1', 0, 'preview', env())).toMatchSnapshot();
  });

  it('export is the preview minus placeholders and guides', () => {
    const preview = compose(fixture, 'frm_1', 0, 'preview', env());
    const exported = compose(fixture, 'frm_1', 0, 'export', env());
    expect(kinds(preview)).toEqual(['fillRect', 'image', 'text', 'placeholder', 'guide']);
    expect(kinds(exported)).toEqual(['fillRect', 'image', 'text']);
    expect(exported).toEqual(preview.filter((op) => !isPreviewOnly(op)));
  });

  it('export ignores guide settings', () => {
    const ops = compose(fixture, 'frm_1', 0, 'export', env({ guides: { safe: true, adSafe: true } }));
    expect(ops.some(isPreviewOnly)).toBe(false);
  });

  it('preview guides follow env.guides: safe by default, adSafe on request, none when off', () => {
    const guides = (g?: ComposeEnv['guides']) =>
      compose(fixture, 'frm_1', 0, 'preview', env({ guides: g })).flatMap((o) => (o.op === 'guide' ? [o.kind] : []));
    expect(guides()).toEqual(['safe']);
    expect(guides({ safe: false, adSafe: true })).toEqual(['adSafe']);
    expect(guides({ safe: true, adSafe: true })).toEqual(['safe', 'adSafe']);
    expect(guides({ safe: false, adSafe: false })).toEqual([]);
    const safe = compose(fixture, 'frm_1', 0, 'preview', env()).at(-1);
    expect(safe).toMatchObject({ op: 'guide', kind: 'safe' });
    if (safe?.op === 'guide') expect(safe.rects[1]).toEqual({ x: 0, y: 1536, w: 1080, h: 384 });
  });

  it('VideoLayer throws NOT_IMPLEMENTED, for either target and any time', () => {
    const video: Layer = {
      kind: 'video',
      id: 'lyr_video',
      assetId: IMG,
      trim: { inMs: 0, outMs: 3000 },
      fit: 'cover',
      xf: { cx: 540, cy: 960, scale: 1, rotDeg: 0 },
      startMs: 10_000,
    };
    const doc = docWith(frame({ durationMs: 5000, layers: [video] }));
    for (const target of ['preview', 'export'] as const) {
      expect(() => compose(doc, 'frm_1', 0, target, env())).toThrow(/^NOT_IMPLEMENTED/);
    }
    try {
      compose(doc, 'frm_1', 0, 'export', env());
    } catch (e) {
      expect(e).toBeInstanceOf(ComposeError);
      expect((e as ComposeError).code).toBe('NOT_IMPLEMENTED');
    }
  });

  it('throws on an unknown frame or asset', () => {
    expect(() => compose(fixture, 'frm_nope', 0, 'preview', env())).toThrow(/^UNKNOWN_FRAME: frm_nope/);
    expect(() => compose(fixture, 'frm_1', 0, 'export', env({ assetSize: () => undefined }))).toThrow(/^UNKNOWN_ASSET/);
  });

  it('places the image with its cover matrix', () => {
    const op = compose(fixture, 'frm_1', 0, 'export', env()).find((o) => o.op === 'image');
    if (op?.op !== 'image') throw new Error('no image op');
    expect(op.srcSize).toEqual({ w: 4000, h: 3000 });
    expect(applyToPoint(op.matrix, { x: 0, y: 0 })).toEqual({ x: -740, y: 0 });
    expect(applyToPoint(op.matrix, { x: 4000, y: 3000 })).toEqual({ x: 1820, y: 1920 });
  });

  it('centres the text block on the layer xf, one box per line', () => {
    const op = compose(fixture, 'frm_1', 0, 'export', env()).find((o) => o.op === 'text');
    if (op?.op !== 'text') throw new Error('no text op');
    expect(op.lines.map((l) => l.text)).toEqual(['Hola mundo', 'desde instapost']);
    expect(op.lines.every((l) => l.box !== null)).toBe(true);
    const blockW = 15 * 32 + 2 * 16;
    const blockH = 2 * 64 * 1.2;
    const c = applyToPoint(op.matrix, { x: blockW / 2, y: blockH / 2 });
    expect(c.x).toBeCloseTo(540, 9);
    expect(c.y).toBeCloseTo(1400, 9);
    expect({ color: op.color, boxColor: op.boxColor, style: op.style }).toEqual({
      color: '#ffffff',
      boxColor: '#e4405f',
      style: 'highlight',
    });
  });

  it('skips empty text layers', () => {
    const doc = docWith(frame({ layers: [{ ...textLayer, text: ' \n ' }] }));
    expect(kinds(compose(doc, 'frm_1', 0, 'export', env()))).toEqual(['fillRect']);
  });

  describe('backgrounds', () => {
    it('gradient', () => {
      const doc = docWith(frame({ background: { kind: 'gradient', from: '#112233', to: '#445566', angleDeg: 45 } }));
      expect(compose(doc, 'frm_1', 0, 'export', env())[0]).toEqual({
        op: 'linearGradient',
        rect: { x: 0, y: 0, w: 1080, h: 1920 },
        from: '#112233',
        to: '#445566',
        angleDeg: 45,
      });
    });

    it('blur: a centred copy of the asset, overscanned by 3σ beyond the cover on every side (EDIT-3)', () => {
      const doc = docWith(frame({ background: { kind: 'blur', assetId: BG, radiusPx: 40, dim: 0.3 } }));
      const op = compose(doc, 'frm_1', 0, 'export', env())[0];
      if (op?.op !== 'blurredImage') throw new Error('no blurredImage op');
      expect(op).toMatchObject({ assetId: BG, srcSize: { w: 3024, h: 4032 }, radiusPx: 40, dim: 0.3 });
      const tl = applyToPoint(op.matrix, { x: 0, y: 0 });
      const br = applyToPoint(op.matrix, { x: 3024, y: 4032 });
      // An exact cover of 3024x4032 would span x -180..1260, y 0..1920; 3σ = 120 story px more.
      for (const edge of [-tl.x, -tl.y, br.x - 1080, br.y - 1920]) expect(edge).toBeGreaterThanOrEqual(120 - 1e-9);
      expect((tl.x + br.x) / 2).toBeCloseTo(540, 9);
      expect((tl.y + br.y) / 2).toBeCloseTo(960, 9);
      // No blur, no overscan: the exact cover.
      const sharp = compose(
        docWith(frame({ background: { kind: 'blur', assetId: BG, radiusPx: 0, dim: 0 } })),
        'frm_1',
        0,
        'export',
        env(),
      )[0];
      if (sharp?.op !== 'blurredImage') throw new Error('no blurredImage op');
      expect(applyToPoint(sharp.matrix, { x: 0, y: 0 }).x).toBeCloseTo(-180, 9);
    });

    it('blur with an unknown asset throws', () => {
      const doc = docWith(frame({ background: { kind: 'blur', assetId: 'c'.repeat(64), radiusPx: 4, dim: 0 } }));
      expect(() => compose(doc, 'frm_1', 0, 'preview', env())).toThrow(/^UNKNOWN_ASSET/);
    });
  });

  describe('time', () => {
    const timedText: TextLayer = { ...textLayer, startMs: 1000, endMs: 2000 };

    it('photo frames ignore layer timing', () => {
      const doc = docWith(frame({ layers: [timedText] }));
      expect(kinds(compose(doc, 'frm_1', 5000, 'export', env()))).toEqual(['fillRect', 'text']);
    });

    it('timed frames show a layer in [startMs, endMs)', () => {
      const doc = docWith(frame({ durationMs: 3000, layers: [timedText] }));
      const at = (t: number) => kinds(compose(doc, 'frm_1', t, 'export', env()));
      expect(at(999)).toEqual(['fillRect']);
      expect(at(1000)).toEqual(['fillRect', 'text']);
      expect(at(1999)).toEqual(['fillRect', 'text']);
      expect(at(2000)).toEqual(['fillRect']);
    });
  });

  describe('text colours per style', () => {
    const colors = (style: TextLayer['style'], boxColor?: string) =>
      resolveTextColors({ style, color: '#ffffff', ...(boxColor ? { boxColor } : {}) });

    it('models all five styles', () => {
      expect(colors('plain', '#123456')).toEqual({ color: '#ffffff', boxColor: null });
      expect(colors('highlight')).toEqual({ color: '#ffffff', boxColor: '#000000' });
      expect(colors('highlight', '#e4405f')).toEqual({ color: '#ffffff', boxColor: '#e4405f' });
      expect(colors('inverse')).toEqual({ color: '#000000', boxColor: '#ffffff' });
      expect(colors('outline')).toEqual({ color: '#ffffff', boxColor: '#000000' });
      expect(colors('glow')).toEqual({ color: '#ffffff', boxColor: '#ffffff' });
    });

    it('contrastColor picks black or white', () => {
      expect(contrastColor('#ffffff')).toBe('#000000');
      expect(contrastColor('#000')).toBe('#ffffff');
      expect(contrastColor('#ffd400')).toBe('#000000');
      expect(contrastColor('#1a237e')).toBe('#ffffff');
      expect(contrastColor('not a colour')).toBe('#000000');
      expect(parseHexColor('#11223380')).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 0x80 / 255 });
    });
  });
});
