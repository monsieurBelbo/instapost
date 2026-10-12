/**
 * E13 (strategy §7.11, §3.9 C8, A6, A18, §11 AM13): for each composer geometry model, the
 * agent's C8 report of the ready composer equals the fake's ground truth
 * (`document.documentElement.dataset.fakeGeometry`): backing size, CSS rect, DPR and inner size.
 * And a popup forced to landscape is refitted once, then probed portrait.
 *
 * - C8 is the report the background asks for when the composer becomes ready (AM13); it lands
 *   in the record as `readyProbe` and `preflight.C8`.
 * - **cssFixed:360x640 runs in a smaller popup.** In the default fitted popup (511x909 on the
 *   owner's screen, S8) a 360x640 CSS canvas covers 49.6% of the viewport, below C6's 50%, so the
 *   composer never counts as ready and no C8 is taken; C6's threshold is the contract's and is
 *   kept. The case sets `composerProfile` to 450x800 (the setting L5/D7 will write; it has no UI
 *   yet, so the test writes it to storage.local), where the box covers 64%.
 */
import type { Worker } from '@playwright/test';
import type { HandoffRecord } from '../../src/core/handoff/state.ts';
import { type ExtGlobal, expect, test, whenClosed } from './fixtures.ts';
import {
  cancelHandoff,
  loadPhoto,
  photoFile,
  postFromDesktop,
  setSwitches,
  shownError,
  waitPhase,
} from './helpers/editor-flow.ts';
import { fakeGeometry } from './helpers/fake-page.ts';

const MODELS = ['viewportDpr', 'source', 'fixed:1080x1920', 'cssFixed:360x640'] as const;
const SMALL_POPUP = { innerW: 450, innerH: 800 };

async function lastRecord(records: () => Promise<HandoffRecord[]>): Promise<HandoffRecord> {
  const rec = (await records()).at(-1);
  if (!rec) throw new Error('no hand-off record');
  return rec;
}

for (const model of MODELS) {
  test(`E13 geometry ${model}: the agent's C8 report equals the fake's ground truth`, async ({
    context,
    extension,
    editor,
    composer,
    fake,
    handoffRecords,
  }, testInfo) => {
    await fake.setKnobs({ geometry: model });
    if (model.startsWith('cssFixed:')) {
      await extension.sw.evaluate(async (profile) => {
        const { local } = (globalThis as ExtGlobal).chrome.storage;
        const { settings } = await local.get('settings');
        await local.set({ settings: { ...(settings ?? {}), composerProfile: { ...profile, capturedAt: Date.now() } } });
      }, SMALL_POPUP);
    }
    const page = await editor();
    await setSwitches(page, { assisted: true });
    await loadPhoto(page, await photoFile(context, testInfo));
    await postFromDesktop(page);
    const popup = await composer();
    await waitPhase(page, 'awaitingShare');
    // The C8 report of the ready composer reaches the panel.
    await expect(page.getByTestId('handoff-probe')).toContainText('Canvas');
    const truth = await fakeGeometry(popup);
    await cancelHandoff(page);
    await whenClosed(popup);
    await waitPhase(page, 'idle');

    const rec = await lastRecord(handoffRecords);
    const c8 = { inner: truth.inner, dpr: truth.dpr, canvas: { w: truth.canvas.w, h: truth.canvas.h, css: truth.css } };
    expect(rec.preflight?.C8).toEqual(c8);
    expect(rec.readyProbe).toMatchObject(c8);
    testInfo.annotations.push({ type: 'C8', description: JSON.stringify(c8) });

    // Each model's own signature, so a wrong knob cannot pass by accident.
    const { canvas, css, dpr } = truth;
    switch (model) {
      case 'viewportDpr':
        expect(canvas).toEqual({ w: Math.round(css.w * dpr), h: Math.round(css.h * dpr) });
        break;
      case 'source':
      case 'fixed:1080x1920':
        // The source is the 1080x1920 export; `fixed` is 1080x1920 by definition.
        expect(canvas).toEqual({ w: 1080, h: 1920 });
        break;
      case 'cssFixed:360x640':
        expect({ w: css.w, h: css.h }).toEqual({ w: 360, h: 640 });
        expect(canvas).toEqual({ w: 360 * dpr, h: 640 * dpr });
        expect(truth.inner).toEqual({ w: SMALL_POPUP.innerW, h: SMALL_POPUP.innerH });
        break;
    }
  });
}

/** Records the bounds of the composer window after the test forced it to landscape. */
interface BoundsLog {
  forcedWindow: number | null;
  bounds: { w: number; h: number }[];
}

async function forceLandscapeOnFirstLoad(sw: Worker): Promise<void> {
  await sw.evaluate(() => {
    const g = globalThis as ExtGlobal & { __e2eGeo?: BoundsLog };
    const log: BoundsLog = { forcedWindow: null, bounds: [] };
    g.__e2eGeo = log;
    // The first document load of the composer: the extension has already fitted the window.
    g.chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
      if (log.forcedWindow !== null || info.status !== 'loading') return;
      if (!tab.url?.startsWith('https://www.instagram.com/')) return;
      log.forcedWindow = tab.windowId;
      void g.chrome.windows.update(tab.windowId, { width: 960, height: 600 });
    });
    g.chrome.windows.onBoundsChanged.addListener((w) => {
      if (w.id === log.forcedWindow) log.bounds.push({ w: w.width ?? 0, h: w.height ?? 0 });
    });
  });
}

test('E13 a popup forced to landscape is refitted once, then probed portrait', async ({
  extension,
  editor,
  composer,
  handoffRecords,
}, testInfo) => {
  await forceLandscapeOnFirstLoad(extension.sw);
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBeNull();

  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('not-posted');
  expect(rec.probe?.portrait).toBe(true);
  expect(rec.preflight?.C3).toBe('pass');
  const log = (await extension.sw.evaluate(() => (globalThis as { __e2eGeo?: BoundsLog }).__e2eGeo)) as BoundsLog;
  expect(log.forcedWindow).not.toBeNull();
  testInfo.annotations.push({ type: 'bounds after forcing', description: JSON.stringify(log.bounds) });
  // Landscape first (the test), then exactly one change back to portrait (the extension's refit).
  const portrait = log.bounds.filter((b) => b.h > b.w);
  expect(log.bounds[0]?.w).toBeGreaterThan(log.bounds[0]?.h ?? Number.POSITIVE_INFINITY);
  expect(portrait).toHaveLength(1);
  expect(log.bounds.at(-1)).toEqual(portrait[0]);
});
