/**
 * E2E test hooks for **guarded builds only** (F2, 2026-10-12). Nothing here runs on its own: the
 * only references are behind the build-time constant `GUARDED` (windows.ts, background-main.ts), so
 * the live bundle tree-shakes this module away. check-bundle T3 asserts that no `__e2e` marker is in
 * the live artifact and that the mock artifact does carry the shim (so the check would catch it).
 *
 * Both flags live in storage.local and are read at use time, so a spec can set them through the
 * extension service worker (`sw.evaluate`) before it starts a hand-off:
 *
 * - `__e2eWindowQuirk` (WindowQuirk) makes Chromium's windows API behave like Arc's for the popups
 *   the product creates (only those; other windows are untouched):
 *   - `none` (or unset): pass-through;
 *   - `arc`: windows.create ignores the bounds (the popup comes out ARC_CREATED, 1512x949); the first
 *     update of the popup, an update without `state:'normal'`, and one issued less than
 *     ARC_UPDATE_GRACE_MS after the create are silently dropped (the observed live behaviour, F1, and
 *     the Arc research: Arc often ignores the first windows.update);
 *   - `arcLate`: windows.create honours the bounds, but ARC_LATE_MS later "Arc" re-places the window
 *     at ARC_CREATED, overriding an early fit; updates without `state:'normal'` are dropped;
 *   - `ignoreAll`: the create ignores the bounds and every product update is dropped (forces the
 *     guided resize, W3). The spec then acts as the human with chrome.windows.update from the
 *     extension service worker (or CDP Browser.setWindowBounds), which bypasses this shim.
 * - `__e2eResizeTimeoutMs` (number): a shorter guided-resize deadline (W3); the reducer ignores it in
 *   live builds and when it is not below RESIZE_TIMEOUT_MS.
 * - `__e2ePortraitShimOff` (true): the portrait shim (AM37, src/agent/portrait-shim.ts) only reads the
 *   page's screen orientation instead of installing itself, so a spec can show what Instagram's composer
 *   does on a landscape screen without it (the headless E2E screen is landscape, HEADLESS_SCREEN_ARGS).
 *   `'home'` (SH-1): it only reads on every page but /create/story (the tab's URL at the injection), so
 *   it installs itself first at the injection that follows the pick's SPA navigation, after the
 *   composer mounted: the late shim the reducer must catch. Read at every injection; live builds never
 *   read it (the runner gets no test hooks there).
 */
import { browser } from 'wxt/browser';
import type { WindowsPort, WindowUpdate } from './windows.ts';

export const WINDOW_QUIRKS = ['none', 'arc', 'arcLate', 'ignoreAll'] as const;
export type WindowQuirk = (typeof WINDOW_QUIRKS)[number];

/** storage.local key of the window quirk. */
export const WINDOW_QUIRK_KEY = '__e2eWindowQuirk';
/** storage.local key of the shorter guided-resize deadline. */
export const RESIZE_TIMEOUT_KEY = '__e2eResizeTimeoutMs';
/** storage.local key that switches the portrait shim off (AM37). */
export const PORTRAIT_SHIM_OFF_KEY = '__e2ePortraitShimOff';

/** The size Arc gave the popup whatever windows.create asked for (2026-10-12 live run). */
export const ARC_CREATED = { width: 1512, height: 949 } as const;
/** `arc`: updates issued this soon after the create are dropped (the failed run's update came at ~280 ms). */
export const ARC_UPDATE_GRACE_MS = 400;
/** `arcLate`: "Arc" re-places the popup this long after the create. */
export const ARC_LATE_MS = 500;

export interface QuirkDeps {
  readQuirk(): Promise<WindowQuirk>;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

async function readLocal(key: string): Promise<unknown> {
  try {
    return (await browser.storage.local.get(key))[key];
  } catch {
    return undefined;
  }
}

const isQuirk = (x: unknown): x is WindowQuirk => (WINDOW_QUIRKS as readonly unknown[]).includes(x);

export const defaultQuirkDeps: QuirkDeps = {
  readQuirk: async () => {
    const v = await readLocal(WINDOW_QUIRK_KEY);
    return isQuirk(v) ? v : 'none';
  },
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
};

/**
 * Whether the quirk drops this update of a popup it created at `createdAt`. `first`: no update of
 * that popup came before this one.
 */
export function quirkDrops(
  quirk: WindowQuirk,
  update: WindowUpdate,
  createdAt: number,
  now: number,
  first = false,
): boolean {
  switch (quirk) {
    case 'none':
      return false;
    case 'ignoreAll':
      return true;
    case 'arcLate':
      return update.state !== 'normal';
    case 'arc':
      return first || update.state !== 'normal' || now - createdAt < ARC_UPDATE_GRACE_MS;
  }
}

/** Wraps a WindowsPort so the product's popups get the quirk storage.local names at their creation. */
export function withWindowQuirk(base: WindowsPort, deps: QuirkDeps = defaultQuirkDeps): WindowsPort {
  const popups = new Map<number, { quirk: WindowQuirk; createdAt: number; updates: number }>();
  return {
    ...base,
    async createPopup(box) {
      const quirk = await deps.readQuirk();
      if (quirk === 'none') return base.createPopup(box);
      const ignoresBounds = quirk === 'arc' || quirk === 'ignoreAll';
      const created = await base.createPopup(ignoresBounds ? { left: box.left, top: box.top, ...ARC_CREATED } : box);
      popups.set(created.windowId, { quirk, createdAt: deps.now(), updates: 0 });
      if (quirk === 'arcLate') {
        deps.setTimeout(() => {
          base.update(created.windowId, { state: 'normal', ...ARC_CREATED }).catch(() => undefined);
        }, ARC_LATE_MS);
      }
      return created;
    },
    async update(windowId, update) {
      const p = popups.get(windowId);
      if (p) p.updates++;
      if (p && quirkDrops(p.quirk, update, p.createdAt, deps.now(), p.updates === 1)) return;
      await base.update(windowId, update);
    },
    async remove(windowId) {
      popups.delete(windowId);
      await base.remove(windowId);
    },
  };
}

/** The runner's test hooks (RunnerEnv.e2e), guarded builds only. */
export interface RunnerTestHooks {
  /** W3: a shorter guided-resize deadline, or undefined. */
  resizeTimeoutMs(): Promise<number | undefined>;
  /**
   * AM37: true when the portrait shim must only read the orientation (storage.local flag set to true);
   * `'home'` (SH-1) when it must only read off the composer (flag set to 'home'); false otherwise.
   */
  portraitShimOff(): Promise<boolean | 'home'>;
}

export const e2eRunnerHooks: RunnerTestHooks = {
  async resizeTimeoutMs() {
    const v = await readLocal(RESIZE_TIMEOUT_KEY);
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
  },
  async portraitShimOff() {
    const v = await readLocal(PORTRAIT_SHIM_OFF_KEY);
    return v === 'home' ? 'home' : v === true;
  },
};
