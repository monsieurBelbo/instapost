/**
 * Repost (docs/repost.md RP-18, AM55): the only URLs a repost carries are pictures Instagram's page is
 * already showing, on Instagram's image CDN. `isCdnImageUrl` is checked by the content script (before it
 * sends `inpage/repost`), by the background and the composer (on arrival) and by cdn-fetch.ts (before the
 * one GET). Pure: src/core has no `URL` global, so the URL is split by hand (as urls.ts does).
 *
 * Accepted: `https:`, no userinfo, no port, a host ending in `.cdninstagram.com` or `.fna.fbcdn.net` (with at
 * least one label before it), a path that is more than `/`, at most 2048 characters, no whitespace, control
 * characters or backslashes. Never `instagram.com` or any of its subdomains, never any other host.
 */

/** Host suffixes of Instagram's image CDN (checked as strings: no Meta URL literal in any bundle, RP-17). */
export const CDN_HOST_SUFFIXES: readonly string[] = ['.cdninstagram.com', '.fna.fbcdn.net'];

/**
 * The optional host permissions a repost needs (manifest `optional_host_permissions`, requested on the
 * owner's click, RP-20). check-bundle T1 pins the manifest to exactly these two patterns.
 */
export const CDN_ORIGINS: readonly string[] = ['https://*.cdninstagram.com/*', 'https://*.fna.fbcdn.net/*'];

export const MAX_CDN_URL = 2048;

/** scheme `https` (lower case, as the DOM normalises it), authority, path. */
const PARTS = /^https:\/\/([^/?#]*)([^?#]*)/;
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
/** Whitespace, control characters, backslashes: never in a URL the DOM hands out. */
const badChars = (x: string): boolean => {
  for (let i = 0; i < x.length; i++) {
    const c = x.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c === 0x5c) return true;
  }
  return /\s/.test(x);
};

/** The lower-case host of a CDN image URL, or null when `x` is not one. */
export function cdnHost(x: unknown): string | null {
  if (typeof x !== 'string' || x.length === 0 || x.length > MAX_CDN_URL || badChars(x)) return null;
  const m = PARTS.exec(x);
  if (!m) return null;
  const authority = m[1] ?? '';
  const path = m[2] ?? '';
  // Userinfo or a port: never (another origin than the permission covers, or a credential).
  if (authority.includes('@') || authority.includes(':') || authority.includes('[')) return null;
  const host = authority.toLowerCase();
  if (!HOST.test(host)) return null;
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return null;
  if (!CDN_HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length)) return null;
  if (path === '' || path === '/') return null;
  return host;
}

export function isCdnImageUrl(x: unknown): x is string {
  return cdnHost(x) !== null;
}
