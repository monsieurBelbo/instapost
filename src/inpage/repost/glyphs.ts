/**
 * Repost (docs/repost.md RP-5; Research A §1.2): the svg path prefixes of Instagram's desktop action bar, the
 * structural (language-free) way to find a post's Share control and its bar. The sidebar's Messages and
 * Notifications reuse the Share and Like glyphs, which is why the bar needs a Comment or Repost glyph too.
 */

export const SHARE_D = ['M13.973 20.046'];
export const LIKE_D = ['M16.792 3.904', 'M34.6 3.1'];
export const COMMENT_D = ['M20.656 17.008'];
export const REPOST_D = ['M19.998 9.497'];

/** A CSS selector for svg paths whose `d` starts with one of the prefixes. */
export const pathSel = (prefixes: readonly string[]): string => prefixes.map((p) => `path[d^="${p}"]`).join(',');

export const SHARE_PATHS = pathSel(SHARE_D);
export const LIKE_PATHS = pathSel(LIKE_D);
export const BAR_PEER_PATHS = pathSel([...COMMENT_D, ...REPOST_D]);
