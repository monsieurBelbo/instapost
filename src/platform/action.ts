/**
 * The toolbar badge (ux.md §4.1): `…` while a run is active or queued, `✓` after a post or a passed test,
 * `!` after a failure, `?` after Couldn't confirm. action.setBadgeText needs no permission.
 */
import { browser } from 'wxt/browser';

export interface BadgePort {
  set(text: string, color: string | null): Promise<void>;
}

export const badge: BadgePort = {
  async set(text, color) {
    await browser.action.setBadgeText({ text });
    if (color) await browser.action.setBadgeBackgroundColor({ color });
  },
};
