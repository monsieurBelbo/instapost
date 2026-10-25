/**
 * Repost (docs/repost.md RP-13): the media candidates of an `<img>`: its `srcset` (`url 640w, url 1080w`) plus
 * its `currentSrc` (at its natural width), deduplicated, CDN URLs only, widest first, at most 3. Desktop web
 * tops out at 1080w (Research A §1.4). Pure.
 */
import { isCdnImageUrl } from './cdn-url.ts';

export interface Candidate {
  url: string;
  /** Width in px (0 when the descriptor gave none). */
  w: number;
}

export const MAX_CANDIDATES = 3;

/** A `srcset` parsed per the HTML rules (URL up to whitespace, `Nw` descriptors; others give w 0). */
export function parseSrcset(srcset: string): Candidate[] {
  const out: Candidate[] = [];
  let i = 0;
  const s = srcset;
  while (i < s.length) {
    while (i < s.length && (/\s/.test(s[i] as string) || s[i] === ',')) i++;
    if (i >= s.length) break;
    let j = i;
    while (j < s.length && !/\s/.test(s[j] as string)) j++;
    let url = s.slice(i, j);
    let desc = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let k = j;
      while (k < s.length && s[k] !== ',') k++;
      desc = s.slice(j, k).trim();
      j = k;
    }
    i = j;
    if (url === '') continue;
    const w = /^(\d{1,5})w$/.exec(desc);
    out.push({ url, w: w ? Number(w[1]) : 0 });
  }
  return out;
}

/** The candidates to try, widest first: srcset + currentSrc, CDN only, deduplicated, at most `max`. */
export function pickCandidates(
  srcset: string | null,
  currentSrc: string | null,
  naturalWidth: number,
  max: number = MAX_CANDIDATES,
): Candidate[] {
  const all = srcset ? parseSrcset(srcset) : [];
  if (currentSrc)
    all.push({ url: currentSrc, w: Number.isFinite(naturalWidth) ? Math.max(0, Math.round(naturalWidth)) : 0 });
  const best = new Map<string, number>();
  for (const c of all) {
    if (!isCdnImageUrl(c.url)) continue;
    best.set(c.url, Math.max(best.get(c.url) ?? 0, c.w));
  }
  return [...best.entries()]
    .map(([url, w]) => ({ url, w }))
    .sort((a, b) => b.w - a.w)
    .slice(0, Math.max(0, max));
}
