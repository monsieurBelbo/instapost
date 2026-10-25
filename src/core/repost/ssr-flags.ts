/**
 * Repost (docs/repost.md RP-16, AM56): the author's sharing choice, when the page says it. On a hard-loaded
 * page Instagram's server-rendered JSON (`script[type="application/json"][data-sjs]`) holds the post's media
 * object. The caller hands the scripts' texts lazily; at most 8 that mention `"code":"<code>"` and at most
 * 4 MB in all are parsed, and the first object whose `code` is the post's decides:
 *
 * - blocked: `ig_media_sharing_disabled === true`, or `can_viewer_reshare === false` without
 *   `can_reshare === true`, or the owner `is_private === true`;
 * - allowed: found, none of those, and at least one flag that says so: `can_viewer_reshare === true`,
 *   `can_reshare === true` or `ig_media_sharing_disabled === false`;
 * - unknown: not found (the usual case for a post opened as an SPA modal), a stale blob of another post, or a
 *   media object that carries none of the sharing flags (a profile grid's thin objects).
 *
 * Own posts are always allowed. Pure.
 */

export type ReshareVerdict = 'allowed' | 'blocked' | 'unknown';

export const SSR_MAX_SCRIPTS = 8;
export const SSR_MAX_BYTES = 4_000_000;
/** How deep the JSON walk goes (Instagram's blobs nest the media around depth 10–20). */
const MAX_DEPTH = 64;
const MAX_NODES = 200_000;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null;

/** The first object (breadth-first) whose `code` is `code`, or null. */
export function findMedia(root: unknown, code: string): Obj | null {
  const queue: [unknown, number][] = [[root, 0]];
  let seen = 0;
  for (let i = 0; i < queue.length && seen < MAX_NODES; i++) {
    const [node, depth] = queue[i] as [unknown, number];
    seen++;
    if (!isObj(node)) continue;
    if (!Array.isArray(node) && node.code === code) return node;
    if (depth >= MAX_DEPTH) continue;
    for (const v of Array.isArray(node) ? node : Object.values(node)) if (isObj(v)) queue.push([v, depth + 1]);
  }
  return null;
}

/** The verdict for a found media object. */
export function verdictOf(media: Obj): ReshareVerdict {
  if (media.ig_media_sharing_disabled === true) return 'blocked';
  if (media.can_viewer_reshare === false && media.can_reshare !== true) return 'blocked';
  const owner = (isObj(media.owner) ? media.owner : isObj(media.user) ? media.user : null) as Obj | null;
  if (owner?.is_private === true) return 'blocked';
  const says =
    media.can_viewer_reshare === true || media.can_reshare === true || media.ig_media_sharing_disabled === false;
  return says ? 'allowed' : 'unknown';
}

export function reshareFlags(texts: Iterable<string>, code: string, isOwn: boolean): ReshareVerdict {
  if (isOwn) return 'allowed';
  const needle = `"code":"${code}"`;
  let scripts = 0;
  let bytes = 0;
  for (const text of texts) {
    if (scripts >= SSR_MAX_SCRIPTS) break;
    if (!text.includes(needle)) continue;
    scripts++;
    if (bytes + text.length > SSR_MAX_BYTES) continue;
    bytes += text.length;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    const media = findMedia(json, code);
    if (media) return verdictOf(media);
  }
  return 'unknown';
}
