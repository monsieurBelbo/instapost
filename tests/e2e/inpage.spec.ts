/**
 * The in-page lane, the product (strategy §11 AM46–AM52; docs/inpage.md §9.4, §14; inpage-ui-spec.md), in the
 * sealed environment against the fake's desktop Instagram: the "New story" entry in Instagram's sidebar, the
 * composer dialog (an extension page framed over the page, with its own scrim), the chip, and the engine frame
 * (Instagram's mobile site in a phone-sized frame of the same tab) that the autopilot drives.
 *
 * Projects: `inpage` (Playwright's Chromium) and `inpage-cft155` (Chrome for Testing 155, Arc's Chromium) on the
 * mock artifact, whose Developer toggles (rule 1020 or 1021 left out, the covered view, the U1 variant) exist in
 * guarded builds only; `inpage-live` and `inpage-live-cft155` run the `@live` cases on the live artifact (a
 * real post reaches the fake; mock's static ruleset blocks every write).
 *
 * The fake models Instagram's facts (C15, live 2026-10-14/15): `X-Frame-Options: DENY` on every document, so
 * Chromium refuses a frame unless rule 1020 removed it; a document requested with `Sec-Fetch-Dest: iframe`
 * gets "Sorry, this page isn't available" (`framed=unavailable`), so the frame shows msite only because rule
 * 1021 forges `document`; the responsive left navigation whose collapsed form widens while hovered
 * (`desktopNav=auto`); the light/dark signal (`theme`).
 *
 * | Id | Case | Expected |
 * |----|------|----------|
 * | E59 | Instagram's responsive navigation (auto) | 1440 wide: a row 8 px below Profile with its left and width, "New story", the coach mark once (Got it, never again); 1100 wide (collapsed, hover-expanding): a 48×48 tile in the column; 700 wide (bottom bar): no entry |
 * | E60 | The 2026-10-15 regression | the pointer rests on the nav (it widens), then goes onto the entry (the nav collapses under it): the entry never fades or moves (its class and box sampled every 40 ms; without the freeze it turns into a row), stays under the pointer, and the click opens the composer |
 * | E51 | Fixed navigation shapes | wide and renamed: a row; collapsed: a tile; a bottom bar or none: the 40-px corner button; each opens the composer |
 * | E61 | The composer | the entry opens it over the whole viewport (a dynamic-URL extension frame under the page's CSP); ✕, Esc and the scrim close it; during a run Esc hides it into the chip in the entry's slot with the live phone in its thumbnail; a click on the chip opens the run; the result shows on the chip |
 * | E57 | Check, Test run, Share test from the composer, zero human actions after the start | a 540×960 msite frame (shim in the frame only), `checked` / `tested` (C8 1080×1920, nothing written) / `shareTested` (Share once, the upload blocked); every rule and the frame gone; the result card |
 * | E57 (U1) | `ua: document` | the frame's document Android, its scripts and the page's XHRs desktop; the run passes on the fake |
 * | E57 (N15) | `view: covered` | the phone under the composer at opacity 0.01 still renders; the run passes |
 * | E62 | The forge is necessary | without rule 1021 the frame's request says `iframe`, the fake serves "page isn't available": FRAME_REFUSED (page unavailable), no tap, no lock, no rule left; the same check with 1021: `checked` |
 * | E58 | Rule 1020 off | Chromium refuses the frame (XFO DENY): FRAME_REFUSED, no lock, no write, no rule left |
 * | E46 + E55 + E48 (a) | During a run | 1001/1020/1021 for the run's tab only; another Instagram tab's frame is refused, desktop and `iframe`; the engine document Android with the forged `document`, `same-origin`, the origin as Referer, `Sec-Fetch-User` as the browser sets it (`?1` within the owner's click); a reload of the run's tab is a desktop `main_frame` and PAGE_LEFT |
 * | E52 | Activation | a real click in the dialog leaves the engine frame inactive (N5); hidden into the chip, a click on Instagram's page activates it; the autopilot waits it out, no file chooser |
 * | E53 | F8 without a sandbox | a checkpoint moves the desktop page to /challenge/: KILLED_CHALLENGE, locked, no rule left |
 * | E47 | The frame's kill switch | a framed request answered with a login, an off-host redirect, a 403, the desktop shell; a challenge inside the frame |
 * | E63 @live | A real post on the live build | Post story → Posted from Instagram's publish answer, one story 1080×1920 on the fake, the outcome card, then the chip "Posted" after the auto-close |
 * | E64 | HEIC | a real .heic (tests/fixtures/story.heic, `sips -s format heic` from the live icon) by Choose photo… and by drag and drop (Finder's empty type): converted, on the stage, its export posted to the frame in a Test run |
 * | E65 | Spanish | Settings → Language → Español: the composer, its run and result, and the entry on Instagram's page switch at once |
 * | E66 | Light and dark | Instagram dark: the entry and the composer dark; Instagram following the system: both switch live |
 *
 * Reads during a run never carry a user gesture (helpers/inpage.ts): records, the fake's logs, CDP.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { dialogLayout } from '../../src/inpage/geometry.ts';
import { EN } from '../../src/ui/catalog.en.ts';
import { ES } from '../../src/ui/catalog.es.ts';
import { FAKE_ACCOUNT } from '../../tools/fake-ig/knobs.ts';
import { expect, IG_ORIGIN, test } from './fixtures.ts';
import { photoFile } from './helpers/editor-flow.ts';
import { countFileChoosers, quietEvaluate, quietWaitFor } from './helpers/fake-page.ts';
import {
  type Box,
  centre,
  choosePhoto,
  composerFrame,
  composerMode,
  composerQuiet,
  composerWait,
  dialogView,
  engineDocs,
  engineFrame,
  enginePath,
  engineQuiet,
  entryKind,
  entryShown,
  expectAndroid,
  expectDesktop,
  hostSnapshot,
  openComposer,
  openInstagram,
  rawClickComposer,
  setToggles,
  startCheck,
  startShareTest,
  startTestRun,
  waitChip,
  waitComposerOpen,
  waitEdited,
  waitEngine,
  waitEntry,
  waitRecord,
  watchEntry,
} from './helpers/inpage.ts';

const HEIC = resolve('tests/fixtures/story.heic');
const fill = (s: string, p: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k: string) => p[k] ?? `{${k}}`);

/** Profile's link in the fake's desktop navigation (quiet: no gesture on Instagram's page). */
const profileBox = (page: Page): Promise<Box> =>
  quietEvaluate(page, () => {
    const r = document.querySelector('[data-testid="fake-nav-profile"]')?.getBoundingClientRect();
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 };
  });

const navState = (page: Page) =>
  quietEvaluate(page, () => {
    const n = document.querySelector('nav[data-fake-nav]');
    return {
      layout: n?.getAttribute('data-fake-nav') ?? null,
      expanded: n?.getAttribute('data-fake-nav-expanded') ?? null,
      w: n ? Math.round(n.getBoundingClientRect().width) : 0,
    };
  });

/** The layout viewport, as the content script measures it. */
const viewport = (page: Page) =>
  quietEvaluate(page, () => ({
    w: document.documentElement.clientWidth || innerWidth,
    h: document.documentElement.clientHeight || innerHeight,
  }));

test.describe('in-page lane: the entry on Instagram’s page', () => {
  test('E59 Instagram’s responsive navigation: a row below Profile when wide, a tile when collapsed, none when narrow; the coach once', async ({
    context,
    localKeys,
  }) => {
    test.setTimeout(120_000);
    // Wide (≥ 1264): Instagram's labelled navigation; the row twins Profile, 8 px under it.
    const page = await openInstagram(context, { w: 1440, h: 900 });
    expect((await navState(page)).layout).toBe('wide');
    const row = await waitEntry(page);
    expect(entryKind(row)).toBe('row');
    const p = await profileBox(page);
    expect(Math.abs(row.box.x - p.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(row.box.w - p.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(row.box.y - (p.y + p.h + 8))).toBeLessThanOrEqual(1);
    expect(row.box.h).toBe(48);
    expect(row.text).toContain(EN['page.entry.label']);
    expect(row.attrs['aria-label']).toBe(EN['page.entry.name']);
    expect(row.attrs['aria-expanded']).toBe('false');
    // FE8: the coach mark, once, right of the nav at the entry's top; Got it dismisses it for good.
    const snap = await hostSnapshot(page);
    expect(snap.coach?.text).toContain(EN['page.coach.title']);
    // It rises 6 px into place (280 ms).
    await expect
      .poll(async () => Math.abs(((await hostSnapshot(page)).coach?.box?.y ?? 0) - (row.box.y - 4)))
      .toBeLessThanOrEqual(1);
    const coach = (await hostSnapshot(page)).coach?.box as Box;
    expect(coach.x).toBeGreaterThanOrEqual((await navState(page)).w + 12 - 1);
    await page.mouse.click(coach.x + coach.w - 40, coach.y + coach.h - 22);
    await expect.poll(async () => (await hostSnapshot(page)).coach).toBeNull();
    await expect
      .poll(async () => ((await localKeys(['inpageUi'])).inpageUi as { coachSeen?: boolean } | undefined)?.coachSeen)
      .toBe(true);
    await page.reload();
    await waitEntry(page);
    expect((await hostSnapshot(page)).coach).toBeNull();
    await page.close();

    // 768–1263: the collapsed (72 px) navigation that widens while hovered; the tile sits in its column.
    const mid = await openInstagram(context, { w: 1100, h: 800 });
    expect(await navState(mid)).toMatchObject({ layout: 'hover', expanded: 'false', w: 72 });
    const tile = await waitEntry(mid);
    expect(entryKind(tile)).toBe('tile');
    expect(tile.box).toMatchObject({ w: 48, h: 48 });
    const pc = await profileBox(mid);
    expect(Math.abs(centre(tile.box).x - centre(pc).x)).toBeLessThanOrEqual(1);
    expect(Math.abs(tile.box.y - (pc.y + pc.h + 8))).toBeLessThanOrEqual(1);
    await mid.close();

    // < 768: Instagram's narrow layout (a bottom bar): no entry (FE5).
    const narrow = await openInstagram(context, { w: 700, h: 800 });
    expect((await navState(narrow)).layout).toBe('bottomBar');
    await narrow.waitForTimeout(800);
    expect(entryShown((await hostSnapshot(narrow)).entry)).toBe(false);
  });

  test('E60 the hover-expanding nav (2026-10-15 regression): from the nav onto the entry it never fades or moves, and the click opens', async ({
    context,
  }) => {
    const page = await openInstagram(context, { w: 1100, h: 800 });
    const tile = await waitEntry(page);
    const home = await quietEvaluate(page, () => {
      const r = document.querySelector('nav[data-fake-nav] a[href="/"]')?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    });
    if (!home) throw new Error('no Home item');
    const watch = await watchEntry(page);
    try {
      // Onto the navigation: it widens over the page (labels shown) while the pointer is on it.
      await page.mouse.move(600, 400);
      await page.mouse.move(home.x, home.y, { steps: 12 });
      await expect.poll(async () => (await navState(page)).expanded, { timeout: 3000 }).toBe('true');
      await expect.poll(async () => (await navState(page)).w).toBe(244);
      // The owner looks at the widened navigation for a moment (longer than the entry's 150-ms settle).
      await page.waitForTimeout(600);
      // Down the column, past Profile, onto the entry: the navigation loses the pointer and collapses under it.
      const target = centre(tile.box);
      await page.mouse.move(home.x, target.y - 30, { steps: 20 });
      await page.waitForTimeout(400);
      await page.mouse.move(target.x, target.y, { steps: 10 });
      await expect.poll(async () => (await navState(page)).expanded, { timeout: 3000 }).toBe('false');
      await expect.poll(async () => (await navState(page)).w).toBe(72);
      await page.waitForTimeout(400);
      // Never hidden, never re-placed while the pointer was on the nav or the entry.
      expect(watch.initial.classes).not.toContain('off');
      expect(watch.classChanges.filter((c) => /\boff\b/.test(c))).toEqual([]);
      expect(watch.classes().filter((c) => /\boff\b/.test(c))).toEqual([]);
      expect(watch.boxes()).toEqual([tile.box]);
      const now = (await hostSnapshot(page)).entry;
      expect(entryShown(now)).toBe(true);
      expect(now?.box).toEqual(tile.box);
    } finally {
      await watch.stop();
    }
    // The pointer is on it: a plain click there opens the composer.
    await page.mouse.down();
    await page.mouse.up();
    await waitComposerOpen(page);
    expect((await hostSnapshot(page)).entry?.attrs['aria-expanded']).toBe('true');
  });

  for (const [nav, kind] of [
    ['wide', 'row'],
    ['renamed', 'row'],
    ['collapsed', 'tile'],
    ['bottomBar', 'corner'],
    ['absent', 'corner'],
  ] as const) {
    test(`E51 desktopNav=${nav}: the entry is a ${kind}, and opens the composer`, async ({ context, fake }) => {
      await fake.setKnobs({ desktopNav: nav });
      const page = await openInstagram(context, { w: 1280, h: 860 });
      const e = await waitEntry(page);
      expect(entryKind(e)).toBe(kind);
      if (kind === 'corner') {
        const vw = (await viewport(page)).w;
        expect(e.box).toEqual({ x: vw - 56, y: 16, w: 40, h: 40 });
      } else {
        const p = await profileBox(page);
        expect(Math.abs(e.box.y - (p.y + p.h + 8))).toBeLessThanOrEqual(1);
      }
      await openComposer(page);
    });
  }
});

test.describe('in-page lane: the composer', () => {
  test('E61 open over the page; ✕, Esc and the scrim close it; during a run it hides into the chip and opens again', async ({
    context,
    extension,
    fake,
  }, testInfo) => {
    test.setTimeout(120_000);
    const page = await openInstagram(context, { w: 1280, h: 860 });
    const vp = await viewport(page);
    let composer = await openComposer(page);
    let snap = await hostSnapshot(page);
    expect(composerMode(snap)).toBe('open');
    expect(snap.composer?.box).toEqual({ x: 0, y: 0, w: vp.w, h: vp.h });
    expect(snap.entry?.attrs['aria-expanded']).toBe('true');
    // N3: an extension frame under the page's CSP, its src the per-session dynamic URL (never the extension id).
    const src = snap.composer?.attrs.src ?? '';
    expect(src).toMatch(/^chrome-extension:\/\/[0-9a-f-]{36}\/composer\.html#(light|dark)$/);
    expect(src).not.toContain(extension.id);
    await expect(composer.locator('#dlg-title')).toHaveText(EN['inpage.dialog.titleNew']);
    expect(await dialogView(page)).toBe('import');

    // ✕ closes (0×0, hidden, kept loaded).
    await composer.getByTestId('inpage-close').click();
    await expect.poll(async () => composerMode(await hostSnapshot(page))).toBe('closed');
    snap = await hostSnapshot(page);
    expect(snap.composer?.box ?? { w: 0, h: 0 }).toMatchObject({ w: 0, h: 0 });
    expect(snap.entry?.attrs['aria-expanded']).toBe('false');
    // Esc closes.
    composer = await openComposer(page);
    await composer.locator('#dlg-title').click();
    await page.keyboard.press('Escape');
    await expect.poll(async () => composerMode(await hostSnapshot(page))).toBe('closed');
    // A click on the scrim (outside the dialog) closes; nothing reached Instagram.
    composer = await openComposer(page);
    await page.mouse.click(8, vp.h / 2);
    await expect.poll(async () => composerMode(await hostSnapshot(page))).toBe('closed');
    expect((await fake.log()).filter((l) => l.step.startsWith('tap:'))).toEqual([]);

    // During a run: Esc hides the dialog into the chip in the entry's slot; the phone glides into its thumbnail.
    await fake.setKnobs({ slowMs: 8000 });
    composer = await openComposer(page);
    await choosePhoto(page, composer, await photoFile(context, testInfo, 1080, 1920));
    const entry = (await hostSnapshot(page)).entry?.box as Box;
    await startTestRun(composer);
    await waitEngine(page);
    await expect.poll(() => enginePath(page), { timeout: 15_000 }).toBe('/');
    await page.keyboard.press('Escape');
    // The chip rises 6 px into the entry's slot.
    expect(await waitChip(page)).toEqual({ x: entry.x, y: entry.y, w: entry.w, h: 76 });
    snap = await hostSnapshot(page);
    expect(entryShown(snap.entry)).toBe(false);
    await expect
      .poll(async () => (await hostSnapshot(page)).engine?.box ?? null)
      .toEqual({ x: entry.x + 6, y: entry.y + 6, w: 36, h: 64 });
    const chipName = await composerQuiet(
      page,
      () => document.querySelector('[data-testid="inpage-chip"]')?.getAttribute('aria-label') ?? '',
    );
    expect(chipName).toContain(fill(EN['inpage.chip.testing'], { clock: '' }).trim());
    expect(chipName).toContain(EN['inpage.chip.handsOff']);
    // A click on the chip (its text, not the phone) opens the dialog on the run, which carries on.
    const chip = snap.composer?.box as Box;
    await page.mouse.click(chip.x + chip.w - 40, chip.y + chip.h / 2);
    await waitComposerOpen(page);
    expect(await dialogView(page)).toBe('run');
    // Hide it again with the outside button (raw click), and let the run end on the chip.
    await rawClickComposer(page, '[data-testid="inpage-close"]');
    await waitChip(page);
    const rec = await waitRecord(extension);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('tested');
    await composerWait(
      page,
      () =>
        document.querySelector('[data-testid="inpage-chip"]')?.getAttribute('aria-label')?.includes('Test passed') ===
        true,
    );
    await expect.poll(async () => (await hostSnapshot(page)).badge?.classes.includes('on')).toBe(true);
    expect((await hostSnapshot(page)).badge?.attrs['data-k']).toBe('ok');
    // The chip opens the result.
    await page.mouse.click(chip.x + chip.w - 40, chip.y + chip.h / 2);
    await waitComposerOpen(page);
    expect(await dialogView(page)).toBe('result');
    composer = composerFrame(page) ?? composer;
    await expect(composer.getByTestId('inpage-outcome')).toHaveAttribute('data-outcome', 'tested');
    await composer.getByTestId('inpage-close').click();
    await expect.poll(async () => composerMode(await hostSnapshot(page))).toBe('closed');
    expect(engineFrame(page)).toBeUndefined();
  });
});

test.describe('in-page lane: runs in the frame', () => {
  test('E57 check: a 540×960 msite frame, the shim in the frame only, the account; nothing left behind', async ({
    context,
    extension,
    fake,
    sessionRules,
  }) => {
    const page = await openInstagram(context);
    const composer = await openComposer(page);
    await startCheck(composer);
    const rec = await waitRecord(extension);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('checked');
    expect(rec.code).toBeNull();
    expect(rec.account.detected).toBe(FAKE_ACCOUNT);
    expect(rec.frame.box).toEqual({ w: 540, h: 960 });
    expect(rec.frame.dpr).toBe(2);
    expect(rec.frame.loaded && rec.frame.readable).toBe(true);
    expect(rec.probe?.isMobile).toBe(true);
    expect(rec.probe?.inner).toEqual({ w: 540, h: 960 });
    expect(rec.probe?.portrait).toBe(true);
    expect(rec.orientation?.shim).toBe('installed');
    expect(rec.rules.installed).toEqual(expect.arrayContaining([1001, 1020, 1021, 1002]));
    expect(rec.rules.after).toEqual([]);
    expect(await sessionRules()).toEqual([]);
    await expect.poll(() => engineFrame(page)).toBeUndefined();
    // N6: the desktop page's own screen was never touched.
    expect(await quietEvaluate(page, () => screen.orientation.type)).toMatch(/^landscape/);
    expect(await fake.writes()).toEqual([]);
    await expect(composer.getByTestId('inpage-outcome')).toHaveAttribute('data-outcome', 'checked');
    await expect(composer.locator('.res-title')).toHaveText(
      fill(EN['inpage.result.checkedTitle'], { handle: FAKE_ACCOUNT }),
    );
  });

  test('E57 test: + → Story → the export → the composer with one Share, in the frame; nothing written; C8 1080×1920', async ({
    context,
    extension,
    fake,
    sessionRules,
  }, testInfo) => {
    const page = await openInstagram(context);
    const composer = await openComposer(page);
    await choosePhoto(page, composer, await photoFile(context, testInfo, 1080, 1920));
    const choosers = countFileChoosers(context);
    const historyBefore = await quietEvaluate(page, () => history.length);
    await startTestRun(composer);
    // Zero human actions from here: the autopilot does it all.
    const rec = await waitRecord(extension);
    const historyAfter = await quietEvaluate(page, () => history.length);
    test.info().annotations.push({ type: 'N12', description: `history.length ${historyBefore} → ${historyAfter}` });
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('tested');
    expect(rec.photo).toMatchObject({ source: 'export', mime: 'image/png' });
    expect(rec.entry?.result).toBe('armed');
    expect(rec.compose).toMatchObject({ onComposer: true, drawn: true, landscape: false, controls: 1 });
    expect(rec.compose?.canvas).toEqual({ w: 1080, h: 1920 });
    expect(rec.frame.paths).toEqual(['/', '/create/story/']);
    expect(rec.rules.after).toEqual([]);
    expect(await sessionRules()).toEqual([]);
    expect(choosers()).toBe(0);
    expect(await fake.writes()).toEqual([]);
    expect(await fake.uploads()).toEqual([]);
    const log = await fake.log();
    expect(log.some((l) => l.step === 'enter')).toBe(true);
    expect(log.filter((l) => l.step === 'tap:share')).toEqual([]);
    expect(log.find((l) => l.step === 'msite_session')?.fields).toMatchObject({
      framed: true,
      sessionLogIdReused: true,
    });
    expect(log.some((l) => l.step === 'page_unavailable')).toBe(false);
    await expect(composer.getByTestId('inpage-outcome')).toHaveAttribute('data-outcome', 'tested');
    await expect(composer.locator('.res-title')).toHaveText(EN['inpage.result.testTitle']);
  });

  test('E57 shareTest: Share pressed once in the frame, the upload blocked, nothing reaches Instagram', async ({
    context,
    extension,
    fake,
    sessionRules,
  }) => {
    const page = await openInstagram(context);
    const composer = await openComposer(page);
    await startShareTest(composer);
    const rec = await waitRecord(extension, 1, 90_000);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('shareTested');
    expect(rec.share).toMatchObject({ sent: true, done: true, refused: null });
    const uploads = rec.net.filter((n) => n.host === 'i' && n.path.startsWith('/rupload_igphoto/'));
    expect(uploads.length).toBe(1);
    expect(uploads[0]?.status).toBe(0);
    expect(rec.net.some((n) => n.path.includes('configure_to_story'))).toBe(false);
    expect(await fake.writes()).toEqual([]);
    expect(await fake.uploads()).toEqual([]);
    expect(await fake.stories()).toEqual([]);
    const log = await fake.log();
    expect(log.filter((l) => l.step === 'tap:share')).toHaveLength(1);
    expect(log.some((l) => l.step === 'compose_failure')).toBe(true);
    expect(rec.rules.after).toEqual([]);
    expect(await sessionRules()).toEqual([]);
    await expect(composer.getByTestId('inpage-outcome')).toHaveAttribute('data-outcome', 'shareTested');
  });

  test('E57 (U1) ua: document: the frame document Android, its scripts and the page’s XHRs desktop; the run passes', async ({
    context,
    extension,
    fake,
    sessionRules,
  }) => {
    await setToggles(extension, { ua: 'document' });
    await fake.setKnobs({ slowMs: 4000 });
    const page = await openInstagram(context);
    const composer = await openComposer(page);
    await startShareTest(composer);
    await waitEngine(page);
    await expect.poll(() => enginePath(page), { timeout: 30_000 }).toBe('/create/story/');
    await quietEvaluate(page, () => fetch('/fake-static/beacon?e2e=page-xhr-u1').then((r) => r.status));
    const rec = await waitRecord(extension, 1, 90_000);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('shareTested');
    expect(rec.rules.ua).toBe('document');
    const reqs = await fake.requests();
    const doc = engineDocs(reqs)[0];
    expectAndroid(doc, 'the engine document');
    expectDesktop(
      reqs.find((r) => r.seq > (doc?.seq ?? 0) && r.path === '/fake-static/client.js'),
      "the frame's script (U1)",
    );
    expectDesktop(
      reqs.find((r) => r.path === '/fake-static/beacon?e2e=page-xhr-u1'),
      "the desktop page's own XHR during the run (U1)",
    );
    expect(await sessionRules()).toEqual([]);
  });

  test('E57 (N15) view: covered: the phone under the composer at opacity 0.01 still renders; the run passes', async ({
    context,
    extension,
  }) => {
    await setToggles(extension, { view: 'covered' });
    const page = await openInstagram(context);
    const composer = await openComposer(page);
    await startShareTest(composer);
    const rec = await waitRecord(extension, 1, 90_000);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('shareTested');
    expect(rec.compose?.drawn).toBe(true);
  });

  test('E62 the forge is necessary: without rule 1021 Instagram serves "page isn’t available" in the frame → FRAME_REFUSED; with it, the check passes', async ({
    context,
    extension,
    fake,
    sessionRules,
    storedSettings,
    clearRateLog,
  }) => {
    test.setTimeout(120_000);
    await setToggles(extension, { fetchDest: 'iframe' });
    const page = await openInstagram(context);
    let composer = await openComposer(page);
    await startCheck(composer);
    const rec = await waitRecord(extension);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('stopped');
    expect(rec.code).toBe('FRAME_REFUSED');
    expect(rec.detail).toMatch(/page unavailable/);
    expect(rec.rules.installed).toEqual(expect.arrayContaining([1001, 1020]));
    expect(rec.rules.installed).not.toContain(1021);
    // The frame loaded (XFO removed) and Instagram's error page is what it showed: no header, no account.
    expect(rec.frame.loaded && rec.frame.readable).toBe(true);
    expect(rec.probe?.storyInput).toBe('absent');
    expect(rec.account.detected).toBeNull();
    const doc = engineDocs(await fake.requests())[0];
    expectAndroid(doc, 'the engine document');
    expect(doc?.fetch['sec-fetch-dest']).toBe('iframe');
    const log = await fake.log();
    expect(log.find((l) => l.step === 'page_unavailable')?.fields).toMatchObject({ framed: true, shell: 'msite' });
    expect(log.filter((l) => l.step.startsWith('tap:'))).toEqual([]);
    expect(rec.locked).toBeNull();
    expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
    expect(rec.rules.after).toEqual([]);
    expect(await sessionRules()).toEqual([]);
    expect(await fake.writes()).toEqual([]);
    await expect(composer.getByTestId('inpage-outcome')).toHaveAttribute('data-code', 'FRAME_REFUSED');
    await expect(composer.locator('.res-title')).toHaveText(EN['inpage.fail.FRAME_REFUSED.title']);

    // The same check with the forge (rule 1021: `Sec-Fetch-Dest: document`): msite, logged in.
    await clearRateLog();
    await setToggles(extension, { fetchDest: 'document' });
    await composer.getByTestId('inpage-close').click();
    composer = await openComposer(page);
    await startCheck(composer);
    const ok = await waitRecord(extension, 2);
    expect(ok.outcome, JSON.stringify(ok, null, 2)).toBe('checked');
    expect(ok.rules.installed).toContain(1021);
    expect(engineDocs(await fake.requests())[1]?.fetch['sec-fetch-dest']).toBe('document');
  });

  test('E58 without rule 1020 Chromium refuses the frame (XFO DENY): FRAME_REFUSED, no lock, no write, no rule left', async ({
    context,
    extension,
    fake,
    sessionRules,
    storedSettings,
  }) => {
    await setToggles(extension, { xfoRule: 'off' });
    const page = await openInstagram(context);
    const composer = await openComposer(page);
    await startCheck(composer);
    const rec = await waitRecord(extension);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('stopped');
    expect(rec.code).toBe('FRAME_REFUSED');
    expect(rec.locked).toBeNull();
    expect(rec.rules.installed).not.toContain(1020);
    expect(rec.frame.readable).toBe(false);
    expect(rec.probe).toBeNull();
    expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
    expect(rec.rules.after).toEqual([]);
    expect(await sessionRules()).toEqual([]);
    expect(await fake.writes()).toEqual([]);
    // The fake did answer the (forged) request; Chromium refused to render it because of the XFO it carried.
    const docs = engineDocs(await fake.requests());
    expect(docs).toHaveLength(1);
    expect(docs[0]?.fetch['sec-fetch-dest']).toBe('document');
  });

  test('E46 + E55 + E48 (a): rules for the run tab only; the frame Android with the forged dest; reload = PAGE_LEFT', async ({
    context,
    extension,
    fake,
    sessionRules,
  }) => {
    test.setTimeout(120_000);
    // Hold the run in Instagram's composer (the photo is drawn 8 s after the insert).
    await fake.setKnobs({ slowMs: 8000 });
    const page = await openInstagram(context);
    const composer = await openComposer(page);
    await startShareTest(composer);
    await waitEngine(page);
    await expect.poll(() => enginePath(page), { timeout: 30_000 }).toBe('/create/story/');

    // During the run: 1001 (tab-wide, never main_frame), 1020 and 1021 name this tab only.
    const rules = await sessionRules();
    const r1001 = rules.find((r) => r.id === 1001);
    const r1020 = rules.find((r) => r.id === 1020);
    const r1021 = rules.find((r) => r.id === 1021);
    expect(r1001?.condition.resourceTypes).not.toContain('main_frame');
    expect(r1001?.condition.tabIds).toHaveLength(1);
    expect(r1020?.condition.tabIds).toEqual(r1001?.condition.tabIds);
    expect(r1020?.condition.resourceTypes).toEqual(['sub_frame']);
    expect(r1021?.condition.tabIds).toEqual(r1001?.condition.tabIds);
    expect(r1021?.condition.resourceTypes).toEqual(['sub_frame']);

    // Another Instagram tab: its own frame of Instagram is refused (XFO), desktop, and says `iframe`.
    const other = await openInstagram(context);
    const otherFrameReadable = await quietEvaluate(other, () => {
      return new Promise<boolean>((done) => {
        const f = document.createElement('iframe');
        f.src = '/?e2e=other-tab';
        f.addEventListener('load', () => {
          try {
            done(f.contentWindow?.location.pathname === '/');
          } catch {
            done(false);
          }
        });
        document.body.append(f);
        setTimeout(() => done(false), 8000);
      });
    });
    expect(otherFrameReadable).toBe(false);

    // The run tab's own XHR during the run: U3 gives it the Android profile (docs/inpage.md §3.6, R24).
    await quietEvaluate(page, () => fetch('/fake-static/beacon?e2e=page-xhr').then((r) => r.status));
    const reqs = await fake.requests();
    const doc = engineDocs(reqs)[0];
    expectAndroid(doc, 'the engine document');
    // E55: a same-origin navigation with the origin only as Referer; Sec-Fetch-Dest forged to `document` (1021).
    expect(doc?.fetch).toMatchObject({
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
    });
    // Sec-Fetch-User is the browser's own: `?1` while the owner's click that started the run still activates the
    // page (the click in the composer activates its ancestors, Instagram's page included), else absent.
    expect([undefined, '?1']).toContain(doc?.fetch['sec-fetch-user']);
    test
      .info()
      .annotations.push({ type: 'E55', description: `sec-fetch-user ${doc?.fetch['sec-fetch-user'] ?? 'absent'}` });
    expect(doc?.referer).toBe(`${IG_ORIGIN}/`);
    expectAndroid(
      reqs.find((r) => r.seq > (doc?.seq ?? 0) && r.path === '/fake-static/client.js'),
      "the frame's script",
    );
    expectAndroid(
      reqs.find((r) => r.path === '/fake-static/beacon?e2e=page-xhr'),
      "the desktop page's own XHR during the run (U3)",
    );
    const otherDoc = reqs.find((r) => r.path === '/?e2e=other-tab');
    expectDesktop(otherDoc, "the other tab's framed document");
    expect(otherDoc?.fetch['sec-fetch-dest']).toBe('iframe');

    // E48 (a): the owner reloads the run's tab before Share: a desktop main_frame, and the run stops.
    const before = (await fake.requests()).at(-1)?.seq ?? 0;
    await page.reload();
    const rec = await waitRecord(extension);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('stopped');
    expect(rec.code).toBe('PAGE_LEFT');
    expect(rec.locked).toBeNull();
    const reload = (await fake.requests(before)).find(
      (r) => r.path === '/' && r.fetch['sec-fetch-dest'] === 'document' && !/Android/.test(r.ua ?? ''),
    );
    expectDesktop(reload, 'the reloaded page (main_frame)');
    expect(rec.rules.after).toEqual([]);
    expect(await sessionRules()).toEqual([]);
    await quietWaitFor(page, () => document.querySelector('[data-fake-layout="desktop"]') !== null, 15_000);
    expect(engineFrame(page)).toBeUndefined();
    expect(await fake.writes()).toEqual([]);
  });

  test('E52 a click in the dialog leaves the engine inactive; hidden, a click on Instagram activates it; the autopilot waits, no chooser', async ({
    context,
    extension,
    fake,
  }) => {
    const choosers = countFileChoosers(context);
    const page = await openInstagram(context);
    const vp = await viewport(page);
    const composer = await openComposer(page);
    await startShareTest(composer);
    await waitEngine(page);
    await expect.poll(() => enginePath(page), { timeout: 15_000 }).toBe('/');
    // N5: a real click in the dialog (its title; an extension frame) does not activate the engine frame.
    expect(await engineQuiet(page, () => navigator.userActivation.isActive)).toBe(false);
    const L = dialogLayout(vp.w, vp.h);
    await page.mouse.click(L.left + L.dlgW / 2, L.top + 22);
    const dialogClick = {
      engine: await engineQuiet(page, () => navigator.userActivation.isActive),
      top: await quietEvaluate(page, () => navigator.userActivation.isActive),
    };
    test.info().annotations.push({ type: 'N5', description: JSON.stringify(dialogClick) });
    expect(dialogClick.top).toBe(true);
    expect(dialogClick.engine).toBe(false);
    expect(composerMode(await hostSnapshot(page))).toBe('open');
    // Hidden into the chip (Esc), Instagram's page is the owner's again: a click there activates the engine.
    await page.keyboard.press('Escape');
    await waitChip(page);
    await page.mouse.click(vp.w / 2, vp.h / 2);
    const clickedAt = Date.now();
    expect(await engineQuiet(page, () => navigator.userActivation.isActive)).toBe(true);
    const rec = await waitRecord(extension, 1, 90_000);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('shareTested');
    expect(choosers()).toBe(0);
    // The agent tapped Story only once the activation had lapsed (R22: never a file chooser).
    const story = (await fake.log()).find((l) => l.step === 'tap:story');
    expect(story).toBeDefined();
    expect((story?.t ?? 0) - clickedAt).toBeGreaterThan(4000);
  });

  test('E53 F8 without a sandbox: a checkpoint moves the desktop page to /challenge/ → KILLED_CHALLENGE, locked', async ({
    context,
    extension,
    fake,
    sessionRules,
    storedSettings,
  }) => {
    await fake.setKnobs({ challenge: 'afterReadyTop' });
    const page = await openInstagram(context);
    const composer = await openComposer(page);
    await startShareTest(composer);
    const rec = await waitRecord(extension, 1, 90_000);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('killed');
    expect(rec.code).toBe('KILLED_CHALLENGE');
    expect(rec.locked).toBe('KILLED_CHALLENGE');
    expect(new URL(page.url()).pathname).toBe('/challenge/');
    expect(rec.pageUrls.at(-1)).toBe('/challenge/');
    expect((await storedSettings())?.msiteLockedUntil ?? 0).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    expect(rec.rules.after).toEqual([]);
    expect(await sessionRules()).toEqual([]);
    expect(await fake.writes()).toEqual([]);
  });

  for (const [knobs, code, kind, how] of [
    [{ framed: 'login' }, 'NOT_LOGGED_IN', 'stopped', 'framed'],
    [{ framed: 'offhost' }, 'KILLED_OFFHOST', 'killed', 'framed'],
    [{ framed: 'refuse' }, 'FRAME_REFUSED', 'stopped', 'framed'],
    [{ framed: 'desktop' }, 'DESKTOP_SHELL', 'stopped', 'framed'],
    [{ challenge: 'afterReady' }, 'KILLED_CHALLENGE', 'killed', 'forged'],
    [{ challenge: 'afterReadySpa' }, 'KILLED_CHALLENGE', 'killed', 'forged'],
  ] as const) {
    test(`E47 the frame's kill switch: ${JSON.stringify(knobs)} → ${code}`, async ({
      context,
      extension,
      fake,
      sessionRules,
      storedSettings,
      tripwire,
    }) => {
      tripwire.expectOutside('https://accountscenter.instagram.com/');
      // The `framed` answers apply to a request the server sees as framed: rule 1021 left out (C15).
      if (how === 'framed') await setToggles(extension, { fetchDest: 'iframe' });
      await fake.setKnobs(knobs);
      const page = await openInstagram(context);
      const composer = await openComposer(page);
      if (how === 'framed') await startCheck(composer);
      else await startShareTest(composer);
      const rec = await waitRecord(extension, 1, 90_000);
      expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe(kind);
      expect(rec.code).toBe(code);
      const lock = (await storedSettings())?.msiteLockedUntil ?? null;
      if (kind === 'killed') expect(lock ?? 0).toBeGreaterThan(Date.now());
      else expect(lock).toBeNull();
      expect(rec.rules.after).toEqual([]);
      expect(await sessionRules()).toEqual([]);
      // The desktop page itself stayed where it was.
      expect(new URL(page.url()).pathname).toBe('/');
      expect(await fake.writes()).toEqual([]);
    });
  }
});

test.describe('in-page lane: posting', () => {
  test('E63 @live a real post: Post story → Posted from the publish answer, one 1080×1920 story, the outcome card, the chip', async ({
    context,
    extension,
    fake,
    sessionRules,
  }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(extension.mode !== 'live', 'a post reaches the fake only without the mock build’s static write block');
    const page = await openInstagram(context);
    const composer = await openComposer(page);
    await choosePhoto(page, composer, await photoFile(context, testInfo, 1080, 1920));
    await composer.getByTestId('inpage-post').click();
    // Zero human actions from here. The card shows for 4 s before the dialog closes itself (FS12): watch quietly.
    let card: { outcome: string; title: string } | null = null;
    const deadline = Date.now() + 120_000;
    while (!card && Date.now() < deadline) {
      card = await composerQuiet(page, () => {
        const c = document.querySelector('[data-testid="inpage-outcome"]');
        return c
          ? { outcome: c.getAttribute('data-outcome') ?? '', title: c.querySelector('.res-title')?.textContent ?? '' }
          : null;
      }).catch(() => null);
      if (!card) await page.waitForTimeout(100);
    }
    expect(card).toEqual({ outcome: 'posted', title: fill(EN['inpage.result.posted'], { handle: FAKE_ACCOUNT }) });
    const rec = await waitRecord(extension, 1, 30_000);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('posted');
    expect(rec.writeBlocked).toBe(false);
    expect(rec.rules.installed).toEqual([1001, 1020, 1021]);
    expect(rec.photo).toMatchObject({ source: 'export', mime: 'image/png' });
    expect(rec.share).toMatchObject({ sent: true, done: true, refused: null });
    // Server truth: one story, the export at 1080×1920, shared once from the frame.
    const stories = await fake.stories();
    expect(stories).toHaveLength(1);
    expect(stories[0]?.size).toEqual({ w: 1080, h: 1920 });
    expect((await fake.log()).filter((l) => l.step === 'tap:share')).toHaveLength(1);
    // FS12: Posted closes itself after 4 s; the chip says Posted, with the ✓ badge.
    await expect.poll(async () => composerMode(await hostSnapshot(page)), { timeout: 10_000 }).toBe('chip');
    await composerWait(
      page,
      () =>
        document.querySelector('[data-testid="inpage-chip"]')?.getAttribute('aria-label')?.includes('Posted') === true,
    );
    expect((await hostSnapshot(page)).badge?.attrs['data-k']).toBe('ok');
    expect(rec.rules.after).toEqual([]);
    expect(await sessionRules()).toEqual([]);
    expect(engineFrame(page)).toBeUndefined();
  });
});

test.describe('in-page lane: photos, languages, themes', () => {
  test('E64 HEIC: Choose photo… and drag and drop (Finder’s empty type) convert a real .heic; its export runs in the frame', async ({
    context,
    extension,
  }) => {
    test.setTimeout(120_000);
    const heic = readFileSync(HEIC);
    expect(heic.subarray(4, 12).toString('latin1')).toBe('ftypheic');
    const page = await openInstagram(context);
    let composer = await openComposer(page);
    await choosePhoto(page, composer, HEIC);
    const asset = await composer.getByTestId('editor-stage').getAttribute('data-asset-id');
    expect(asset).toBeTruthy();
    // The converted photo is the story's: a Test run takes its export into Instagram's composer in the frame.
    await startTestRun(composer);
    const rec = await waitRecord(extension);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('tested');
    expect(rec.photo).toMatchObject({ source: 'export', mime: 'image/png' });
    expect(rec.compose?.drawn).toBe(true);

    // Drag and drop from Finder: a HEIC with an empty type, recognised by its name and ftyp brand.
    await composer.getByTestId('inpage-close').click();
    await expect.poll(async () => composerMode(await hostSnapshot(page))).toBe('closed');
    const fresh = await openInstagram(context);
    composer = await openComposer(fresh);
    await composer.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'IMG_0042.HEIC', { type: '' }));
      const dialog = document.querySelector('.dialog');
      if (!dialog) throw new Error('no dialog');
      for (const type of ['dragenter', 'dragover', 'drop']) {
        dialog.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    }, heic.toString('base64'));
    await waitEdited(composer);
    expect(await composer.getByTestId('editor-stage').getAttribute('data-asset-id')).toBeTruthy();
    await expect(composer.locator('.drop-err')).toHaveCount(0);
  });

  test('E65 the composer in Spanish: Settings → Español switches the dialog, its run and result, and the entry at once', async ({
    context,
    extension,
  }, testInfo) => {
    test.setTimeout(120_000);
    const page = await openInstagram(context);
    const composer = await openComposer(page);
    await expect(composer.locator('#dlg-title')).toHaveText(EN['inpage.dialog.titleNew']);
    await composer.locator('#more-btn').click();
    await composer.getByTestId('inpage-menu-settings').click();
    await composer.getByTestId('inpage-language').locator('button[lang="es"]').click();
    // The composer at once (no reload), its document's language too.
    await expect(composer.locator('.sheet.open h2')).toHaveText(ES['inpage.settings.title']);
    expect(await composer.evaluate(() => document.documentElement.lang)).toBe('es');
    await composer.locator('.sheet.open .sheet-h button').click();
    await expect(composer.locator('#dlg-title')).toHaveText(ES['inpage.dialog.titleNew']);
    await expect(composer.locator('.drop-title')).toHaveText(ES['inpage.import.title']);
    // The entry on Instagram's page (the content script reads the language from the background).
    await expect.poll(async () => (await hostSnapshot(page)).lang).toBe('es');
    await expect.poll(async () => (await hostSnapshot(page)).entry?.text ?? '').toContain(ES['page.entry.label']);
    expect((await hostSnapshot(page)).entry?.attrs['aria-label']).toBe(ES['page.entry.name']);
    // A Test run in Spanish: the result and its steps.
    await choosePhoto(page, composer, await photoFile(context, testInfo, 1080, 1920));
    await startTestRun(composer);
    const rec = await waitRecord(extension);
    expect(rec.outcome, JSON.stringify(rec, null, 2)).toBe('tested');
    await expect(composer.getByTestId('inpage-outcome')).toHaveAttribute('data-outcome', 'tested');
    await expect(composer.locator('.res-title')).toHaveText(ES['inpage.result.testTitle']);
    await expect(composer.locator('.steps')).toContainText(ES['inpage.step.done2']);
    await expect(composer.locator('.steps')).not.toContainText(EN['inpage.step.done2']);
    // And back to English, at once, on the page too.
    await composer.locator('#more-btn').click();
    await composer.getByTestId('inpage-menu-settings').click();
    await composer.getByTestId('inpage-language').locator('button[lang="en"]').click();
    await expect(composer.locator('.sheet.open h2')).toHaveText(EN['inpage.settings.title']);
    await expect.poll(async () => (await hostSnapshot(page)).entry?.text ?? '').toContain(EN['page.entry.label']);
  });

  test('E66 Instagram dark: the entry and the composer dark; Instagram following the system: both switch live', async ({
    context,
    fake,
  }) => {
    test.setTimeout(120_000);
    await fake.setKnobs({ theme: 'dark' });
    let page = await openInstagram(context);
    await waitEntry(page);
    expect(await quietEvaluate(page, () => document.documentElement.dataset.fakeTheme)).toBe('dark');
    await expect.poll(async () => (await hostSnapshot(page)).scheme).toBe('dark');
    await openComposer(page);
    expect((await hostSnapshot(page)).composer?.attrs.style).toContain('color-scheme: dark');
    await composerWait(page, () => document.documentElement.dataset.theme === 'dark');
    await page.close();

    // `auto` (Instagram's Automatic appearance): the system's preference, switched live.
    await fake.setKnobs({ theme: 'auto' });
    page = await openInstagram(context);
    await page.emulateMedia({ colorScheme: 'light' });
    await waitEntry(page);
    await expect.poll(async () => (await hostSnapshot(page)).scheme).toBe('light');
    await openComposer(page);
    await composerWait(page, () => document.documentElement.dataset.theme === 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await quietWaitFor(page, () => document.documentElement.classList.contains('__fb-dark-mode'), 5000);
    await expect.poll(async () => (await hostSnapshot(page)).scheme).toBe('dark');
    await composerWait(page, () => document.documentElement.dataset.theme === 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(async () => (await hostSnapshot(page)).scheme).toBe('light');
    await composerWait(page, () => document.documentElement.dataset.theme === 'light');
  });
});
