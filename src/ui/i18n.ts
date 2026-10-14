/**
 * The editor's languages (strategy §11 AM44): every user-facing text of the extension's own UI comes from a
 * typed catalog, in English (`catalog.en.ts`, the source of the keys) and Spanish (`catalog.es.ts`). The
 * language is the Settings choice "Auto (browser) / English / Español"; Auto follows the browser's UI
 * language (`chrome.i18n.getUILanguage()`, else `navigator.language`): any `es-*` is Spanish, anything
 * else English. Dates and times use `Intl` with the chosen language (and the browser's region when it
 * speaks the same language, e.g. `es-AR`).
 *
 * `t(key, params)` reads the current language from a signal, so a component (or an effect) that renders a
 * text follows a change of the setting at once. Placeholders are `{name}`; the parameters a key needs are
 * checked at compile time from the English text, and `i18n.test.ts` checks that both catalogs have the same
 * keys and the same placeholders per key.
 *
 * Instagram's own UI language is another matter (L21): the autopilot never reads Instagram's text
 * (docs/contract.md § "Instagram in Spanish").
 */
import { computed, signal } from '@preact/signals';
import type { UiLangSetting } from '../core/handoff/state.ts';
import { EN } from './catalog.en.ts';
import { ES } from './catalog.es.ts';

export type Lang = 'en' | 'es';
export type LangSetting = UiLangSetting;
export const LANGS: readonly Lang[] = ['en', 'es'];

export type MsgKey = keyof typeof EN;
export type Catalog = { readonly [K in MsgKey]: string };
export const CATALOGS: Readonly<Record<Lang, Catalog>> = { en: EN, es: ES };

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

/** The browser's UI language (chrome.i18n), else the page's `navigator.language`, else `en`. */
export function browserLanguage(): string {
  try {
    const i18n = (globalThis as { chrome?: { i18n?: { getUILanguage?: () => string } } }).chrome?.i18n;
    const ui = i18n?.getUILanguage?.();
    if (typeof ui === 'string' && ui !== '') return ui;
  } catch {
    // Not an extension page (unit tests, the fake's own pages): fall through.
  }
  return typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language !== ''
    ? navigator.language
    : 'en';
}

/** The Settings choice (settings-state.ts keeps it in step with storage.local `settings.lang`). */
export const langSetting = signal<LangSetting>('auto');
/** What Auto reads (exported for tests). */
export const browserTag = signal<string>(browserLanguage());
/** The language every text is in now. */
export const lang = computed<Lang>(() => resolveLang(langSetting.value, browserTag.value));

export function setLangSetting(next: LangSetting): void {
  langSetting.value = next;
}

/** The locale for Intl: the browser's own tag when it is in the chosen language (keeps its region), else the bare language. */
export function intlLocale(l: Lang = lang.value): string {
  const tag = (typeof navigator !== 'undefined' && navigator.language) || browserTag.value;
  return langOf(tag) === l && /^[a-z]{2}(?:-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : l;
}

type ParamNames<S extends string> = S extends `${string}{${infer P}}${infer R}` ? P | ParamNames<R> : never;
/** The placeholders of a key, from its English text. */
export type Params<K extends MsgKey> = ParamNames<(typeof EN)[K]>;
type Args<K extends MsgKey> = [Params<K>] extends [never] ? [] : [Readonly<Record<Params<K>, string | number>>];

function fill(text: string, params: Readonly<Record<string, string | number>> | undefined): string {
  if (!params) return text;
  return text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/** The text of `key` in the current language, with its placeholders filled. */
export function t<K extends MsgKey>(key: K, ...args: Args<K>): string {
  return fill(CATALOGS[lang.value][key] ?? EN[key], args[0] as Readonly<Record<string, string | number>> | undefined);
}

/** For keys built at run time (`action.${id}`): unchecked parameters. */
export function tk(key: MsgKey, params?: Readonly<Record<string, string | number>>): string {
  return fill(CATALOGS[lang.value][key] ?? EN[key], params);
}

/**
 * A text with placeholders that hold elements: the text split around them, for JSX
 * (`tParts('onboarding.intro', { post: <strong>…</strong> })`). Unknown placeholders stay as text.
 */
export function tParts<T>(key: MsgKey, parts: Readonly<Record<string, T>>): (string | T)[] {
  const text = CATALOGS[lang.value][key] ?? EN[key];
  const out: (string | T)[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
    const name = m[1] ?? '';
    if (!Object.hasOwn(parts, name)) continue;
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(parts[name] as T);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** An object whose properties are texts read at access time (so `Object.values` and `obj.key` follow the language). */
export function liveTexts<K extends string>(keys: readonly K[], text: (k: K) => string): Readonly<Record<K, string>> {
  const o = {} as Record<K, string>;
  for (const k of keys) Object.defineProperty(o, k, { get: () => text(k), enumerable: true });
  return o;
}
