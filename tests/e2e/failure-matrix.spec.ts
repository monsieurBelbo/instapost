/**
 * E12 (strategy §7.11, §3.6, §3.10): one test per fake knob, on the mock and live artifacts.
 *
 * | Case | Knob                    | Expected                                                        |
 * |------|-------------------------|-----------------------------------------------------------------|
 * | (a)  | sw=desktopShell         | after the hard reload: mobile, uncontrolled; a normal tab: desktop |
 * | (b)  | sw=claimLate            | SW_TOOK_CONTROL, no lock                                        |
 * | (c)  | auth=out                | NOT_LOGGED_IN, no lock                                          |
 * | (d)  | auth=challenge          | kill; next start MSITE_LOCKED; ENABLE re-enables                |
 * | (e)  | offhost=afterReady      | kill (KILLED_OFFHOST)                                           |
 * | (f)  | trusted=require         | INJECTION_IGNORED → H0, exactly one inject                      |
 * | (g)  | listen=drop             | as (f)                                                          |
 * | (h)  | input=afterTap          | H0 (INPUT_MISSING)                                              |
 * | (i)  | route=homeOnly          | H0 with the "tap + → Story" text                                |
 * | (j)  | accept=changed          | ACCEPT_DRIFT → H0                                               |
 * | (k)  | classifier=client-hints | still mobile                                                    |
 * | (l)  | locale=es               | the same outcomes as en                                         |
 * | (m)  | drift=renamed           | unaffected                                                      |
 * | (a2) | sw=desktopShell, post   | homeOnly H0, posted by hand; every reloaded document mobile     |
 * | (n)  | auth=codeentry          | kill and lock (AM17: /auth_platform is a security flow)         |
 * | (o)  | route=elsewhere         | UNEXPECTED_PAGE, no reload, no lock, nothing injected (AM17)     |
 * | (p)  | offhost=firstLoad       | kill and lock before the kill switch is armed (AM20)            |
 * | (q)  | pushState after the pick| H1 kept: same document, no re-probe, no INJECTION_IGNORED (AM16) |
 * | (r)  | share=background        | rehearsal off: held open until answered, upload lands (AM19)    |
 * | (s)  | reload, desktopComposer | a later SW-served desktop document → DESKTOP_SHELL (AM2)         |
 * | (t)  | reload, 302 home        | pinned: counts as composer left after Share (see AM16)          |
 * | (u)  | challenge=…             | mid-session challenge, full or in-page, ready or shared: kill   |
 * | (v)  | geometry=cssFixed:360x640 | insert never confirmed (C6), Share → C9, no pre-answer, held open (AM28) |
 *
 * Every case that needs H1 switches assisted insert on explicitly (it is off by default in live,
 * §7.10), so both artifacts run the same flow. (d), (l) and (m) open a second composer within
 * 60 s and clear the rate guard's log in between (fixtures.ts `clearRateLog`).
 */
import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { CLOSE_DELAY_MS, type HandoffRecord } from '../../src/core/handoff/state.ts';
import { BACKGROUND_UPLOAD_DELAY_MS, OFFHOST_URL } from '../../tools/fake-ig/protocol.ts';
import { expect, IG_ORIGIN, test, whenClosed } from './fixtures.ts';
import {
  answerPosted,
  cancelHandoff,
  gotoRoute,
  instruction,
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
import type { Human } from './helpers/human.ts';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The last record, which must exist. */
async function lastRecord(records: () => Promise<HandoffRecord[]>): Promise<HandoffRecord> {
  const rec = (await records()).at(-1);
  if (!rec) throw new Error('no hand-off record');
  return rec;
}

const phasesOf = (rec: HandoffRecord) => rec.phaseLog.map((p) => p.phase);

/** The export as a .png in the test's output dir, for the human's H0 pick. */
async function exportFile(
  exportBytes: (id: string) => Promise<Buffer>,
  exportId: string,
  testInfo: TestInfo,
): Promise<string> {
  const path = testInfo.outputPath('story.png');
  await writeFile(path, await exportBytes(exportId));
  return path;
}

/** Share, then wait for C9, the 3 s close and idle. */
async function shareAndFinish(page: Page, popup: Page, human: Human): Promise<void> {
  const closed = whenClosed(popup);
  await human.share(popup);
  await waitSeen(page, 'finished');
  await closed;
  await waitPhase(page, 'idle');
}

/** The UA classification the fake embedded in a shell document (C1's source). */
async function pageIsMobile(page: Page): Promise<unknown> {
  const raw = await page.locator('script[type="application/json"][data-fake-ua]').textContent();
  return (JSON.parse(raw ?? 'null') as { InstagramUserAgent?: { is_mobile?: unknown } } | null)?.InstagramUserAgent
    ?.is_mobile;
}

const lastSeq = async (fake: FakeClient): Promise<number> => (await fake.requests()).at(-1)?.seq ?? 0;

const isDocument = (r: RequestRecord) => r.host === 'www.instagram.com' && r.fetch['sec-fetch-dest'] === 'document';

// ---------------------------------------------------------------------------------------------
// (a)–(e): service worker, auth and off-host

test('E12 (a) sw=desktopShell: after the hard reload mobile and uncontrolled; a normal tab still gets desktop', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
}) => {
  await fake.setKnobs({ sw: 'desktopShell' });
  // Everyday browsing installs Instagram's (here: the fake's) service worker first.
  const visit = await context.newPage();
  await visit.goto(`${IG_ORIGIN}/`);
  await visit.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await visit.close();

  const since = await lastSeq(fake);
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  await whenClosed(await composer({ not: [visit] }));
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBeNull();
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('not-posted');
  expect(rec.probe).toMatchObject({ isMobile: true, swControlled: false });
  expect(rec.preflight).toMatchObject({ C1: 'pass', swControlled: false });

  // The worker really answered the popup's first load, with its own desktop-UA fetch (tabId -1,
  // spike S4; such fetches are `sec-fetch-dest: empty`) ...
  const session = await fake.requests(since);
  const viaSw = session.filter((r) => r.viaSw);
  expect(viaSw.map((r) => r.path)).toContain('/create/story/');
  for (const r of viaSw) expect(r.classification.is_mobile).toBe(false);
  // ... and every document the hard reload fetched itself carried the Android profile.
  const reloaded = session.filter((r) => !r.viaSw && isDocument(r));
  expect(reloaded.length).toBeGreaterThanOrEqual(1);
  for (const r of reloaded) expect(r.classification.is_mobile).toBe(true);
  // The fake 302s a desktop /create/story/ to `/`, and the worker's redirect commits before the
  // reload runs, so the reload reloads `/` and C5 reads homeOnly (docs/contract.md C5 caveat).
  expect(rec.route).toBe('homeOnly');
  expect(rec.preflight?.C5).toBe('fail');

  // Afterwards an ordinary tab is still served the desktop shell, through the worker.
  const after = await lastSeq(fake);
  const tab = await context.newPage();
  await tab.goto(`${IG_ORIGIN}/`);
  expect(await pageIsMobile(tab)).toBe(false);
  expect(await tab.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const later = await fake.requests(after);
  expect(later.filter((r) => r.viaSw).map((r) => r.path)).toContain('/');
  for (const r of later) expect(r.classification.is_mobile).toBe(false);
});

test('E12 (b) sw=claimLate: a service worker taking control mid-session ends it with SW_TOOK_CONTROL', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
}, testInfo) => {
  await fake.setKnobs({ sw: 'claimLate' });
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();
  await waitSeen(page, 'awaitingShare');
  await whenClosed(popup);
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('SW_TOOK_CONTROL');
  expect((await lastRecord(handoffRecords)).outcome).toBe('failed:SW_TOOK_CONTROL');
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
  expect(await fake.stories()).toHaveLength(0);
});

test('E12 (c) auth=out: NOT_LOGGED_IN closes the window at once, with no lock', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
}, testInfo) => {
  await fake.setKnobs({ auth: 'out' });
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('NOT_LOGGED_IN');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:NOT_LOGGED_IN');
  expect(phasesOf(rec)).not.toContain('injecting');
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
  await gotoRoute(page, '#/settings');
  await expect(page.locator('.lock-status')).toHaveAttribute('data-locked', 'false');
});

test('E12 (d) auth=challenge: kill and lock; the next start is MSITE_LOCKED; ENABLE re-enables the lane', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
  clearRateLog,
}, testInfo) => {
  await fake.setKnobs({ auth: 'challenge' });
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const t0 = Date.now();
  await postFromDesktop(page);
  const first = await composer();
  await whenClosed(first);
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('KILLED_CHALLENGE');
  expect((await lastRecord(handoffRecords)).outcome).toBe('killed:KILLED_CHALLENGE');
  const lockedUntil = (await storedSettings())?.msiteLockedUntil ?? 0;
  expect(lockedUntil).toBeGreaterThanOrEqual(t0 + WEEK_MS);
  expect(lockedUntil).toBeLessThanOrEqual(Date.now() + WEEK_MS);

  // The next start is refused before any window opens.
  let opened = 0;
  context.on('page', () => {
    opened++;
  });
  await postFromDesktop(page);
  await expect(page.getByTestId('handoff-error')).toHaveAttribute('data-error', 'MSITE_LOCKED');
  await page.waitForTimeout(1000);
  expect(opened).toBe(0);
  expect(await handoffRecords()).toHaveLength(1);

  // Typing ENABLE lifts the lock.
  await gotoRoute(page, '#/settings');
  const lock = page.locator('.lock-status');
  await expect(lock).toHaveAttribute('data-locked', 'true');
  await page.getByTestId('setting-enable').fill('ENABLE');
  await expect(lock).toHaveAttribute('data-locked', 'false');
  await expect.poll(async () => (await storedSettings())?.msiteLockedUntil ?? null).toBeNull();

  // With the challenge gone, a new session runs (the 60 s spacing is E14's subject).
  await fake.setKnobs({ auth: 'in' });
  await clearRateLog();
  await gotoRoute(page, '#/');
  await postFromDesktop(page);
  const second = await composer({ not: [first] });
  await waitPhase(page, 'awaitingShare');
  await cancelHandoff(page);
  await whenClosed(second);
  await waitPhase(page, 'idle');
  expect((await handoffRecords()).map((r) => r.outcome)).toEqual(['killed:KILLED_CHALLENGE', 'abandoned']);
});

test('E12 (e) offhost=afterReady: leaving Instagram kills the session and locks the lane', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
  tripwire,
}, testInfo) => {
  await fake.setKnobs({ offhost: 'afterReady' });
  tripwire.expectOutside(OFFHOST_URL);
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const t0 = Date.now();
  await postFromDesktop(page);
  const popup = await composer();
  await waitSeen(page, 'awaitingShare');
  await whenClosed(popup);
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('KILLED_OFFHOST');
  expect((await lastRecord(handoffRecords)).outcome).toBe('killed:KILLED_OFFHOST');
  expect((await storedSettings())?.msiteLockedUntil ?? 0).toBeGreaterThanOrEqual(t0 + WEEK_MS);
  expect(await fake.stories()).toHaveLength(0);
});

// ---------------------------------------------------------------------------------------------
// (f)–(j): the H1 → H0 ladder

test('E12 (f) trusted=require: the insert is ignored → INJECTION_IGNORED → H0, with exactly one inject', async ({
  context,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ trusted: 'require' });
  await countUntrustedFileChanges(context);
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();
  // H1 waits 10 s for C6, then falls back to H0 in the same window.
  await waitPhase(page, 'awaitingPick');
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H0');
  expect(await shownError(page)).toBe('INJECTION_IGNORED');
  expect(await fakeInputOutcome(popup)).toBe('ignored-untrusted');
  expect(await untrustedFileChanges(popup)).toBe(1);

  // The owner picks the file by hand (trusted), as the panel says.
  await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo));
  await waitPhase(page, 'awaitingShare');
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H0');
  expect(await untrustedFileChanges(popup)).toBe(1);
  await shareAndFinish(page, popup, human);

  const rec = await lastRecord(handoffRecords);
  expect(rec.level).toBe('H0');
  expect(rec.outcome).toBe('posted-confirmed');
  expect(phasesOf(rec).filter((p) => p === 'injecting')).toHaveLength(1);
  expect(phasesOf(rec)).toEqual(expect.arrayContaining(['injecting', 'awaitingPick', 'awaitingShare']));
  const stories = await fake.stories();
  expect(stories).toHaveLength(1);
  expect(stories[0]?.isTrusted).toBe(true);
});

test('E12 (g) listen=drop: the insert is ignored → INJECTION_IGNORED → H0, with exactly one inject', async ({
  context,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ listen: 'drop' });
  await countUntrustedFileChanges(context);
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H0');
  expect(await shownError(page)).toBe('INJECTION_IGNORED');
  expect(await fakeInputOutcome(popup)).toBe('ignored-listen');
  expect(await untrustedFileChanges(popup)).toBe(1);

  // This composer only reads drops: the owner drops the file (see human.dropFile).
  await human.dropFile(popup, await exportBytes(exportId), 'story.png', 'image/png');
  await waitPhase(page, 'awaitingShare');
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H0');
  expect(await untrustedFileChanges(popup)).toBe(1);
  await shareAndFinish(page, popup, human);

  const rec = await lastRecord(handoffRecords);
  expect(rec.level).toBe('H0');
  expect(rec.outcome).toBe('posted-confirmed');
  expect(phasesOf(rec).filter((p) => p === 'injecting')).toHaveLength(1);
  expect(await fake.stories()).toHaveLength(1);
});

test('E12 (h) input=afterTap: no story input on load → H0 (INPUT_MISSING); + → Story and pick', async ({
  context,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ input: 'afterTap' });
  await countUntrustedFileChanges(context);
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H0');
  expect(await shownError(page)).toBe('INPUT_MISSING');
  await expect(instruction(page)).toContainText('tap + → Story and pick');

  await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo));
  await waitPhase(page, 'awaitingShare');
  expect(await untrustedFileChanges(popup)).toBe(0);
  await shareAndFinish(page, popup, human);

  const rec = await lastRecord(handoffRecords);
  expect(rec.level).toBe('H0');
  expect(rec.outcome).toBe('posted-confirmed');
  expect(phasesOf(rec)).not.toContain('injecting');
  expect(rec.probe?.storyInput).toBe('absent');
  expect(rec.preflight?.C4).toBe('fail');
  expect(await fake.stories()).toHaveLength(1);
});

test('E12 (i) route=homeOnly: H0 with the "tap + → Story" text; the owner gets there from home', async ({
  context,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ route: 'homeOnly' });
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  await expect(popup).toHaveURL(`${IG_ORIGIN}/`);
  await expect(instruction(page)).toContainText(
    'The composer did not open directly. In the Instagram window tap + → Story, then pick instapost/',
  );

  // + → Story navigates in-page to /create/story/ (an AM2 re-probe), then the owner picks.
  await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo));
  await waitPhase(page, 'awaitingShare');
  await expect(popup).toHaveURL(`${IG_ORIGIN}/create/story/`);
  await shareAndFinish(page, popup, human);

  const rec = await lastRecord(handoffRecords);
  expect(rec.level).toBe('H0');
  expect(rec.outcome).toBe('posted-confirmed');
  expect(rec.route).toBe('homeOnly');
  expect(rec.preflight?.C5).toBe('fail');
  expect(phasesOf(rec)).not.toContain('injecting');
  expect(await fake.stories()).toHaveLength(1);
});

test('E12 (j) accept=changed: ACCEPT_DRIFT → H0, nothing inserted', async ({
  context,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ accept: 'changed' });
  await countUntrustedFileChanges(context);
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  expect(await shownError(page)).toBe('ACCEPT_DRIFT');

  await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo));
  await waitPhase(page, 'awaitingShare');
  expect(await untrustedFileChanges(popup)).toBe(0);
  await shareAndFinish(page, popup, human);

  const rec = await lastRecord(handoffRecords);
  expect(rec.level).toBe('H0');
  expect(rec.outcome).toBe('posted-confirmed');
  expect(phasesOf(rec)).not.toContain('injecting');
  expect(rec.probe).toMatchObject({ storyInput: 'present', acceptOk: false });
  expect(rec.probe?.acceptSeen).toContain('image/avif,image/heic,image/jpeg,image/png');
  expect(rec.preflight?.C4).toBe('fail');
});

// ---------------------------------------------------------------------------------------------
// (k)–(m): classification, locale and markup drift

test('E12 (k) classifier=client-hints: the composer is still classified mobile', async ({
  editor,
  composer,
  fake,
  handoffRecords,
}) => {
  await fake.setKnobs({ classifier: 'client-hints' });
  const since = await lastSeq(fake);
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBeNull();
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('not-posted');
  expect(rec.probe?.isMobile).toBe(true);
  expect(rec.preflight?.C1).toBe('pass');
  const docs = (await fake.requests(since)).filter((r) => isDocument(r) && r.path === '/create/story/');
  expect(docs.length).toBeGreaterThanOrEqual(1);
  for (const r of docs) {
    expect(r.ch['sec-ch-ua-mobile']).toBe('?1');
    expect(r.classification.is_mobile).toBe(true);
  }
});

/** What an H1 post looks like from the outside, minus ids and times. */
interface H1Outcome {
  level: HandoffRecord['level'];
  outcome: HandoffRecord['outcome'];
  phases: string[];
  preflight: unknown;
  canvas: unknown;
  error: string | null;
  story: { isTrusted: boolean | null; size: unknown };
}

/** One H1 post through Share; `look` inspects the composer while it is ready. */
async function h1Post(
  f: {
    page: Page;
    composer: (o?: { not?: readonly Page[] }) => Promise<Page>;
    fake: FakeClient;
    human: Human;
    handoffRecords: () => Promise<HandoffRecord[]>;
  },
  not: readonly Page[],
  look: (popup: Page) => Promise<void>,
): Promise<{ popup: Page; outcome: H1Outcome; rec: HandoffRecord }> {
  await postFromDesktop(f.page);
  const popup = await f.composer({ not });
  await waitPhase(f.page, 'awaitingShare');
  await expect(phaseLocator(f.page)).toHaveAttribute('data-level', 'H1');
  // The C8 report of the ready composer (AM13) reaches the panel before Share.
  await expect(f.page.getByTestId('handoff-probe')).toContainText('Canvas');
  await look(popup);
  await shareAndFinish(f.page, popup, f.human);
  const rec = await lastRecord(f.handoffRecords);
  const story = (await f.fake.stories()).at(-1);
  const { contractVersion: _v, C8, ...checks } = rec.preflight ?? ({} as NonNullable<HandoffRecord['preflight']>);
  return {
    popup,
    rec,
    outcome: {
      level: rec.level,
      outcome: rec.outcome,
      phases: phasesOf(rec),
      preflight: checks,
      canvas: C8?.canvas ?? null,
      error: await shownError(f.page),
      story: { isTrusted: story?.isTrusted ?? null, size: story?.size ?? null },
    },
  };
}

test('E12 (l) locale=es: the same outcomes as en', async ({
  context,
  editor,
  composer,
  fake,
  human,
  handoffRecords,
  clearRateLog,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const f = { page, composer, fake, human, handoffRecords };
  const lang = (p: Page) => p.evaluate(() => document.documentElement.lang);

  const en = await h1Post(f, [], async (p) => expect(await lang(p)).toBe('en'));
  await fake.setKnobs({ locale: 'es' });
  await clearRateLog();
  const es = await h1Post(f, [en.popup], async (p) => expect(await lang(p)).toBe('es'));

  expect(es.outcome).toEqual(en.outcome);
  expect(en.outcome).toMatchObject({ level: 'H1', outcome: 'posted-confirmed', error: null });
  expect([en.rec.probe?.lang, es.rec.probe?.lang]).toEqual(['en', 'es']);
  expect(await fake.stories()).toHaveLength(2);
});

test('E12 (m) drift=renamed: randomised class names and ids change nothing', async ({
  context,
  editor,
  composer,
  fake,
  human,
  handoffRecords,
  clearRateLog,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const f = { page, composer, fake, human, handoffRecords };
  const hasPlainRoot = (p: Page) => p.evaluate(() => document.getElementById('root') !== null);

  const plain = await h1Post(f, [], async (p) => expect(await hasPlainRoot(p)).toBe(true));
  await fake.setKnobs({ drift: 'renamed' });
  await clearRateLog();
  const renamed = await h1Post(f, [plain.popup], async (p) => {
    expect(await hasPlainRoot(p)).toBe(false);
    // The UA script is renamed too; the agent finds it by type and content only.
    expect(await p.locator('script[data-fake-ua]').count()).toBe(0);
  });

  expect(renamed.outcome).toEqual(plain.outcome);
  expect(plain.outcome).toMatchObject({ level: 'H1', outcome: 'posted-confirmed', error: null });
  expect(await fake.stories()).toHaveLength(2);
});

// ---------------------------------------------------------------------------------------------
// Review fixes (§11 AM16–AM26): service worker in post mode, fail-closed URLs, the first
// navigation, same-document loads, uploads after Share, later full-document loads, challenges.

test.describe('with the fake service worker installed first (FID-1)', () => {
  test.use({ preinstallFakeSw: true });

  test('E12 (a2) sw=desktopShell, post: H0 "tap + → Story" from home, posted by hand; reloaded documents mobile', async ({
    context,
    editor,
    composer,
    fake,
    human,
    exportBytes,
    handoffRecords,
  }, testInfo) => {
    const since = await lastSeq(fake);
    const page = await editor();
    await setSwitches(page, { assisted: true });
    await loadPhoto(page, await photoFile(context, testInfo));
    const exportId = await postFromDesktop(page);
    const popup = await composer();
    await waitPhase(page, 'awaitingPick');
    await expect(instruction(page)).toContainText('The composer did not open directly');
    await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo));
    await waitPhase(page, 'awaitingShare');
    await shareAndFinish(page, popup, human);

    const rec = await lastRecord(handoffRecords);
    expect(rec).toMatchObject({ level: 'H0', outcome: 'posted-confirmed', route: 'homeOnly' });
    expect(rec.preflight?.C5).toBe('fail');
    const session = await fake.requests(since);
    expect(session.filter((r) => r.viaSw).map((r) => r.path)).toContain('/create/story/');
    const reloaded = session.filter((r) => !r.viaSw && isDocument(r));
    expect(reloaded.length).toBeGreaterThanOrEqual(1);
    for (const r of reloaded) expect(r.classification.is_mobile).toBe(true);
    expect(await fake.stories()).toHaveLength(1);
  });

  test('E12 (s) reload=afterReady, desktopComposer=desktopShell: the SW-served desktop document → DESKTOP_SHELL', async ({
    context,
    editor,
    composer,
    fake,
    handoffRecords,
  }, testInfo) => {
    await fake.setKnobs({ desktopComposer: 'desktopShell', reload: 'afterReady' });
    const page = await editor();
    await setSwitches(page, { assisted: true });
    await loadPhoto(page, await photoFile(context, testInfo));
    await postFromDesktop(page);
    const popup = await composer();
    await waitSeen(page, 'awaitingShare');
    await whenClosed(popup);
    await waitPhase(page, 'idle');
    expect(await shownError(page)).toBe('DESKTOP_SHELL');
    const rec = await lastRecord(handoffRecords);
    expect(rec.outcome).toBe('failed:DESKTOP_SHELL');
    expect(rec.level).toBe('H1');
    expect(await fake.stories()).toHaveLength(0);
  });

  test('E12 (t) reload=afterReady, desktop 302 home: pinned, the reload counts as the composer left after Share', async ({
    context,
    editor,
    composer,
    fake,
    human,
    exportBytes,
    handoffRecords,
  }, testInfo) => {
    // A later full-document load that the SW redirects home is indistinguishable from a full
    // navigation home after a real Share (AM16), so it ends as C9, pre-answered "posted"; the
    // owner's answer corrects the record. The window still closes (rehearsal on).
    await fake.setKnobs({ reload: 'afterReady' });
    const page = await editor();
    await setSwitches(page, { assisted: true });
    await loadPhoto(page, await photoFile(context, testInfo));
    const exportId = await postFromDesktop(page);
    const popup = await composer();
    await waitPhase(page, 'awaitingPick'); // homeOnly: the SW-served first load went home
    const closed = whenClosed(popup);
    await human.pickViaStory(popup, await exportFile(exportBytes, exportId, testInfo));
    await waitSeen(page, 'finished');
    await answerPosted(page, false);
    await closed;
    await waitPhase(page, 'idle');
    const rec = await lastRecord(handoffRecords);
    expect(rec.outcome).toBe('not-posted');
    expect(phasesOf(rec)).toContain('awaitingShare');
    expect(await fake.stories()).toHaveLength(0);
  });
});

test('E12 (n) auth=codeentry: a security flow under /auth_platform kills and locks the lane (AM17)', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
}, testInfo) => {
  await fake.setKnobs({ auth: 'codeentry' });
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const t0 = Date.now();
  await postFromDesktop(page);
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('KILLED_CHALLENGE');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('killed:KILLED_CHALLENGE');
  expect(phasesOf(rec)).not.toContain('injecting');
  expect((await storedSettings())?.msiteLockedUntil ?? 0).toBeGreaterThanOrEqual(t0 + WEEK_MS);
});

test('E12 (o) route=elsewhere: an unexpected Instagram page → UNEXPECTED_PAGE, no reload, no lock (AM17)', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
}, testInfo) => {
  await fake.setKnobs({ route: 'elsewhere' });
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('UNEXPECTED_PAGE');
  // AM28: the page is named in the panel and on the record (query dropped), a contract fact for L4.
  await expect(page.getByTestId('handoff-error-detail')).toHaveText('It went to /consent/.');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:UNEXPECTED_PAGE');
  expect(rec.detail).toBe('page /consent/');
  expect(phasesOf(rec)).not.toContain('reloading');
  expect(phasesOf(rec)).not.toContain('injecting');
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
});

test('E12 (p) offhost=firstLoad: the first load leaves Instagram → kill and lock, no reload (AM20)', async ({
  context,
  editor,
  fake,
  handoffRecords,
  storedSettings,
  tripwire,
}, testInfo) => {
  await fake.setKnobs({ offhost: 'firstLoad' });
  tripwire.expectOutside(OFFHOST_URL);
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  const t0 = Date.now();
  // The popup never shows www (the composer route redirects straight off-host): catch it as it opens.
  const opened = context.waitForEvent('page');
  await postFromDesktop(page);
  await whenClosed(await opened);
  await waitPhase(page, 'idle');
  expect(await shownError(page)).toBe('KILLED_OFFHOST');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('killed:KILLED_OFFHOST');
  expect(phasesOf(rec)).not.toContain('reloading');
  expect((await storedSettings())?.msiteLockedUntil ?? 0).toBeGreaterThanOrEqual(t0 + WEEK_MS);
});

test('E12 (q) a pushState inside /create/story after the insert keeps H1: same document, no re-probe (AM16)', async ({
  context,
  editor,
  composer,
  fake,
  human,
  handoffRecords,
  handoffState,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingShare');
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H1');
  // The composer moves to its editing step in-page, as msite routes (Chrome reports it as loading).
  await popup.evaluate(() => window.history.pushState(null, '', '/create/story/?step=edit'));
  await expect
    .poll(async () =>
      ((await handoffState()) as { phaseLog?: { phase: string }[] }).phaseLog?.slice(-2).map((p) => p.phase),
    )
    .toEqual(['probing', 'awaitingShare']);
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H1');
  expect(await shownError(page)).toBeNull();
  await shareAndFinish(page, popup, human);
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ level: 'H1', outcome: 'posted-confirmed' });
  expect(await fake.stories()).toHaveLength(1);
});

test('E12 (r) share=background: rehearsal off holds the popup open until the owner answers, so the upload lands (AM19)', async ({
  context,
  editor,
  composer,
  fake,
  human,
  handoffRecords,
  clearRateLog,
}, testInfo) => {
  await fake.setKnobs({ share: 'background' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));

  // Rehearsal on (its blocks stop real uploads anyway): the popup closes 3 s after C9, cutting the
  // late upload off. This is the harm AM19 avoids when rehearsal is off.
  await setSwitches(page, { assisted: true, rehearsal: true });
  await postFromDesktop(page);
  const first = await composer();
  await waitPhase(page, 'awaitingShare');
  const firstClosed = whenClosed(first);
  await human.share(first);
  await waitSeen(page, 'finished');
  await firstClosed;
  await waitPhase(page, 'idle');
  await page.waitForTimeout(BACKGROUND_UPLOAD_DELAY_MS);
  expect(await fake.stories()).toHaveLength(0);

  // Rehearsal off: held open past the 3 s and past the upload; the answer closes it.
  await setSwitches(page, { rehearsal: false });
  await clearRateLog();
  await postFromDesktop(page);
  const second = await composer({ not: [first] });
  await waitPhase(page, 'awaitingShare');
  const closed = whenClosed(second);
  await human.share(second);
  await waitPhase(page, 'finished');
  await expect(page.getByTestId('handoff-hold-open')).toBeVisible();
  await page.waitForTimeout(CLOSE_DELAY_MS + 500);
  expect(second.isClosed()).toBe(false);
  await expect.poll(async () => (await fake.stories()).length, { timeout: 10_000 }).toBe(1);
  await answerPosted(page, true);
  await closed;
  await waitPhase(page, 'idle');
  expect((await lastRecord(handoffRecords)).outcome).toBe('posted-confirmed');
});

test('E12 (v) geometry=cssFixed:360x640: an insert C6 never confirms, then Share → C9 with no pre-answer, held open (AM28)', async ({
  context,
  editor,
  composer,
  fake,
  human,
  handoffRecords,
}, testInfo) => {
  // In the default 511x909 popup this canvas covers 49.6% of the viewport (AM14), so C6 never holds:
  // the inserted photo is in the composer, but the agent can only report inject-unconfirmed.
  await fake.setKnobs({ geometry: 'cssFixed:360x640' });
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  expect(await shownError(page)).toBe('INJECTION_IGNORED');

  // The owner sees the photo and taps Share; the composer goes home. That is C9, not C5 failing.
  await human.share(popup);
  await waitPhase(page, 'finished');
  await expect(page.getByTestId('handoff-posted')).toHaveAttribute('data-pre-answer', 'null');
  await expect(page.getByRole('button', { name: 'Yes, posted' })).not.toHaveClass(/primary/);
  await expect(page.getByRole('button', { name: 'Not posted' })).not.toHaveClass(/primary/);
  await expect(page.getByTestId('handoff-hold-open')).toBeVisible();
  // Held open past the 3 s close although rehearsal is on: a post or a pick by hand may still run there.
  await page.waitForTimeout(CLOSE_DELAY_MS + 500);
  expect(popup.isClosed()).toBe(false);
  const closed = whenClosed(popup);
  await answerPosted(page, true);
  await closed;
  await waitPhase(page, 'idle');

  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('posted-confirmed');
  expect(rec.detail).toMatch(/not confirmed/);
  expect(rec.route).toBe('direct');
  expect(phasesOf(rec)).toEqual(expect.arrayContaining(['injecting', 'awaitingPick', 'finished']));
  expect(phasesOf(rec)).not.toContain('awaitingShare');
  expect(await fake.stories()).toHaveLength(1);
});

for (const when of ['afterReady', 'afterReadySpa', 'afterShare', 'afterShareSpa'] as const) {
  test(`E12 (u) challenge=${when}: a mid-session security challenge kills and locks; the record says so (FID-6)`, async ({
    context,
    editor,
    composer,
    fake,
    human,
    handoffRecords,
    storedSettings,
  }, testInfo) => {
    await fake.setKnobs({ challenge: when });
    const page = await editor();
    await setSwitches(page, { assisted: true });
    await loadPhoto(page, await photoFile(context, testInfo));
    const t0 = Date.now();
    await postFromDesktop(page);
    const popup = await composer();
    const closed = whenClosed(popup);
    await waitSeen(page, 'awaitingShare');
    const shared = when.startsWith('afterShare');
    if (shared) await human.share(popup);
    await closed;
    await waitPhase(page, 'idle');
    expect(await shownError(page)).toBe('KILLED_CHALLENGE');
    const rec = await lastRecord(handoffRecords);
    // After Share the record was first written posted-confirmed, then patched by the kill.
    expect(rec.outcome).toBe('killed:KILLED_CHALLENGE');
    if (shared) expect(phasesOf(rec)).toContain('finished');
    expect(await fake.stories()).toHaveLength(shared ? 1 : 0);
    const lockedUntil = (await storedSettings())?.msiteLockedUntil ?? 0;
    expect(lockedUntil).toBeGreaterThanOrEqual(t0 + WEEK_MS);
  });
}
