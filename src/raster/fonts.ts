/**
 * Bundled fonts (strategy §3.4 step 6, §4 "Text"). Each font is a FontFace built from a woff2 in
 * public/fonts, loaded and awaited before any draw, and added to the page's (or worker's)
 * FontFaceSet.
 *
 * `FontFaceSet.check()` alone cannot prove a font is ready: Chrome answers true for a family the
 * set has never heard of (it would draw with a fallback). So this module keeps its own registry
 * of loaded faces, and a font counts as loaded only when its face is loaded, still in the set,
 * and `check()` agrees. Everything that measures or draws text asserts that first and throws
 * FONT_NOT_LOADED otherwise.
 *
 * The internal family names are prefixed, so a copy installed on the machine can never stand in
 * for the bundled one; the UI labels fonts by their real family name (`label`).
 */
import type { FontSpec } from '../core/text/layout.ts';
import { RasterError } from './errors.ts';

export interface FontEntry {
  id: string;
  /** The family's own name, shown in the UI (never an Instagram style name). */
  label: string;
  /** The FontFace family registered in the FontFaceSet. */
  family: string;
  /** Root-relative URL: public/ in the extension and in the Vitest browser server alike. */
  url: string;
  /** The weight text is drawn at (the variable font's wght axis follows it). */
  weight: number;
  descriptors: FontFaceDescriptors;
}

export const DEFAULT_FONT_ID = 'instrument-sans';

/** The walking skeleton bundles one family; the other twelve arrive in P6. */
export const FONTS: Readonly<Record<string, FontEntry>> = {
  [DEFAULT_FONT_ID]: {
    id: DEFAULT_FONT_ID,
    label: 'Instrument Sans',
    family: 'instapost Instrument Sans',
    url: '/fonts/InstrumentSans-Variable.woff2',
    weight: 600,
    descriptors: { weight: '400 700', stretch: '75% 100%', style: 'normal' },
  },
};

/** The registry entry for `fontId`; FONT_NOT_LOADED for an id the build does not bundle. */
export function fontEntry(fontId: string): FontEntry {
  const entry = Object.hasOwn(FONTS, fontId) ? FONTS[fontId] : undefined;
  if (!entry) throw new RasterError('FONT_NOT_LOADED', `${fontId} (not bundled)`);
  return entry;
}

/** The canvas `font` shorthand for a spec, e.g. `600 72px "instapost Instrument Sans"`. */
export function cssFont(font: Pick<FontSpec, 'fontId' | 'sizePx'>): string {
  const { weight, family } = fontEntry(font.fontId);
  return `${weight} ${font.sizePx}px "${family}"`;
}

/** The document's FontFaceSet, or the worker's. */
export function fontSet(): FontFaceSet {
  const scope = globalThis as { document?: Document; fonts?: FontFaceSet };
  const set = scope.document?.fonts ?? scope.fonts;
  if (!set) throw new RasterError('FONT_NOT_LOADED', 'no FontFaceSet in this realm');
  return set;
}

const pending = new Map<string, Promise<FontFace>>();
const loaded = new Map<string, FontFace>();

/**
 * Loads a bundled font and adds it to the FontFaceSet. Idempotent: concurrent and later calls
 * share one load. A failed load throws FONT_NOT_LOADED and is forgotten, so a later call tries again.
 */
export function loadFont(fontId: string): Promise<FontFace> {
  let p = pending.get(fontId);
  if (p) return p;
  p = (async () => {
    const entry = fontEntry(fontId);
    const face = new FontFace(entry.family, `url("${entry.url}")`, entry.descriptors);
    try {
      await face.load();
    } catch (cause) {
      throw new RasterError('FONT_NOT_LOADED', `${fontId} (${entry.url} did not load)`, { cause });
    }
    fontSet().add(face);
    loaded.set(fontId, face);
    return face;
  })();
  pending.set(fontId, p);
  p.catch(() => pending.delete(fontId));
  return p;
}

/** True when the bundled face for `fontId` is loaded, in the set, and the set agrees. */
export function isFontLoaded(fontId: string): boolean {
  const face = loaded.get(fontId);
  if (face?.status !== 'loaded') return false;
  const set = fontSet();
  return set.has(face) && set.check(cssFont({ fontId, sizePx: 16 }));
}

/** Throws FONT_NOT_LOADED unless isFontLoaded(fontId). */
export function assertFontLoaded(fontId: string): void {
  fontEntry(fontId);
  if (!isFontLoaded(fontId)) throw new RasterError('FONT_NOT_LOADED', fontId);
}
