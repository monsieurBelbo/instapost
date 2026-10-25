/**
 * Repost (docs/repost.md RP-5 step 5, RP-16): Instagram's Share dialog after the owner's click on Share, by
 * structure (any language). It is the first `[role=dialog]` that appears within 1500 ms which was not there at
 * click time, does not hold the post, holds an `input` (the contact search) and is visible, at least 280×300.
 * Its panel is the topmost ancestor of that input still at most 0.9 × the viewport's width and 0.95 × its
 * height. The external share bar (Copy link, WhatsApp, Email…) is recorded for diagnostics only.
 */
import type { ShareBar } from '../../core/repost/source.ts';

export const DIALOG_WAIT_MS = 1500;
const MIN_W = 280;
const MIN_H = 300;

/** The Share dialog among the page's dialogs, or null. */
export function findShareDialog(doc: Document, before: ReadonlySet<Element>, post: Element): Element | null {
  for (const d of Array.from(doc.querySelectorAll('[role="dialog"]'))) {
    if (before.has(d) || d.contains(post) || post.contains(d)) continue;
    if (!d.querySelector('input')) continue;
    const r = d.getBoundingClientRect();
    if (r.width < MIN_W || r.height < MIN_H) continue;
    return d;
  }
  return null;
}

/** The dialog's panel: the input's topmost ancestor (within the dialog) that is not viewport-sized. */
export function panelOf(dialog: Element, vp: { w: number; h: number }): Element | null {
  const input = dialog.querySelector('input');
  if (!input) return null;
  let panel: Element | null = null;
  for (let el: Element | null = input.parentElement; el; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (r.width > 0.9 * vp.w || r.height > 0.95 * vp.h) break;
    if (r.width > 0 && r.height > 0) panel = el;
    if (el === dialog) break;
  }
  return panel;
}

const SHARE_LINKS = [
  'a[href^="mailto:"]',
  'a[href*="whatsapp"]',
  'a[href*="facebook.com/sharer"]',
  'a[href*="facebook.com/dialog"]',
  'a[href*="twitter.com/intent"]',
  'a[href*="x.com/intent"]',
  'a[href*="threads.net/intent"]',
].join(',');

/** RP-16: the dialog's external share bar (diagnostics; a gate only after L42). */
export function shareBarOf(panel: Element | null): ShareBar {
  if (!panel) return 'unknown';
  return panel.querySelector(SHARE_LINKS) ? 'seen' : 'absent';
}

export function visible(el: Element): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
