/**
 * docs/repost.md §11, the pure core: U40 (isCdnImageUrl), U41 (srcset), U42 (paths), U43 (the source
 * guard), U44 (SSR flags), U45 (the entry states), U46 (palette), U47 (card layout), U48 (the look's
 * reducers).
 */
import { describe, expect, it } from 'vitest';
import {
  bitmapSize,
  CARD_CENTRE,
  type CardStyle,
  CREDIT_INSET,
  cardSpec,
  cardXf,
  clampCardCentre,
  clampCardXf,
  creditBox,
  INSIDE_PER_AXIS,
  MARGIN,
  MIN_CREDIT_PX,
  nextLook,
  onCard,
  PAINT_K,
  PHOTO_ASPECT,
  photoCrop,
  SCALE_RANGE,
  userScaleOf,
} from './card-layout.ts';
import { CDN_ORIGINS, isCdnImageUrl } from './cdn-url.ts';
import { cycleLook, defaultLook, isOwnPost, withBg, withCredit, withScale } from './edit.ts';
import { entryEnabled, entryShown, entryState, MENTION_MAX_AGE_MS } from './gate.ts';
import { luminance, palette, rgbOf } from './palette.ts';
import { imgIndexOf, isDmThread, postPathOf, profilePathHandle, storyPathOf } from './paths.ts';
import { isRepostMeta, isRepostSource, type RepostSource, repostMeta } from './source.ts';
import { parseSrcset, pickCandidates } from './srcset.ts';
import { reshareFlags } from './ssr-flags.ts';

const IMG = 'https://scontent-mad1-1.cdninstagram.com/v/t51.2885-15/1_n.jpg?stp=dst-jpg_e35&_nc_ht=x&oh=00_A&oe=6720';
const FB = 'https://instagram.fmad3-1.fna.fbcdn.net/v/t51.29350-15/2_n.jpg?oe=6720';

describe('U40 isCdnImageUrl', () => {
  it('accepts the image CDN over https', () => {
    expect(isCdnImageUrl(IMG)).toBe(true);
    expect(isCdnImageUrl(FB)).toBe(true);
    expect(isCdnImageUrl('https://SCONTENT.cdninstagram.com/a.jpg')).toBe(true);
  });
  it('rejects everything else', () => {
    for (const bad of [
      IMG.replace('https:', 'http:'),
      'https://www.instagram.com/p/abc/',
      'https://i.instagram.com/x.jpg',
      'https://scontent.instagram.com/x.jpg',
      'https://cdninstagram.com.evil.io/x.jpg',
      'https://evilcdninstagram.com/x.jpg',
      'https://cdninstagram.com/x.jpg',
      'https://.cdninstagram.com/x.jpg',
      'https://user:pw@scontent.cdninstagram.com/x.jpg',
      'https://user@scontent.cdninstagram.com/x.jpg',
      'https://scontent.cdninstagram.com:443/x.jpg',
      'https://scontent.cdninstagram.com',
      'https://scontent.cdninstagram.com/',
      'https://scontent.cdninstagram.com/a b.jpg',
      'https://scontent.cdninstagram.com\\@evil.io/x.jpg',
      'data:image/png;base64,AAAA',
      'blob:https://www.instagram.com/123',
      `https://scontent.cdninstagram.com/${'a'.repeat(2048)}`,
      '',
      null,
      42,
    ]) {
      expect(isCdnImageUrl(bad), String(bad)).toBe(false);
    }
  });
  it('the permission patterns are the two CDN origins', () => {
    expect([...CDN_ORIGINS]).toEqual(['https://*.cdninstagram.com/*', 'https://*.fna.fbcdn.net/*']);
  });
});

describe('U41 srcset', () => {
  it('parses, dedupes with currentSrc, sorts widest first, caps at 3, drops non-CDN', () => {
    const set = `${IMG}&a=1 640w, ${IMG}&a=2 750w, https://evil.io/x.jpg 2000w, ${IMG}&a=3 1080w, ${IMG}&a=4 480w`;
    expect(parseSrcset(set).map((c) => c.w)).toEqual([640, 750, 2000, 1080, 480]);
    const got = pickCandidates(set, `${IMG}&a=3`, 1080);
    expect(got.map((c) => c.w)).toEqual([1080, 750, 640]);
    expect(got.every((c) => isCdnImageUrl(c.url))).toBe(true);
    expect(pickCandidates(null, IMG, 828)).toEqual([{ url: IMG, w: 828 }]);
    expect(pickCandidates('', 'https://evil.io/x.jpg', 1080)).toEqual([]);
  });
  it('handles a trailing comma and urls without descriptors', () => {
    expect(parseSrcset(`${IMG},`)).toEqual([{ url: IMG, w: 0 }]);
    expect(parseSrcset(`${IMG} 2x`)).toEqual([{ url: IMG, w: 0 }]);
  });
});

describe('U42 paths', () => {
  it('reads permalinks, stories and DM threads', () => {
    expect(postPathOf('/p/C1aBcDeFgH/')).toEqual({ kind: 'p', code: 'C1aBcDeFgH' });
    expect(postPathOf('/some.user/p/C1aBcDeFgH/')).toEqual({ kind: 'p', code: 'C1aBcDeFgH' });
    expect(postPathOf('/reel/C1aBcDeFgH/')).toEqual({ kind: 'reel', code: 'C1aBcDeFgH' });
    expect(postPathOf('/p/C1aBcDeFgH/c/123/')).toEqual({ kind: 'p', code: 'C1aBcDeFgH' });
    expect(imgIndexOf('?img_index=2')).toBe(2);
    expect(imgIndexOf('?x=1&img_index=21')).toBe(null);
    expect(storyPathOf('/stories/some.user/3456789012345678901/')).toEqual({
      user: 'some.user',
      pk: '3456789012345678901',
    });
    expect(isDmThread('/direct/t/1234567890/')).toBe(true);
    expect(profilePathHandle('/some.user/')).toBe('some.user');
  });
  it('rejects garbage', () => {
    for (const p of ['/p/abc/', '/p/', '/explore/p/C1aBcDeFgH/', '/p/C1aBcDeFgH', '/../p/C1aBcDeFgH/']) {
      expect(postPathOf(p), p).toBe(null);
    }
    expect(storyPathOf('/stories/highlights/123456/')).toBe(null);
    expect(storyPathOf('/stories/user/abc/')).toBe(null);
    expect(isDmThread('/direct/inbox/')).toBe(false);
    expect(profilePathHandle('/explore/')).toBe(null);
    expect(profilePathHandle('/a/b/')).toBe(null);
  });
});

const SRC: RepostSource = {
  kind: 'post',
  author: 'owner',
  code: 'C1aBcDeFgH',
  storyPk: null,
  media: [
    { url: `${IMG}&w=1080`, w: 1080 },
    { url: `${IMG}&w=640`, w: 640 },
  ],
  aspect: 0.8,
  avatar: FB,
  slide: 2,
  isOwn: true,
  consent: 'allowed',
  via: 'dialog',
  bar: 'seen',
};

describe('U43 isRepostSource', () => {
  it('accepts a post and a mention', () => {
    expect(isRepostSource(SRC)).toBe(true);
    expect(
      isRepostSource({
        ...SRC,
        kind: 'mention',
        code: null,
        storyPk: '345678901234',
        via: 'dm',
        avatar: null,
        slide: null,
      }),
    ).toBe(true);
  });
  it('rejects bad shapes, caps and a blocked consent', () => {
    const bad: unknown[] = [
      { ...SRC, consent: 'blocked' },
      { ...SRC, author: '../x' },
      { ...SRC, code: 'x' },
      { ...SRC, storyPk: '123456' },
      { ...SRC, media: [] },
      { ...SRC, media: [...SRC.media, { url: `${IMG}&w=3`, w: 3 }, { url: `${IMG}&w=2`, w: 2 }] },
      { ...SRC, media: [...SRC.media].reverse() },
      { ...SRC, media: [{ url: 'https://www.instagram.com/x.jpg', w: 10 }] },
      { ...SRC, aspect: 3 },
      { ...SRC, avatar: 'https://evil.io/a.jpg' },
      { ...SRC, slide: 0 },
      { ...SRC, via: 'dm' },
      { ...SRC, caption: 'hello' },
      { ...SRC, bar: 'maybe' },
    ];
    for (const b of bad) expect(isRepostSource(b), JSON.stringify(b).slice(0, 80)).toBe(false);
  });
  it('the run record keeps facts, no URL', () => {
    const m = repostMeta(SRC, 1080.4);
    expect(m).toEqual({
      kind: 'post',
      author: 'owner',
      via: 'dialog',
      slide: 2,
      consent: 'allowed',
      bar: 'seen',
      mediaW: 1080,
    });
    expect(isRepostMeta(m)).toBe(true);
    expect(JSON.stringify(m)).not.toMatch(/https?:/);
    expect(isRepostMeta({ ...m, url: IMG })).toBe(false);
  });
});

describe('U44 reshareFlags', () => {
  const blob = (media: object) =>
    JSON.stringify({ require: [[{ data: { items: [{ code: 'C1aBcDeFgH', ...media }] } }]] });
  it('allowed, blocked by each signal, unknown', () => {
    expect(reshareFlags([blob({ can_viewer_reshare: true })], 'C1aBcDeFgH', false)).toBe('allowed');
    expect(reshareFlags([blob({ ig_media_sharing_disabled: true })], 'C1aBcDeFgH', false)).toBe('blocked');
    expect(reshareFlags([blob({ can_viewer_reshare: false })], 'C1aBcDeFgH', false)).toBe('blocked');
    expect(reshareFlags([blob({ can_viewer_reshare: false, can_reshare: true })], 'C1aBcDeFgH', false)).toBe('allowed');
    expect(reshareFlags([blob({ user: { is_private: true } })], 'C1aBcDeFgH', false)).toBe('blocked');
    expect(reshareFlags([blob({ owner: { is_private: true } })], 'C1aBcDeFgH', false)).toBe('blocked');
    expect(reshareFlags([], 'C1aBcDeFgH', false)).toBe('unknown');
    expect(reshareFlags([blob({ ig_media_sharing_disabled: false })], 'C1aBcDeFgH', false)).toBe('allowed');
  });
  it('RV-8: a found object without any sharing flag is unknown, not allowed', () => {
    expect(reshareFlags([blob({ user: { username: 'some.user' }, like_count: 3 })], 'C1aBcDeFgH', false)).toBe(
      'unknown',
    );
    expect(reshareFlags([blob({ owner: { is_private: false } })], 'C1aBcDeFgH', false)).toBe('unknown');
    expect(reshareFlags([blob({ user: { is_private: true } })], 'C1aBcDeFgH', false)).toBe('blocked');
  });
  it('a stale blob of another post is unknown; own posts are allowed; over 4 MB is skipped', () => {
    expect(reshareFlags([blob({ ig_media_sharing_disabled: true })], 'Zz9876543', false)).toBe('unknown');
    expect(reshareFlags([blob({ ig_media_sharing_disabled: true })], 'C1aBcDeFgH', true)).toBe('allowed');
    const huge = `${blob({ ig_media_sharing_disabled: true }).slice(0, -1)},"pad":"${'x'.repeat(4_100_000)}"}`;
    expect(reshareFlags([huge], 'C1aBcDeFgH', false)).toBe('unknown');
    expect(reshareFlags(['{not json "code":"C1aBcDeFgH"'], 'C1aBcDeFgH', false)).toBe('unknown');
  });
});

describe('U45 entry states', () => {
  const base = { pref: true, readable: true, video: false, consent: 'unknown' as const, isOwn: false, busy: false };
  it('the first matching row wins', () => {
    expect(entryState(base)).toBe('ready');
    expect(entryState({ ...base, pref: false, video: true })).toBe('off');
    expect(entryState({ ...base, readable: false, video: true })).toBe('unreadable');
    expect(entryState({ ...base, video: true, busy: true })).toBe('video');
    expect(entryState({ ...base, consent: 'blocked', busy: true })).toBe('blocked');
    expect(entryState({ ...base, consent: 'blocked', isOwn: true })).toBe('ready');
    expect(entryState({ ...base, busy: true })).toBe('busy');
  });
  it('a mention expires at 24 h', () => {
    expect(entryState({ ...base, ageMs: MENTION_MAX_AGE_MS - 1 })).toBe('ready');
    expect(entryState({ ...base, ageMs: MENTION_MAX_AGE_MS })).toBe('expired');
    expect(entryShown('expired')).toBe(true);
    expect(entryEnabled('expired')).toBe(false);
    expect(entryShown('unreadable')).toBe(false);
  });
});

describe('U46 palette', () => {
  const sample = (top: number[], bottom: number[]) => {
    const a = new Uint8ClampedArray(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) a.set([...(y < 8 ? top : bottom), 255], (y * 16 + x) * 4);
    return a;
  };
  it('a flat sample is widened; a ramp keeps its colours (15% toward black)', () => {
    const flat = palette(sample([128, 128, 128], [128, 128, 128]));
    expect(flat.from).not.toBe(flat.to);
    expect(Math.abs(luminance(rgbOf(flat.from)) - luminance(rgbOf(flat.to)))).toBeGreaterThan(0.02);
    const ramp = palette(sample([255, 255, 255], [0, 0, 0]));
    expect(ramp).toEqual({ from: '#d9d9d9', to: '#000000' });
    for (const p of [flat, ramp]) expect(p.from).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('U47 card layout', () => {
  const aspects = [4 / 5, 1, 1.91, 3 / 4, 9 / 16];
  it('each style × aspect: clamped photo, credit ≥ 24 px at the minimum scale, bitmap margins', () => {
    for (const style of ['card', 'photo', 'dark'] as const) {
      for (const a of aspects) {
        for (const credit of [true, false]) {
          const s = cardSpec(style, a, credit, 'post');
          expect(s.w).toBe(800);
          expect(s.photo.aspect).toBeGreaterThanOrEqual(PHOTO_ASPECT.min);
          expect(s.photo.aspect).toBeLessThanOrEqual(PHOTO_ASPECT.max);
          expect(s.creditPx * SCALE_RANGE.post.min).toBeGreaterThanOrEqual(MIN_CREDIT_PX);
          const bm = bitmapSize(s);
          expect(bm.w).toBe(Math.ceil((s.w + 2 * MARGIN) * PAINT_K));
          expect(bm.h).toBe(Math.ceil((s.h + 2 * MARGIN) * PAINT_K));
          if (credit && style !== 'photo') expect(s.header?.handle.size).toBe(34);
          if (!credit) expect(s.header).toBe(null);
          if (style === 'photo') expect(s.plate).toBe(null);
        }
      }
    }
    const story = cardSpec('card', 0.8, false, 'mention');
    expect(story.style).toBe('story');
    expect(story.credit).toBe(true);
    expect([story.w, story.h]).toEqual([864, 1536]);
    expect(story.creditPx * SCALE_RANGE.mention.min).toBeGreaterThanOrEqual(MIN_CREDIT_PX);
  });
  it('cardXf shows the card at its user scale; the clamp keeps it in range and in the frame', () => {
    const s = cardSpec('card', 4 / 5, true, 'post');
    const xf = cardXf(s, 1, CARD_CENTRE.post);
    expect(userScaleOf(s, xf.scale)).toBeCloseTo(1, 6);
    // On-story width: the bitmap (card + margins) at user scale 1.
    const bm = bitmapSize(s);
    const base = Math.min(1080 / bm.w, 1920 / bm.h);
    expect(bm.w * base * xf.scale).toBeCloseTo(bm.w / PAINT_K, 3);
    const far = clampCardXf({ cx: 5000, cy: -5000, scale: xf.scale * 10, rotDeg: 0 }, s);
    expect(userScaleOf(s, far.scale)).toBeCloseTo(SCALE_RANGE.post.max, 6);
    expect(far.cx).toBeLessThanOrEqual(1080);
    expect(far.cy).toBeGreaterThanOrEqual(0);
    const c = clampCardCentre({ x: 1080, y: 1920 }, s, 1);
    expect(1080 - (c.x - s.w / 2)).toBeGreaterThanOrEqual(0.7 * s.w);
    expect(onCard(s, xf, { x: 540, y: 900 })).toBe(true);
    expect(onCard(s, xf, { x: 20, y: 20 })).toBe(false);
  });
  it('RV-1: the credit stays whole in the frame, clear of the bars, whatever the drag, scale, look or aspect', () => {
    const far = [
      [5000, 900],
      [-5000, 900],
      [540, 5000],
      [540, -5000],
      [5000, 5000],
      [-5000, -5000],
      [5000, -5000],
      [-5000, 5000],
    ] as const;
    const cases: [CardStyle, 'post' | 'mention', number][] = [];
    for (const style of ['card', 'dark', 'photo'] as const)
      for (const a of [4 / 5, 1, 1.91, 3 / 4]) cases.push([style, 'post', a]);
    cases.push(['story', 'mention', 9 / 16]);
    for (const [style, kind, a] of cases) {
      const s = cardSpec(style, a, true, kind);
      const range = SCALE_RANGE[kind];
      // The painter's measured width, and none (the widest the credit can be).
      for (const drawnW of [null, 120, 400, 10_000]) {
        const credit = creditBox(s, drawnW);
        expect(credit, `${style} has a credit`).not.toBe(null);
        if (!credit) continue;
        for (const u of [range.min, 1, range.max]) {
          for (const [x, y] of far) {
            const xf = clampCardXf({ ...cardXf(s, u, { x, y }), rotDeg: 0 }, s, credit);
            const k = userScaleOf(s, xf.scale);
            const left = xf.cx - (s.w * k) / 2 + credit.x * k;
            const top = xf.cy - (s.h * k) / 2 + credit.y * k;
            const at = `${style} ${a.toFixed(2)} u=${u} w=${drawnW} → (${x}, ${y})`;
            expect(left, at).toBeGreaterThanOrEqual(CREDIT_INSET.side - 1e-6);
            expect(left + credit.w * k, at).toBeLessThanOrEqual(1080 - CREDIT_INSET.side + 1e-6);
            expect(top, at).toBeGreaterThanOrEqual(CREDIT_INSET.top - 1e-6);
            expect(top + credit.h * k, at).toBeLessThanOrEqual(1920 - CREDIT_INSET.bottom + 1e-6);
            // The area rule still holds on the axis the credit does not pin.
            const inX = Math.min(1080, xf.cx + (s.w * k) / 2) - Math.max(0, xf.cx - (s.w * k) / 2);
            expect(inX / (s.w * k), at).toBeGreaterThanOrEqual(INSIDE_PER_AXIS - 1e-6);
          }
        }
      }
      // The default placement already satisfies it (the clamp never moves a fresh card).
      const box = creditBox(s, null);
      expect(clampCardCentre(CARD_CENTRE[kind], s, 1, box), `${style} ${a} default`).toEqual(CARD_CENTRE[kind]);
    }
    // Credit off (own posts): no credit box, the area rule only.
    expect(creditBox(cardSpec('card', 0.8, false, 'post'))).toBe(null);
    expect(creditBox(cardSpec('photo', 0.8, false, 'post'))).toBe(null);
    // The header spans the avatar to the handle's end; the photo style's pill hugs its text.
    const card = cardSpec('card', 0.8, true, 'post');
    expect(creditBox(card, 100)).toEqual({ x: 24, y: 0, w: 72 + 100, h: 104 });
    const photo = cardSpec('photo', 0.8, true, 'post');
    expect(creditBox(photo, 180)).toEqual({ x: 0, y: 1016, w: 180, h: 56 });
    expect(photo.h).toBe(1000 + 16 + 56);
  });
  it('the crop centres, and only outside the range', () => {
    expect(photoCrop({ w: 1080, h: 1350 }, 0.8)).toEqual({ x: 0, y: 0, w: 1080, h: 1350 });
    expect(photoCrop({ w: 1080, h: 1920 }, 0.75)).toEqual({ x: 0, y: 240, w: 1080, h: 1440 });
    expect(photoCrop({ w: 2000, h: 500 }, 1.91).x).toBeCloseTo(522.5, 1);
  });
});

describe('U48 the look', () => {
  it('cycles card → photo → dark; a mention has one look', () => {
    expect(nextLook('card', 'post')).toBe('photo');
    expect(nextLook('photo', 'post')).toBe('dark');
    expect(nextLook('dark', 'post')).toBe('card');
    const m = defaultLook('mention');
    expect(cycleLook(m, 'mention')).toEqual(m);
  });
  it('the credit is locked for others and toggles for own posts', () => {
    const l = defaultLook('post');
    expect(withCredit(l, false, false).credit).toBe(true);
    expect(withCredit(l, false, true).credit).toBe(false);
    expect(isOwnPost({ kind: 'post', isOwn: true, author: 'Owner' }, 'owner')).toBe(true);
    expect(isOwnPost({ kind: 'post', isOwn: true, author: 'owner' }, null)).toBe(false);
    expect(isOwnPost({ kind: 'post', isOwn: true, author: 'owner' }, 'other')).toBe(false);
    expect(isOwnPost({ kind: 'mention', isOwn: true, author: 'owner' }, 'owner')).toBe(false);
    expect(withScale(l, 9, 'post').userScale).toBe(SCALE_RANGE.post.max);
    expect(withBg(l, 'blur').bg).toBe('blur');
  });
});
