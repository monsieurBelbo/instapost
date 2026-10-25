/**
 * docs/repost.md §11: B24 (the card painter), B25 (a repost on the stage and its export: gradient,
 * card, text at 1080×1920; Blur resolves the backdrop; nothing goes to IndexedDB), B27 (the intake's plan:
 * permission, the second candidate after a 403, expired, at most 3 GETs, failures; cdn-fetch's options).
 * The network is stubbed: nothing is requested from any CDN.
 */
import { h, render } from 'preact';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compose } from '../core/render/compose.ts';
import { CREDIT_INSET, cardSpec, creditBox, SCALE_RANGE, userScaleOf } from '../core/repost/card-layout.ts';
import type { RepostSource } from '../core/repost/source.ts';
import { getAsset } from '../platform/idb.ts';
import { paintCard } from '../raster/card.ts';
import { decodeImage } from '../raster/decode.ts';
import { DEFAULT_FONT_ID, loadFont } from '../raster/fonts.ts';
import {
  assetSize,
  backdrop,
  doc,
  fontsReady,
  frame,
  image,
  imageLayer,
  loadImageFile,
  measurer,
  setText,
  transient,
} from './editor-state.ts';
import { freshExport } from './export-cache.ts';
import { cdnFetch } from './repost/cdn-fetch.ts';
import { type IntakeDeps, loadRepostMedia } from './repost/intake.ts';
import {
  cycleRepostLook,
  intake,
  receiveRepost,
  repost,
  repostActive,
  repostScale,
  setIntakeDeps,
  setRepostBg,
  tapsCard,
} from './repost-state.ts';
import { Stage } from './Stage.tsx';

const CDN = 'https://scontent-mad1-1.cdninstagram.com/v/t51.2885-15';

async function photoBlob(w: number, h: number, type = 'image/jpeg'): Promise<Blob> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#3060c0');
  g.addColorStop(1, '#f0a020');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return await c.convertToBlob({ type });
}

function pixels(b: ImageBitmap): { at(x: number, y: number): [number, number, number, number] } {
  const c = new OffscreenCanvas(b.width, b.height);
  const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(b, 0, 0);
  const d = ctx.getImageData(0, 0, b.width, b.height).data;
  return {
    at: (x, y) => {
      const i = (Math.round(y) * b.width + Math.round(x)) * 4;
      return [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, d[i + 3] ?? 0];
    },
  };
}

const SRC: RepostSource = {
  kind: 'post',
  author: 'some.user',
  code: 'C1aBcDeFgH',
  storyPk: null,
  media: [
    { url: `${CDN}/a_1080.jpg`, w: 1080 },
    { url: `${CDN}/a_640.jpg`, w: 640 },
  ],
  aspect: 0.8,
  avatar: `${CDN}/av.jpg`,
  slide: null,
  isOwn: false,
  consent: 'unknown',
  via: 'dialog',
  bar: 'seen',
};

beforeAll(async () => {
  await loadFont(DEFAULT_FONT_ID);
  fontsReady.value = true;
});

describe('B24 the card painter', () => {
  it('each style: transparent margins, the plate colour, the photo, the credit, the no-avatar initial', async () => {
    const photo = await createImageBitmap(await photoBlob(1080, 1350));
    for (const style of ['card', 'photo', 'dark'] as const) {
      const spec = cardSpec(style, 0.8, true, 'post');
      const { bitmap: bm, creditW } = await paintCard({
        spec,
        photo,
        avatar: null,
        author: 'some.user',
        avatarFill: '#204080',
      });
      expect(creditW, `${style} credit width`).toBeGreaterThan(0);
      const k = 1.3;
      const px = pixels(bm);
      expect(px.at(2, 2)[3], `${style} corner`).toBe(0);
      const inPhoto = px.at((64 + 400) * k, (64 + (spec.photo.box.y + spec.photo.box.h / 2)) * k);
      expect(inPhoto[3]).toBe(255);
      if (style !== 'photo') {
        const plate = px.at((64 + 700) * k, (64 + 20) * k);
        expect(plate.slice(0, 3)).toEqual(style === 'dark' ? [18, 18, 18] : [255, 255, 255]);
        // The no-avatar circle: the fill around a white initial.
        const ring = px.at((64 + 30) * k, (64 + 52) * k);
        expect(ring.slice(0, 3)).toEqual([32, 64, 128]);
      } else {
        // "@author" below the photo: some opaque white text on its dark backing pill (RV-6: readable on a
        // light background too).
        const mid = 64 + (spec.below?.y ?? 0) + (spec.below?.h ?? 0) / 2;
        let lit = 0;
        for (let x = 64; x < 300; x += 2) {
          const p = px.at(x * k, mid * k);
          if (p[3] > 200 && p[0] > 200) lit++;
        }
        expect(lit).toBeGreaterThan(5);
        const backing = px.at((64 + 8) * k, mid * k);
        expect(backing[3], 'the pill behind the credit').toBeGreaterThan(80);
        expect(backing[0]).toBeLessThan(40);
      }
      bm.close();
    }
    const story = cardSpec('story', 9 / 16, true, 'mention');
    const { bitmap: st } = await paintCard({
      spec: story,
      photo,
      avatar: null,
      author: 'some.user',
      avatarFill: '#000',
    });
    const px = pixels(st);
    expect(st.width).toBe(Math.ceil((864 + 128) * 1.3));
    // The credit pill's dark backing inside the bottom-left.
    const pill = px.at((64 + 30) * 1.3, (64 + 1536 - 24 - 26) * 1.3);
    expect(pill[3]).toBe(255);
    st.close();
    photo.close();
  });
});

function deps(over: Partial<IntakeDeps> & { calls?: string[] } = {}): IntakeDeps & { calls: string[] } {
  const calls: string[] = over.calls ?? [];
  return {
    calls,
    granted: over.granted ?? (async () => true),
    get:
      over.get ??
      (async (url) => {
        calls.push(url);
        return {
          ok: true,
          via: 'instapost:cdn-fetch',
          blob: await photoBlob(url.includes('av') ? 64 : 1080, url.includes('av') ? 64 : 1350),
          status: 200,
        };
      }),
    decode: over.decode ?? ((b) => decodeImage(b)),
    bitmap: over.bitmap ?? ((b) => createImageBitmap(b)),
  };
}

const until = async <T>(f: () => T | null | undefined | false, ms = 5000): Promise<T> => {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('B25 a repost on the stage, and its export', () => {
  afterEach(() => {
    intake.value = null;
  });
  it('gradient + card + text at 1080×1920, Blur resolves the backdrop, nothing stored, a photo ends it', async () => {
    const d = deps();
    setIntakeDeps(d);
    expect(receiveRepost(SRC)).toBe(true);
    expect(intake.value?.state).toBe('loading');
    await until(() => repostActive.value);
    expect(intake.value).toBe(null);
    expect(d.calls.length).toBe(2);
    expect(transient.value).toBe(true);
    expect(image.value?.stored).toBe(false);
    expect(imageLayer.value?.fit).toBe('free');
    expect(frame.value.background.kind).toBe('gradient');
    setText('hello');
    const ops = compose(doc.value, frame.value.id, 0, 'export', { assetSize, measurer });
    expect(ops.map((o) => o.op)).toEqual(['linearGradient', 'image', 'text']);
    const out = await freshExport();
    expect(out && [out.w, out.h]).toEqual([1080, 1920]);
    setRepostBg('blur');
    const blur = compose(doc.value, frame.value.id, 0, 'export', { assetSize, measurer });
    expect(blur[0]).toMatchObject({ op: 'blurredImage', assetId: backdrop.value?.assetId });
    expect(await freshExport()).not.toBe(null);
    const card = repost.value?.cardAssetId as string;
    expect(await getAsset(card)).toBe(undefined);
    cycleRepostLook();
    await until(() => repost.value?.look.style === 'photo' && repost.value.cardAssetId !== card);
    expect(repostActive.value).toBe(true);
    expect(await loadImageFile(await photoBlob(800, 600))).toBe(true);
    expect(repost.value).toBe(null);
    expect(transient.value).toBe(false);
    expect(backdrop.value).toBe(null);
  });
  it('an invalid source is refused', () => {
    expect(receiveRepost({ ...SRC, consent: 'blocked' })).toBe(false);
    expect(receiveRepost({ ...SRC, media: [{ url: 'https://evil.io/x.jpg', w: 1 }] })).toBe(false);
    expect(intake.value).toBe(null);
  });
});

describe('B27 the intake plan', () => {
  const fail = (status: number) => ({
    ok: false as const,
    why: status === 403 || status === 404 ? ('gone' as const) : ('http' as const),
    status,
  });
  it('not granted: the permission card, no GET', async () => {
    const d = deps({ granted: async () => false });
    expect(await loadRepostMedia(SRC, d)).toMatchObject({ ok: false, state: 'permission', gets: 0 });
    expect(d.calls).toEqual([]);
  });
  it('403 then the next candidate; both gone: expired; at most 3 GETs', async () => {
    const calls: string[] = [];
    const once = deps({
      calls,
      get: async (url) => {
        calls.push(url);
        if (url.endsWith('a_1080.jpg')) return fail(403);
        return { ok: true, via: 'instapost:cdn-fetch', blob: await photoBlob(640, 800), status: 200 };
      },
    });
    const r = await loadRepostMedia(SRC, once);
    expect(r).toMatchObject({ ok: true, gets: 3, lowRes: false });
    expect(calls.length).toBe(3);
    if (r.ok) r.photo.bitmap.close();
    const gone = deps({ get: async () => fail(404) });
    expect(await loadRepostMedia(SRC, gone)).toMatchObject({ ok: false, state: 'expired', gets: 3 });
    const five = deps({ get: async () => fail(500) });
    expect(await loadRepostMedia(SRC, five)).toMatchObject({ ok: false, state: 'failed', why: 'http-500', gets: 2 });
  });
  it('a timeout, a tiny image and an undecodable answer fail', async () => {
    const t = deps({ get: async () => ({ ok: false, why: 'timeout', status: null }) });
    expect(await loadRepostMedia(SRC, t)).toMatchObject({ ok: false, state: 'failed', why: 'timeout' });
    const tiny = deps({
      get: async () => ({ ok: true, via: 'instapost:cdn-fetch', blob: await photoBlob(200, 200), status: 200 }),
    });
    expect(await loadRepostMedia(SRC, tiny)).toMatchObject({ ok: false, state: 'failed', why: 'too-small' });
    const junk = deps({
      get: async () => ({ ok: true, via: 'instapost:cdn-fetch', blob: new Blob(['nope']), status: 200 }),
    });
    expect(await loadRepostMedia(SRC, junk)).toMatchObject({ ok: false, state: 'failed', why: 'decode' });
  });
  it('a mention under 720 wide is low-resolution', async () => {
    const m: RepostSource = {
      ...SRC,
      kind: 'mention',
      code: null,
      storyPk: '345678901234',
      via: 'dm',
      avatar: null,
      media: [{ url: `${CDN}/m.jpg`, w: 480 }],
    };
    const d = deps({
      get: async () => ({ ok: true, via: 'instapost:cdn-fetch', blob: await photoBlob(480, 853), status: 200 }),
    });
    const r = await loadRepostMedia(m, d);
    expect(r).toMatchObject({ ok: true, lowRes: true, gets: 1 });
    if (r.ok) r.photo.bitmap.close();
  });
  it('cdn-fetch: no cookies, no referrer, no redirect; only CDN URLs; images only', async () => {
    const seen: RequestInit[] = [];
    const stub = vi.fn(async (_u: string, init: RequestInit) => {
      seen.push(init);
      return new Response(await photoBlob(10, 10, 'image/png'), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });
    vi.stubGlobal('fetch', stub);
    try {
      expect((await cdnFetch(`${CDN}/a.jpg`, 1_000_000)).ok).toBe(true);
      expect(seen[0]).toMatchObject({
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
      });
      expect(await cdnFetch('https://www.instagram.com/x.jpg', 1_000_000)).toMatchObject({ ok: false, why: 'not-cdn' });
      expect(stub).toHaveBeenCalledTimes(1);
      stub.mockImplementationOnce(
        async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      );
      expect(await cdnFetch(`${CDN}/a.jpg`, 1_000_000)).toMatchObject({ ok: false, why: 'not-image' });
      stub.mockImplementationOnce(async () => new Response('', { status: 404 }));
      expect(await cdnFetch(`${CDN}/a.jpg`, 1_000_000)).toMatchObject({ ok: false, why: 'gone', status: 404 });
      expect(await cdnFetch(`${CDN}/a.jpg`, 10)).toMatchObject({ ok: false, why: 'too-large' });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('B26 the stage: a tap on the card, a drag, the wheel', () => {
  it('a short press reports a tap on the card; a drag moves it without a tap; the wheel stays in range', async () => {
    setIntakeDeps(deps());
    receiveRepost(SRC);
    await until(() => repostActive.value);
    const box = document.createElement('div');
    Object.assign(box.style, { width: '300px', height: '533px', position: 'relative' });
    const css = document.createElement('style');
    css.textContent = '.stage-wrap{position:absolute;inset:0}';
    document.head.append(css);
    document.body.append(box);
    const taps: { x: number; y: number }[] = [];
    render(h(Stage, { onTap: (p: { x: number; y: number }) => taps.push(p) }), box);
    const canvas = await until(() => {
      const c = box.querySelector<HTMLCanvasElement>('canvas');
      return c && c.getBoundingClientRect().width > 200 ? c : null;
    });
    const r = canvas.getBoundingClientRect();
    const at = (fx: number, fy: number) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy });
    const fire = (type: string, p: { clientX: number; clientY: number }) =>
      canvas.dispatchEvent(
        new PointerEvent(type, { ...p, bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0 }),
      );
    // The card's centre is at (540, 900) of 1920: 0.5, 0.47.
    fire('pointerdown', at(0.5, 0.47));
    fire('pointerup', at(0.5, 0.47));
    expect(taps).toHaveLength(1);
    expect(tapsCard(taps[0] as { x: number; y: number })).toBe(true);
    expect(tapsCard({ x: 10, y: 10 })).toBe(false);
    const before = imageLayer.value?.xf.cx ?? 0;
    fire('pointerdown', at(0.5, 0.47));
    fire('pointermove', at(0.55, 0.47));
    fire('pointermove', at(0.6, 0.47));
    fire('pointerup', at(0.6, 0.47));
    expect(taps).toHaveLength(1);
    expect(imageLayer.value?.xf.cx ?? 0).toBeGreaterThan(before + 50);
    for (let i = 0; i < 12; i++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', { ...at(0.5, 0.47), deltaY: -400, bubbles: true, cancelable: true }),
      );
    }
    const r0 = repost.value;
    expect(r0 && userScaleOf(r0.spec, imageLayer.value?.xf.scale ?? 0)).toBeCloseTo(SCALE_RANGE.post.max, 3);
    expect(repostScale.value).toBeCloseTo(SCALE_RANGE.post.max, 3);
    // RV-1 (AM56): dragged far up and left, the credit (the header) stays whole in the frame.
    fire('pointerdown', at(0.5, 0.47));
    fire('pointermove', at(0.2, -1));
    fire('pointermove', at(-2, -3));
    fire('pointerup', at(-2, -3));
    const xf = imageLayer.value?.xf;
    const credit = r0 ? creditBox(r0.spec, r0.creditW) : null;
    expect(xf && credit).toBeTruthy();
    if (r0 && xf && credit) {
      const u = userScaleOf(r0.spec, xf.scale);
      const left = xf.cx - (r0.spec.w * u) / 2 + credit.x * u;
      const top = xf.cy - (r0.spec.h * u) / 2 + credit.y * u;
      expect(left).toBeGreaterThanOrEqual(CREDIT_INSET.side - 0.01);
      expect(top).toBeGreaterThanOrEqual(CREDIT_INSET.top - 0.01);
      expect(left + credit.w * u).toBeLessThanOrEqual(1080);
    }
    render(null, box);
    box.remove();
    css.remove();
  });
});
