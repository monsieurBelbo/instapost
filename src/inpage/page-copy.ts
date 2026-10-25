/**
 * What the content script writes on Instagram's page (inpage-ui-spec.md FE6, FE8; strategy §11 AM48): the
 * entry's label, tooltip and accessible name per state, and the coach mark, in the owner's language. Pure:
 * the language comes with the background's `inpage/state` (PageState `lang`, Settings → Language resolved
 * there), so the content script reads no storage and nothing of Instagram's to choose it. Only the small
 * page catalogs are imported (never the editor's whole catalog): this file is in the content script's bundle.
 */
import { PAGE_EN, type PageKey } from '../ui/catalog.page.en.ts';
import { PAGE_ES } from '../ui/catalog.page.es.ts';
import { type ArgsOf, dayOf, fill, type Lang, localeFor } from '../ui/i18n-core.ts';
import type { PageRunState } from './messages.ts';

/**
 * RL-10: the toolbar shortcut from the background's `inpage/state` (Chrome's own spelling for the platform:
 * `⌥⇧S` on a Mac, `Alt+Shift+S` elsewhere, or whatever the owner set), shown as keys in every language; null
 * when none is set (another extension holds it, or it was cleared): then no key is shown anywhere.
 */
export function shortcutOf(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  return s === '' || s.length > 32 ? null : s;
}

const MAC_MODIFIERS: Readonly<Record<string, string>> = { '⌘': 'Meta', '⌥': 'Alt', '⇧': 'Shift', '⌃': 'Control' };
const NAMED_MODIFIERS: Readonly<Record<string, string>> = { Ctrl: 'Control', Command: 'Meta', MacCtrl: 'Control' };

/** The shortcut as `aria-keyshortcuts` wants it (`Alt+Shift+S`), or null when it cannot be read. */
export function ariaShortcut(shortcut: string | null): string | null {
  if (shortcut === null) return null;
  if (shortcut.includes('+')) {
    const parts = shortcut.split('+').map((p) => p.trim());
    return parts.every((p) => p !== '') ? parts.map((p) => NAMED_MODIFIERS[p] ?? p).join('+') : null;
  }
  const chars = [...shortcut];
  const mods: string[] = [];
  while (chars.length > 1 && chars[0] !== undefined && MAC_MODIFIERS[chars[0]])
    mods.push(MAC_MODIFIERS[chars.shift() as string] as string);
  const keyName = chars.join('');
  return mods.length > 0 && keyName !== '' ? [...mods, keyName].join('+') : null;
}
/** The composer frame's title: instapost's name. */
export const FRAME_TITLE = 'instapost';
/** FE6: a result in another tab shows on the entry this long. */
export const OTHER_RESULT_MS = 10_000;

const PAGE = { en: PAGE_EN, es: PAGE_ES } as const;

/** The page text of `key` in `lang`, with its placeholders filled. */
export function pageT<K extends PageKey>(lang: Lang, key: K, ...args: ArgsOf<(typeof PAGE_EN)[K]>): string {
  return fill(PAGE[lang][key] ?? PAGE_EN[key], args[0] as Readonly<Record<string, string | number>> | undefined);
}

/** A language from the wire: anything but `es` is English. */
export const toLang = (x: unknown): Lang => (x === 'es' ? 'es' : 'en');

export type Glyph = 'check' | 'alert' | 'q' | 'pause';

export interface EntryLook {
  st: 'idle' | 'busy' | 'result' | 'paused';
  k: '' | 'ok' | 'bad' | 'unk';
  label: string;
  small: string;
  tip: string;
  name: string;
  glyph: Glyph | null;
}

const clockOf = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * FE6: the entry as the run (in another tab), the pause and the language say. `navTag` is the page's
 * `navigator.language` (its region, for the date words, when it speaks the chosen language).
 */
export function entryLook(
  run: PageRunState,
  pausedUntil: number | null,
  lang: Lang,
  now: number,
  navTag: string | null = null,
): EntryLook {
  const T = <K extends PageKey>(key: K, ...args: ArgsOf<(typeof PAGE_EN)[K]>) => pageT(lang, key, ...args);
  if (run.phase === 'running' && !run.here) {
    return {
      st: 'busy',
      k: '',
      label: T('page.entry.posting'),
      small: run.startedAt ? clockOf(now - run.startedAt) : '',
      tip: T('page.entry.postingTip', { step: run.step + 1, of: 5 }),
      name: T('page.entry.postingName'),
      glyph: null,
    };
  }
  if (run.phase === 'result' && !run.here && run.endedAt !== null && now - run.endedAt < OTHER_RESULT_MS) {
    if (run.result === 'posted') {
      const label = T('page.entry.posted');
      return {
        st: 'result',
        k: 'ok',
        label,
        small: '',
        tip: run.handle ? T('page.entry.postedTip', { handle: run.handle }) : T('page.entry.postedTipYours'),
        name: T('page.entry.resultName', { label }),
        glyph: 'check',
      };
    }
    if (run.result === 'failed') {
      const label = T('page.entry.notPosted');
      return {
        st: 'result',
        k: 'bad',
        label,
        small: '',
        tip: T('page.entry.notPostedTip'),
        name: T('page.entry.resultName', { label }),
        glyph: 'alert',
      };
    }
    if (run.result === 'unknown') {
      const label = T('page.entry.unknown');
      return {
        st: 'result',
        k: 'unk',
        label,
        small: '',
        tip: T('page.entry.unknownTip'),
        name: T('page.entry.resultName', { label }),
        glyph: 'q',
      };
    }
  }
  if (pausedUntil !== null && pausedUntil > now) {
    const until = dayOf(pausedUntil, lang, localeFor(lang, navTag));
    return {
      st: 'paused',
      k: '',
      label: T('page.entry.paused'),
      small: '',
      tip: T('page.entry.pausedTip', { until }),
      name: T('page.entry.pausedName', { until }),
      glyph: 'pause',
    };
  }
  return {
    st: 'idle',
    k: '',
    label: T('page.entry.label'),
    small: '',
    tip: T('page.entry.tip'),
    name: T('page.entry.name'),
    glyph: null,
  };
}

/** FE8: the coach mark's texts; `key` (the word "Shortcut") precedes the shortcut's keys, when there is one. */
export function coachCopy(lang: Lang): { title: string; body: string; key: string; ok: string } {
  return {
    title: pageT(lang, 'page.coach.title'),
    body: pageT(lang, 'page.coach.body'),
    key: pageT(lang, 'page.coach.key'),
    ok: pageT(lang, 'page.coach.ok'),
  };
}
