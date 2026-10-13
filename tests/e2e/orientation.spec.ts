/**
 * E28 (strategy §7.11; §11 AM37): msite's two orientation checks and the portrait shim, against the
 * production-shaped fake, on the mock and live artifacts. The second live run in Arc (2026-10-12)
 * showed the composer's "Rotate your device to add to your story." snackbar instead of Share in a
 * fitted 503x894 portrait window, because the composer page reads `screen.orientation.type`, and a
 * desktop's landscape monitor reads `landscape-primary` whatever the window (C3b). The headless screen
 * here is the owner's MacBook (HEADLESS_SCREEN_ARGS, 1512x982, landscape), so without the shim every
 * composer would block Share; the fixtures' invariant checks that no composer did (except E28 b).
 *
 * | Id           | Case                                                     | Expected                                    |
 * |--------------|----------------------------------------------------------|---------------------------------------------|
 * | E28 (a)      | H1 with the shim (every build)                           | page reads portrait-primary on a landscape screen; Share; posted; no story session (insert) |
 * | E28 (b)      | mock: shim off (guarded E2E flag), H0 + → Story → pick    | snackbar, no Share → SCREEN_LANDSCAPE, closed, no lock, nothing posted |
 * | E28 (b) live | live: the same flag                                      | ignored (compiled out): shim installed, posted |
 * | E28 (c)      | H0: the human taps + → Story and picks                   | story session started (sessionStarted true, a uuid); Share; posted |
 * | E28 (d)      | H0: a landscape window at + → Story (C3a)                | rotate toast, no chooser; portrait again → chooser, posted |
 * | E28 (e)      | mock: the shim only installs on the composer (flag `home`), H0 pick | the composer mounted landscape first: snackbar, no Share → SCREEN_LANDSCAPE "after the composer mounted" (SH-1) |
 */
import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import type { HandoffRecord } from '../../src/core/handoff/state.ts';
import { expect, IG_ORIGIN, test, whenClosed } from './fixtures.ts';
import {
  loadPhoto,
  phaseLocator,
  photoFile,
  postFromDesktop,
  setSwitches,
  shownError,
  waitPhase,
  waitSeen,
} from './helpers/editor-flow.ts';
import { pageScreen } from './helpers/fake-page.ts';
import { composerWindow, ownerResizes, setPortraitShimOff } from './helpers/window.ts';

const ROTATE = 'Rotate your device to add to your story.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function lastRecord(records: () => Promise<HandoffRecord[]>): Promise<HandoffRecord> {
  const rec = (await records()).at(-1);
  if (!rec) throw new Error('no hand-off record');
  return rec;
}

async function exportFile(exportBytes: (id: string) => Promise<Buffer>, id: string, testInfo: TestInfo) {
  const path = testInfo.outputPath('story.png');
  await writeFile(path, await exportBytes(id));
  return path;
}

/** The page reads the shim's portrait on the emulated landscape screen; nothing else changed. */
async function expectShimmed(popup: Page): Promise<void> {
  const s = await pageScreen(popup);
  expect(s.real, 'the emulated screen is landscape').toMatch(/^landscape-/);
  expect(s.screen.w).toBeGreaterThan(s.screen.h);
  expect(s.type).toBe('portrait-primary');
  expect(s.angle).toBe(0);
  expect(s.own).toEqual(['angle', 'type']);
  expect(s.nativeProto).toBe(true);
  // The fitted window is portrait for media queries without any help.
  expect(s.mqPortrait).toBe(true);
}

/** Shares from the composer and waits for the hand-off to finish. */
async function shareAndFinish(page: Page, popup: Page, human: { share(p: Page): Promise<void> }): Promise<void> {
  await expect(popup.getByTestId('fake-landscape-snackbar')).toHaveCount(0);
  await expect(popup.getByTestId('fake-share')).toBeVisible();
  const closed = whenClosed(popup);
  await human.share(popup);
  await waitSeen(page, 'finished');
  await closed;
  await waitPhase(page, 'idle');
}

// ---------------------------------------------------------------------------------------------
// E28 (a): the shim makes the composer read portrait, so Share is there

test('E28 (a) H1 with the portrait shim: on a landscape screen the composer reads portrait-primary, shows Share, posted', async ({
  context,
  editor,
  composer,
  fake,
  human,
  handoffRecords,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingShare', 30_000);
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H1');
  await expect(popup).toHaveURL(`${IG_ORIGIN}/create/story/`);
  await expectShimmed(popup);
  // The panel's Screen row: the ready composer's reading (the shim found itself there after the
  // insert's SPA navigation).
  const row = page.locator('[data-row="screen"]');
  await expect(row).toHaveAttribute('data-type', 'portrait-primary');
  await expect(row).toHaveText('portrait-primary (portrait shim in place)');
  await shareAndFinish(page, popup, human);

  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ level: 'H1', outcome: 'posted-confirmed' });
  expect(rec.preflight).toMatchObject({ C3: 'pass', C3b: 'pass' });
  // The deciding probe on home: installed just now; the composer's C8 report: already there.
  expect(rec.probe?.orientation).toEqual({ type: 'portrait-primary', shim: 'installed' });
  expect(rec.readyProbe?.orientation).toEqual({ type: 'portrait-primary', shim: 'present' });
  // What the composer page showed: Share, by the screen reading, without a story session (the insert
  // bypasses + → Story, so Instagram's sessionId stays null).
  const views = await fake.composerViews();
  expect(views.length).toBeGreaterThanOrEqual(1);
  for (const v of views) {
    expect(v).toMatchObject({ landscape: false, share: true, via: 'screen', screenOrientation: 'portrait-primary' });
    expect(v.sessionStarted).toBe(false);
  }
  const stories = await fake.stories();
  expect(stories).toHaveLength(1);
  expect(stories[0]?.meta).toMatchObject({
    sessionStarted: false,
    sessionId: null,
    screenOrientation: 'portrait-primary',
  });
});

// ---------------------------------------------------------------------------------------------
// E28 (b): without the shim the composer blocks Share, and the extension says why

test('E28 (b) mock: the shim switched off (E2E flag) → the composer shows its rotate snackbar and no Share → SCREEN_LANDSCAPE', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
  invariants,
  storedSettings,
}, testInfo) => {
  test.skip(extension.mode === 'live', 'the shim-off flag exists in guarded builds only (E28 b live checks that)');
  invariants.allowLandscapeComposer();
  await setPortraitShimOff(extension.sw, true);
  const page = await editor();
  await setSwitches(page, { assisted: false });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  // On home the landscape reading decides nothing yet (no composer is mounted); it is shown.
  expect(await shownError(page)).toBeNull();
  const row = page.locator('[data-row="screen"]');
  await expect(row).toHaveAttribute('data-shim', 'off');
  await expect(row).toHaveText(/^landscape-\w+ \(portrait shim switched off by a test flag\)$/);
  const s = await pageScreen(popup);
  expect(s.type).toMatch(/^landscape-/);
  expect(s.own).toEqual([]);

  // + → Story passes msite's session start (the fitted window is portrait, C3a); the pick then
  // navigates in-page to the composer, which reads the landscape screen (C3b).
  const closed = whenClosed(popup);
  const file = await exportFile(exportBytes, exportId, testInfo);
  await human.pickViaStory(popup, file).catch((err: unknown) => {
    // The background closes the window as soon as the composer is reached; that may land first.
    if (!popup.isClosed()) throw err;
  });
  await closed;
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('SCREEN_LANDSCAPE');
  await expect(page.getByTestId('handoff-error-detail')).toHaveText(
    /^The composer read landscape-\w+ \(portrait shim switched off by a test flag\)\.$/,
  );

  // What the composer page showed (recorded by the fake before the window closed).
  await expect.poll(async () => (await fake.composerViews()).length).toBeGreaterThanOrEqual(1);
  const views = await fake.composerViews();
  for (const v of views) {
    expect(v).toMatchObject({ landscape: true, share: false, via: 'screen', path: '/create/story/' });
    expect(v.screenOrientation).toMatch(/^landscape-/);
    // The session start passed: the story session was started by + → Story.
    expect(v.sessionStarted).toBe(true);
    expect(v.inner.h).toBeGreaterThan(v.inner.w);
  }

  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ level: 'H0', outcome: 'failed:SCREEN_LANDSCAPE' });
  expect(rec.preflight).toMatchObject({ C3: 'pass', C3b: 'fail' });
  expect(rec.detail).toMatch(/^screen landscape-\w+, portrait shim off$/);
  expect(rec.probe?.orientation?.shim).toBe('off');
  expect(await fake.stories()).toHaveLength(0);
  // Closed, never locked: nothing suspicious happened, the composer only refused to show Share.
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
});

test('E28 (b) live: the shim-off flag does nothing in the live build: the shim installs, Share, posted', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
}, testInfo) => {
  test.skip(extension.mode !== 'live', 'the live build’s half of E28 (b)');
  await setPortraitShimOff(extension.sw, true);
  const page = await editor();
  await setSwitches(page, { assisted: false });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  await expect(page.locator('[data-row="screen"]')).toHaveAttribute('data-shim', 'installed');
  await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo));
  await waitPhase(page, 'awaitingShare');
  await expectShimmed(popup);
  await shareAndFinish(page, popup, human);
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ level: 'H0', outcome: 'posted-confirmed' });
  expect(rec.probe?.orientation).toEqual({ type: 'portrait-primary', shim: 'installed' });
  expect(await fake.stories()).toHaveLength(1);
});

// ---------------------------------------------------------------------------------------------
// E28 (e): a shim that only goes in after the composer mounted does not help, and the extension says so

test('E28 (e) mock: the shim installs only once the pick reached the composer (E2E flag `home`) → snackbar stays, SCREEN_LANDSCAPE after the composer mounted (SH-1)', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
  invariants,
  storedSettings,
}, testInfo) => {
  test.skip(extension.mode === 'live', 'the shim-off flag exists in guarded builds only');
  invariants.allowLandscapeComposer();
  await setPortraitShimOff(extension.sw, 'home');
  const page = await editor();
  await setSwitches(page, { assisted: false });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  // On home the shim only read the landscape screen (as on a screen that turned landscape later).
  await expect(page.locator('[data-row="screen"]')).toHaveAttribute('data-shim', 'off');
  expect((await pageScreen(popup)).own).toEqual([]);

  const closed = whenClosed(popup);
  await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo)).catch((err: unknown) => {
    if (!popup.isClosed()) throw err;
  });
  await closed;
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('SCREEN_LANDSCAPE');
  await expect(page.getByTestId('handoff-error-detail')).toHaveText(
    /^The portrait shim went in only after the composer had opened and read the landscape screen/,
  );
  await expect(page.locator('[data-row="screen"]')).toHaveAttribute('data-type', 'portrait-primary');

  // The composer mounted on the landscape screen and kept its snackbar: nothing re-read it.
  await expect.poll(async () => (await fake.composerViews()).length).toBeGreaterThanOrEqual(1);
  for (const v of await fake.composerViews()) {
    expect(v).toMatchObject({
      landscape: true,
      share: false,
      via: 'screen',
      path: '/create/story/',
      sessionStarted: true,
    });
    expect(v.screenOrientation).toMatch(/^landscape-/);
  }

  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({
    level: 'H0',
    outcome: 'failed:SCREEN_LANDSCAPE',
    detail: 'screen portrait-primary, portrait shim installed after the composer mounted',
  });
  expect(rec.preflight).toMatchObject({ C3: 'pass', C3b: 'fail' });
  expect(rec.probe?.orientation).toEqual({ type: 'portrait-primary', shim: 'installed', afterComposerMount: true });
  expect(await fake.stories()).toHaveLength(0);
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
});

// ---------------------------------------------------------------------------------------------
// E28 (c): the human's own + → Story starts msite's story session

test('E28 (c) H0: the human taps + → Story and picks: the story session is started, Share, posted', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
}, testInfo) => {
  // Assisted insert is off by default in the live build, and Settings says why (AM37).
  const page = await editor('#/settings');
  await expect(page.getByTestId('setting-assisted')).toBeChecked({ checked: extension.mode !== 'live' });
  await expect(page.getByTestId('setting-assisted-hint')).toContainText('Off by default in the live build');
  await expect(page.getByTestId('setting-assisted-hint')).toContainText('skips the story session');
  await setSwitches(page, { assisted: false });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  await expect(popup).toHaveURL(`${IG_ORIGIN}/`);
  await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo));
  await waitPhase(page, 'awaitingShare');
  await expect(popup).toHaveURL(`${IG_ORIGIN}/create/story/`);
  await expectShimmed(popup);
  await shareAndFinish(page, popup, human);

  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ level: 'H0', outcome: 'posted-confirmed' });
  expect(rec.preflight).toMatchObject({ C3: 'pass', C3b: 'pass' });
  const views = await fake.composerViews();
  expect(views.length).toBeGreaterThanOrEqual(1);
  for (const v of views) expect(v).toMatchObject({ landscape: false, share: true, sessionStarted: true });
  const stories = await fake.stories();
  expect(stories).toHaveLength(1);
  expect(stories[0]?.meta).toMatchObject({ sessionStarted: true, screenOrientation: 'portrait-primary' });
  expect(stories[0]?.meta?.sessionId).toMatch(UUID);
});

// ---------------------------------------------------------------------------------------------
// E28 (d): the other check, msite's session start, reads the viewport (C3a)

test('E28 (d) C3a: in a landscape window + → Story shows the rotate toast and opens no chooser; portrait again, it does', async ({
  context,
  extension,
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
  const win = await composerWindow(extension.sw);
  if (!win) throw new Error('no composer window');

  // The owner drags the window landscape, still narrower than 767 CSS px (the header stays).
  await ownerResizes(extension.sw, win.windowId, { width: 700, height: 460 });
  await expect.poll(() => popup.evaluate(() => innerHeight < innerWidth && innerWidth <= 767)).toBe(true);
  let choosers = 0;
  const count = () => {
    choosers += 1;
  };
  popup.on('filechooser', count);
  await human.tapCreateStory(popup);
  await expect(popup.getByTestId('fake-rotate-toast')).toHaveText(ROTATE);
  await popup.waitForTimeout(500);
  expect(choosers).toBe(0);
  popup.off('filechooser', count);
  await expect(popup).toHaveURL(`${IG_ORIGIN}/`);
  expect(await fake.composerViews()).toEqual([]);

  // Portrait again: the session starts and the chooser opens.
  await ownerResizes(extension.sw, win.windowId, { width: 524, height: 1012 });
  await expect.poll(() => popup.evaluate(() => innerHeight >= innerWidth)).toBe(true);
  await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo));
  await waitPhase(page, 'awaitingShare');
  await shareAndFinish(page, popup, human);
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ level: 'H0', outcome: 'posted-confirmed' });
  const stories = await fake.stories();
  expect(stories).toHaveLength(1);
  expect(stories[0]?.meta?.sessionStarted).toBe(true);
});
