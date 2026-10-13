/**
 * F2 (2026-10-12): the guarded-build window-quirk shim that makes Chromium's windows API behave like
 * Arc's for the product's popups, so E2E can drive W2/W3. The live bundle never contains it (T3).
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { WindowBox } from '../core/geometry/window-fit.ts';
import {
  ARC_CREATED,
  ARC_LATE_MS,
  ARC_UPDATE_GRACE_MS,
  e2eRunnerHooks,
  PORTRAIT_SHIM_OFF_KEY,
  type QuirkDeps,
  quirkDrops,
  type WindowQuirk,
  withWindowQuirk,
} from './e2e-hooks.ts';
import type { WindowsPort, WindowUpdate } from './windows.ts';

const BOX: WindowBox = { left: 2970, top: -212, width: 524, height: 979 };

function harness(quirk: WindowQuirk) {
  let t = 0;
  const later: { at: number; fn: () => void }[] = [];
  const created: WindowBox[] = [];
  const applied: [number, WindowUpdate][] = [];
  const base: WindowsPort = {
    createPopup: async (box) => {
      created.push(box);
      return { windowId: 7, tabId: 42 };
    },
    update: async (id, u) => {
      applied.push([id, u]);
    },
    getBox: async () => BOX,
    describe: async () => null,
    remove: async () => undefined,
    onRemoved: () => () => undefined,
    onBoundsChanged: () => () => undefined,
  };
  const deps: QuirkDeps = {
    readQuirk: async () => quirk,
    now: () => t,
    setTimeout: (fn, ms) => void later.push({ at: t + ms, fn }),
  };
  const port = withWindowQuirk(base, deps);
  return {
    port,
    created,
    applied,
    advance(ms: number) {
      t += ms;
      for (const l of later.splice(0).filter((x) => x.at <= t)) l.fn();
    },
  };
}

describe('F2 window-quirk shim (guarded builds only)', () => {
  it('none: pass-through', async () => {
    const h = harness('none');
    await h.port.createPopup(BOX);
    await h.port.update(7, { width: 1 });
    expect(h.created).toEqual([BOX]);
    expect(h.applied).toEqual([[7, { width: 1 }]]);
  });

  it('arc: the create ignores the bounds; updates without state normal, or within 400 ms, are dropped', async () => {
    const h = harness('arc');
    await h.port.createPopup(BOX);
    expect(h.created).toEqual([{ left: BOX.left, top: BOX.top, ...ARC_CREATED }]);
    await h.port.update(7, { state: 'normal', ...BOX }); // ~280 ms in the failed run: too early
    h.advance(ARC_UPDATE_GRACE_MS);
    await h.port.update(7, { ...BOX }); // no state: dropped
    await h.port.update(7, { state: 'normal', ...BOX });
    expect(h.applied).toEqual([[7, { state: 'normal', ...BOX }]]);
    // Other windows (the editor's) are untouched.
    await h.port.update(3, { focused: true });
    expect(h.applied.at(-1)).toEqual([3, { focused: true }]);
  });

  it('arc: the first update of the popup is dropped even when it comes late and with state normal', async () => {
    const h = harness('arc');
    await h.port.createPopup(BOX);
    h.advance(ARC_UPDATE_GRACE_MS * 3);
    await h.port.update(7, { state: 'normal', ...BOX });
    expect(h.applied).toEqual([]);
    await h.port.update(7, { state: 'normal', ...BOX });
    expect(h.applied).toEqual([[7, { state: 'normal', ...BOX }]]);
    expect(quirkDrops('arc', { state: 'normal' }, 0, 1e9, true)).toBe(true);
    expect(quirkDrops('arc', { state: 'normal' }, 0, 1e9, false)).toBe(false);
  });

  it('arcLate: the create is honoured, then re-placed 500 ms later', async () => {
    const h = harness('arcLate');
    await h.port.createPopup(BOX);
    expect(h.created).toEqual([BOX]);
    await h.port.update(7, { state: 'normal', ...BOX });
    h.advance(ARC_LATE_MS);
    expect(h.applied).toEqual([
      [7, { state: 'normal', ...BOX }],
      [7, { state: 'normal', ...ARC_CREATED }],
    ]);
  });

  it('ignoreAll: every product update is dropped (the guided resize must take over)', async () => {
    const h = harness('ignoreAll');
    await h.port.createPopup(BOX);
    h.advance(10_000);
    await h.port.update(7, { state: 'normal', ...BOX });
    expect(h.applied).toEqual([]);
    expect(quirkDrops('ignoreAll', { state: 'normal' }, 0, 1e9)).toBe(true);
    expect(quirkDrops('none', {}, 0, 0)).toBe(false);
  });
});

describe('AM37 / SH-1 the portrait shim’s E2E flag (guarded builds only)', () => {
  it('reads true (off everywhere), `home` (off but on the composer), and anything else as on', async () => {
    fakeBrowser.reset();
    expect(await e2eRunnerHooks.portraitShimOff()).toBe(false);
    await fakeBrowser.storage.local.set({ [PORTRAIT_SHIM_OFF_KEY]: true });
    expect(await e2eRunnerHooks.portraitShimOff()).toBe(true);
    await fakeBrowser.storage.local.set({ [PORTRAIT_SHIM_OFF_KEY]: 'home' });
    expect(await e2eRunnerHooks.portraitShimOff()).toBe('home');
    for (const v of ['yes', 1, false, 'HOME']) {
      await fakeBrowser.storage.local.set({ [PORTRAIT_SHIM_OFF_KEY]: v });
      expect(await e2eRunnerHooks.portraitShimOff(), String(v)).toBe(false);
    }
  });
});
