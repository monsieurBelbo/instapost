/**
 * P6 (2026-10-12): which browser the editor runs in, sent with handoff/start and recorded on the
 * hand-off. Brands name Google Chrome and Microsoft Edge; Arc 155 reports only "Chromium" (like
 * Playwright's Chromium, F1), so Arc is recognised by the `--arc-palette-*` CSS custom properties it
 * injects on page roots, the editor's own included. A heuristic: recorded, and enough for a guarded
 * build to refuse, never relied on for anything else.
 */
import { type BrowserFlavour, browserFlavourOf } from '../core/ig-contract/browser-flavour.ts';

/** The custom-property prefix Arc's palette uses. */
export const ARC_PALETTE_PREFIX = '--arc-palette-';
/** A few names Arc is known to set, read through getComputedStyle (works for inline and stylesheet values). */
export const ARC_PALETTE_PROBES = [
  '--arc-palette-background',
  '--arc-palette-title',
  '--arc-palette-foregroundPrimary',
  '--arc-palette-focus',
] as const;

/** The parts of a CSSStyleDeclaration the check reads. */
interface StyleLike {
  readonly length: number;
  item(index: number): string;
  getPropertyValue(name: string): string;
}

export interface FlavourEnv {
  /** navigator.userAgentData.brands[].brand, or null without userAgentData. */
  brands: readonly string[] | null;
  /** document.documentElement.style. */
  inline: StyleLike | null;
  /** getComputedStyle(document.documentElement). */
  computed: StyleLike | null;
}

function hasPrefixed(style: StyleLike | null): boolean {
  if (!style) return false;
  for (let i = 0; i < style.length; i++) if (style.item(i).startsWith(ARC_PALETTE_PREFIX)) return true;
  return false;
}

/** Arc's palette on the document root: an inline property with the prefix, or a known name with a value. */
export function hasArcPalette(env: Pick<FlavourEnv, 'inline' | 'computed'>): boolean {
  if (hasPrefixed(env.inline) || hasPrefixed(env.computed)) return true;
  return ARC_PALETTE_PROBES.some((name) => (env.computed?.getPropertyValue(name) ?? '').trim() !== '');
}

export function flavourOf(env: FlavourEnv): BrowserFlavour {
  return browserFlavourOf(env.brands, hasArcPalette(env));
}

/** The editor page's own reading (call it when a hand-off starts, after Arc had time to theme the page). */
export function detectBrowserFlavour(): BrowserFlavour {
  try {
    const uad = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData;
    const root = document.documentElement;
    return flavourOf({
      brands: uad?.brands ? uad.brands.map((b) => b.brand) : null,
      inline: root.style,
      computed: getComputedStyle(root),
    });
  } catch {
    return 'unknown';
  }
}
