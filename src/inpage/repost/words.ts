/**
 * Repost (docs/repost.md RP-5, RP-9; strategy AM57): the one place the repost entries read Instagram's text.
 * U31 (no text in decision code) scans src/inpage/repost/ and excludes exactly this file; no autopilot
 * decision reads it.
 *
 * - SHARE_LABELS: the Share control's svg `aria-label`, a fallback for when its glyph path changed (EN, ES).
 * - MENTION_PHRASES: what a story-mention message says in a DM thread. Story replies and shared stories show
 *   the same story link without it, so they get no pill. A wording that is not listed (es-LA, a new
 *   phrasing) fails closed: no pill (R37; L44 records the wording).
 */

export const SHARE_LABELS: readonly string[] = ['Share Post', 'Share', 'Compartir publicación', 'Compartir'];

export const MENTION_PHRASES: readonly string[] = [
  'mentioned you in their story',
  'Mentioned you in their story',
  'te ha mencionado en su historia',
  // es-LA (unverified)
  'te mencionó en su historia',
];

/** The longest text an ancestor may have to count as one message row (longer means a whole thread). */
export const MENTION_TEXT_MAX = 400;

const norm = (s: string): string => s.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
const PHRASES = MENTION_PHRASES.map(norm);

export const isMentionText = (text: string): boolean => {
  const t = norm(text);
  return PHRASES.some((p) => t.includes(p));
};

/** Whether `el`'s own text (at most MENTION_TEXT_MAX characters) says it is a story mention. */
export function mentionedIn(el: Element): boolean {
  const text = el.textContent ?? '';
  return text.length <= MENTION_TEXT_MAX && isMentionText(text);
}

/** Whether `el` is or holds an svg labelled as Share (the glyph's fallback). */
export function hasShareLabel(el: Element): boolean {
  const svgs = el.matches('svg[aria-label]') ? [el] : Array.from(el.querySelectorAll('svg[aria-label]'));
  return svgs.some((s) => SHARE_LABELS.includes((s.getAttribute('aria-label') ?? '').trim()));
}
