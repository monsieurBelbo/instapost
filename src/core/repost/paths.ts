/**
 * Repost (docs/repost.md RP-5, RP-9, RP-10, RP-13): the Instagram paths a repost reads, parsed by hand (src/core
 * has no `URL` global). Pathnames only: the content script hands over `a.pathname` / `location.pathname`.
 *
 * - a post's permalink: `/p/<code>/`, `/<user>/p/<code>/`, `/reel/<code>/`, `/tv/<code>/`;
 * - a story: `/stories/<user>/<pk>/` (a valid handle, a numeric pk);
 * - a DM thread: `/direct/t/<id>/`.
 */
import { isValidHandle } from '../ig-contract/account.ts';

export type PostKind = 'p' | 'reel' | 'tv';

export interface PostRef {
  kind: PostKind;
  code: string;
}

const POST = /^\/(?:([^/]+)\/)?(p|reel|tv)\/([\w-]{5,64})\//;
const STORY = /^\/stories\/([^/]+)\/(\d{5,25})\/?$/;
const DM_THREAD = /^\/direct\/t\/[\w-]{1,64}\/?$/;

export const isShortcode = (x: unknown): x is string => typeof x === 'string' && /^[\w-]{5,64}$/.test(x);
export const isStoryPk = (x: unknown): x is string => typeof x === 'string' && /^\d{5,25}$/.test(x);

/** A post's permalink path, or null (the optional first segment must be a handle). */
export function postPathOf(path: string): PostRef | null {
  const m = POST.exec(path);
  if (!m) return null;
  const user = m[1];
  if (user !== undefined && !isValidHandle(user)) return null;
  return { kind: m[2] as PostKind, code: m[3] as string };
}

/** `/stories/<user>/<pk>/`, or null. */
export function storyPathOf(path: string): { user: string; pk: string } | null {
  const m = STORY.exec(path);
  if (!m) return null;
  const user = m[1] as string;
  // `/stories/highlights/<id>/` is a highlight, never a story that mentions the owner.
  return isValidHandle(user) && user.toLowerCase() !== 'highlights' ? { user, pk: m[2] as string } : null;
}

export const isDmThread = (path: string): boolean => DM_THREAD.test(path);

/** `?img_index=N` (1..20), the carousel slide a permalink names; null otherwise (diagnostics only). */
export function imgIndexOf(search: string): number | null {
  const m = /[?&]img_index=(\d{1,2})(?:&|$)/.exec(search);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 20 ? n : null;
}

/** `/<handle>/` (a profile link, the post header's author), or null. */
export function profilePathHandle(path: string): string | null {
  const seg = path.split('/').filter(Boolean);
  return path.startsWith('/') && path.endsWith('/') && seg.length === 1 && isValidHandle(seg[0])
    ? (seg[0] as string)
    : null;
}
