/**
 * RL-10: the toolbar action's shortcut (`commands._execute_action`) as the browser shows it. Chrome formats it
 * for the platform (`⌥⇧S` on a Mac, `Alt+Shift+S` elsewhere) and reports `''` when there is none: another
 * extension already holds the suggested key, or the owner cleared or changed it at chrome://extensions/shortcuts.
 * Readable from the background and from extension pages (the composer); no permission needed.
 */
import { browser } from 'wxt/browser';

/** The shortcut, or null when none is set (or the API is unavailable). */
export async function actionShortcut(): Promise<string | null> {
  try {
    const all = await browser.commands.getAll();
    const s = (all.find((c) => c.name === '_execute_action')?.shortcut ?? '').trim();
    return s === '' || s.length > 32 ? null : s;
  } catch {
    return null;
  }
}
