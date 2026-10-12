/** Thin wrapper over the windows API (strategy §3.6). */
import { type Browser, browser } from 'wxt/browser';
import type { WindowBox } from '../core/geometry/window-fit.ts';

export interface WindowsPort {
  /** popup at about:blank, focused; resolves with the window and its only tab. */
  createPopup(box: WindowBox): Promise<{ windowId: number; tabId: number }>;
  update(windowId: number, update: Partial<WindowBox> & { focused?: boolean }): Promise<void>;
  /** Outer box of a window. */
  getBox(windowId: number): Promise<WindowBox>;
  /**
   * AM22: the window's type and its tabs' URLs (undefined for hosts without permission), or null
   * when the window does not exist.
   */
  describe(windowId: number): Promise<{ type: string | undefined; tabUrls: (string | undefined)[] } | null>;
  remove(windowId: number): Promise<void>;
  onRemoved(listener: (windowId: number) => void): () => void;
}

export const windows: WindowsPort = {
  async createPopup(box) {
    const w: Browser.windows.Window | undefined = await browser.windows.create({
      type: 'popup',
      url: 'about:blank',
      focused: true,
      ...box,
    });
    const tabId = w?.tabs?.[0]?.id;
    if (w?.id === undefined || tabId === undefined) throw new Error('windows.create returned no window or tab id');
    return { windowId: w.id, tabId };
  },
  async update(windowId, update) {
    await browser.windows.update(windowId, update);
  },
  async getBox(windowId) {
    const w = await browser.windows.get(windowId);
    return { left: w.left ?? 0, top: w.top ?? 0, width: w.width ?? 0, height: w.height ?? 0 };
  },
  async describe(windowId) {
    try {
      const w = await browser.windows.get(windowId, { populate: true });
      return { type: w.type, tabUrls: (w.tabs ?? []).map((t) => t.url) };
    } catch {
      return null;
    }
  },
  async remove(windowId) {
    await browser.windows.remove(windowId);
  },
  onRemoved(listener) {
    browser.windows.onRemoved.addListener(listener);
    return () => browser.windows.onRemoved.removeListener(listener);
  },
};
