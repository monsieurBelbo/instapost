/**
 * The composer window from the test's side (W1–W5, F2; strategy §11 AM29): the guarded build's
 * window-quirk shim flags, and the owner's hands on the popup. Everything runs in the extension's
 * service worker through `sw.evaluate`, where `chrome.windows` is Chromium's own: the shim wraps only
 * the product's windows port, so a resize made here is the owner dragging the window, never the
 * product (src/platform/e2e-hooks.ts).
 */
import type { Worker } from '@playwright/test';
import type { WindowBox } from '../../../src/core/geometry/window-fit.ts';
import type { WindowQuirk } from '../../../src/platform/e2e-hooks.ts';
import type { ExtGlobal } from '../fixtures.ts';

export type { WindowQuirk };

/** storage.local `__e2eWindowQuirk`: read when the product creates its popup (guarded builds only). */
export async function setWindowQuirk(sw: Worker, quirk: WindowQuirk): Promise<void> {
  await sw.evaluate((q) => (globalThis as ExtGlobal).chrome.storage.local.set({ __e2eWindowQuirk: q }), quirk);
}

/** storage.local `__e2eResizeTimeoutMs`: a shorter guided-resize deadline (guarded builds only). */
export async function setResizeTimeout(sw: Worker, ms: number): Promise<void> {
  await sw.evaluate((t) => (globalThis as ExtGlobal).chrome.storage.local.set({ __e2eResizeTimeoutMs: t }), ms);
}

/**
 * storage.local `__e2ePortraitShimOff` (AM37): the portrait shim only reads the page's orientation, so
 * the composer sees the emulated landscape screen. `'home'` (SH-1): it only reads off the composer, so
 * it installs first at the injection after the pick reached the composer (after the composer mounted).
 * Guarded builds only; the live build ignores it.
 */
export async function setPortraitShimOff(sw: Worker, off: boolean | 'home'): Promise<void> {
  await sw.evaluate((v) => (globalThis as ExtGlobal).chrome.storage.local.set({ __e2ePortraitShimOff: v }), off);
}

/** The composer popup the product remembers (storage.local `composerWindow`, AM22), or null. */
export async function composerWindow(sw: Worker): Promise<{ windowId: number; tabId: number } | null> {
  return (await sw.evaluate(async () => {
    const got = await (globalThis as ExtGlobal).chrome.storage.local.get('composerWindow');
    const w = got.composerWindow as { windowId?: number; tabId?: number } | undefined;
    return w?.windowId !== undefined && w.tabId !== undefined ? { windowId: w.windowId, tabId: w.tabId } : null;
  })) as { windowId: number; tabId: number } | null;
}

/** The owner drags the window: chrome.windows.update straight from the service worker (no shim). */
export async function ownerResizes(sw: Worker, windowId: number, box: Partial<WindowBox>): Promise<void> {
  await sw.evaluate(
    async ([id, b]) => {
      await (globalThis as ExtGlobal).chrome.windows.update(id, { state: 'normal', ...b });
    },
    [windowId, box] as const,
  );
}

/** The window's outer box and its tab's size right now. */
export async function windowNow(
  sw: Worker,
  windowId: number,
): Promise<{ box: WindowBox; tab: { w: number; h: number } }> {
  return (await sw.evaluate(async (id) => {
    const { chrome } = globalThis as ExtGlobal;
    const w = await chrome.windows.get(id, { populate: true });
    const t = w.tabs?.[0];
    return {
      box: { left: w.left ?? 0, top: w.top ?? 0, width: w.width ?? 0, height: w.height ?? 0 },
      tab: { w: t?.width ?? 0, h: t?.height ?? 0 },
    };
  }, windowId)) as { box: WindowBox; tab: { w: number; h: number } };
}

/**
 * Forces the composer window to `box` (outer) on the first `loading` of a www document in it, i.e.
 * after the product fitted it and started the navigation (E13, E25): from the service worker, so
 * the guarded shim never sees it.
 */
export async function forceBoundsOnFirstLoad(sw: Worker, box: { width: number; height: number }): Promise<void> {
  await sw.evaluate((b) => {
    const g = globalThis as ExtGlobal & { __e2eForced?: number | null };
    g.__e2eForced = null;
    g.chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
      if (g.__e2eForced !== null || info.status !== 'loading') return;
      if (!tab.url?.startsWith('https://www.instagram.com/')) return;
      g.__e2eForced = tab.windowId;
      void g.chrome.windows.update(tab.windowId, { state: 'normal', ...b });
    });
  }, box);
}

/** Moves the editor's own window (the page at `editorUrlPart`) to `box`, e.g. onto the ultrawide. */
export async function moveEditorWindow(sw: Worker, editorUrlPart: string, box: WindowBox): Promise<WindowBox> {
  return (await sw.evaluate(
    async ([part, b]) => {
      const { chrome } = globalThis as ExtGlobal;
      const all = await chrome.windows.getAll({ populate: true });
      const w = all.find((x) => x.tabs?.some((t) => t.url?.includes(part)));
      if (w?.id === undefined) throw new Error('editor window not found');
      await chrome.windows.update(w.id, { state: 'normal', ...b });
      const got = await chrome.windows.get(w.id);
      return { left: got.left ?? 0, top: got.top ?? 0, width: got.width ?? 0, height: got.height ?? 0 };
    },
    [editorUrlPart, box] as const,
  )) as WindowBox;
}
