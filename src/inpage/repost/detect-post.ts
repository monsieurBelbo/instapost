/**
 * Repost (docs/repost.md RP-5 steps 2–4, RP-13, RP-15, RP-16): from the owner's click on Instagram's own
 * Share control to a post's metadata, read at click time. Structural reads only (svg paths, links, times,
 * images, rects; the label fallback lives in words.ts): any language. Reads never become writes (RP-17): no
 * click, focus, dispatch, storage, network or navigation.
 *
 * 1. The Share control: the first `button` / `[role=button]` in the click's path holding the Share glyph
 *    (or, failing that, an svg labelled Share).
 * 2. Its action bar: at most 6 ancestors up, the first holding exactly one rendered Like glyph and a Comment
 *    or Repost glyph (this rejects the sidebar's Messages and Notifications).
 * 3. The post root: the bar's `article`, else its `[role=dialog]`, else `main`; it must hold a permalink.
 * 4. The metadata: code, author (the header's first profile link; the owner on collab posts), the author's
 *    avatar (none when a collab header's avatars cannot be told apart), the
 *    visible media (the carousel slide whose centre is in the clip, else the largest visible image or video),
 *    its CDN candidates and aspect; the SSR sharing flags.
 */
import { isValidHandle } from '../../core/ig-contract/account.ts';
import { isCdnImageUrl } from '../../core/repost/cdn-url.ts';
import { imgIndexOf, postPathOf, profilePathHandle } from '../../core/repost/paths.ts';
import { clampAspect } from '../../core/repost/source.ts';
import { type Candidate, pickCandidates } from '../../core/repost/srcset.ts';
import { type ReshareVerdict, reshareFlags } from '../../core/repost/ssr-flags.ts';
import { BAR_PEER_PATHS, LIKE_PATHS, SHARE_PATHS } from './glyphs.ts';
import { hasShareLabel } from './words.ts';

const PRESSABLE = 'button, [role="button"]';
const BAR_DEPTH = 6;
/** Pressables looked at in the click's path before giving up (the control is the innermost). */
const PATH_PRESSABLES = 3;
const MIN_MEDIA_W = 200;
const MAX_AVATAR = 64;

export interface PostFacts {
  code: string;
  author: string;
  avatar: string | null;
  media: Candidate[];
  aspect: number;
  slide: number | null;
  video: boolean;
  isOwn: boolean;
  consent: ReshareVerdict;
}

export type PostRead = { ok: true; post: PostFacts; control: Element; root: Element } | { ok: false; why: string };

const rendered = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** Step 1: the Share control in a click's composed path, or null. */
export function shareControlIn(path: readonly EventTarget[]): Element | null {
  let seen = 0;
  for (const t of path) {
    if (!(t instanceof Element) || !t.matches(PRESSABLE)) continue;
    if (++seen > PATH_PRESSABLES) return null;
    // A pressable holding a Like glyph is a container of several controls, not the Share control.
    if (t.querySelector(LIKE_PATHS)) return null;
    if (t.querySelector(SHARE_PATHS) || hasShareLabel(t)) return t;
  }
  return null;
}

const renderedCount = (el: Element, sel: string): number =>
  Array.from(el.querySelectorAll(sel)).filter((p) => rendered(p.closest('svg') ?? p)).length;

/** Step 2: the action bar holding `control`, or null. */
export function actionBarOf(control: Element): Element | null {
  let el = control.parentElement;
  for (let i = 0; el && i < BAR_DEPTH; i++, el = el.parentElement) {
    if (renderedCount(el, LIKE_PATHS) === 1 && el.querySelector(BAR_PEER_PATHS) !== null) return el;
    if (renderedCount(el, LIKE_PATHS) > 1) return null;
  }
  return null;
}

/** Step 3: the post root around an action bar. */
export function postRootOf(bar: Element): Element {
  return bar.closest('article') ?? bar.closest('[role="dialog"]') ?? bar.ownerDocument.querySelector('main') ?? bar;
}

function anchorPath(a: Element): { path: string; search: string } | null {
  if (!(a instanceof HTMLAnchorElement)) return null;
  if (a.host !== '' && a.host !== a.ownerDocument.location.host) return null;
  return { path: a.pathname, search: a.search };
}

/** The post's permalink in its root: a link holding a `time[datetime]`, else the page's own URL (modal, permalink). */
export function permalinkOf(root: Element): { kind: 'p' | 'reel' | 'tv'; code: string; slide: number | null } | null {
  for (const t of Array.from(root.querySelectorAll('a[href] time[datetime]'))) {
    const a = t.closest('a');
    const at = a ? anchorPath(a) : null;
    const ref = at ? postPathOf(at.path) : null;
    if (ref) return { ...ref, slide: imgIndexOf(at?.search ?? '') };
  }
  if (root.tagName !== 'ARTICLE') {
    const loc = root.ownerDocument.location;
    const ref = postPathOf(loc.pathname);
    if (ref) return { ...ref, slide: imgIndexOf(loc.search) };
  }
  return null;
}

/** The author: the root header's first `/<handle>/` link. */
export function authorOf(root: Element): string | null {
  for (const a of Array.from(root.querySelectorAll('header a[href]'))) {
    const at = anchorPath(a);
    const h = at ? profilePathHandle(at.path) : null;
    if (h && isValidHandle(h)) return h;
  }
  return null;
}

const srcOf = (img: HTMLImageElement): string => img.currentSrc || img.src;

/**
 * The author's avatar in the header (an image at most 64 px, CDN only), or null. Tied to the author
 * structurally: the one inside the author's `/<handle>/` link; else the header's only avatar. A collab header
 * stacks several avatars in unlinked spans, the first often the collaborator's: then null, and the card draws
 * the author's initial rather than maybe someone else's face.
 */
export function avatarOf(root: Element, author: string): string | null {
  const small: HTMLImageElement[] = [];
  for (const img of Array.from(root.querySelectorAll('header img'))) {
    if (!(img instanceof HTMLImageElement)) continue;
    const r = img.getBoundingClientRect();
    if (r.width <= 0 || r.width > MAX_AVATAR || r.height > MAX_AVATAR) continue;
    if (!isCdnImageUrl(srcOf(img))) continue;
    const a = img.closest('a[href]');
    const at = a ? anchorPath(a) : null;
    if (at && profilePathHandle(at.path)?.toLowerCase() === author.toLowerCase()) return srcOf(img);
    small.push(img);
  }
  return small.length === 1 && small[0] ? srcOf(small[0]) : null;
}

const centreIn = (r: DOMRect, clip: DOMRect): boolean => {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return cx >= clip.left && cx <= clip.right && cy >= clip.top && cy <= clip.bottom;
};

/** The visible media element: the carousel's slide in view, else the largest visible image or video. */
export function visibleMedia(root: Element): HTMLImageElement | HTMLVideoElement | null {
  for (const ul of Array.from(root.querySelectorAll('div[role="presentation"] > div > ul'))) {
    const clip = ul.parentElement?.parentElement;
    if (!clip) continue;
    const cr = clip.getBoundingClientRect();
    if (cr.width <= 0) continue;
    for (const li of Array.from(ul.children)) {
      if (li.tagName !== 'LI' || !centreIn(li.getBoundingClientRect(), cr)) continue;
      const m = li.querySelector('video') ?? li.querySelector('img');
      if (m instanceof HTMLVideoElement || m instanceof HTMLImageElement) return m;
    }
  }
  let best: HTMLImageElement | HTMLVideoElement | null = null;
  let area = 0;
  for (const el of Array.from(root.querySelectorAll('img, video'))) {
    if (!(el instanceof HTMLImageElement || el instanceof HTMLVideoElement)) continue;
    if (el.closest('header')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < MIN_MEDIA_W || r.height <= 0) continue;
    if (r.width * r.height > area) {
      area = r.width * r.height;
      best = el;
    }
  }
  return best;
}

export function aspectOf(el: HTMLImageElement | HTMLVideoElement): number {
  if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
    return clampAspect(el.naturalWidth / el.naturalHeight);
  }
  const r = el.getBoundingClientRect();
  return clampAspect(r.height > 0 ? r.width / r.height : 1);
}

/** The SSR scripts' texts, lazily (reshareFlags stops after 8 matches or 4 MB). */
function* ssrTexts(doc: Document): Generator<string> {
  for (const s of Array.from(doc.querySelectorAll('script[type="application/json"][data-sjs]'))) {
    yield s.textContent ?? '';
  }
}

/** Steps 1–4 for a click's path. `me` is the account the page shows (RP-15). */
export function readPostClick(path: readonly EventTarget[], me: string | null): PostRead | null {
  const control = shareControlIn(path);
  if (!control) return null;
  const bar = actionBarOf(control);
  if (!bar) return null;
  return readPost(postRootOf(bar), control, me);
}

export function readPost(root: Element, control: Element, me: string | null): PostRead {
  const link = permalinkOf(root);
  if (!link) return { ok: false, why: 'no-permalink' };
  const author = authorOf(root);
  if (!author) return { ok: false, why: 'no-author' };
  const el = visibleMedia(root);
  if (!el) return { ok: false, why: 'no-media' };
  const video = el instanceof HTMLVideoElement || link.kind === 'reel' || link.kind === 'tv';
  const media =
    el instanceof HTMLImageElement ? pickCandidates(el.getAttribute('srcset'), srcOf(el), el.naturalWidth) : [];
  if (!video && media.length === 0) return { ok: false, why: 'no-cdn-media' };
  const isOwn = me !== null && author.toLowerCase() === me.toLowerCase();
  const doc = root.ownerDocument;
  return {
    ok: true,
    control,
    root,
    post: {
      code: link.code,
      author,
      avatar: avatarOf(root, author),
      media,
      aspect: aspectOf(el),
      slide: link.slide,
      video,
      isOwn,
      consent: video ? 'unknown' : reshareFlags(ssrTexts(doc), link.code, isOwn),
    },
  };
}
