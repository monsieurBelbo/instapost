/**
 * The language rules of i18n.ts without its signals or its catalogs (strategy §11 AM44, AM48): which
 * language a setting means, how a text's `{placeholders}` are filled, and the locale and day words for dates.
 * The extension pages use them through i18n.ts; the in-page content script uses them directly with its own
 * small catalog (`catalog.page.*.ts`), so its bundle stays lean.
 */
import type { UiLangSetting } from '../core/handoff/state.ts';

export type Lang = 'en' | 'es';
export type LangSetting = UiLangSetting;
export const LANGS: readonly Lang[] = ['en', 'es'];

/** The `{name}` placeholders of a text, sorted and without repeats. */
export function placeholders(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g), (m) => m[1] ?? ''))].sort();
}

/** The language a browser language tag maps to: `es`, `es-AR`, `es_419` → es; anything else → en. */
export function langOf(tag: string | null | undefined): Lang {
  return /^es(?:[-_]|$)/i.test((tag ?? '').trim()) ? 'es' : 'en';
}

/** The setting as the UI shows it: Auto follows the browser. */
export function resolveLang(setting: LangSetting, browserTag: string | null | undefined): Lang {
  return setting === 'auto' ? langOf(browserTag) : setting;
}

/** The browser's UI language (chrome.i18n), else `navigator.language`, else `en`. */
export function browserLanguage(): string {
  try {
    const i18n = (globalThis as { chrome?: { i18n?: { getUILanguage?: () => string } } }).chrome?.i18n;
    const ui = i18n?.getUILanguage?.();
    if (typeof ui === 'string' && ui !== '') return ui;
  } catch {
    // Not an extension context (unit tests, the fake's own pages): fall through.
  }
  return typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language !== ''
    ? navigator.language
    : 'en';
}

type ParamNames<S extends string> = S extends `${string}{${infer P}}${infer R}` ? P | ParamNames<R> : never;
/** The arguments a text with these placeholders takes: none, or one record of them. */
export type ArgsOf<S extends string> = [ParamNames<S>] extends [never]
  ? []
  : [Readonly<Record<ParamNames<S>, string | number>>];

/** `text` with its `{name}` placeholders filled from `params`; unknown ones stay as they are. */
export function fill(text: string, params: Readonly<Record<string, string | number>> | undefined): string {
  if (!params) return text;
  return text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/** The locale for Intl: the browser's own tag when it is in the chosen language (keeps its region), else the bare language. */
export function localeFor(l: Lang, tag: string | null | undefined): string {
  const t = tag ?? '';
  return langOf(t) === l && /^[a-z]{2}(?:-[A-Za-z0-9]{2,8})*$/.test(t) ? t : l;
}

/**
 * How a language names the day inside "until …" / "detected …": English `Tue 20 Oct`; Spanish
 * `martes 20 de octubre` (after "hasta el" / "detectada el", an abbreviated weekday is ungrammatical and
 * `el mar` reads "the sea", ES-1). Intl's own words and order, without the comma it puts after a long weekday.
 */
export function dayOf(time: number, l: Lang, locale: string): string {
  const d = new Date(time);
  if (l === 'en') return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const parts = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(d);
  return parts
    .map((p, i) => (p.type === 'literal' && parts[i - 1]?.type === 'weekday' ? ' ' : p.value))
    .join('')
    .trim();
}
