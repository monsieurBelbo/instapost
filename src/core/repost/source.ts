/**
 * Repost (docs/repost.md RP-18, RP-31): what the content script hands the composer (through the background)
 * when the owner clicks Add to story: handles, a shortcode or a story pk, validated CDN URLs, numbers and
 * booleans. No caption, no other text, no bytes, no cookies (AM57). Checked on every hop (isRepostSource).
 *
 * `bar` is diagnostics only (RP-16: the Share dialog's external share bar, seen or not); `RepostMeta` is the
 * run record's `repost` (Details, Copy diagnostics), without any URL.
 */
import { isValidHandle } from '../ig-contract/account.ts';
import { isCdnImageUrl } from './cdn-url.ts';
import { isShortcode, isStoryPk } from './paths.ts';

export type RepostKind = 'post' | 'mention';
export type RepostVia = 'dialog' | 'popover' | 'dm' | 'viewer';
export type RepostConsent = 'allowed' | 'unknown';
export type ShareBar = 'seen' | 'absent' | 'unknown';

export const REPOST_VIAS: readonly RepostVia[] = ['dialog', 'popover', 'dm', 'viewer'];
export const SHARE_BARS: readonly ShareBar[] = ['seen', 'absent', 'unknown'];

export interface RepostMedia {
  url: string;
  w: number;
}

export interface RepostSource {
  kind: RepostKind;
  author: string;
  /** The post's shortcode; null for mentions. */
  code: string | null;
  /** The story's pk; null for posts. */
  storyPk: string | null;
  /** 1–3 candidates, widest first. */
  media: RepostMedia[];
  aspect: number;
  avatar: string | null;
  /** The carousel slide (1..20), diagnostics only. */
  slide: number | null;
  isOwn: boolean;
  /** `blocked` and videos are never sent. */
  consent: RepostConsent;
  via: RepostVia;
  bar: ShareBar;
}

/** The run record's `repost` (RP-31): no URL. */
export interface RepostMeta {
  kind: RepostKind;
  author: string;
  via: RepostVia;
  slide: number | null;
  consent: RepostConsent;
  bar: ShareBar;
  /** The decoded media's width. */
  mediaW: number;
}

export const ASPECT_RANGE = { min: 0.3, max: 2.5 } as const;
export const MAX_MEDIA = 3;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown, lo: number, hi: number): x is number =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const isSlide = (x: unknown): boolean => x === null || isInt(x, 1, 20);

function isMedia(x: unknown): x is RepostMedia[] {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_MEDIA) return false;
  let prev = Number.POSITIVE_INFINITY;
  for (const m of x) {
    if (!isObj(m) || !isCdnImageUrl(m.url) || !isInt(m.w, 0, 10_000)) return false;
    if (m.w > prev) return false;
    prev = m.w;
  }
  return new Set(x.map((m) => (m as RepostMedia).url)).size === x.length;
}

export function isRepostSource(x: unknown): x is RepostSource {
  if (!isObj(x)) return false;
  if (x.kind !== 'post' && x.kind !== 'mention') return false;
  if (!isValidHandle(x.author)) return false;
  if (x.kind === 'post' ? !isShortcode(x.code) || x.storyPk !== null : x.code !== null || !isStoryPk(x.storyPk))
    return false;
  if (!isMedia(x.media)) return false;
  if (typeof x.aspect !== 'number' || !(x.aspect >= ASPECT_RANGE.min && x.aspect <= ASPECT_RANGE.max)) return false;
  if (x.avatar !== null && !isCdnImageUrl(x.avatar)) return false;
  if (!isSlide(x.slide)) return false;
  if (typeof x.isOwn !== 'boolean') return false;
  if (x.consent !== 'allowed' && x.consent !== 'unknown') return false;
  if (!REPOST_VIAS.includes(x.via as RepostVia)) return false;
  if (x.kind === 'post' ? x.via !== 'dialog' && x.via !== 'popover' : x.via !== 'dm' && x.via !== 'viewer')
    return false;
  if (!SHARE_BARS.includes(x.bar as ShareBar)) return false;
  return Object.keys(x).length === 12;
}

export function isRepostMeta(x: unknown): x is RepostMeta {
  if (!isObj(x)) return false;
  return (
    (x.kind === 'post' || x.kind === 'mention') &&
    isValidHandle(x.author) &&
    REPOST_VIAS.includes(x.via as RepostVia) &&
    isSlide(x.slide) &&
    (x.consent === 'allowed' || x.consent === 'unknown') &&
    SHARE_BARS.includes(x.bar as ShareBar) &&
    isInt(x.mediaW, 0, 20_000) &&
    Object.keys(x).length === 7
  );
}

export const clampAspect = (a: number): number =>
  Number.isFinite(a) && a > 0 ? Math.min(ASPECT_RANGE.max, Math.max(ASPECT_RANGE.min, a)) : 1;

/** The run record's facts of a repost (no URL). */
export function repostMeta(src: RepostSource, mediaW: number): RepostMeta {
  return {
    kind: src.kind,
    author: src.author,
    via: src.via,
    slide: src.slide,
    consent: src.consent,
    bar: src.bar,
    mediaW: Math.max(0, Math.min(20_000, Math.round(mediaW))),
  };
}
