/**
 * E20–E27 (strategy §7.11; §11 AM29–AM35): the first live run in Arc (2026-10-12) failed with
 * DESKTOP_SHELL in a 1512x902 composer window. These specs replay what went wrong, and the fixes,
 * against the production-shaped fake, on the mock and live artifacts.
 *
 * | Id  | Case (E2E list of 2026-10-12)                     | Expected                                        |
 * |-----|---------------------------------------------------|-------------------------------------------------|
 * | E20 | (a) quirk `arc`, `arcLate`; live: the flags inert | fitted before Instagram loads, no resize, no refit |
 * | E21 | (b) quirk `ignoreAll`, the owner resizes          | `resizing` with the live size, then it proceeds |
 * | E22 | (c) quirk `ignoreAll`, nobody resizes; Cancel     | WINDOW_NOT_FITTED / abandoned, Instagram never loaded |
 * | E23 | (d) default worker (claimOnRegister)              | controlled, workerStart 0, counted, posted      |
 * | E24 | (f) composer wider than 767 CSS px, portrait      | refit then H1; refit refused → LAYOUT_TOO_WIDE   |
 * | E25 | (h) H1 into the header input after hydration (P5) | input wait, insert, SPA to the composer, posted |
 * | E26 | (i) the owner's two displays, editor on the ultrawide | popup centred there and fitted               |
 * | E27 | P6 Arc's page colours on the editor               | mock: BRANDED_BROWSER; live: recorded `arc`      |
 *
 * (e) is E12 (a)/(a2) and (g) is E6. The window quirks exist only in guarded builds (the shim is
 * compiled out of live, check-bundle T3), so E20–E22 and E24's second half run in mock; E20 (live)
 * proves the flags do nothing there. The owner's hand on the window is chrome.windows.update from
 * the extension's service worker, which the shim never sees (helpers/window.ts).
 */
import { writeFile } from 'node:fs/promises';
import type { TestInfo } from '@playwright/test';
import { MIN_INNER_H } from '../../src/core/geometry/window-fit.ts';
import type { HandoffRecord } from '../../src/core/handoff/state.ts';
import { ARC_CREATED } from '../../src/platform/e2e-hooks.ts';
import { expect, IG_ORIGIN, test, whenClosed } from './fixtures.ts';
import {
  cancelHandoff,
  loadPhoto,
  phaseLocator,
  photoFile,
  postFromDesktop,
  setSwitches,
  shownError,
  waitPhase,
  waitSeen,
} from './helpers/editor-flow.ts';
import type { FakeClient, RequestRecord } from './helpers/fake-client.ts';
import { countUntrustedFileChanges, fakeInputOutcome, untrustedFileChanges } from './helpers/fake-page.ts';
import {
  composerWindow,
  forceBoundsOnFirstLoad,
  moveEditorWindow,
  ownerResizes,
  setResizeTimeout,
  setWindowQuirk,
  windowNow,
} from './helpers/window.ts';

const MSITE_MAX = 767;

async function lastRecord(records: () => Promise<HandoffRecord[]>): Promise<HandoffRecord> {
  const rec = (await records()).at(-1);
  if (!rec) throw new Error('no hand-off record');
  return rec;
}

const phasesOf = (rec: HandoffRecord) => rec.phaseLog.map((p) => p.phase);
const lastSeq = async (fake: FakeClient): Promise<number> => (await fake.requests()).at(-1)?.seq ?? 0;
const wwwDocuments = (rs: RequestRecord[]) =>
  rs.filter((r) => r.host === 'www.instagram.com' && r.fetch['sec-fetch-dest'] === 'document');

async function exportFile(exportBytes: (id: string) => Promise<Buffer>, id: string, testInfo: TestInfo) {
  const path = testInfo.outputPath('story.png');
  await writeFile(path, await exportBytes(id));
  return path;
}

/** The window diagnostics on a record (W5), which every hand-off that opened a popup has. */
function windowOf(rec: HandoffRecord): NonNullable<HandoffRecord['window']> {
  if (!rec.window) throw new Error('no window diagnostics on the record');
  return rec.window;
}

// ---------------------------------------------------------------------------------------------
// E20 (a): Arc ignores the create's bounds and early updates, and re-places new popups late

test('E20 (a) quirk arc: the create and the first updates are ignored; re-applied while about:blank, fitted, no resize', async ({
  extension,
  editor,
  composer,
  handoffRecords,
}) => {
  test.skip(extension.mode === 'live', 'the window-quirk shim exists in guarded builds only (E20 live checks that)');
  await setWindowQuirk(extension.sw, 'arc');
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBeNull();

  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('not-posted');
  const w = windowOf(rec);
  // The record shows what Arc did: created ≠ requested (F1) ...
  expect(w.created).toMatchObject(ARC_CREATED);
  expect({ width: w.requested.width, height: w.requested.height }).not.toEqual(ARC_CREATED);
  // ... and that one attempt fitted it, with the box re-applied (the first update is always dropped).
  expect(w.attempts).toBe(1);
  expect(w.updates).toHaveLength(1);
  const fit = w.updates[0];
  expect(fit).toMatchObject({ step: 'fit', fitted: true });
  expect(fit?.applied).toBeGreaterThanOrEqual(2);
  expect(w.finalTab).toEqual(fit?.target);
  expect(w.manualResize).toBe(false);
  // Instagram only ever saw the fitted window.
  expect(phasesOf(rec)).not.toContain('resizing');
  expect(rec.probe?.inner).toEqual(w.finalTab);
  expect(rec.probe?.inner.w).toBeLessThanOrEqual(MSITE_MAX);
  expect(rec.probe?.portrait).toBe(true);
  await expect(page.locator('[data-row="window"]')).toHaveText(
    new RegExp(
      `\\(1 attempt, size re-applied: \\d updates; opened at 1512×949 instead of ${w.requested.width}×${w.requested.height}\\)$`,
    ),
  );
});

test('E20 (a) quirk arcLate: a popup re-placed 500 ms after the create is re-fitted before Instagram loads, no refit', async ({
  extension,
  editor,
  composer,
  handoffRecords,
}, testInfo) => {
  test.skip(extension.mode === 'live', 'the window-quirk shim exists in guarded builds only');
  await setWindowQuirk(extension.sw, 'arcLate');
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBeNull();

  const rec = await lastRecord(handoffRecords);
  const w = windowOf(rec);
  testInfo.annotations.push({ type: 'window', description: JSON.stringify(w.updates) });
  // The fit held (FIT_HOLD_MS) past the late re-placement, so the composer loaded narrow and tall:
  // no refit after the navigation (Instagram never saw the 1512 px window).
  expect(w.updates.map((u) => u.step)).toEqual(['fit']);
  expect(w.updates[0]?.fitted).toBe(true);
  expect(phasesOf(rec)).not.toContain('resizing');
  expect(rec.probe?.inner).toEqual(w.finalTab);
  expect(rec.probe?.inner.w).toBeLessThanOrEqual(MSITE_MAX);
  expect(rec.probe?.portrait).toBe(true);
});

test('E20 (live) the window-quirk flags do nothing in the live build: no shim, plain fit', async ({
  extension,
  editor,
  composer,
  handoffRecords,
}) => {
  test.skip(extension.mode !== 'live', 'mock honours the flags (E20–E22)');
  await setWindowQuirk(extension.sw, 'ignoreAll');
  await setResizeTimeout(extension.sw, 1000);
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBeNull();
  const rec = await lastRecord(handoffRecords);
  const w = windowOf(rec);
  expect(rec.outcome).toBe('not-posted');
  expect(phasesOf(rec)).not.toContain('resizing');
  // Chromium honoured the create; the one update fitted at once.
  expect(w.created).toEqual(w.requested);
  expect(w.updates).toEqual([expect.objectContaining({ step: 'fit', fitted: true, applied: 1 })]);
});

// ---------------------------------------------------------------------------------------------
// E21 (b) / E22 (c): every programmatic update ignored → the guided resize (W3)

test('E21 (b) quirk ignoreAll: resizing with the live size; the owner drags it narrow and tall; it proceeds', async ({
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
}) => {
  test.skip(extension.mode === 'live', 'the window-quirk shim exists in guarded builds only');
  await setWindowQuirk(extension.sw, 'ignoreAll');
  const since = await lastSeq(fake);
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  await waitPhase(page, 'resizing', 15_000);

  // The panel asks for the resize and shows the size now: Arc's 1512 px wide window, not usable.
  await expect(page.getByTestId('handoff-resize')).toContainText('narrow and tall');
  // AF-8: the width it names is the one its ✓ uses (767 at this window's 100% zoom).
  await expect(page.getByTestId('handoff-resize')).toContainText('at most 767 px wide, taller than wide');
  const size = page.getByTestId('handoff-resize-size');
  await expect(size).toHaveAttribute('data-ok', 'false');
  await expect(size).toHaveAttribute('data-w', String(ARC_CREATED.width));
  await expect(size).toHaveText(/^1512×\d+ ✗$/);
  // Instagram has not been loaded: the popup is still about:blank.
  expect(wwwDocuments(await fake.requests(since))).toEqual([]);
  const popup = await composerWindow(extension.sw);
  if (!popup) throw new Error('no composer window');

  // A first drag: portrait but still too wide. The indicator follows (windows.onBoundsChanged).
  await ownerResizes(extension.sw, popup.windowId, { width: 900, height: 1000 });
  await expect(size).toHaveAttribute('data-w', '900');
  await expect(size).toHaveAttribute('data-ok', 'false');
  expect(wwwDocuments(await fake.requests(since))).toEqual([]);

  // Narrow and tall: it carries on by itself.
  const composerPage = composer();
  await ownerResizes(extension.sw, popup.windowId, { width: 524, height: 1012 });
  await whenClosed(await composerPage);
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBeNull();

  const rec = await lastRecord(handoffRecords);
  const w = windowOf(rec);
  expect(rec.outcome).toBe('not-posted');
  expect(phasesOf(rec)).toEqual(expect.arrayContaining(['fitting', 'resizing', 'navigating', 'probing']));
  expect(w.manualResize).toBe(true);
  expect(w.attempts).toBe(2);
  // Both pre-navigation attempts re-applied the box on the whole schedule, all ignored.
  expect(w.updates.map((u) => [u.step, u.fitted, u.applied])).toEqual([
    ['fit', false, 5],
    ['retry', false, 5],
  ]);
  expect(w.finalTab?.w).toBe(524);
  expect(rec.probe?.inner).toEqual(w.finalTab);
  expect(rec.probe?.portrait).toBe(true);
  await expect(page.locator('[data-row="window"]')).toContainText('resized by you');
});

test('E22 (c) quirk ignoreAll, nobody resizes: WINDOW_NOT_FITTED, phone fallback, Instagram never loaded; Cancel too', async ({
  context,
  extension,
  editor,
  fake,
  handoffRecords,
  sessionRules,
  storedSettings,
  clearRateLog,
}, testInfo) => {
  test.skip(extension.mode === 'live', 'the window-quirk shim exists in guarded builds only');
  await setWindowQuirk(extension.sw, 'ignoreAll');
  await setResizeTimeout(extension.sw, 2500);
  const since = await lastSeq(fake);
  const page = await editor();
  await setSwitches(page, { assisted: false });
  await loadPhoto(page, await photoFile(context, testInfo));
  const opened = context.waitForEvent('page');
  await postFromDesktop(page);
  const popup = await opened;
  await waitPhase(page, 'resizing', 15_000);
  await whenClosed(popup);
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('WINDOW_NOT_FITTED');
  await expect(page.getByTestId('handoff-error')).toContainText('could not be made narrow and tall');
  await expect(page.getByTestId('handoff-error')).toContainText('Use Share… or AirDrop to post it from the phone');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:WINDOW_NOT_FITTED');
  expect(windowOf(rec)).toMatchObject({ attempts: 2, manualResize: false });
  expect(phasesOf(rec)).not.toContain('navigating');
  // Nothing reached Instagram at all: the popup never left about:blank.
  expect(await fake.requests(since)).toEqual([]);
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
  expect(await sessionRules()).toEqual([]);

  // Cancel while the owner is asked to resize: closed, nothing loaded either.
  await clearRateLog();
  const second = context.waitForEvent('page');
  await postFromDesktop(page);
  const popup2 = await second;
  await waitPhase(page, 'resizing', 15_000);
  await cancelHandoff(page);
  await whenClosed(popup2);
  await waitPhase(page, 'idle');
  expect((await lastRecord(handoffRecords)).outcome).toBe('abandoned');
  expect(await fake.requests(since)).toEqual([]);
  expect(await sessionRules()).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// E23 (d): Instagram's worker (F2) claims every composer page; it has no fetch handler

test('E23 (d) default worker (claimOnRegister): the composer is controlled, its requests are not handled (workerStart 0), posted', async ({
  context,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: false });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');

  // The page registered Instagram's kind of worker for this load (F2) and it took control ...
  await expect.poll(() => popup.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const scriptUrl = await popup.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '');
  expect(scriptUrl).toMatch(
    /^https:\/\/www\.instagram\.com\/fake-sw\/claim-on-register\.js\?enableAddToHomeScreen=true&zenon_device_id=\w+$/,
  );
  // ... but handled none of its requests: the beacon sent on `controllerchange`, and every other
  // www request, kept workerStart 0 (P3's tripwire stays quiet; rule 1001 applied to them).
  const timing = async () =>
    popup.evaluate(() =>
      (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .filter((e) => e.name.startsWith('https://www.instagram.com/'))
        .map((e) => ({ name: new URL(e.name).pathname, workerStart: e.workerStart })),
    );
  await expect.poll(async () => (await timing()).some((e) => e.name === '/fake-static/beacon')).toBe(true);
  for (const e of await timing()) expect(e.workerStart, e.name).toBe(0);
  const beacon = (await fake.requests()).find((r) => r.path.startsWith('/fake-static/beacon'));
  expect(beacon?.classification.is_mobile).toBe(true);
  expect(await shownError(page)).toBeNull();

  await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo));
  await waitPhase(page, 'awaitingShare');
  // The C8 report of the ready composer, which by now is controlled.
  await expect(page.locator('[data-row="service-worker"]')).toHaveText('controls the page — normal on Instagram');
  const closed = whenClosed(popup);
  await human.share(popup);
  await waitSeen(page, 'finished');
  await closed;
  await waitPhase(page, 'idle');

  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('posted-confirmed');
  expect(rec.swControllerChanges).toBeGreaterThanOrEqual(1);
  expect(rec.preflight?.swIntercepted).toBe(false);
  expect(rec.readyProbe?.swControlled).toBe(true);
  expect(rec.readyProbe?.swIntercepted).toBe(false);
  expect(await fake.stories()).toHaveLength(1);
});

// ---------------------------------------------------------------------------------------------
// E24 (f): msite has no + → Story above 767 CSS px (F3, W4/P4)

test('E24 (f) a portrait composer 900 px wide: the wide layout has no story input; one refit, then H1 from the header', async ({
  context,
  extension,
  editor,
  composer,
  human,
  handoffRecords,
  fake,
}, testInfo) => {
  await forceBoundsOnFirstLoad(extension.sw, { width: 900, height: 1332 });
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingShare', 30_000);
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H1');
  await expect(popup).toHaveURL(`${IG_ORIGIN}/create/story/`);
  // After the refit the breakpoint re-rendered msite's mobile layout (live), with the header input.
  expect(
    await popup.evaluate(() => document.querySelector('[data-fake-layout]')?.getAttribute('data-fake-layout')),
  ).toBe('mobile');
  const closed = whenClosed(popup);
  await human.share(popup);
  await waitSeen(page, 'finished');
  await closed;
  await waitPhase(page, 'idle');

  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('posted-confirmed');
  expect(rec.level).toBe('H1');
  const w = windowOf(rec);
  expect(w.updates.map((u) => u.step)).toEqual(['fit', 'refit']);
  const refit = w.updates[1];
  expect(refit?.fitted).toBe(true);
  // The refit's own update: one windows.update, no pre-navigation re-applies.
  expect(refit?.applied).toBe(1);
  expect(refit?.target.w).toBeLessThanOrEqual(MSITE_MAX);
  expect(rec.probe?.inner.w).toBeLessThanOrEqual(MSITE_MAX);
  await expect(page.locator('[data-row="window"]')).toContainText('; refitted once');
  expect(await fake.stories()).toHaveLength(1);
});

test('E24 (f) the refit is refused too (quirk ignoreAll after a resize by hand): LAYOUT_TOO_WIDE, C4 not checked', async ({
  extension,
  editor,
  composer,
  handoffRecords,
  storedSettings,
}) => {
  test.skip(extension.mode === 'live', 'the window-quirk shim exists in guarded builds only');
  await setWindowQuirk(extension.sw, 'ignoreAll');
  // Once Instagram loads, the window is forced 900 px wide (portrait); the refit's update is dropped.
  await forceBoundsOnFirstLoad(extension.sw, { width: 900, height: 1332 });
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  await waitPhase(page, 'resizing', 15_000);
  const popup = await composerWindow(extension.sw);
  if (!popup) throw new Error('no composer window');
  const composerPage = composer();
  await ownerResizes(extension.sw, popup.windowId, { width: 524, height: 1012 });
  await whenClosed(await composerPage);
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('LAYOUT_TOO_WIDE');
  await expect(page.locator('[data-row="story-input"]')).toHaveText(
    'none (no file input on the page) (not checked: stopped before this step)',
  );
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:LAYOUT_TOO_WIDE');
  expect(rec.preflight?.C4).toBe('unknown');
  expect(rec.probe?.inner.w).toBeGreaterThan(MSITE_MAX);
  expect(rec.probe?.portrait).toBe(true);
  expect(windowOf(rec).updates.map((u) => [u.step, u.fitted])).toEqual([
    ['fit', false],
    ['retry', false],
    ['refit', false],
  ]);
  // AF-7: the Window row does not claim a refit that the browser dropped.
  const row = page.locator('[data-row="window"]');
  await expect(row).toContainText('; resized by you; refit not honoured');
  await expect(row).not.toContainText('refitted once');
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
});

// ---------------------------------------------------------------------------------------------
// E25 (h): P5, the header input mounts after hydration; H1 opens the composer by SPA navigation

test('E25 (h) hydrateMs=1500: the input wait catches the late header input; H1 into it opens the composer in-page; posted', async ({
  context,
  editor,
  composer,
  fake,
  human,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ hydrateMs: 1500 });
  await countUntrustedFileChanges(context);
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const posted = await lastSeq(fake);
  await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingShare', 30_000);
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H1');
  expect(await shownError(page)).toBeNull();
  // The insert went into the header's story input on home and started msite's story session ...
  expect(await untrustedFileChanges(popup)).toBe(1);
  expect(await fakeInputOutcome(popup)).toBe('accepted');
  // ... which navigated in-page: no document after the hard reload of `/` (AM16 same-document resume).
  await expect(popup).toHaveURL(`${IG_ORIGIN}/create/story/`);
  expect(wwwDocuments(await fake.requests(posted)).map((r) => r.path)).toEqual(['/create/story/', '/', '/']);
  const closed = whenClosed(popup);
  await human.share(popup);
  await waitSeen(page, 'finished');
  await closed;
  await waitPhase(page, 'idle');

  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ level: 'H1', outcome: 'posted-confirmed', route: 'homeOnly' });
  expect(rec.preflight?.C4).toBe('pass');
  // The first probe at `complete` saw no input yet; the re-probe after `input-appeared` decided H1.
  expect(phasesOf(rec).filter((p) => p === 'injecting').length).toBeGreaterThanOrEqual(1);
  const stories = await fake.stories();
  expect(stories).toHaveLength(1);
  expect(stories[0]?.isTrusted).toBe(true);
  expect(stories[0]?.meta?.path).toBe('/create/story/');
});

// ---------------------------------------------------------------------------------------------
// E26 (i): the owner's two displays, the editor on the ultrawide (S11)

test.describe('on the owner’s two displays (MacBook + ultrawide at 1512,-428)', () => {
  test.use({ screens: 'ownerDual' });

  test('E26 (i) @smoke the editor on the ultrawide: the popup is centred there and fitted (Arc quirk in mock)', async ({
    context,
    extension,
    editor,
    composer,
    handoffRecords,
  }, testInfo) => {
    if (extension.mode === 'mock') await setWindowQuirk(extension.sw, 'arc');
    const page = await editor();
    await moveEditorWindow(extension.sw, 'editor.html', { left: 1612, top: -378, width: 1400, height: 1000 });
    // The editor now reads the ultrawide's work area, as the owner's did on 2026-10-12.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = screen as Screen & { availLeft: number; availTop: number };
          return [s.availLeft, s.availTop, s.availWidth, s.availHeight, devicePixelRatio];
        }),
      )
      .toEqual([1512, -428, 3440, 1410, 1]);
    await setSwitches(page, { assisted: false });
    await loadPhoto(page, await photoFile(context, testInfo));
    await postFromDesktop(page);
    const popup = await composer();
    await waitPhase(page, 'awaitingPick');
    const win = await composerWindow(extension.sw);
    if (!win) throw new Error('no composer window');
    const now = await windowNow(extension.sw, win.windowId);
    testInfo.annotations.push({ type: 'popup', description: JSON.stringify(now) });
    // 524x932 inner (9:16 at the default 932 px) plus the frame, centred in the ultrawide's work area.
    expect(now.tab).toEqual({ w: 524, h: 932 });
    expect(now.box.left).toBe(1512 + Math.round((3440 - now.box.width) / 2));
    expect(now.box.top).toBe(-428 + Math.round((1410 - now.box.height) / 2));
    expect(now.box.left + now.box.width).toBeLessThanOrEqual(1512 + 3440);
    expect(now.box.top).toBeGreaterThanOrEqual(-428);
    expect(await popup.evaluate(() => [innerWidth, innerHeight, devicePixelRatio])).toEqual([524, 932, 1]);
    await cancelHandoff(page);
    await whenClosed(popup);
    await waitPhase(page, 'idle');

    const rec = await lastRecord(handoffRecords);
    const w = windowOf(rec);
    expect(w.screen).toEqual({ availLeft: 1512, availTop: -428, availWidth: 3440, availHeight: 1410 });
    // The first guess: 524x1012 at (2970,-229), what the owner's console experiment asked for too.
    expect(w.requested).toEqual({ left: 2970, top: -229, width: 524, height: 1012 });
    if (extension.mode === 'mock') {
      expect(w.created).toMatchObject(ARC_CREATED);
      expect(w.updates[0]).toMatchObject({ step: 'fit', fitted: true });
      expect(w.updates[0]?.applied).toBeGreaterThanOrEqual(2);
    } else {
      expect(w.created).toEqual(w.requested);
    }
    expect(w.finalTab).toEqual({ w: 524, h: 932 });
    expect(rec.probe).toMatchObject({ inner: { w: 524, h: 932 }, dpr: 1, portrait: true });
    expect(rec.probe?.inner.h).toBeGreaterThanOrEqual(MIN_INNER_H);
  });
});

// ---------------------------------------------------------------------------------------------
// E27: P6, Arc recognised by its page colours

test('E27 Arc’s --arc-palette-* on the editor: mock refuses (BRANDED_BROWSER, no window); live records arc', async ({
  context,
  extension,
  editor,
  composer,
  handoffRecords,
}) => {
  const page = await editor('#/settings');
  // What Arc injects on every page root (F1); the editor reads its own.
  await page.evaluate(() => document.documentElement.style.setProperty('--arc-palette-title', '#1a1a1a'));
  let opened = 0;
  context.on('page', () => {
    opened++;
  });
  await page.getByTestId('setting-probe').click();
  if (extension.mode === 'mock') {
    await expect(page.getByTestId('handoff-error')).toHaveAttribute('data-error', 'BRANDED_BROWSER');
    await expect(page.getByTestId('handoff-error')).toContainText('Arc');
    await page.waitForTimeout(1500);
    // A refusal before any window: nothing opened (and no hand-off record exists to read).
    expect(opened).toBe(0);
    return;
  }
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBeNull();
  await expect(page.locator('[data-row="browser"]')).toHaveText('Arc (recognised by its page colours)');
  const rec = await lastRecord(handoffRecords);
  expect(rec.browser).toBe('arc');
  expect(rec.outcome).toBe('not-posted');
});
