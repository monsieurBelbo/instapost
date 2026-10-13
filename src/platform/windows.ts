/**
 * Thin wrapper over the windows API (strategy §3.6).
 *
 * W1 (Arc, 2026-10-12): every popup is created, and every product update made, with
 * `state:'normal'` beside the bounds. Arc ignored the bounds of a plain `windows.create` popup and
 * an update without a state; with `state:'normal'` its update was honoured (F1).
 *
 * In guarded builds only, `windows` is wrapped by the E2E window-quirk shim (e2e-hooks.ts), which a
 * storage.local test flag turns on to make Chromium behave like Arc. `GUARDED` is a build-time
 * constant, so the live bundle contains neither the shim nor its flag (check-bundle T3).
 */
import { type Browser, browser } from 'wxt/browser';
import type { WindowBox } from '../core/geometry/window-fit.ts';
import { GUARDED } from '../shared/env.ts';
import { withWindowQuirk } from './e2e-hooks.ts';

export interface WindowUpdate extends Partial<WindowBox> {
  focused?: boolean;
  /** W1: the product's popup updates always pass 'normal'. */
  state?: 'normal';
}

export interface WindowsPort {
  /** popup at about:blank, focused, `state:'normal'` with the bounds (W1); resolves with the window and its only tab. */
  createPopup(box: WindowBox): Promise<{ windowId: number; tabId: number }>;
  update(windowId: number, update: WindowUpdate): Promise<void>;
  /** Outer box of a window. */
  getBox(windowId: number): Promise<WindowBox>;
  /**
   * AM22: the window's type and its tabs' URLs (undefined for hosts without permission), or null
   * when the window does not exist.
   */
  describe(windowId: number): Promise<{ type: string | undefined; tabUrls: (string | undefined)[] } | null>;
  remove(windowId: number): Promise<void>;
  onRemoved(listener: (windowId: number) => void): () => void;
  /** W3: windows.onBoundsChanged (no permission needed). */
  onBoundsChanged(listener: (windowId: number) => void): () => void;
}

export const chromeWindows: WindowsPort = {
  async createPopup(box) {
    const w: Browser.windows.Window | undefined = await browser.windows.create({
      type: 'popup',
      url: 'about:blank',
      focused: true,
      state: 'normal',
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
  onBoundsChanged(listener) {
    const l = (w: Browser.windows.Window) => {
      if (w.id !== undefined) listener(w.id);
    };
    browser.windows.onBoundsChanged.addListener(l);
    return () => browser.windows.onBoundsChanged.removeListener(l);
  },
};

/** The port the background uses: the real one, behind the E2E quirk shim in guarded builds only. */
export const windows: WindowsPort = GUARDED ? withWindowQuirk(chromeWindows) : chromeWindows;
