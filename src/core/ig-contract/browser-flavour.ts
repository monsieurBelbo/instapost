/**
 * P6 (2026-10-12): the browser the editor runs in, sent in handoff/start and kept on the record.
 * Its own module, with no imports, so the editor and the agent bundles never pull in the rules
 * (and with them the write-endpoint strings T3 keeps out of everything but background.js).
 *
 * - `chrome` / `edge`: userAgentData.brands names Google Chrome / Microsoft Edge;
 * - `arc`: brands say only "Chromium" (Arc 155 is indistinguishable from Playwright's Chromium by
 *   brands, F1), but Arc injects `--arc-palette-*` CSS custom properties on page roots, the editor's
 *   own included. A heuristic: recorded, and enough for a guarded build to refuse, never relied on
 *   for anything else;
 * - `chromium`: brands name Chromium and nothing else identifies the browser (CfT, Playwright);
 * - `unknown`: no userAgentData, or brands that name none of these.
 */
export const BROWSER_FLAVOURS = ['chromium', 'chrome', 'edge', 'arc', 'unknown'] as const;
export type BrowserFlavour = (typeof BROWSER_FLAVOURS)[number];

/** The flavour from `brands` (userAgentData.brands[].brand, null without userAgentData) and the Arc palette check. */
export function browserFlavourOf(brands: readonly string[] | null, arcPalette: boolean): BrowserFlavour {
  const names = (brands ?? []).map((b) => b.trim());
  if (names.includes('Google Chrome')) return 'chrome';
  if (names.includes('Microsoft Edge')) return 'edge';
  if (arcPalette) return 'arc';
  if (brands === null) return 'unknown';
  return names.includes('Chromium') ? 'chromium' : 'unknown';
}

/** AM23 + P6: a guarded build refuses in these (a real browsing profile, never the sealed one). */
export function isBrandedFlavour(f: BrowserFlavour): boolean {
  return f === 'chrome' || f === 'edge' || f === 'arc';
}
