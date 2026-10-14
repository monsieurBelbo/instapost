/**
 * E28 (strategy §7.11; §11 AM37, AM38, AM39): msite's two orientation checks and the portrait shim, against
 * the production-shaped fake, on the mock and live artifacts, with the autopilot driving. The second live
 * run in Arc (2026-10-12) showed the composer's "Rotate your device to add to your story." snackbar instead
 * of Share in a fitted portrait window, because the composer page reads `screen.orientation.type` and a
 * desktop's landscape monitor reads `landscape-primary` whatever the window (C3b). The headless screen here
 * is the owner's MacBook (landscape), so without the shim every composer would hide Share; the fixtures'
 * invariant checks that no composer did (except E28 b and e).
 *
 * | Id           | Case                                                     | Expected                                    |
 * |--------------|----------------------------------------------------------|---------------------------------------------|
 * | E28 (a)      | Post story with the shim (every build)                   | the page reads portrait-primary on a landscape screen; + → Story started the story session; Share; Posted (live) or the blocked upload (mock) |
 * | E28 (b)      | mock: shim off (guarded E2E flag)                        | + → Story passes (the viewport is portrait, C3a); the composer shows its snackbar, no Share → SCREEN_LANDSCAPE, closed, nothing tapped after it, no lock |
 * | E28 (b) live | live: the same flag                                      | ignored (compiled out): shim installed, Posted |
 * | ~~E28 (c)~~  | the human's + → Story starts the session                 | struck (AM39): the autopilot's + → Story does it in every post (E29); the owner's in Finish by hand (E40) |
 * | E28 (d)      | C3a: the window turned landscape before + → Story         | Instagram refuses to start the story (rotate toast, no click on the story input): LANDSCAPE "story session refused", nothing inserted |
 * | E28 (e)      | mock: the shim only installs on the composer (flag `home`) | the composer mounted landscape first: snackbar, no Share → SCREEN_LANDSCAPE (SH-1: the late shim, or the snackbar itself) |
 */
import type { HandoffRecord } from '../../src/core/handoff/state.ts';
import { expect, test, whenClosed } from './fixtures.ts';
import {
  accountPrompt,
  detailRow,
  lastRecord,
  loadPhoto,
  phasesOf,
  photoFile,
  postStory,
  testRun,
  waitResult,
} from './helpers/editor-flow.ts';
import { countFileChoosers, type PageScreen, pageScreen, quietWaitFor } from './helpers/fake-page.ts';
import { composerWindow, ownerResizes, setPortraitShimOff } from './helpers/window.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The page reads the shim's portrait on the emulated landscape screen; nothing else changed. */
function expectShimmed(s: PageScreen): void {
  expect(s.real, 'the emulated screen is landscape').toMatch(/^landscape-/);
  expect(s.screen.w).toBeGreaterThan(s.screen.h);
  expect(s.type).toBe('portrait-primary');
  expect(s.angle).toBe(0);
  expect(s.own).toEqual(['angle', 'type']);
  expect(s.nativeProto).toBe(true);
  // The fitted window is portrait for media queries without any help.
  expect(s.mqPortrait).toBe(true);
}

const taps = async (fake: { log(): Promise<{ step: string }[]> }) =>
  (await fake.log()).filter((l) => l.step.startsWith('tap:')).map((l) => l.step);

test('E28 (a) the portrait shim: on a landscape screen the composer reads portrait-primary and shows Share; the autopilot shares', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  // Look at the window without giving it user activation (the autopilot is still to tap).
  await quietWaitFor(popup, () => location.pathname === '/create/story/');
  expectShimmed(await pageScreen(popup));
  await waitResult(page, extension.mode === 'live' ? 'posted' : 'shareTested');
  await whenClosed(popup);
  // Details: the composer's own reading (the shim found itself there after the insert's SPA navigation).
  await expect(await detailRow(page, 'screen')).toHaveText('portrait-primary (portrait shim in place)');

  const rec = await lastRecord(handoffRecords);
  expect(rec.preflight).toMatchObject({ C3: 'pass', C3b: 'pass' });
  // The deciding probe on home: installed just now; the composer's C8 report: already there.
  expect(rec.probe?.orientation).toEqual({ type: 'portrait-primary', shim: 'installed' });
  expect(rec.readyProbe?.orientation).toEqual({ type: 'portrait-primary', shim: 'present' });
  // What the composer page showed: Share, by the screen reading, in the story session + → Story started.
  const views = await fake.composerViews();
  expect(views.length).toBeGreaterThanOrEqual(1);
  for (const v of views) {
    expect(v).toMatchObject({
      landscape: false,
      share: true,
      via: 'screen',
      screenOrientation: 'portrait-primary',
      sessionStarted: true,
    });
  }
  if (extension.mode === 'live') {
    const stories = await fake.stories();
    expect(stories).toHaveLength(1);
    expect(stories[0]?.meta).toMatchObject({ sessionStarted: true, screenOrientation: 'portrait-primary' });
    expect(stories[0]?.meta?.sessionId).toMatch(UUID);
  }
});

test('E28 (b) mock: the shim switched off (E2E flag) → the composer shows its snackbar and no Share → SCREEN_LANDSCAPE', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
  invariants,
  storedSettings,
}, testInfo) => {
  test.skip(extension.mode === 'live', 'the shim-off flag exists in guarded builds only (E28 b live checks that)');
  invariants.allowLandscapeComposer();
  await setPortraitShimOff(extension.sw, true);
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  const card = await waitResult(page, 'notPosted', { code: 'SCREEN_LANDSCAPE' });
  await expect(card).toContainText('Nothing was posted');
  await whenClosed(popup);
  await expect(await detailRow(page, 'screen')).toHaveText(
    /^landscape-\w+ \(portrait shim switched off by a test flag\)$/,
  );

  // What the composer page showed (recorded by the fake before the window closed): the session start
  // passed (+ → Story in a portrait viewport, C3a), the composer read the landscape screen (C3b).
  await expect.poll(async () => (await fake.composerViews()).length).toBeGreaterThanOrEqual(1);
  for (const v of await fake.composerViews()) {
    expect(v).toMatchObject({ landscape: true, share: false, via: 'screen', path: '/create/story/' });
    expect(v.screenOrientation).toMatch(/^landscape-/);
    expect(v.sessionStarted).toBe(true);
    expect(v.inner.h).toBeGreaterThan(v.inner.w);
  }
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:SCREEN_LANDSCAPE');
  expect(rec.preflight).toMatchObject({ C3: 'pass', C3b: 'fail' });
  expect(rec.detail).toMatch(/screen landscape-\w+, portrait shim off$/);
  expect(rec.probe?.orientation?.shim).toBe('off');
  // Nothing was pressed: no Share tap, no upload. Closed, never locked.
  expect(await taps(fake)).not.toContain('tap:share');
  expect(await fake.uploads()).toEqual([]);
  expect(phasesOf(rec)).not.toContain('sharing');
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
});

test('E28 (b) live: the shim-off flag does nothing in the live build: the shim installs, Posted', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  test.skip(extension.mode !== 'live', 'the live build’s half of E28 (b)');
  await setPortraitShimOff(extension.sw, true);
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  await whenClosed(await composer());
  await waitResult(page, 'posted');
  const rec = await lastRecord(handoffRecords);
  expect(rec.probe?.orientation).toEqual({ type: 'portrait-primary', shim: 'installed' });
  expect(await fake.stories()).toHaveLength(1);
});

test('E28 (d) C3a: the window turned landscape before + → Story: Instagram refuses the story session → LANDSCAPE, nothing inserted', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  seed,
  handoffRecords,
}, testInfo) => {
  // The account prompt holds the run on home (before any tap) while the owner drags the window landscape,
  // still narrower than 767 CSS px (the header with + stays).
  await seed({ account: 'someone_else' });
  await fake.setKnobs({ menuOrder: 'storyPost' });
  const choosers = countFileChoosers(context);
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  const popup = await composer();
  await expect(accountPrompt(page)).toBeVisible({ timeout: 30_000 });
  const win = await composerWindow(extension.sw);
  if (!win) throw new Error('no composer window');
  await ownerResizes(extension.sw, win.windowId, { width: 700, height: 460 });
  await quietWaitFor(popup, () => innerHeight < innerWidth && innerWidth <= 767);
  await page.getByTestId('account-proceed').click();

  const card = await waitResult(page, 'notPosted', { code: 'LANDSCAPE' });
  await expect(card).toContainText('Nothing was posted');
  await whenClosed(popup);
  const rec: HandoffRecord = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ outcome: 'failed:LANDSCAPE', detail: 'story session refused' });
  expect(rec.entry).toMatchObject({ result: 'SESSION_NOT_STARTED' });
  // + and Story were tapped; Instagram showed its rotate toast and never clicked the story input.
  expect(await taps(fake)).toEqual(['tap:create', 'tap:story']);
  const log = (await fake.log()).map((l) => l.step);
  expect(log).not.toContain('enter');
  expect(log).not.toContain('image_process_attempt');
  expect(phasesOf(rec)).not.toContain('inserting');
  expect(choosers()).toBe(0);
  expect(await fake.composerViews()).toEqual([]);
});

test('E28 (e) mock: the shim installs only once the photo reached the composer (E2E flag `home`) → SCREEN_LANDSCAPE (SH-1)', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
  invariants,
  storedSettings,
}, testInfo) => {
  test.skip(extension.mode === 'live', 'the shim-off flag exists in guarded builds only');
  invariants.allowLandscapeComposer();
  await setPortraitShimOff(extension.sw, 'home');
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  await whenClosed(await composer());
  await waitResult(page, 'notPosted', { code: 'SCREEN_LANDSCAPE' });

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
  expect(rec.outcome).toBe('failed:SCREEN_LANDSCAPE');
  // Whichever saw it first: the reducer's late-shim check (SH-1) at the composer's injection, or the
  // compose watch reading Instagram's own snackbar. Either way the home probe read the screen unshimmed.
  expect(rec.detail).toMatch(
    /^(screen portrait-primary, portrait shim installed after the composer mounted|rotate snackbar shown; screen landscape-\w+, portrait shim off)$/,
  );
  expect(rec.probe?.orientation?.shim).toMatch(/^(off|installed)$/);
  expect(rec.preflight).toMatchObject({ C3: 'pass', C3b: 'fail' });
  expect(await fake.uploads()).toEqual([]);
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
});
