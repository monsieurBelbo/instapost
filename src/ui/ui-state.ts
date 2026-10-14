/**
 * The editor's page state (ux.md §4, IU1): one page with a Settings sheet, a History drawer and a shortcut
 * sheet. `#settings` and `#history` deep-link to them (they replace the `#/settings` route).
 */
import { signal } from '@preact/signals';

export type Overlay = 'settings' | 'history' | 'shortcuts' | null;

const fromHash = (hash: string): Overlay =>
  hash === '#settings' ? 'settings' : hash === '#history' ? 'history' : null;

export const overlay = signal<Overlay>(typeof location === 'undefined' ? null : fromHash(location.hash));

/** Opens (or closes, with null) an overlay; Settings and History keep their hash for deep links. */
export function openOverlay(next: Overlay): void {
  overlay.value = next;
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  const hash = next === 'settings' || next === 'history' ? `#${next}` : '';
  if (location.hash !== hash) history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    overlay.value = fromHash(location.hash);
  });
}

/** The text editor is focused (single-key shortcuts are off then). */
export const textFocus = signal(false);
/** The window-wide drop target is active (§4.3). */
export const dropping = signal(false);
/** Ticks every 500 ms while something counts down or up (run view, queue, prompt). */
export const now = signal(Date.now());

let ticking: ReturnType<typeof setInterval> | null = null;
export function startTicking(): void {
  if (ticking !== null) return;
  ticking = setInterval(() => {
    now.value = Date.now();
  }, 500);
}
