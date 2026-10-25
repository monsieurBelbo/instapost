/**
 * Instagram's appearance, read from its page (inpage-ui-spec.md FT1, FT2). Pure: the content script feeds it
 * computed colours and Instagram's `--ig-*` variables; it returns the scheme (light or dark, from the
 * luminance of the page's background, not the OS) and the page palette the host UI uses (the entry row, the
 * coach mark, the tooltip, the chip's badge ring). The composer gets the scheme only and uses its own tokens.
 */

export type Scheme = 'light' | 'dark';

export interface PagePalette {
  scheme: Scheme;
  bg: string;
  elev: string;
  text: string;
  text2: string;
  sep: string;
  hover: string;
}

/** FT2 defaults (~), per scheme. */
export const PAGE_DEFAULTS: Readonly<Record<Scheme, PagePalette>> = {
  light: {
    scheme: 'light',
    bg: '#ffffff',
    elev: '#ffffff',
    text: '#000000',
    text2: '#737373',
    sep: '#dbdbdb',
    hover: 'rgba(0,0,0,.05)',
  },
  dark: {
    scheme: 'dark',
    bg: '#000000',
    elev: '#262626',
    text: '#f5f5f5',
    text2: '#a8a8a8',
    sep: '#262626',
    hover: 'rgba(255,255,255,.1)',
  },
};

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** `rgb(…)`, `rgba(…)`, `#rgb`, `#rrggbb`, or Instagram's bare `r,g,b` triplet; null otherwise. */
export function parseColor(raw: string | null | undefined): Rgba | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === '') return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1] ?? '';
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    return {
      r: Number.parseInt(full.slice(0, 2), 16),
      g: Number.parseInt(full.slice(2, 4), 16),
      b: Number.parseInt(full.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(s);
  const body = fn ? (fn[1] ?? '') : /^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(\s*,\s*[\d.]+)?$/.test(s) ? s : null;
  if (body === null) return null;
  // Computed styles say `rgb(r, g, b)` or `rgba(r, g, b, a)`; an alpha may be a percentage.
  const parts = body
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map((p, i) => (i === 3 && p.endsWith('%') ? Number.parseFloat(p) / 100 : Number(p)));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  const [r = 0, g = 0, b = 0, a = 1] = parts;
  return { r, g, b, a: Number.isFinite(a) ? a : 1 };
}

/** WCAG relative luminance, 0..1. */
export function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** A CSS colour from an Instagram variable's value (`255,255,255` triplets become `rgb(…)`), or null. */
export function cssColor(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (s === '') return null;
  if (/^\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}$/.test(s)) return `rgb(${s})`;
  return parseColor(s) ? s : null;
}

export interface PageSignals {
  /** The first opaque background behind Instagram's navigation, else body's, else html's. */
  background: string | null;
  /** The computed `color` of Instagram's Profile link (its text colour). */
  text: string | null;
  /** Instagram's own variables, when present (V5 fast path). */
  vars: Partial<Record<'text2' | 'sep' | 'elev' | 'hover', string>>;
}

/** The scheme and the page palette (FT1, FT2): the background decides light or dark. */
export function pagePalette(sig: PageSignals): PagePalette {
  const bg = parseColor(sig.background);
  const scheme: Scheme = bg && bg.a > 0.5 ? (luminance(bg) < 0.4 ? 'dark' : 'light') : 'light';
  const d = PAGE_DEFAULTS[scheme];
  const text = cssColor(sig.text);
  const textRgb = parseColor(text);
  // A text colour that does not contrast with the scheme is not Instagram's text: keep the default.
  const textOk = textRgb !== null && (scheme === 'dark' ? luminance(textRgb) > 0.4 : luminance(textRgb) < 0.4);
  return {
    scheme,
    bg: bg && bg.a > 0.5 && sig.background ? sig.background : d.bg,
    elev: cssColor(sig.vars.elev) ?? d.elev,
    text: textOk && text ? text : d.text,
    text2: cssColor(sig.vars.text2) ?? d.text2,
    sep: cssColor(sig.vars.sep) ?? d.sep,
    hover: d.hover,
  };
}
