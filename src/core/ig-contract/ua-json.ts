/**
 * C1: the server's own UA classification, embedded in the page (strategy §3.9).
 * Shared by the agent (reads the script's text) and `pnpm run contract:check` (reads HTML),
 * so both use exactly the same parser.
 */

export const UA_JSON_KEY = 'InstagramUserAgent';

export type IsMobile = boolean | 'unknown';

/** Every `<script …>…</script>` block: attributes, then text. */
const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
/** The `type` attribute, double-, single- or un-quoted. */
const TYPE_ATTR = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
/** The key, also when the JSON is itself embedded as an escaped string (`\"InstagramUserAgent\"`). */
const KEY = new RegExp(`\\\\?"${UA_JSON_KEY}\\\\?"`);
const IS_MOBILE = /\\?"is_mobile\\?"\s*:\s*(true|false)/;

function isJsonScript(attrs: string): boolean {
  const m = TYPE_ATTR.exec(attrs);
  const type = m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
  return type.trim().toLowerCase() === 'application/json';
}

/** The first `script[type="application/json"]` text that contains the key, or null. */
function uaScriptText(html: string): string | null {
  for (const m of html.matchAll(SCRIPT_BLOCK)) {
    const [, attrs = '', text = ''] = m;
    if (isJsonScript(attrs) && KEY.test(text)) return text;
  }
  return null;
}

/**
 * Accepts either a whole HTML document or the text of one `script[type="application/json"]`.
 * Input whose first non-blank character is `<` is HTML: take the first
 * `<script type="application/json">` block whose text contains `"InstagramUserAgent"`; other
 * scripts (including non-JSON ones) are ignored. Then match `"is_mobile"\s*:\s*(true|false)`
 * in that text, starting at the key, so an unrelated `is_mobile` before it is never read.
 * Anything missing → 'unknown'. Tolerant of whitespace, nesting and escaped quotes. Tested by U15.
 */
export function parseIsMobile(htmlOrJsonText: string): IsMobile {
  const text = htmlOrJsonText.trimStart().startsWith('<') ? uaScriptText(htmlOrJsonText) : htmlOrJsonText;
  if (text === null) return 'unknown';
  const key = KEY.exec(text);
  if (!key) return 'unknown';
  const m = IS_MOBILE.exec(text.slice(key.index));
  return m ? m[1] === 'true' : 'unknown';
}
