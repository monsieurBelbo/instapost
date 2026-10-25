/**
 * The desktop shell's layout rules (DesktopShell.tsx; contract.md "Desktop Instagram's page"), pure so U16 can
 * test them: the navigation's layout per `desktopNav` and the window's width, and the theme's `--ig-*`
 * variables.
 */
import type { Knobs } from '../knobs.ts';

/** `desktopNav=auto`: wide from this width, a bottom bar up to NAV_NARROW_QUERY, collapsed between (approximate). */
export const NAV_WIDE_QUERY = '(min-width: 1264px)';
export const NAV_NARROW_QUERY = '(max-width: 767px)';
export const NAV_WIDE_W = 244;
export const NAV_COLLAPSED_W = 72;
/** The hover intent before the collapsed navigation widens, and its animation (unverified, about Instagram's). */
export const NAV_HOVER_DELAY_MS = 100;
export const NAV_GROW_MS = 200;

export type NavLayout = 'wide' | 'collapsed' | 'hover' | 'bottomBar' | 'absent';

/** The navigation's layout now, per `desktopNav` (and, for `auto`, which media queries match). */
export function navLayout(kind: Knobs['desktopNav'], matches: (query: string) => boolean): NavLayout {
  switch (kind) {
    case 'auto':
      return matches(NAV_WIDE_QUERY) ? 'wide' : matches(NAV_NARROW_QUERY) ? 'bottomBar' : 'hover';
    case 'renamed':
      return 'wide';
    default:
      return kind;
  }
}

/** The theme's colours, as Instagram's `--ig-*` variables spell them (bare triplets; values approximate). */
export const THEME_VARS: Readonly<Record<'light' | 'dark', Readonly<Record<string, string>>>> = {
  light: {
    '--ig-primary-background': '255, 255, 255',
    '--ig-primary-text': '0, 0, 0',
    '--ig-secondary-text': '115, 115, 115',
    '--ig-separator': '219, 219, 219',
    '--ig-elevated-background': '255, 255, 255',
    '--ig-hover-overlay': '0, 0, 0',
  },
  dark: {
    '--ig-primary-background': '0, 0, 0',
    '--ig-primary-text': '245, 245, 245',
    '--ig-secondary-text': '168, 168, 168',
    '--ig-separator': '38, 38, 38',
    '--ig-elevated-background': '38, 38, 38',
    '--ig-hover-overlay': '255, 255, 255',
  },
};

/** `theme`: the scheme shown, given whether the page prefers dark. */
export const themeScheme = (knob: Knobs['theme'], prefersDark: boolean): 'light' | 'dark' =>
  knob === 'auto' ? (prefersDark ? 'dark' : 'light') : knob;
