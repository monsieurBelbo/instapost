/**
 * Repost diagnostics (docs/repost.md RP-31; the build task's "record a short reason"): why an Add to story
 * entry could not attach (the content script's `inpage/repost-diag`, written by the background) or why the
 * composer could not load the picture (written by the composer). storage.local `repostDiag`, the last 30,
 * structural only: when, where, a short reason code. No URL, no handle, no text of Instagram's. Settings →
 * Advanced → Diagnostics → Copy adds them to the run records.
 */
import { browser } from 'wxt/browser';
import { isDiagWhy, REPOST_DIAG_WHERE, type RepostDiagWhere } from '../../inpage/messages.ts';

export const REPOST_DIAG_KEY = 'repostDiag';
export const REPOST_DIAG_MAX = 30;

export interface RepostDiag {
  at: number;
  where: RepostDiagWhere;
  why: string;
}

const isDiag = (x: unknown): x is RepostDiag => {
  const o = x as Partial<RepostDiag> | null;
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof o.at === 'number' &&
    REPOST_DIAG_WHERE.includes(o.where as RepostDiagWhere) &&
    isDiagWhy(o.why)
  );
};

export async function readRepostDiag(): Promise<RepostDiag[]> {
  try {
    const got = await browser.storage.local.get(REPOST_DIAG_KEY);
    const list = got[REPOST_DIAG_KEY];
    return Array.isArray(list) ? list.filter(isDiag) : [];
  } catch {
    return [];
  }
}

export async function appendRepostDiag(where: RepostDiagWhere, why: string, at: number = Date.now()): Promise<void> {
  if (!isDiagWhy(why)) return;
  try {
    const list = await readRepostDiag();
    await browser.storage.local.set({ [REPOST_DIAG_KEY]: [...list, { at, where, why }].slice(-REPOST_DIAG_MAX) });
  } catch {
    // Diagnostics only: storage may be unavailable while the extension reloads.
  }
}
