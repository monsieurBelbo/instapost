/**
 * Where instapost's entry goes on Instagram's desktop page (inpage-ui-spec.md FE1–FE5, AN3, AN4, AN7). DOM
 * reads only, structural (no text, no ARIA labels, no class names: a Spanish UI and renamed classes look
 * the same); the content script draws its own row over the result, in its own host, never inside
 * Instagram's navigation.
 *
 * 1. The navigation: the smallest element that contains links to at least two of /explore/, /reels/ and
 *    /direct/inbox/, at most 400 px wide, touching the viewport's left edge (left ≤ 16; the right edge when
 *    the page is right to left, RL-9); then its column: the highest ancestor that is still that narrow and
 *    at that edge (it holds the bottom group, More).
 * 2. Its items: the column's outermost pressables holding an svg or an image (`a[href]`, `[role=link]`,
 *    `[role=button]`), in document order.
 * 3. Profile: the account link (`/<handle>/` holding an image, C14's rule).
 * 4. FE1: a row 8 px below Profile when the free gap below it (up to the next item, or the column's
 *    bottom) is at least the row pitch + 8. FE2: else 8 px above the item that follows the largest such gap
 *    further down (More's group). A collapsed navigation (< 180 wide) gets a 48×48 tile in the same column.
 * 5. FE4: no navigation, a viewport at least 768 wide and a route that has one: a 40-px corner button at the
 *    top right (top left right to left). FE5: none (narrow viewport, login, story viewer); FX7: none on a login wall (isLoginWall).
 */
import { isValidHandle } from '../core/ig-contract/account.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type EntryKind = 'row' | 'tile' | 'corner' | 'none';

export interface EntryPlace {
  kind: EntryKind;
  /** Where the entry goes (viewport). */
  rect: Rect;
  /** Free height from rect.y down to the next control (the chip needs 84). */
  room: number;
  /** The navigation is wide (labels shown). */
  wide: boolean;
}

const NAV_PATHS = ['/explore/', '/reels/', '/direct/inbox/'];
const PRESSABLE = 'a[href], [role="link"], [role="button"], button';
export const NAV_MAX_W = 400;
export const NAV_WIDE_MIN_W = 180;
export const ROW_H = 48;
export const TILE = 48;
export const CORNER = 40;
export const CORNER_INSET = 16;
export const MIN_VIEWPORT_W = 768;
const DEFAULT_PITCH = 52;

export const NONE: EntryPlace = { kind: 'none', rect: { x: 0, y: 0, w: 0, h: 0 }, room: 0, wide: false };

function pathOf(a: Element): string | null {
  const href = a.getAttribute('href');
  if (href === null || href === '' || href.startsWith('#')) return null;
  try {
    return new URL(href, 'https://www.instagram.com/').pathname;
  } catch {
    return null;
  }
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

/**
 * RL-9: Instagram mirrors its desktop layout in right-to-left languages (Arabic, Hebrew, Persian, Urdu): the
 * navigation sits at the right edge then. Read from the document's direction (structural, no text).
 */
export function isRtl(doc: Document): boolean {
  const el = doc.documentElement;
  if ((el.getAttribute('dir') ?? '').toLowerCase() === 'rtl') return true;
  return doc.defaultView?.getComputedStyle(el).direction === 'rtl';
}

/** At the viewport's start edge: the left one (left ≤ 16), or the right one right to left. */
function atStartEdge(r: Rect, rtl: boolean, viewportW: number): boolean {
  return rtl ? r.x + r.w >= viewportW - 16 : r.x <= 16;
}

const viewportWidth = (doc: Document): number =>
  doc.documentElement.clientWidth || doc.defaultView?.innerWidth || Number.POSITIVE_INFINITY;

/** The navigation element (step 1), or null. */
export function findNav(doc: Document): Element | null {
  const rtl = isRtl(doc);
  const vw = viewportWidth(doc);
  const links = Array.from(doc.querySelectorAll('a[href]')).filter((a) => NAV_PATHS.includes(pathOf(a) ?? ''));
  let best: Element | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const link of links) {
    for (let el: Element | null = link.parentElement; el && el !== doc.documentElement; el = el.parentElement) {
      const seen = new Set(
        Array.from(el.querySelectorAll('a[href]'))
          .map(pathOf)
          .filter((p): p is string => p !== null && NAV_PATHS.includes(p)),
      );
      if (seen.size < 2) continue;
      const r = rectOf(el);
      if (r.w <= 0 || r.h <= 0 || r.w > NAV_MAX_W || !atStartEdge(r, rtl, vw)) break;
      const area = r.w * r.h;
      if (area < bestArea) {
        best = el;
        bestArea = area;
      }
      break;
    }
  }
  return best;
}

/** The navigation's column (step 1): its highest ancestor that is still narrow and at the start edge. */
export function navColumn(nav: Element, viewportH: number): Element {
  const rtl = isRtl(nav.ownerDocument);
  const vw = viewportWidth(nav.ownerDocument);
  let col = nav;
  for (let el = nav.parentElement; el && el !== el.ownerDocument.body; el = el.parentElement) {
    const r = rectOf(el);
    if (r.w <= 0 || r.w > NAV_MAX_W || !atStartEdge(r, rtl, vw) || r.h > viewportH + 2) break;
    col = el;
  }
  return col;
}

/** The column's outermost pressables holding an svg or an image (step 2). */
export function navItems(nav: Element): Element[] {
  const all = Array.from(nav.querySelectorAll(PRESSABLE)).filter((el) => el.querySelector('svg, img') !== null);
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

/** The account link: `/<handle>/` holding an image (C14). */
export function isAccountLink(el: Element): boolean {
  const p = pathOf(el);
  if (p === null || el.querySelector('img') === null) return false;
  const seg = p.split('/').filter(Boolean);
  return seg.length === 1 && isValidHandle(seg[0]);
}

/** Profile (step 3): the last account link among the items, or null. */
export function findProfile(items: readonly Element[]): Element | null {
  return items.filter(isAccountLink).at(-1) ?? null;
}

/** The handle in Profile's link, if any. */
export function profileHandle(profile: Element | null): string | null {
  if (!profile) return null;
  const seg = (pathOf(profile) ?? '').split('/').filter(Boolean);
  return seg.length === 1 && isValidHandle(seg[0]) ? (seg[0] as string) : null;
}

/** Routes that have no navigation by design (FE5): login, checkpoints, the story viewer. */
export function routeWithoutNav(path: string): boolean {
  return /^\/(accounts|challenge|stories)\//.test(path);
}

/**
 * FX7 (RL-6): Instagram's login wall, which it serves at `/` (and elsewhere) to a logged-out visitor: a password
 * field and no account link anywhere on the page. Structural only (no text): a logged-in page always has the
 * owner's account link in its navigation.
 */
export function isLoginWall(doc: Document): boolean {
  if (doc.querySelector('input[type="password"]') === null) return false;
  return !Array.from(doc.querySelectorAll('a[href]')).some(isAccountLink);
}

/**
 * Steps 3–5 for a found column (or none): the entry's place. `viewport` is the layout viewport (CSS px).
 * The caller still checks occlusion (FE7) before it shows the entry.
 */
export function entryPlace(
  column: Element | null,
  viewport: { w: number; h: number },
  path: string,
  show: boolean,
  opts: { loginWall?: boolean; rtl?: boolean } = {},
): EntryPlace {
  if (!show || viewport.w < MIN_VIEWPORT_W) return NONE;
  if (!column) {
    // FX7: no entry on a login wall (the composer, opened from the toolbar, says to log in first).
    if (routeWithoutNav(path) || opts.loginWall) return NONE;
    // RL-9: the corner mirrors right to left (Instagram's own top bar mirrors too).
    const x = opts.rtl ? CORNER_INSET : viewport.w - CORNER_INSET - CORNER;
    return {
      kind: 'corner',
      rect: { x, y: CORNER_INSET, w: CORNER, h: CORNER },
      room: 0,
      wide: false,
    };
  }
  const items = navItems(column);
  const profile = findProfile(items);
  if (!profile) return NONE;
  const col = rectOf(column);
  const p = rectOf(profile);
  if (p.w <= 0 || p.h <= 0) return NONE;
  const wide = col.w >= NAV_WIDE_MIN_W;
  const rowH = ROW_H;
  const idx = items.indexOf(profile);
  const prev = idx > 0 ? items[idx - 1] : undefined;
  const prevTop = prev ? rectOf(prev).y : Number.NaN;
  const pitch = prev && p.y - prevTop >= 40 && p.y - prevTop <= 72 ? p.y - prevTop : DEFAULT_PITCH;
  const width = wide ? Math.round(p.w) : TILE;
  const x = wide ? Math.round(p.x) : Math.round(p.x + (p.w - TILE) / 2);
  const bottom = Math.min(col.y + col.h, viewport.h);
  // The items below Profile, top to bottom, and the gaps between them.
  const below = items
    .slice(idx + 1)
    .map(rectOf)
    .filter((r) => r.h > 0 && r.y >= p.y + p.h - 1)
    .sort((a, b) => a.y - b.y);
  const firstTop = below[0]?.y ?? bottom;
  const need = pitch + 8;
  const kind: EntryKind = wide ? 'row' : 'tile';
  const h = wide ? rowH : TILE;
  if (firstTop - (p.y + p.h) >= need) {
    const y = Math.round(p.y + p.h + 8);
    return { kind, rect: { x, y, w: width, h }, room: Math.round(firstTop - y), wide };
  }
  // FE2: the largest gap further down, bottom-aligned 8 px above the item that follows it.
  let best: { top: number; after: number } | null = null;
  for (let i = 0; i + 1 < below.length; i++) {
    const a = below[i] as Rect;
    const b = below[i + 1] as Rect;
    const gap = b.y - (a.y + a.h);
    if (gap >= need && (!best || gap > best.after - best.top)) best = { top: a.y + a.h, after: b.y };
  }
  if (best) {
    const y = Math.round(best.after - 8 - h);
    return { kind, rect: { x, y, w: width, h }, room: Math.round(best.after - y), wide };
  }
  return NONE;
}

/** Whether `el` is (inside) one of Instagram's controls: a pressable, a field or media. */
export function isControl(el: Element): boolean {
  return el.closest('a[href], button, [role="button"], [role="link"], input, textarea, select, video') !== null;
}
