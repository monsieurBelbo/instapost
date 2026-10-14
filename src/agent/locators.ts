/**
 * Structural locators for the autopilot (ux.md §10, docs/contract.md C10–C14, IA1). DOM reads only, and
 * structural only: element types, roles, attributes, geometry and the few class names Instagram's own
 * composer module sets (`_aa3b`, `_aa3c`, `_aa3d`, `_aa3k`), each with a structural fallback. Never visible
 * text or ARIA labels (the owner may use a Spanish UI; the + link's aria-label is even Instagram's "Home"
 * string, by a bug of theirs), never test hooks.
 *
 * Where they come from (Instagram's saved, logged-out msite bundles, 2026-10-13):
 * - Entry (PolarisMobileCreationNavItem): a 48 px box holding the popover trigger (the +, an svg in a link)
 *   and, in the next box, the story form (`form[role=presentation]` around the image-only story input,
 *   C4) and the post form (accept `image/jpeg`).
 * - Menu: the lazy popover (PolarisMobileCreationMenuPopover, not readable logged out, unverified L18) is
 *   a new `[role=dialog]` with two items: Story (handleStoryCreationClick → startStoryCreationSession →
 *   the story input's click()) and Post (the post input's click()).
 * - Composer (PolarisStoryImageCreationContainer): `canvas._aa3c` (0×0 until the photo is drawn),
 *   `header._aa3d`, the landscape snackbar `._aa3b`, the trash footer `footer._aa3k`, and the Share
 *   footer: a `footer` with one `button` (ShareFooter) or one `[role=button]` holding the account's avatar
 *   and, when Instagram cross-posts to Facebook automatically, a badge svg (ShareFooterV2).
 * - Account (PolarisProfileNavItem): the navigation's link to `/<username>/`.
 */
import { isValidHandle } from '../core/ig-contract/account.ts';
import { type AgentWindow, findStoryInput, isComposerPath, isShown, largestCanvas } from './probes.ts';

/** What counts as something a person can press. */
export const PRESSABLE = 'button, [role="button"], a[href], [role="link"], [role="menuitem"]';

export function isPressable(el: Element): boolean {
  return el.matches(PRESSABLE);
}

/** The outermost pressables under `root`: a pressable inside another one (an icon in a button) does not count. */
export function pressables(root: Element): Element[] {
  return Array.from(root.querySelectorAll(PRESSABLE)).filter((el) => {
    for (let p = el.parentElement; p !== null && p !== root; p = p.parentElement) if (isPressable(p)) return false;
    return true;
  });
}

const hasGlyph = (el: Element): boolean => el.tagName.toLowerCase() === 'svg' || el.querySelector('svg') !== null;

export interface EntryParts {
  /** The C4 story input, which Story arms (its click). */
  storyInput: HTMLInputElement;
  /** The post input beside it (a wrong Story item clicks this one), or null. */
  postInput: HTMLInputElement | null;
  /** The + (Create) pressable. */
  plus: HTMLElement;
  /** The box that holds it (the tap helper's containment for +). */
  box: Element;
}

export type EntryLookup = { ok: true; parts: EntryParts } | { ok: false; why: 'no-input' | 'no-plus' | 'ambiguous' };

/** How far up from the forms' box the + is looked for (its previous sibling box, then theirs). */
export const ENTRY_MAX_ANCESTORS = 4;

/**
 * C10: the + beside the story input. From the story input's form, its box's previous sibling holds exactly
 * one pressable with a glyph; failing that, up to ENTRY_MAX_ANCESTORS ancestors are tried the same way.
 * Two or more candidates at a level fail closed (`ambiguous`): instapost never guesses which one is +.
 */
export function findEntry(win: AgentWindow): EntryLookup {
  const storyInput = findStoryInput(win.document);
  if (!storyInput) return { ok: false, why: 'no-input' };
  const form = storyInput.closest('form');
  const holder = (form ?? storyInput).parentElement;
  if (!holder) return { ok: false, why: 'no-plus' };
  const postInput =
    (Array.from(holder.querySelectorAll('input')).find((i) => i.type === 'file' && i !== storyInput) as
      | HTMLInputElement
      | undefined) ?? null;
  let node: Element | null = holder;
  for (let up = 0; node !== null && up <= ENTRY_MAX_ANCESTORS; up++, node = node.parentElement) {
    const prev: Element | null = node.previousElementSibling;
    if (!prev) continue;
    const candidates = (isPressable(prev) ? [prev] : pressables(prev)).filter(hasGlyph);
    if (candidates.length > 1) return { ok: false, why: 'ambiguous' };
    const plus = candidates[0];
    if (plus) return { ok: true, parts: { storyInput, postInput, plus: plus as HTMLElement, box: prev } };
  }
  return { ok: false, why: 'no-plus' };
}

/** The visible `[role=dialog]` elements that were not there before (the + menu), newest last. */
export function newDialogs(win: AgentWindow, before: ReadonlySet<Element>): Element[] {
  return Array.from(win.document.querySelectorAll('[role="dialog"]')).filter((d) => !before.has(d) && isShown(win, d));
}

export function dialogsNow(win: AgentWindow): Set<Element> {
  return new Set(Array.from(win.document.querySelectorAll('[role="dialog"]')));
}

/** fnv1a-32 as 8 hex digits. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const SHAPES = 'path, circle, rect, line, polyline, polygon, ellipse';
const SHAPE_ATTRS = ['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points'];

/** C10: a hash of a menu item's glyph (its svg's viewBox and shape data), or null without an svg. */
export function glyphHash(el: Element): string | null {
  const svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
  if (!svg) return null;
  let data = svg.getAttribute('viewBox') ?? '';
  for (const shape of Array.from(svg.querySelectorAll(SHAPES))) {
    data += `|${shape.tagName.toLowerCase()}`;
    for (const a of SHAPE_ATTRS) {
      const v = shape.getAttribute(a);
      if (v !== null) data += `;${a}=${v}`;
    }
  }
  return fnv1a(data);
}

export interface ComposerState {
  /** The page is on /create/story. */
  onComposer: boolean;
  canvas: HTMLCanvasElement | null;
  /** The canvas has a backing store (Instagram draws the photo into it). */
  drawn: boolean;
  header: boolean;
  /** Instagram's rotate snackbar (C3b failed in the page). */
  landscape: boolean;
  /** The one visible Share footer, or null (none, or several). */
  footer: Element | null;
  footers: number;
  /** Share controls: in the one footer, or across several (ambiguous). */
  controls: Element[];
  variant: 'v1' | 'v2' | null;
  fbAuto: boolean;
}

/** C12: the composer as it is now. */
export function composerState(win: AgentWindow): ComposerState {
  const doc = win.document;
  const onComposer = isComposerPath(win.location.pathname);
  const named = doc.querySelector<HTMLCanvasElement>('canvas._aa3c');
  const canvas = named ?? largestCanvas(win)?.el ?? null;
  const drawn = canvas !== null && canvas.width > 0 && canvas.height > 0;
  const header =
    doc.querySelector('header._aa3d') !== null ||
    Array.from(doc.querySelectorAll('header')).some((h) => isShown(win, h));
  const landscape = Array.from(doc.querySelectorAll('._aa3b')).some((el) => isShown(win, el));
  const footers = Array.from(doc.querySelectorAll('footer')).filter(
    (f) => !f.classList.contains('_aa3k') && isShown(win, f) && pressables(f).length > 0,
  );
  const footer = footers.length === 1 ? (footers[0] ?? null) : null;
  const controls = footers.flatMap((f) => pressables(f).filter((el) => el.matches('button, [role="button"]')));
  const first = controls.length === 1 ? controls[0] : undefined;
  const variant = first ? (first.tagName.toLowerCase() === 'button' ? 'v1' : 'v2') : null;
  const fbAuto = variant === 'v2' && first?.querySelector('svg') != null;
  return { onComposer, canvas, drawn, header, landscape, footer, footers: footers.length, controls, variant, fbAuto };
}

/** The profile handle a link points to (`/<username>/`, relative or on www), or null. */
export function profileHandle(href: string): string | null {
  let path = href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    const m = /^https:\/\/([^/?#]+)(\/[^?#]*)?/i.exec(href);
    if (!m || (m[1] ?? '').toLowerCase() !== 'www.instagram.com') return null;
    path = m[2] ?? '/';
  } else if (!href.startsWith('/')) {
    return null;
  }
  const clean = path.split(/[?#]/)[0] ?? '';
  const m = /^\/([^/]+)\/?$/.exec(clean);
  const seg = m?.[1];
  return seg !== undefined && isValidHandle(seg) ? seg : null;
}

/**
 * C14 (unverified, L18): the account Instagram's navigation names: links to `/<username>/` that hold an
 * avatar or a glyph, outside feed posts (`article`). Links inside a navigation landmark win; one distinct
 * handle is the account, none or several is unreadable (`candidates` counts the distinct handles).
 */
export function readAccount(win: AgentWindow): { handle: string | null; candidates: number } {
  const found: { handle: string; nav: boolean }[] = [];
  for (const a of Array.from(win.document.querySelectorAll('a[href]'))) {
    if (a.closest('article') !== null) continue;
    const handle = profileHandle(a.getAttribute('href') ?? '');
    if (handle === null || a.querySelector('img, svg') === null) continue;
    found.push({ handle, nav: a.closest('nav, [role="navigation"]') !== null });
  }
  const nav = found.filter((c) => c.nav);
  const pool = nav.length > 0 ? nav : found;
  const handles = [...new Set(pool.map((c) => c.handle.toLowerCase()))];
  const one = pool[0];
  if (handles.length === 1 && one) return { handle: one.handle, candidates: 1 };
  return { handle: null, candidates: handles.length };
}

/** ux.md §6.2 corroboration: the toasts (`[role=alert]`) shown now. */
export function alertsNow(win: AgentWindow): Set<Element> {
  return new Set(Array.from(win.document.querySelectorAll('[role="alert"]')));
}

/** A toast that was not there before: none, plain, or with an action button (Instagram's Retry). */
export function newToast(win: AgentWindow, before: ReadonlySet<Element>): 'none' | 'plain' | 'action' {
  let kind: 'none' | 'plain' | 'action' = 'none';
  for (const el of Array.from(win.document.querySelectorAll('[role="alert"]'))) {
    if (before.has(el) || !isShown(win, el)) continue;
    if (el.querySelector('button, [role="button"]') !== null) return 'action';
    kind = 'plain';
  }
  return kind;
}

/** Instagram's "uploading" progress (PolarisSharingProgressModal). */
export function progressShown(win: AgentWindow): boolean {
  return win.document.querySelector('[role="progressbar"]') !== null;
}
