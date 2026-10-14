/**
 * E13 (strategy §7.11, §3.9 C8, A6, A18, §11 AM13): for each composer geometry model, the agent's C8
 * report of the drawn composer equals the fake's ground truth: backing size, CSS rect, DPR and inner size.
 * And a popup forced to landscape is refitted once, then probed portrait.
 *
 * - C8 is the report the background asks for when the autopilot's compose watch saw the photo drawn
 *   (composeReady, AM13); it lands in the record as `readyProbe` and `preflight.C8`. A Test run ends at the
 *   compose fact and takes no C8, so this runs a Post story: Posted on the live artifact, a Share test on
 *   the mock one (its static ruleset blocks the upload).
 * - The truth: the fake's `dataset.fakeGeometry` while the composer is up (mock: after the blocked upload,
 *   until the window closes), or the geometry the fake's Share sent with the upload (live: the composer goes
 *   home right after a published story).
 * - **cssFixed:360x640 now runs in the default popup.** AM14 moved it to a 450x800 popup because C6 (the
 *   canvas covering half the viewport) decided readiness; since AM39 the compose watch reads Instagram's own
 *   canvas (`canvas._aa3c`, drawn = a backing store) and C6 decides nothing, so the default window is fine
 *   (this also retires E12 v, an insert that C6 never confirmed).
 */
import type { Worker } from '@playwright/test';
import type { HandoffState } from '../../src/core/handoff/state.ts';
import { type ExtGlobal, expect, test, whenClosed } from './fixtures.ts';
import { checkConnection, lastRecord, loadPhoto, photoFile, postStory, waitResult } from './helpers/editor-flow.ts';
import { type FakeGeometry, fakeGeometry } from './helpers/fake-page.ts';

const MODELS = ['viewportDpr', 'source', 'fixed:1080x1920', 'cssFixed:360x640'] as const;

for (const model of MODELS) {
  test(`E13 geometry ${model}: the agent's C8 report equals the fake's ground truth`, async ({
    context,
    extension,
    editor,
    composer,
    fake,
    handoffState,
    handoffRecords,
  }, testInfo) => {
    await fake.setKnobs({ geometry: model });
    const page = await editor();
    await loadPhoto(page, await photoFile(context, testInfo));
    await postStory(page);
    const popup = await composer();
    let truth: FakeGeometry;
    if (extension.mode === 'mock') {
      // After Share the blocked upload leaves the composer up until the window closes.
      await expect
        .poll(async () => ((await handoffState()) as HandoffState | undefined)?.phase, {
          intervals: [50],
          timeout: 30_000,
        })
        .toBe('confirmingUpload');
      truth = await fakeGeometry(popup);
      await waitResult(page, 'shareTested');
    } else {
      await waitResult(page, 'posted');
      const [story] = await fake.stories();
      if (!story?.meta) throw new Error('no story meta');
      truth = story.meta.geometry;
    }
    await whenClosed(popup);

    const rec = await lastRecord(handoffRecords);
    const c8 = { inner: truth.inner, dpr: truth.dpr, canvas: { w: truth.canvas.w, h: truth.canvas.h, css: truth.css } };
    expect(rec.preflight?.C8).toEqual(c8);
    expect(rec.readyProbe).toMatchObject(c8);
    // The compose watch read the same backing store.
    expect(rec.compose?.canvas).toEqual({ w: truth.canvas.w, h: truth.canvas.h });
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
        // Less than half of the default window's viewport, and still drawn and shared.
        expect(css.w * css.h).toBeLessThan(0.5 * truth.inner.w * truth.inner.h);
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
      void g.chrome.windows.update(tab.windowId, { left: 0, top: 0, width: 960, height: 600 });
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
  const page = await editor();
  await checkConnection(page);
  await whenClosed(await composer());
  await waitResult(page, 'checked');

  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('checked');
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
