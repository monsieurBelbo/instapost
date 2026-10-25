/**
 * Repost (docs/repost.md RP-9, RP-10, RP-14): stories that mention the owner.
 *
 * - In a DM thread (`/direct/t/<id>/`): a `/stories/<user>/<pk>/` link wrapping an image, confirmed as a
 *   mention by its message row's wording (words.ts, the one text table: walking up at most 8 ancestors and
 *   stopping at one that holds a second story link). Not the owner's own story; a video or a story over
 *   24 h old (the row's `time[datetime]`) gives a disabled pill. Story replies and shared stories render the
 *   same link without the wording: no pill. Expired stories render a placeholder without a link: no pill.
 * - In the story viewer (`/stories/<user>/<pk>/`, only for a mention seen in the DM): the largest visible
 *   `section img` (at least 200 wide); a `section video` disables the pill; `section time[datetime]` the age.
 */
import { isCdnImageUrl } from '../../core/repost/cdn-url.ts';
import { storyPathOf } from '../../core/repost/paths.ts';
import { clampAspect } from '../../core/repost/source.ts';
import { type Candidate, pickCandidates } from '../../core/repost/srcset.ts';
import { mentionedIn } from './words.ts';

const STORY_LINK = 'a[href*="/stories/"]';
const ROW_DEPTH = 8;
const MIN_VIEWER_W = 200;

export interface MentionHit {
  key: string;
  user: string;
  pk: string;
  anchor: Element;
  img: HTMLImageElement | null;
  video: boolean;
  /** The row's age (ms) from its time element, or null. */
  ageMs: number | null;
}

export const mentionKey = (user: string, pk: string): string => `${user.toLowerCase()}/${pk}`;

function storyRef(a: Element): { user: string; pk: string } | null {
  if (!(a instanceof HTMLAnchorElement)) return null;
  if (a.host !== '' && a.host !== a.ownerDocument.location.host) return null;
  return storyPathOf(a.pathname);
}

/** The `time[datetime]` age (ms) under `el`, or null. */
export function ageOf(el: Element | null, now: number): number | null {
  const t = el?.querySelector('time[datetime]');
  const at = Date.parse(t?.getAttribute('datetime') ?? '');
  return Number.isFinite(at) ? Math.max(0, now - at) : null;
}

/** The message row confirming a mention, or null (not a mention, or not readable). */
export function mentionRow(anchor: Element): Element | null {
  let el = anchor.parentElement;
  for (let i = 0; el && i < ROW_DEPTH; i++, el = el.parentElement) {
    if (el.querySelectorAll(STORY_LINK).length > 1) return null;
    if (mentionedIn(el)) return el;
  }
  return null;
}

/** RP-9: the story mentions in a DM thread, not the owner's own. */
export function scanMentions(scope: Element, me: string | null, now: number): MentionHit[] {
  const out: MentionHit[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(scope.querySelectorAll(STORY_LINK))) {
    const media = a.querySelector('img, video');
    if (!media) continue;
    const ref = storyRef(a);
    if (!ref) continue;
    if (me !== null && ref.user.toLowerCase() === me.toLowerCase()) continue;
    const row = mentionRow(a);
    if (!row) continue;
    const key = mentionKey(ref.user, ref.pk);
    if (seen.has(key)) continue;
    seen.add(key);
    const img = a.querySelector('img');
    out.push({
      key,
      user: ref.user,
      pk: ref.pk,
      anchor: a,
      img: img instanceof HTMLImageElement ? img : null,
      video: a.querySelector('video') !== null,
      ageMs: ageOf(row, now),
    });
  }
  return out;
}

/** The media candidates and aspect of a story image (preview or viewer). */
export function storyMedia(img: HTMLImageElement | null): { media: Candidate[]; aspect: number; w: number } {
  if (!img) return { media: [], aspect: 9 / 16, w: 0 };
  const src = img.currentSrc || img.src;
  const media = pickCandidates(img.getAttribute('srcset'), isCdnImageUrl(src) ? src : null, img.naturalWidth);
  const r = img.getBoundingClientRect();
  const aspect =
    img.complete && img.naturalWidth > 0 && img.naturalHeight > 0
      ? img.naturalWidth / img.naturalHeight
      : r.height > 0
        ? r.width / r.height
        : 9 / 16;
  return { media, aspect: clampAspect(aspect), w: r.width };
}

export interface ViewerMedia {
  img: HTMLImageElement | null;
  video: boolean;
  rect: DOMRect | null;
  ageMs: number | null;
}

/** RP-10: the story the viewer shows: its largest visible image, or a video. */
export function viewerMedia(doc: Document, now: number): ViewerMedia {
  let best: HTMLImageElement | null = null;
  let area = 0;
  let rect: DOMRect | null = null;
  for (const img of Array.from(doc.querySelectorAll('section img'))) {
    if (!(img instanceof HTMLImageElement)) continue;
    const r = img.getBoundingClientRect();
    if (r.width < MIN_VIEWER_W || r.height <= 0) continue;
    if (r.width * r.height > area) {
      area = r.width * r.height;
      best = img;
      rect = r;
    }
  }
  let video = false;
  for (const v of Array.from(doc.querySelectorAll('section video'))) {
    const r = v.getBoundingClientRect();
    if (r.width >= MIN_VIEWER_W && r.width * r.height >= area) {
      video = true;
      rect = r;
    }
  }
  return { img: video ? null : best, video, rect, ageMs: ageOf(doc.querySelector('section'), now) };
}
