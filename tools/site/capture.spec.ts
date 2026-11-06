/**
 * The site's product screenshots, taken from the real live artifact in the sealed browser against the fake
 * (usage: tools/site/playwright.capture.config.ts). Everything on them is real UI: a real photo import, a real
 * post through the in-page lane to the fake, and a real Share → Add to story click for the repost. Each shot is
 * cropped to its element, at the sealed browser's 2× screen, in light and dark, English and Spanish:
 *
 * - `sidebar-<lang>-<theme>`: the New story row in Instagram's left navigation.
 * - `composer-<lang>-<theme>`: a photo with a short text layer on the stage, the rail, Post story.
 * - `repost-<lang>-<theme>`: a post on the stage as a repost card (the Card look).
 * - `posted-<lang>-<theme>`: the Posted result.
 * - `mark.svg`, `mark-tile.svg`: the mark as read from the composer's live `Mark`, the tile as in tools/icons/mark.ts.
 *
 * The page's story frames are crops of these, made once by hand with a Playwright canvas, not by this spec:
 * site/assets/stage-posted-{en,es}.webp from `posted-<lang>-light`, stage-repost.webp from `repost-en-light` (the Spanish
 * stage differs only by encoder noise). Each is the stage alone: x 0 to 712, y 89 to one row short of the bottom, below
 * the 87 px title bar and clear of the dark hairlines at y 88 and y 1353, with the dialog's transparent bottom-left
 * corner filled from its neighbour. The right half stays out: it has an em dash on `posted` and an overlap on `repost`.
 * A stage has no theme, so one picture serves light and dark.
 *
 * A shot is written as PNG, or as WebP (from the browser's canvas) when the PNG is over MAX_BYTES. The dialog's
 * corners are transparent, so no scrim shows behind them on any page.
 *
 * - **Pictures:** painted by `paintScene` on a blank page: no photos of people, no stock.
 * - **Handles:** the fake's account knob and the injected post carry placeholder handles. The fake's default
 *   handle would put its name on the shots, and every shot is checked for that word (`expectClean`).
 * - **The repost:** the fake has no feed post with a Share control and no CDN, so the spec adds one post and a Share
 *   dialog to the fake's page and answers the composer's GET and permission check inside the composer. No request
 *   for the image leaves the composer: the post's `<picture>` shows a data: source, so its `<img srcset>`, which is
 *   what the content script reads, is never loaded. The fixtures' tripwire would fail the test otherwise.
 * - **The fake's Spanish:** a few of its navigation labels are English only; the one in the crop is relabelled.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { COMMENT_D, LIKE_D, SHARE_D } from '../../src/inpage/repost/glyphs.ts';
import { EN } from '../../src/ui/catalog.en.ts';
import { ES } from '../../src/ui/catalog.es.ts';
import { type Extension, type ExtGlobal, expect, test } from '../../tests/e2e/fixtures.ts';
import { quietEvaluate } from '../../tests/e2e/helpers/fake-page.ts';
import {
  type Box,
  centre,
  composerBox,
  composerMode,
  composerQuiet,
  composerWait,
  hostSnapshot,
  openComposer,
  openInstagram,
  rawClickComposer,
  waitComposerOpen,
  waitEdited,
  waitEntry,
} from '../../tests/e2e/helpers/inpage.ts';
import { MARK_COLOURS, strokeUnits } from '../icons/mark.ts';

const OUT = process.env.SITE_SHOTS_DIR ?? '';
if (!OUT) throw new Error('tools/site/capture.spec.ts: set SITE_SHOTS_DIR to the folder the images go to');

/** Over this, a shot is written as WebP. */
const MAX_BYTES = 400 * 1024;
/** The owner in every shot, and the post's author: placeholders, as the handle regex allows. */
const OWNER = 'you.example';
const AUTHOR = 'a.friend.example';
const CDN_URL = 'https://scontent-capture.cdninstagram.com/v/sample_1080.jpg';
const LAYER_TEXT = { en: 'First light', es: 'Primera luz' } as const;
const SAMPLE = { w: 1080, h: 1350 } as const;

type Lang = 'en' | 'es';
type Theme = 'light' | 'dark';
type SceneKind = 'dusk' | 'lake';

const CATALOG = { en: EN, es: ES } as const;

// ---- the pictures ---------------------------------------------------------------------------------------------

/**
 * A procedural scene, base64 JPEG. Runs in a page, so it closes over nothing. `dusk`: hills fading into the haze
 * under a violet sky, a low sun, pines and a few birds. `lake`: a mountain lake at first light, the peaks mirrored
 * in the water, pines framing the left. Both end with film grain and a soft vignette.
 */
async function paintScene({ kind, w: W, h: H }: { kind: SceneKind; w: number; h: number }): Promise<string> {
  type Rgb = readonly [number, number, number];
  type Stops = readonly (readonly [number, string])[];
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const rgb = (h: string): Rgb => [
    Number.parseInt(h.slice(1, 3), 16),
    Number.parseInt(h.slice(3, 5), 16),
    Number.parseInt(h.slice(5, 7), 16),
  ];
  const mix = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const css = (c: Rgb, a = 1): string => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  const random = (start: number) => {
    let seed = start;
    return (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const ramp = (stops: Stops, t: number): Rgb => {
    for (let i = 1; i < stops.length; i++) {
      const [p0, c0] = stops[i - 1] as readonly [number, string];
      const [p1, c1] = stops[i] as readonly [number, string];
      if (t <= p1) return mix(rgb(c0), rgb(c1), smooth((t - p0) / (p1 - p0)));
    }
    return rgb((stops[stops.length - 1] as readonly [number, string])[1]);
  };
  const noise1 = (seed: number) => {
    const r = random(seed);
    const n = 4096;
    const table = Float32Array.from({ length: n }, () => r());
    return (x: number): number => {
      const i = Math.floor(x);
      return lerp(table[((i % n) + n) % n] as number, table[(((i + 1) % n) + n) % n] as number, smooth(x - i));
    };
  };
  const fbm1 = (seed: number, octaves: number) => {
    const ns = Array.from({ length: octaves }, (_, i) => noise1(seed + i * 17));
    return (x: number): number => {
      let v = 0;
      let a = 0.5;
      let f = 1;
      let sum = 0;
      for (const n of ns) {
        v += a * n(x * f);
        sum += a;
        a *= 0.5;
        f *= 2.03;
      }
      return v / sum;
    };
  };
  const ridged1 = (seed: number, octaves: number) => {
    const ns = Array.from({ length: octaves }, (_, i) => noise1(seed + i * 23));
    return (x: number): number => {
      let v = 0;
      let a = 0.55;
      let f = 1;
      let sum = 0;
      for (const n of ns) {
        v += a * (1 - Math.abs(2 * n(x * f) - 1));
        sum += a;
        a *= 0.48;
        f *= 2.1;
      }
      return v / sum;
    };
  };
  const noise2 = (seed: number) => {
    const r = random(seed);
    const n = 256;
    const table = Float32Array.from({ length: n * n }, () => r());
    const at = (x: number, y: number): number => table[(((y % n) + n) % n) * n + (((x % n) + n) % n)] as number;
    return (x: number, y: number): number => {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const u = smooth(x - xi);
      const v = smooth(y - yi);
      return lerp(lerp(at(xi, yi), at(xi + 1, yi), u), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), v);
    };
  };
  const fbm2 = (seed: number, octaves: number) => {
    const ns = Array.from({ length: octaves }, (_, i) => noise2(seed + i * 31));
    return (x: number, y: number): number => {
      let v = 0;
      let a = 0.5;
      let f = 1;
      let sum = 0;
      for (const n of ns) {
        v += a * n(x * f, y * f);
        sum += a;
        a *= 0.5;
        f *= 2.02;
      }
      return v / sum;
    };
  };

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const fillSky = (stops: Stops, until: number): void => {
    for (let y = 0; y < until; y++) {
      ctx.fillStyle = css(ramp(stops, y / until));
      ctx.fillRect(0, y, W, 1);
    }
  };
  /** Thin streaks of cloud, tinted by height, from a small noise field scaled up. */
  const clouds = (seed: number, top: number, bottom: number, density: number, tint: (t: number) => Rgb): void => {
    const cw = 360;
    const ch = Math.round((bottom - top) / 3);
    const layer = document.createElement('canvas');
    layer.width = cw;
    layer.height = ch;
    const lc = layer.getContext('2d') as CanvasRenderingContext2D;
    const img = lc.createImageData(cw, ch);
    const f = fbm2(seed, 5);
    for (let y = 0; y < ch; y++) {
      const band = Math.sin((y / ch) * Math.PI);
      const c = tint(y / ch);
      for (let x = 0; x < cw; x++) {
        const a = clamp01((f(x / 70, y / 11 + x / 500) - density) * 5) * band;
        const i = (y * cw + x) * 4;
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
        img.data[i + 3] = a * 215;
      }
    }
    lc.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'blur(1.5px)';
    ctx.drawImage(layer, 0, top, W, bottom - top);
    ctx.restore();
  };
  const glow = (x: number, y: number, r: number, colour: Rgb, alpha: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(colour, alpha));
    g.addColorStop(0.35, css(colour, alpha * 0.42));
    g.addColorStop(1, css(colour, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const conifer = (x: number, y: number, h: number, c: Rgb): void => {
    ctx.fillStyle = css(c);
    const w = h * 0.36;
    const tiers = Math.max(4, Math.min(11, Math.round(h / 22)));
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    for (let i = 1; i <= tiers; i++) {
      const t = i / tiers;
      ctx.lineTo(x + w * t, y - h + h * t * 0.94);
      if (i < tiers) ctx.lineTo(x + w * t * 0.45, y - h + h * t * 0.86);
    }
    ctx.lineTo(x + w * 0.1, y);
    ctx.lineTo(x - w * 0.1, y);
    for (let i = tiers; i >= 1; i--) {
      const t = i / tiers;
      if (i < tiers) ctx.lineTo(x - w * t * 0.45, y - h + h * t * 0.86);
      ctx.lineTo(x - w * t, y - h + h * t * 0.94);
    }
    ctx.closePath();
    ctx.fill();
  };
  /** Trees on a ridge, in clumps; thinner towards the frame's middle when `open`. */
  const forest = (seed: number, ridge: (x: number) => number, minH: number, maxH: number, c: Rgb, open: boolean) => {
    const r = random(seed);
    const clump = fbm1(seed + 5, 3);
    for (let x = -10; x < W + 10; x += 3 + r() * (minH * 0.5)) {
      const keep = clump(x / 160) + (open ? (Math.abs(x / W - 0.5) * 2 - 0.55) * 0.9 : 0);
      if (keep < 0.47) continue;
      conifer(x, ridge(x) + 4, lerp(minH, maxH, r() * r()) * (0.75 + keep * 0.5), c);
    }
  };
  const ridgePath = (ridge: (x: number) => number, bottom: number): void => {
    ctx.beginPath();
    ctx.moveTo(-2, bottom);
    for (let x = -2; x <= W + 2; x += 2) ctx.lineTo(x, ridge(x));
    ctx.lineTo(W + 2, bottom);
    ctx.closePath();
  };
  const finish = (seed: number, grain: number, vignette: number): void => {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const r = random(seed);
    const cx = W / 2;
    const cy = H / 2;
    const norm = cx * cx + cy * cy;
    for (let y = 0, i = 0; y < H; y++) {
      for (let x = 0; x < W; x++, i += 4) {
        const dist = ((x - cx) * (x - cx) + (y - cy) * (y - cy)) / norm;
        const v = 1 - vignette * dist * dist;
        const n = (r() + r() + r() - 1.5) * grain;
        d[i] = (d[i] as number) * v + n;
        d[i + 1] = (d[i + 1] as number) * v + n;
        d[i + 2] = (d[i + 2] as number) * v + n * 1.1;
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  const dusk = (): void => {
    const horizon = H * 0.66;
    fillSky(
      [
        [0, '#171a45'],
        [0.28, '#32296a'],
        [0.52, '#6d3a80'],
        [0.72, '#b84f78'],
        [0.87, '#ee7e5f'],
        [1, '#ffc27a'],
      ],
      Math.ceil(horizon),
    );
    const stars = random(11);
    for (let i = 0; i < 240; i++) {
      const y = stars() * horizon * 0.42;
      ctx.fillStyle = `rgba(255,245,235,${(1 - y / (horizon * 0.42)) * (0.25 + stars() * 0.65)})`;
      const s = stars() < 0.07 ? 2 : 1.2;
      ctx.fillRect(stars() * W, y, s, s);
    }
    const sunX = W * 0.58;
    const sunY = horizon * 0.97;
    glow(sunX, sunY, W * 0.95, rgb('#ff9a62'), 0.55);
    glow(sunX, sunY, W * 0.34, rgb('#ffd9a1'), 0.75);
    clouds(21, horizon * 0.34, horizon * 0.94, 0.53, (t) => mix(rgb('#b5597f'), rgb('#ffb48a'), t));
    ctx.fillStyle = css(rgb('#fff1cd'));
    ctx.beginPath();
    ctx.arc(sunX, sunY, 54, 0, Math.PI * 2);
    ctx.fill();
    glow(sunX, sunY, 150, rgb('#fff1cd'), 0.5);

    const shades = [
      ['#dd8079', '#f2a585'],
      ['#b5647e', '#d68280'],
      ['#83507f', '#a66480'],
      ['#573f73', '#75497a'],
      ['#372f5e', '#47345f'],
      ['#1f1f45', '#29234b'],
      ['#101230', '#121333'],
    ] as const;
    shades.forEach(([ridgeColour, footColour], i) => {
      const t = i / (shades.length - 1);
      const base = lerp(H * 0.645, H * 0.93, t ** 1.15);
      const amp = lerp(46, 190, t);
      const f = fbm1(101 + i * 7, 4);
      const scale = lerp(330, 620, t);
      const ridge = (x: number): number => base - amp * (f(x / scale + i * 3.1) - 0.5) * 2;
      ridgePath(ridge, H + 2);
      const g = ctx.createLinearGradient(0, base - amp, 0, Math.min(H, base + amp * 0.9 + 70));
      g.addColorStop(0, ridgeColour);
      g.addColorStop(1, footColour);
      ctx.fillStyle = g;
      ctx.fill();
      if (i < 4) {
        // The sun's light along the far crests.
        ctx.beginPath();
        for (let x = -2; x <= W + 2; x += 2) ctx.lineTo(x, ridge(x));
        ctx.strokeStyle = css(rgb('#ffd0a0'), lerp(0.5, 0.1, t * 1.6));
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      if (i >= 3) {
        const minH = lerp(9, 34, (i - 3) / 3);
        forest(303 + i, ridge, minH, minH * 2.1, rgb(ridgeColour), i >= 5);
      }
    });
    ctx.strokeStyle = 'rgba(30,20,50,.75)';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (const [bx, by, s] of [
      [W * 0.36, horizon * 0.56, 11],
      [W * 0.42, horizon * 0.53, 8],
      [W * 0.4, horizon * 0.6, 7],
      [W * 0.47, horizon * 0.575, 6],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(bx - s, by - s * 0.3);
      ctx.quadraticCurveTo(bx - s * 0.4, by - s * 0.65, bx, by);
      ctx.quadraticCurveTo(bx + s * 0.4, by - s * 0.65, bx + s, by - s * 0.3);
      ctx.stroke();
    }
    finish(7, 13, 0.3);
  };

  const lake = (): void => {
    const shore = H * 0.61;
    fillSky(
      [
        [0, '#123a58'],
        [0.3, '#22677f'],
        [0.58, '#57a3a3'],
        [0.82, '#c5d9b4'],
        [1, '#ffe4b0'],
      ],
      Math.ceil(shore),
    );
    glow(W * 0.33, shore * 0.86, W * 0.85, rgb('#ffdca6'), 0.6);
    ctx.globalAlpha = 0.6;
    clouds(47, shore * 0.06, shore * 0.5, 0.54, (t) => mix(rgb('#9fcfca'), rgb('#ffe2bf'), t));
    ctx.globalAlpha = 1;

    // The ranges, per pixel: rock texture, snow on the high ground, haze at the foot.
    const img = ctx.getImageData(0, 0, W, H);
    const px = img.data;
    const ranges = [
      {
        base: shore - 6,
        amp: 430,
        scale: 410,
        seed: 61,
        rock: '#86b6b6',
        shadow: '#5a8fa0',
        snow: '#f6f7ef',
        line: 0.5,
        haze: '#c9dfc6',
        hazeK: 0.75,
      },
      {
        base: shore - 2,
        amp: 270,
        scale: 320,
        seed: 83,
        rock: '#3f7c8a',
        shadow: '#2a5f73',
        snow: '#dbe9e3',
        line: 0.72,
        haze: '#8fc0b4',
        hazeK: 0.7,
      },
    ];
    for (const m of ranges) {
      const ridgeN = ridged1(m.seed, 6);
      const tex = fbm2(m.seed + 2, 5);
      const snowEdge = fbm1(m.seed + 3, 4);
      const rock = rgb(m.rock);
      const shadow = rgb(m.shadow);
      const snow = rgb(m.snow);
      const haze = rgb(m.haze);
      const end = Math.ceil(shore);
      for (let x = 0; x < W; x++) {
        const e = ridgeN(x / m.scale + 3);
        const top = m.base - m.amp * e ** 1.3;
        const slope = ridgeN((x + 3) / m.scale + 3) - e;
        for (let y = Math.max(0, Math.floor(top)); y < end; y++) {
          const depth = (y - top) / m.amp;
          const n = tex((x + y * 0.7) / 34, (y - x * 0.45) / 22);
          const facet = clamp01(0.5 + slope * 26 * Math.exp(-depth * 7) + (n - 0.5) * 2.1);
          let c = mix(shadow, rock, facet);
          const height = (m.base - y) / m.amp;
          const snowLine = m.line + (snowEdge(x / 52) - 0.5) * 0.28 + (n - 0.5) * 0.3;
          if (height > snowLine) c = mix(c, snow, clamp01((height - snowLine) * 22) * (0.62 + facet * 0.38));
          c = mix(c, haze, clamp01((y - (m.base - m.amp * 0.5)) / (m.amp * 0.5)) ** 1.5 * m.hazeK);
          const a = clamp01(y - top + 1);
          const i = (y * W + x) * 4;
          px[i] = lerp(px[i] as number, c[0], a);
          px[i + 1] = lerp(px[i + 1] as number, c[1], a);
          px[i + 2] = lerp(px[i + 2] as number, c[2], a);
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    (['#245c62', '#143f49'] as const).forEach((shade, i) => {
      const f = fbm1(127 + i * 9, 4);
      const base = shore - lerp(52, 14, i);
      const amp = lerp(46, 26, i);
      const ridge = (x: number): number => base - amp * (f(x / 300 + i * 2.2) - 0.5) * 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, shore);
      ctx.clip();
      ridgePath(ridge, shore + 2);
      ctx.fillStyle = shade;
      ctx.fill();
      forest(151 + i, ridge, lerp(9, 15, i), lerp(20, 34, i), rgb(shade), false);
      ctx.restore();
    });

    // The water: the scene mirrored, each row nudged by a slow ripple, then tinted.
    const land = document.createElement('canvas');
    land.width = W;
    land.height = Math.ceil(shore);
    (land.getContext('2d') as CanvasRenderingContext2D).drawImage(canvas, 0, 0);
    const ripple = fbm1(171, 3);
    for (let y = Math.floor(shore); y < H; y++) {
      const k = (y - shore) / (H - shore);
      const sy = Math.max(0, shore - 1 - (y - shore) * 1.04);
      const dx = (ripple(y / 7) - 0.5) * lerp(2, 44, k);
      for (const shift of [dx - W, dx, dx + W]) ctx.drawImage(land, 0, sy, W, 1, shift, y, W, 1);
    }
    const water = ctx.createLinearGradient(0, shore, 0, H);
    water.addColorStop(0, 'rgba(26,92,104,.18)');
    water.addColorStop(0.5, 'rgba(14,66,84,.42)');
    water.addColorStop(1, 'rgba(8,38,58,.78)');
    ctx.fillStyle = water;
    ctx.fillRect(0, shore, W, H - shore);
    // Light along the ripples, thickest under the bright part of the sky.
    const glints = random(191);
    for (let i = 0; i < 620; i++) {
      const k = glints() ** 1.5;
      const y = shore + k * (H - shore);
      const len = lerp(10, 170, k) * (0.4 + glints());
      const near = Math.exp(-(((glints() - 0.5) * 3) ** 2));
      const x = W * 0.33 + (glints() - 0.5) * lerp(180, W * 1.1, k) * (2 - near);
      ctx.fillStyle = `rgba(255,236,196,${(0.05 + glints() * 0.17) * near})`;
      ctx.fillRect(x - len / 2, y, len, lerp(0.8, 2.6, k));
    }
    ctx.fillStyle = 'rgba(255,240,205,.35)';
    ctx.fillRect(0, shore - 0.5, W, 1.5);

    // Pines on the near bank, framing the left.
    const bankNoise = fbm1(211, 3);
    const bank = (x: number): number =>
      H - 26 - Math.max(0, 1 - x / (W * 0.62)) ** 1.6 * 210 + (bankNoise(x / 90) - 0.5) * 26;
    ridgePath(bank, H + 2);
    ctx.fillStyle = '#0b2433';
    ctx.fill();
    const trees = random(223);
    for (let x = -10; x < W * 0.52; x += 22 + trees() * 40) {
      conifer(x, bank(x) + 8, lerp(250, 70, x / (W * 0.52)) * (0.72 + trees() * 0.55), rgb('#0b2433'));
    }
    finish(9, 12, 0.26);
  };

  if (kind === 'dusk') dusk();
  else lake();
  const blob = await new Promise<Blob>((ok, no) =>
    canvas.toBlob((b) => (b ? ok(b) : no(new Error('toBlob'))), 'image/jpeg', 0.93),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A page with nothing on it, for painting and encoding in the sealed browser. */
async function onBlank<T>(context: BrowserContext, f: (page: Page) => Promise<T>): Promise<T> {
  const page = await context.newPage();
  try {
    await page.goto('about:blank');
    return await f(page);
  } finally {
    await page.close();
  }
}

const scene = async (context: BrowserContext, kind: SceneKind): Promise<Buffer> =>
  Buffer.from(await onBlank(context, (p) => p.evaluate(paintScene, { kind, ...SAMPLE })), 'base64');

// ---- writing the shots ----------------------------------------------------------------------------------------

/** Writes `name` under OUT: PNG, or WebP when the PNG is over MAX_BYTES. `radius` (CSS px) rounds the corners. */
async function writeShot(context: BrowserContext, name: string, shot: Buffer, radius: number, dpr: number) {
  const encoded = await onBlank(context, (p) =>
    p.evaluate(
      async ({ b64, r, max }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes]));
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        if (r > 0) {
          ctx.beginPath();
          ctx.roundRect(0, 0, bmp.width, bmp.height, r);
          ctx.clip();
        }
        ctx.drawImage(bmp, 0, 0);
        const base64 = async (blob: Blob): Promise<string> => {
          const u8 = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
          return btoa(bin);
        };
        const png = await canvas.convertToBlob({ type: 'image/png' });
        if (png.size <= max) return { ext: 'png', b64: await base64(png), w: bmp.width, h: bmp.height };
        let webp = png;
        for (const quality of [0.88, 0.82, 0.76, 0.7]) {
          webp = await canvas.convertToBlob({ type: 'image/webp', quality });
          if (webp.size <= max) break;
        }
        return { ext: 'webp', b64: await base64(webp), w: bmp.width, h: bmp.height };
      },
      { b64: shot.toString('base64'), r: radius * dpr, max: MAX_BYTES },
    ),
  );
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (parse(f).name === name) rmSync(join(OUT, f));
  writeFileSync(join(OUT, `${name}.${encoded.ext}`), Buffer.from(encoded.b64, 'base64'));
}

const clipOf = (b: Box) => ({ x: b.x, y: b.y, width: b.w, height: b.h });

/** The composer's dialog, cropped to its element, with no hover on it. */
async function shootDialog(page: Page, name: string): Promise<void> {
  await page.mouse.move(2, 2);
  // Past the dialog's own transitions and any tooltip's fade.
  await page.waitForTimeout(500);
  const metrics = await composerQuiet(page, () => ({
    radius: Number.parseFloat(getComputedStyle(document.querySelector('.dialog') as Element).borderTopLeftRadius),
    dpr: devicePixelRatio,
    scrollTop: (document.querySelector('.dialog') as Element).scrollTop,
  }));
  expect(metrics.dpr, 'the sealed screen is 2×').toBe(2);
  // A Playwright locator's scroll-into-view can move the overflow-hidden dialog: the owner's raw input never does.
  expect(metrics.scrollTop, 'the dialog is not scrolled').toBe(0);
  const shot = await page.screenshot({ clip: clipOf(await composerBox(page, '.dialog')) });
  await writeShot(page.context(), name, shot, metrics.radius, metrics.dpr);
}

/** No word of the test environment is on a shot. */
function expectClean(text: string, what: string): void {
  expect(text, `${what} shows a word of the test environment`).not.toMatch(/fake|test build|compilación de prueba/i);
}

const dialogText = (page: Page): Promise<string> =>
  composerQuiet(page, () => (document.querySelector('.dialog') as HTMLElement).innerText);

// ---- the setup ------------------------------------------------------------------------------------------------

interface Setup {
  extension: Extension;
  fake: { setKnobs(patch: Record<string, unknown>): Promise<unknown> };
  seed(opts: { account: string; lang: Lang }): Promise<void>;
}

/** The fake's account and theme, the seed in that language, the coach and the one-time repost note already seen. */
async function prepare(s: Setup, lang: Lang, theme: Theme, knobs: Record<string, unknown> = {}): Promise<void> {
  await s.fake.setKnobs({ account: OWNER, theme, ...knobs });
  await s.seed({ account: OWNER, lang });
  await s.extension.sw.evaluate(async () => {
    const { chrome } = globalThis as ExtGlobal;
    await chrome.storage.local.set({ inpageUi: { coachSeen: true }, repostNoteSeen: true });
  });
}

async function openStory(page: Page, lang: Lang, theme: Theme): Promise<ReturnType<typeof openComposer>> {
  await waitEntry(page);
  await expect.poll(async () => (await hostSnapshot(page)).scheme).toBe(theme);
  await expect.poll(async () => (await hostSnapshot(page)).lang).toBe(lang);
  const composer = await openComposer(page);
  await expect(composer.locator('#dlg-title')).toHaveText(CATALOG[lang]['inpage.dialog.titleNew']);
  expect(await composer.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
  return composer;
}

/** The photo on the stage and the short text layer on it; the rail on its Text tab, nothing focused. Raw input only. */
async function storyWithText(page: Page, lang: Lang, theme: Theme, photo: string) {
  const composer = await openStory(page, lang, theme);
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  await rawClickComposer(page, '[data-testid="import-choose"]');
  await (await chooser).setFiles(photo);
  await waitEdited(composer);
  await rawClickComposer(page, '#tab-text');
  await composerWait(page, () => document.getElementById('story-text') !== null, 5000);
  await rawClickComposer(page, '#story-text');
  await page.keyboard.type(LAYER_TEXT[lang]);
  await composer.locator('#story-text').blur();
  // Up into the sky, clear of the result's badge in the stage's middle.
  const stage = await composerBox(page, '[data-testid="editor-stage"]');
  const from = centre(stage);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - stage.h * 0.26, { steps: 8 });
  await page.mouse.up();
  await waitEdited(composer);
  return composer;
}

// ---- the repost's stand-ins -----------------------------------------------------------------------------------

/** Adds a feed post whose Share opens a Share dialog, as far as the content script's detectors read (RP-5, RP-13). */
async function addPostToPage(page: Page): Promise<Box> {
  return page.evaluate(
    ({ author, cdn, sample, like, comment, share }) => {
      const svg = (d: string) =>
        `<svg width="24" height="24" viewBox="0 0 24 24"><path d="${d} L4 4 L20 4Z"></path></svg>`;
      const source = `data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${sample.w}" height="${sample.h}"></svg>`,
      )}`;
      const post = document.createElement('article');
      post.style.cssText = 'position:fixed;left:300px;top:24px;width:420px;z-index:5;background:#fff;color:#000';
      post.innerHTML = `
        <header><a href="/${author}/">${author}</a></header>
        <picture>
          <source srcset="${source}">
          <img alt="" srcset="${cdn} ${sample.w}w" style="display:block;width:420px;height:525px">
        </picture>
        <div style="display:flex;gap:8px">
          ${svg(like)}${svg(comment)}
          <button type="button" data-capture-share style="width:32px;height:32px;padding:0">${svg(share)}</button>
        </div>
        <a href="/p/CaptureOne1/"><time datetime="2026-11-01T10:00:00.000Z">1d</time></a>`;
      document.body.append(post);
      const control = post.querySelector('[data-capture-share]') as HTMLElement;
      control.addEventListener('click', () => {
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.style.cssText = 'position:fixed;left:760px;top:120px;width:400px;height:420px;z-index:6;background:#fff';
        dialog.innerHTML = '<input aria-label="Search">';
        document.body.append(dialog);
      });
      const r = control.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    {
      author: AUTHOR,
      cdn: CDN_URL,
      sample: SAMPLE,
      like: LIKE_D[0] as string,
      comment: COMMENT_D[0] as string,
      share: SHARE_D[0] as string,
    },
  );
}

/** The Add to story strip's box, in the content script's closed shadow root (CDP's pierced DOM). */
async function stripBox(page: Page): Promise<Box | null> {
  const cdp = await page.context().newCDPSession(page);
  try {
    interface DomNode {
      nodeId: number;
      attributes?: string[];
      children?: DomNode[];
      shadowRoots?: DomNode[];
    }
    const walk = (n: DomNode): DomNode | null => {
      const a = n.attributes ?? [];
      const cls = a[a.indexOf('class') + 1];
      if (a.includes('class') && cls?.split(/\s+/).includes('rp-strip')) return n;
      for (const c of [...(n.shadowRoots ?? []), ...(n.children ?? [])]) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
    const hit = walk(root);
    if (!hit) return null;
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId: hit.nodeId });
    const [x, y] = model.border as [number, number];
    return { x, y, w: model.width, h: model.height };
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

// ---- the shots ------------------------------------------------------------------------------------------------

for (const lang of ['en', 'es'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    const tag = `${lang}-${theme}`;

    test(`sidebar ${tag}`, async ({ context, extension, fake, seed }) => {
      await prepare({ extension, fake, seed }, lang, theme, { locale: lang });
      const page = await openInstagram(context, { w: 1440, h: 900 });
      const row = await waitEntry(page);
      await expect.poll(async () => (await hostSnapshot(page)).scheme).toBe(theme);
      await expect
        .poll(async () => (await hostSnapshot(page)).entry?.text ?? '')
        .toContain(CATALOG[lang]['page.entry.label']);
      if (lang === 'es') {
        // The fake's Profile label has no Spanish; Instagram's does.
        await quietEvaluate(page, () => {
          const link = document.querySelector('[data-testid="fake-nav-profile"]');
          const walker = link && document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
          while (walker?.nextNode()) {
            if (walker.currentNode.textContent === 'Profile') walker.currentNode.textContent = 'Perfil';
          }
        });
      }
      const nav = await quietEvaluate(page, () => {
        const list = document.querySelector('nav[data-fake-nav]') as HTMLElement;
        return {
          top: (document.querySelector('[data-testid="fake-create"]') as Element).getBoundingClientRect().top,
          right: list.getBoundingClientRect().right,
          text: list.innerText,
        };
      });
      expectClean(nav.text, 'the navigation');
      expectClean((await hostSnapshot(page)).entry?.text ?? '', 'the entry');
      await page.mouse.move(900, 500);
      await page.waitForTimeout(400);
      const top = nav.top - 8;
      const shot = await page.screenshot({
        clip: { x: 0, y: top, width: nav.right, height: row.box.y + row.box.h + 8 - top },
      });
      await writeShot(context, `sidebar-${tag}`, shot, 0, 2);
    });

    test(`composer ${tag}`, async ({ context, extension, fake, seed }) => {
      await prepare({ extension, fake, seed }, lang, theme);
      const photo = test.info().outputPath('lake.jpg');
      writeFileSync(photo, await scene(context, 'lake'));
      const page = await openInstagram(context);
      await storyWithText(page, lang, theme, photo);
      expectClean(await dialogText(page), 'the composer');
      await shootDialog(page, `composer-${tag}`);
    });

    test(`repost ${tag}`, async ({ context, extension, fake, seed }) => {
      await prepare({ extension, fake, seed }, lang, theme);
      const sample = await scene(context, 'lake');
      const page = await openInstagram(context);
      // The composer's frame stays loaded when closed: its permission check and its GET answer from here on.
      const composer = await openStory(page, lang, theme);
      await composer.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const { chrome } = globalThis as ExtGlobal;
        chrome.permissions.contains = (async () => true) as unknown as typeof chrome.permissions.contains;
        const real = globalThis.fetch;
        globalThis.fetch = async (input, init) =>
          String(input).includes('.cdninstagram.com/')
            ? new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
            : real(input, init);
      }, sample.toString('base64'));
      await rawClickComposer(page, '[data-testid="inpage-close"]');
      await expect.poll(async () => composerMode(await hostSnapshot(page))).toBe('closed');

      const share = await addPostToPage(page);
      const at = centre(share);
      await page.mouse.click(at.x, at.y);
      await expect.poll(() => stripBox(page).catch(() => null), { timeout: 5000 }).not.toBeNull();
      const strip = centre((await stripBox(page)) as Box);
      await page.mouse.move(strip.x, strip.y, { steps: 3 });
      await page.mouse.click(strip.x, strip.y);
      const open = await waitComposerOpen(page);
      await expect(open.getByTestId('repost-tab')).toBeVisible({ timeout: 15_000 });
      await waitEdited(open);
      // The "click the post" hint fades after 1.8 s.
      await page.waitForTimeout(2300);
      await composerWait(page, () => document.querySelector('[data-testid="repost-note"]') !== null);
      expectClean(await dialogText(page), 'the repost');
      await shootDialog(page, `repost-${tag}`);
    });

    test(`posted ${tag}`, async ({ context, extension, fake, seed }) => {
      await prepare({ extension, fake, seed }, lang, theme);
      const photo = test.info().outputPath('dusk.jpg');
      writeFileSync(photo, await scene(context, 'dusk'));
      const page = await openInstagram(context);
      await storyWithText(page, lang, theme, photo);
      await rawClickComposer(page, '[data-testid="inpage-post"]');
      // Zero human actions from here: quiet reads only, until the run has ended (tests/e2e/helpers/inpage.ts).
      await expect
        .poll(
          () =>
            composerQuiet(
              page,
              () => document.querySelector('[data-testid="inpage-outcome"]')?.getAttribute('data-outcome') ?? null,
            ).catch(() => null),
          { timeout: 120_000, intervals: [100] },
        )
        .toBe('posted');
      // Keep open: Posted closes itself after 4 s (FS12), and the shot goes without its countdown.
      await rawClickComposer(page, '.res-auto button');
      await composerWait(page, () => document.querySelector('.res-auto') === null, 5000);
      expectClean(await dialogText(page), 'the result');
      await shootDialog(page, `posted-${tag}`);
    });
  }
}

test('mark', async ({ context, extension, fake, seed }) => {
  const read = async (theme: Theme) => {
    await prepare({ extension, fake, seed }, 'en', theme);
    const page = await openInstagram(context);
    const composer = await openStory(page, 'en', theme);
    const mark = await composer.locator('.d-mark svg').evaluate((svg) => {
      const attrs = (el: Element | null) =>
        Object.fromEntries(Array.from(el?.attributes ?? [], (a) => [a.name, a.value]));
      const dot = svg.querySelector('.mark-dot') as Element;
      return {
        rect: attrs(svg.querySelector('rect')),
        path: svg.querySelector('path')?.getAttribute('d') ?? '',
        dot: attrs(dot),
        ring: Number.parseFloat(getComputedStyle(dot).strokeWidth),
        stroke: svg.getAttribute('stroke-width') ?? '',
        dotFill: getComputedStyle(dot).fill,
        ink: getComputedStyle(svg).color,
      };
    });
    await page.close();
    return mark;
  };
  const light = await read('light');
  const dark = await read('dark');
  const hex = (c: string): string =>
    `#${(c.match(/\d+/g) ?? [])
      .slice(0, 3)
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')}`;
  const { rect, path, dot, ring, stroke } = light;
  const shapes = `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${rect.rx}"/><path d="${path}"/>`;
  const svgOpen = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="256" height="256" fill="none">';
  // The dot's ring is the surface colour in the app; here it is cut out, so the mark sits on any background.
  const mark = `${svgOpen}
  <title>instapost</title>
  <style>
    :root { color: ${hex(light.ink)} }
    .dot { fill: ${hex(light.dotFill)} }
    @media (prefers-color-scheme: dark) {
      :root { color: ${hex(dark.ink)} }
      .dot { fill: ${hex(dark.dotFill)} }
    }
  </style>
  <mask id="ring"><rect width="24" height="24" fill="#fff"/><circle cx="${dot.cx}" cy="${dot.cy}" r="${Number(dot.r) + ring / 2}" fill="#000"/></mask>
  <g mask="url(#ring)" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>
  <circle class="dot" cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}"/>
</svg>
`;
  const hexOf = (c: readonly number[]): string => `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  const tile = hexOf(MARK_COLOURS.tile);
  // tools/icons/mark.ts: the toolbar icon. A dark tile, the mark at 78 % of it, the stroke of a 32-px icon.
  const markTile = `${svgOpen}
  <title>instapost</title>
  <rect width="24" height="24" rx="5.4" fill="${tile}"/>
  <g transform="translate(12 12) scale(.78) translate(-12 -12)">
    <g stroke="${hexOf(MARK_COLOURS.stroke)}" stroke-width="${strokeUnits(32)}" stroke-linecap="round" stroke-linejoin="round">${shapes}</g>
    <circle cx="${dot.cx}" cy="${dot.cy}" r="${Number(dot.r) + 2}" fill="${tile}"/>
    <circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}" fill="${hexOf(MARK_COLOURS.dot)}"/>
  </g>
</svg>
`;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'mark.svg'), mark);
  writeFileSync(join(OUT, 'mark-tile.svg'), markTile);
});
