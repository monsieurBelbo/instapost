/**
 * E12 (strategy §7.11, §3.6, §3.10; ux.md §5, AM39): one test per fake knob, on the mock and live artifacts,
 * with the autopilot driving. Since AM35 the fake's defaults are the production shape (route=homeOnly, the
 * story input beside + on home, ≤ 767 CSS px, sw=claimOnRegister); since AM39 it models + → Story, the
 * armed story input, the composer's Share footer and Instagram's own upload and publish requests.
 *
 * Most cases run a Test run (everything up to Share, writes blocked, the window closes on a failure); the
 * ones about posting run a Post story (Posted on live, the blocked upload on mock).
 *
 * | Case | Knob                    | Expected                                                        |
 * |------|-------------------------|-----------------------------------------------------------------|
 * | (a)  | sw=desktopShell, first  | the hard reload escapes it, then it handles the page's requests: SW_INTERCEPTS, no lock; a normal tab: desktop |
 * | (a2) | sw=desktopShell, page   | the composer registers it itself: SW_INTERCEPTS; its requests show workerStart > 0 |
 * | (b)  | sw=claimLate            | a worker claiming mid-run is counted, never fatal (P2)          |
 * | (c)  | auth=out                | NOT_LOGGED_IN, no lock, nothing tapped                          |
 * | (d)  | auth=challenge          | kill and lock; the next start MSITE_LOCKED; Resume (checkbox) lifts it |
 * | (e)  | offhost=afterReady      | the composer leaves Instagram before Share: kill and lock, nothing posted |
 * | ~~(f)~~ | trusted=require      | struck (AM39): + opens no menu → STORY_ENTRY_MISSING, E33 (a); Finish by hand, E40 |
 * | (g)  | listen=drop             | the insert is ignored: INJECTION_IGNORED, exactly one insert, nothing tapped after it |
 * | (h)  | input=afterTap          | INPUT_MISSING after the P5 wait (no story input to arm); Finish by hand posts |
 * | (i)  | route=direct            | the composer route renders itself (pre-F3 shape): C5 pass; + is tapped on home only → STORY_ENTRY_MISSING (tap refused) |
 * | (j)  | accept=changed          | ACCEPT_DRIFT before any tap                                     |
 * | (k)  | classifier=client-hints | still mobile                                                    |
 * | (l)  | locale=es               | the same outcomes as en                                         |
 * | (m)  | drift=renamed           | unaffected (structural fallbacks)                               |
 * | (n)  | auth=codeentry          | kill and lock (AM17: /auth_platform is a security flow)         |
 * | (o)  | route=elsewhere         | UNEXPECTED_PAGE, no reload, no lock, nothing tapped (AM17)      |
 * | (p)  | offhost=firstLoad       | kill and lock before the kill switch is armed (AM20)            |
 * | (q)  | a pushState inside /create/story after the insert | same document, no re-probe; the run goes on (AM16) |
 * | ~~(r)~~ | share=background     | struck (AM39): the knob is gone; a possibly running upload is held by OUTCOME_UNKNOWN (U19) and E37 runs a slow upload |
 * | (s)  | client-hints + uaOnly   | Instagram serves desktop (is_mobile false) → DESKTOP_SHELL (P1) |
 * | (w)  | a later desktop document on home | AM2's strict re-probe of a reloaded document, while the account prompt waits: DESKTOP_SHELL, nothing tapped |
 * | (t)  | reload=afterReady       | a new document after the insert (the composer reloaded, 302 home): INJECTION_IGNORED (page reloaded), nothing pressed |
 * | (u)  | challenge=…             | mid-run challenge, full or in-page: before Share kill (nothing posted); after Share kill (mock: Couldn't confirm; live: E38) |
 * | ~~(v)~~ | geometry=cssFixed:360x640 | struck (AM39): C6 decides nothing; the case is E13's cssFixed run in the default window |
 *
 * The old (w) after the H1 insert is (t) now: a new document after the insert is INJECTION_IGNORED.
 * (d), (l) and (m) open a second window within 60 s and clear the rate guard's log in between.
 */
import { writeFile } from 'node:fs/promises';
import type { Page, Worker } from '@playwright/test';
import { type HandoffRecord, INPUT_WAIT_MS } from '../../src/core/handoff/state.ts';
import { OFFHOST_URL } from '../../tools/fake-ig/protocol.ts';
import { type ExtGlobal, expect, IG_ORIGIN, test, whenClosed } from './fixtures.ts';
import {
  accountPrompt,
  detailRow,
  lastRecord,
  loadPhoto,
  phasesOf,
  photoFile,
  postCard,
  postStory,
  refusal,
  resultAction,
  testRun,
  waitResult,
} from './helpers/editor-flow.ts';
import type { FakeClient, RequestRecord } from './helpers/fake-client.ts';
import {
  countUntrustedFileChanges,
  fakeInputOutcome,
  quietEvaluate,
  quietWaitFor,
  untrustedFileChanges,
} from './helpers/fake-page.ts';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The UA classification the fake embedded in a shell document (C1's source). */
async function pageIsMobile(page: Page): Promise<unknown> {
  const raw = await page.locator('script[type="application/json"][data-fake-ua]').textContent();
  return (JSON.parse(raw ?? 'null') as { InstagramUserAgent?: { is_mobile?: unknown } } | null)?.InstagramUserAgent
    ?.is_mobile;
}

const lastSeq = async (fake: FakeClient): Promise<number> => (await fake.requests()).at(-1)?.seq ?? 0;
const isDocument = (r: RequestRecord) => r.host === 'www.instagram.com' && r.fetch['sec-fetch-dest'] === 'document';
const taps = async (fake: FakeClient) => (await fake.log()).filter((l) => l.step.startsWith('tap:')).map((l) => l.step);

/** chMode `uaOnly` (§3.7): rule 1001 rewrites only the User-Agent, so a client-hints classifier sees desktop. */
async function useUaOnly(sw: Worker): Promise<void> {
  await sw.evaluate(async () => {
    const { local } = (globalThis as ExtGlobal).chrome.storage;
    const { settings } = await local.get('settings');
    await local.set({ settings: { ...(settings ?? {}), chMode: 'uaOnly' } });
  });
}

// ---------------------------------------------------------------------------------------------
// (a)–(e): service worker, auth and off-host

test('E12 (a) (e) sw=desktopShell installed first: the hard reload escapes it, then it handles the page’s requests → SW_INTERCEPTS', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
}, testInfo) => {
  // Hypothetical (F2: Instagram's worker has no fetch handler): a worker that answers navigations with its
  // own desktop-UA fetch and handles every other request too. Everyday browsing installs it first (FID-1).
  await fake.setKnobs({ sw: 'desktopShell' });
  const visit = await context.newPage();
  await visit.goto(`${IG_ORIGIN}/`);
  await visit.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await visit.close();

  const since = await lastSeq(fake);
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  await whenClosed(await composer({ not: [visit] }));
  await waitResult(page, 'notPosted', { code: 'SW_INTERCEPTS' });
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:SW_INTERCEPTS');
  expect(rec.probe).toMatchObject({ isMobile: true });
  expect(rec.preflight).toMatchObject({ C1: 'pass' });
  // AF-2: whether the probe or the watch saw it, the row and the record say the worker intercepted.
  await expect(await detailRow(page, 'service-worker')).toHaveText('intercepts requests');
  expect(rec.preflight?.swIntercepted).toBe(true);
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
  expect(await fake.stories()).toHaveLength(0);
  expect(await taps(fake)).not.toContain('tap:share');

  // The worker really answered the popup's first load, with its own desktop-UA fetch (tabId -1, spike S4) ...
  const session = await fake.requests(since);
  const viaSw = session.filter((r) => r.viaSw);
  expect(viaSw.map((r) => r.path)).toContain('/create/story/');
  for (const r of viaSw) expect(r.classification.is_mobile).toBe(false);
  // ... every document the hard reload fetched itself carried the Android profile ...
  const reloaded = session.filter((r) => !r.viaSw && isDocument(r));
  expect(reloaded.length).toBeGreaterThanOrEqual(1);
  for (const r of reloaded) expect(r.classification.is_mobile).toBe(true);
  // ... but the worker then took the page, and its next request (the beacon) went through the worker, out
  // of rule 1001's reach (desktop UA on the wire).
  const beacons = session.filter((r) => r.path.startsWith('/fake-static/beacon'));
  expect(beacons.length).toBeGreaterThan(0);
  expect(beacons.some((r) => r.classification.is_mobile === false)).toBe(true);
  expect(rec.route).toBe('homeOnly');

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

test('E12 (a2) (e) sw=desktopShell registered by the composer itself: SW_INTERCEPTS; its requests show workerStart > 0', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
}, testInfo) => {
  await fake.setKnobs({ sw: 'desktopShell' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  await whenClosed(await composer());
  const card = await waitResult(page, 'notPosted', { code: 'SW_INTERCEPTS' });
  await expect(card).toContainText('handled the window’s own requests');
  await expect(await detailRow(page, 'service-worker')).toHaveText('intercepts requests');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:SW_INTERCEPTS');
  expect(rec.preflight?.swIntercepted).toBe(true);
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
  expect(await fake.stories()).toHaveLength(0);

  // The signal itself, on the fake (P3, F2): a page this worker controls sees workerStart > 0 on a www
  // request it handled. (The claim-on-register default keeps it at 0: E23.)
  const tab = await context.newPage();
  await tab.goto(`${IG_ORIGIN}/`);
  await expect.poll(() => tab.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const workerStart = await tab.evaluate(async () => {
    const url = `${location.origin}/fake-static/beacon?probe=${Date.now()}`;
    await (await fetch(url, { cache: 'no-store' })).arrayBuffer();
    for (let i = 0; i < 40; i++) {
      const e = performance.getEntriesByName(url)[0] as PerformanceResourceTiming | undefined;
      if (e) return e.workerStart;
      await new Promise((r) => setTimeout(r, 50));
    }
    return -1;
  });
  expect(workerStart).toBeGreaterThan(0);
});

test('E12 (b) sw=claimLate: a worker taking control mid-run is counted, never fatal (P2)', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
}, testInfo) => {
  await fake.setKnobs({ sw: 'claimLate' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  await whenClosed(await composer());
  await waitResult(page, extension.mode === 'live' ? 'posted' : 'shareTested');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe(extension.mode === 'live' ? 'posted' : 'share-tested');
  expect(rec.swControllerChanges).toBeGreaterThanOrEqual(1);
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
  expect(await fake.stories()).toHaveLength(extension.mode === 'live' ? 1 : 0);
});

test('E12 (c) auth=out: NOT_LOGGED_IN closes the window at once, with no lock and nothing tapped', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
}, testInfo) => {
  await fake.setKnobs({ auth: 'out' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  await whenClosed(await composer());
  const card = await waitResult(page, 'notPosted', { code: 'NOT_LOGGED_IN' });
  await expect(card).toContainText('Log in to Instagram first');
  await expect(resultAction(page, 'openInstagram')).toBeVisible();
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:NOT_LOGGED_IN');
  expect(phasesOf(rec)).not.toContain('openingEntry');
  expect(await taps(fake)).toEqual([]);
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-pace')).toHaveAttribute('data-locked', 'false');
});

test('E12 (d) auth=challenge: kill and lock; the next start is MSITE_LOCKED; Resume (checkbox) lifts the lock', async ({
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
  await loadPhoto(page, await photoFile(context, testInfo));
  const t0 = Date.now();
  await postStory(page);
  const first = await composer();
  await whenClosed(first);
  const card = await waitResult(page, 'notPosted', { code: 'KILLED_CHALLENGE' });
  await expect(card).toContainText('paused desktop posting for 7 days');
  expect((await lastRecord(handoffRecords)).outcome).toBe('killed:KILLED_CHALLENGE');
  const lockedUntil = (await storedSettings())?.msiteLockedUntil ?? 0;
  expect(lockedUntil).toBeGreaterThanOrEqual(t0 + WEEK_MS);
  expect(lockedUntil).toBeLessThanOrEqual(Date.now() + WEEK_MS);
  await expect(page.getByTestId('pause-banner')).toBeVisible();

  // The Post card is paused (K4); a start that gets through anyway (Test run) is refused before any window.
  await page.getByTestId('result-done').click();
  await expect(postCard(page)).toHaveAttribute('data-state', 'K4');
  await expect(page.getByTestId('post-primary')).toBeDisabled();
  let opened = 0;
  context.on('page', () => {
    opened++;
  });
  await page.getByTestId('post-test').click();
  await expect(refusal(page)).toHaveAttribute('data-error', 'MSITE_LOCKED');
  await page.waitForTimeout(1000);
  expect(opened).toBe(0);
  expect(await handoffRecords()).toHaveLength(1);

  // Resume…: the checkbox, then Resume, lifts the lock (AM25's message).
  await page.getByTestId('pause-resume-open').click();
  await expect(page.getByTestId('pause-resume')).toBeDisabled();
  await page.getByTestId('pause-resume-check').check();
  await page.getByTestId('pause-resume').click();
  await expect(page.getByTestId('pause-banner')).toHaveCount(0);
  await expect.poll(async () => (await storedSettings())?.msiteLockedUntil ?? null).toBeNull();

  // With the challenge gone, a new run goes through (the 60 s spacing is E14's subject).
  await fake.setKnobs({ auth: 'in' });
  await clearRateLog();
  await testRun(page);
  await whenClosed(await composer({ not: [first] }));
  await waitResult(page, 'tested');
  expect((await handoffRecords()).map((r) => r.outcome)).toEqual(['killed:KILLED_CHALLENGE', 'tested']);
});

test('E12 (e) offhost=afterReady: the composer leaves Instagram before Share → kill and lock, nothing posted', async ({
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
  await loadPhoto(page, await photoFile(context, testInfo));
  const t0 = Date.now();
  await postStory(page);
  await whenClosed(await composer());
  const card = await waitResult(page, 'notPosted', { code: 'KILLED_OFFHOST' });
  await expect(card).toContainText('Nothing was posted');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('killed:KILLED_OFFHOST');
  expect(phasesOf(rec)).not.toContain('sharing');
  expect((await storedSettings())?.msiteLockedUntil ?? 0).toBeGreaterThanOrEqual(t0 + WEEK_MS);
  expect(await taps(fake)).not.toContain('tap:share');
  expect(await fake.uploads()).toEqual([]);
  expect(await fake.stories()).toHaveLength(0);
});

// ---------------------------------------------------------------------------------------------
// (g)–(j): the story input

test('E12 (g) listen=drop: the insert is ignored → INJECTION_IGNORED, exactly one insert, nothing pressed', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ listen: 'drop' });
  await countUntrustedFileChanges(context);
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  // The compose watch waits for the composer (20 s), then reports that it never drew the photo.
  const card = await waitResult(page, 'notPosted', { code: 'INJECTION_IGNORED', timeout: 60_000 });
  await expect(card).toContainText('Nothing was posted');
  await expect(card).toHaveAttribute('data-held', 'offerManual');
  expect(await fakeInputOutcome(popup)).toBe('ignored-listen');
  expect(await untrustedFileChanges(popup)).toBe(1);
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ outcome: 'failed:INJECTION_IGNORED', detail: 'composer not drawn' });
  expect(rec.compose).toMatchObject({ onComposer: false, drawn: false });
  expect(await taps(fake)).not.toContain('tap:share');
  await page.getByTestId('result-done').click();
  await whenClosed(popup);
});

test('E12 (h) input=afterTap: no story input to arm → INPUT_MISSING after the P5 wait; Finish by hand: the owner posts', async ({
  context,
  extension,
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
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  // P5: the probe on `/` found no story input; the failure comes only after the 6 s wait for a late one.
  const card = await waitResult(page, 'notPosted', { code: 'INPUT_MISSING' });
  await expect(card).toContainText('Instagram didn’t offer a story upload');
  await expect(await detailRow(page, 'story-input')).toHaveText('none image-only (file inputs: image/jpeg)');
  const rec0 = await lastRecord(handoffRecords);
  expect(rec0.probe?.storyInput).toBe('absent');
  expect(rec0.preflight?.C4).toBe('fail');
  expect(rec0.route).toBe('homeOnly');
  expect(phasesOf(rec0)).not.toContain('openingEntry');
  const probing = rec0.phaseLog.find((p) => p.phase === 'probing')?.t ?? 0;
  const failed = rec0.phaseLog.find((p) => p.phase === 'finished')?.t ?? 0;
  expect(failed - probing).toBeGreaterThanOrEqual(INPUT_WAIT_MS);
  expect(await taps(fake)).toEqual([]);

  // Finish by hand (§4.9): the owner taps + → Story and picks the export, then taps Share.
  await resultAction(page, 'finishByHand').click();
  await expect(page.getByTestId('finish-by-hand')).toHaveAttribute('data-needs', 'pick');
  const file = testInfo.outputPath('story.png');
  await writeFile(file, await exportBytes(rec0.exportId as string));
  await human.pickViaStory(popup, file);
  const closed = whenClosed(popup);
  await human.share(popup);
  await waitResult(page, extension.mode === 'live' ? 'posted' : 'shareTested');
  await closed;
  expect(await untrustedFileChanges(popup).catch(() => 0)).toBe(0);
  const rec = await lastRecord(handoffRecords);
  expect(rec.evidence?.sharedBy).toBe('owner');
  expect(rec.outcome).toBe(extension.mode === 'live' ? 'posted' : 'share-tested');
  expect(await fake.stories()).toHaveLength(extension.mode === 'live' ? 1 : 0);
});

test('E12 (i) route=direct (the pre-F3 shape): the composer route renders itself, C5 passes; + is tapped on home only → STORY_ENTRY_MISSING', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ route: 'direct' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  await whenClosed(await composer());
  await waitResult(page, 'notPosted', { code: 'STORY_ENTRY_MISSING' });
  await expect(await detailRow(page, 'page')).toHaveText('/create/story/ (the story composer directly)');
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ route: 'direct', detail: 'tap refused' });
  expect(rec.preflight?.C5).toBe('pass');
  expect(rec.entry).toMatchObject({ result: 'REFUSED', plusTaps: 0 });
  // The tap helper refused + off home: nothing was clicked at all.
  expect(await taps(fake)).toEqual([]);
});

test('E12 (j) accept=changed: ACCEPT_DRIFT before any tap', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ accept: 'changed' });
  await countUntrustedFileChanges(context);
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  await whenClosed(await composer());
  await waitResult(page, 'notPosted', { code: 'ACCEPT_DRIFT' });
  await expect(await detailRow(page, 'story-input')).toHaveText(
    'present, accept list changed: image/avif,image/heic,image/jpeg,image/png',
  );
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:ACCEPT_DRIFT');
  expect(phasesOf(rec)).not.toContain('openingEntry');
  expect(rec.probe).toMatchObject({ storyInput: 'present', acceptOk: false });
  expect(rec.probe?.acceptSeen).toContain('image/avif,image/heic,image/jpeg,image/png');
  expect(rec.preflight?.C4).toBe('fail');
  expect(await taps(fake)).toEqual([]);
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
  const { checkConnection } = await import('./helpers/editor-flow.ts');
  const page = await editor();
  await checkConnection(page);
  await whenClosed(await composer());
  await waitResult(page, 'checked');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('checked');
  expect(rec.probe?.isMobile).toBe(true);
  expect(rec.preflight?.C1).toBe('pass');
  const docs = (await fake.requests(since)).filter((r) => isDocument(r) && r.path === '/create/story/');
  expect(docs.length).toBeGreaterThanOrEqual(1);
  for (const r of docs) {
    expect(r.ch['sec-ch-ua-mobile']).toBe('?1');
    expect(r.classification.is_mobile).toBe(true);
  }
});

/** What a Test run looks like from the outside, minus ids, times and the fingerprint's own use. */
interface TestOutcome {
  outcome: HandoffRecord['outcome'];
  phases: string[];
  preflight: unknown;
  entry: unknown;
  compose: unknown;
  account: unknown;
  taps: string[];
}

async function oneTest(
  f: {
    page: Page;
    composer: (o?: { not?: readonly Page[] }) => Promise<Page>;
    fake: FakeClient;
    handoffRecords: () => Promise<HandoffRecord[]>;
  },
  not: readonly Page[],
): Promise<{ popup: Page; outcome: TestOutcome; rec: HandoffRecord }> {
  const since = (await f.fake.log()).at(-1)?.seq ?? 0;
  await testRun(f.page);
  const popup = await f.composer({ not });
  await whenClosed(popup);
  await waitResult(f.page, 'tested');
  const rec = await lastRecord(f.handoffRecords);
  // swControlled is diagnostics only (P1): whether Instagram's worker had claimed the page when the probe
  // ran is a race of about a second (F2).
  const {
    contractVersion: _v,
    swControlled: _sw,
    ...checks
  } = rec.preflight ?? ({} as NonNullable<HandoffRecord['preflight']>);
  const { fpUsed: _fp, armedMs: _ms, ...entry } = rec.entry ?? ({} as NonNullable<HandoffRecord['entry']>);
  const { settleMs: _s, imageScore: _i, ...compose } = rec.compose ?? ({} as NonNullable<HandoffRecord['compose']>);
  return {
    popup,
    rec,
    outcome: {
      outcome: rec.outcome,
      phases: phasesOf(rec),
      preflight: checks,
      entry,
      compose,
      account: rec.account,
      taps: (await f.fake.log(since)).filter((l) => l.step.startsWith('tap:')).map((l) => l.step),
    },
  };
}

test('E12 (l) locale=es: the same outcomes as en', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  clearRateLog,
}, testInfo) => {
  // Story first in the menu, so neither run needs a trial (the first one learns the fingerprint).
  await fake.setKnobs({ menuOrder: 'storyPost' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  const f = { page, composer, fake, handoffRecords };

  const en = await oneTest(f, []);
  await fake.setKnobs({ locale: 'es' });
  await clearRateLog();
  await page.getByTestId('result-done').click();
  const es = await oneTest(f, [en.popup]);

  expect(es.outcome).toEqual(en.outcome);
  expect(en.outcome).toMatchObject({ outcome: 'tested', taps: ['tap:create', 'tap:story'] });
  expect([en.rec.probe?.lang, es.rec.probe?.lang]).toEqual(['en', 'es']);
  expect(await fake.stories()).toHaveLength(0);
});

test('E12 (m) drift=renamed: randomised class names and ids change nothing', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  clearRateLog,
}, testInfo) => {
  await fake.setKnobs({ menuOrder: 'storyPost' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  const f = { page, composer, fake, handoffRecords };

  const plain = await oneTest(f, []);
  await fake.setKnobs({ drift: 'renamed' });
  await clearRateLog();
  await page.getByTestId('result-done').click();
  const renamed = await oneTest(f, [plain.popup]);

  expect(renamed.outcome).toEqual(plain.outcome);
  expect(plain.outcome).toMatchObject({ outcome: 'tested', taps: ['tap:create', 'tap:story'] });
  // Instagram's own class names were randomised too: the compose watch found the canvas and the Share
  // footer by structure.
  expect(renamed.rec.compose).toMatchObject({ drawn: true, controls: 1, variant: 'v1' });
});

// ---------------------------------------------------------------------------------------------
// Review fixes (§11 AM16–AM26): Instagram's desktop site, fail-closed URLs, the first navigation,
// same-document loads, later full-document loads, challenges.

test('E12 (s) classifier=client-hints with chMode uaOnly: Instagram serves its desktop site → DESKTOP_SHELL (P1)', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
}, testInfo) => {
  // Instagram classifying by sec-ch-ua-mobile while rule 1001 rewrites only the UA (§3.7 `uaOnly`): the
  // composer is served the desktop site. P1: is_mobile alone decides DESKTOP_SHELL.
  await fake.setKnobs({ classifier: 'client-hints' });
  await useUaOnly(extension.sw);
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  await whenClosed(await composer());
  await waitResult(page, 'notPosted', { code: 'DESKTOP_SHELL' });
  await expect(await detailRow(page, 'mobile')).toHaveText('no');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:DESKTOP_SHELL');
  expect(rec.chMode).toBe('uaOnly');
  expect(rec.probe?.isMobile).toBe(false);
  expect(rec.preflight).toMatchObject({ C1: 'fail', C4: 'unknown' });
  expect(phasesOf(rec)).not.toContain('openingEntry');
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
  expect(await fake.stories()).toHaveLength(0);
});

test('E12 (w) a later document served desktop on home, while the account prompt waits: the strict re-probe ends it with DESKTOP_SHELL (AM2)', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  seed,
  handoffRecords,
  storedSettings,
}, testInfo) => {
  // No worker is involved: the reloaded document itself is classified desktop. uaOnly + the UA classifier:
  // the first documents are mobile ...
  await useUaOnly(extension.sw);
  await seed({ account: 'someone_else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  const popup = await composer();
  await expect(accountPrompt(page)).toBeVisible({ timeout: 30_000 });
  // ... then Instagram starts classifying by client hints (unchanged by uaOnly: ?0) and the page reloads.
  await fake.setKnobs({ classifier: 'client-hints' });
  const closed = whenClosed(popup);
  await popup.reload().catch(() => undefined);
  await closed;
  await waitResult(page, 'notPosted', { code: 'DESKTOP_SHELL' });
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:DESKTOP_SHELL');
  expect(rec.probe?.isMobile).toBe(false);
  // The strict re-probe of the new document decided, before any tap.
  const phases = phasesOf(rec);
  expect(phases.slice(phases.indexOf('awaitingAccount'))).toEqual(['awaitingAccount', 'probing', 'closing']);
  expect(await taps(fake)).toEqual([]);
  expect((await storedSettings())?.msiteLockedUntil ?? null).toBeNull();
});

test('E12 (t) reload=afterReady: the composer reloads after the insert (302 home): INJECTION_IGNORED, page reloaded, nothing pressed', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  // A new document after the insert: the photo went with the old one (AM28). Before the Share footer had
  // settled, so nothing was pressed.
  await fake.setKnobs({ reload: 'afterReady' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  await whenClosed(await composer());
  const card = await waitResult(page, 'notPosted', { code: 'INJECTION_IGNORED' });
  await expect(card).toContainText('Nothing was posted');
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ outcome: 'failed:INJECTION_IGNORED', detail: 'page reloaded' });
  expect(phasesOf(rec)).toContain('inserting');
  expect(await taps(fake)).not.toContain('tap:share');
  expect(await fake.stories()).toHaveLength(0);
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
  await loadPhoto(page, await photoFile(context, testInfo));
  const t0 = Date.now();
  await testRun(page);
  await whenClosed(await composer());
  await waitResult(page, 'notPosted', { code: 'KILLED_CHALLENGE' });
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('killed:KILLED_CHALLENGE');
  expect(phasesOf(rec)).not.toContain('openingEntry');
  expect(await taps(fake)).toEqual([]);
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
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  await whenClosed(await composer());
  const card = await waitResult(page, 'notPosted', { code: 'UNEXPECTED_PAGE' });
  // AM28: the page is named in the result and on the record (query dropped), a contract fact for L4.
  await expect(card).toContainText('went to /consent/');
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('failed:UNEXPECTED_PAGE');
  expect(rec.detail).toBe('page /consent/');
  expect(phasesOf(rec)).not.toContain('reloading');
  expect(await taps(fake)).toEqual([]);
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
  await loadPhoto(page, await photoFile(context, testInfo));
  const t0 = Date.now();
  // The popup never shows www (the composer route redirects straight off-host): catch it as it opens.
  const opened = context.waitForEvent('page');
  await testRun(page);
  await whenClosed(await opened);
  await waitResult(page, 'notPosted', { code: 'KILLED_OFFHOST' });
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('killed:KILLED_OFFHOST');
  expect(phasesOf(rec)).not.toContain('reloading');
  expect((await storedSettings())?.msiteLockedUntil ?? 0).toBeGreaterThanOrEqual(t0 + WEEK_MS);
});

test('E12 (q) a pushState inside /create/story after the insert: same document, no re-probe; the run goes on (AM16)', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  // The composer draws the photo 4 s after it took the file, so the page is on /create/story while the
  // autopilot waits for it.
  await fake.setKnobs({ slowMs: 4000 });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  await quietWaitFor(popup, () => location.pathname === '/create/story/');
  // The composer moves to its editing step in-page, as msite routes (Chrome reports it as loading), from
  // script without user activation.
  await quietEvaluate(popup, () => window.history.pushState(null, '', '/create/story/?step=edit'));
  await waitResult(page, extension.mode === 'live' ? 'posted' : 'shareTested');
  await whenClosed(popup);
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe(extension.mode === 'live' ? 'posted' : 'share-tested');
  // One probe only: the pushState was the same document.
  const phases = phasesOf(rec);
  expect(phases.filter((p) => p === 'probing')).toHaveLength(1);
  expect(phases).toEqual(expect.arrayContaining(['inserting', 'composeReady', 'sharing', 'confirmingUpload']));
  expect(await fake.stories()).toHaveLength(extension.mode === 'live' ? 1 : 0);
});

for (const when of ['afterReady', 'afterReadySpa', 'afterShare', 'afterShareSpa'] as const) {
  test(`E12 (u) challenge=${when}: a mid-run security challenge kills and locks; the record says so (FID-6)`, async ({
    context,
    extension,
    editor,
    composer,
    fake,
    handoffRecords,
    storedSettings,
  }, testInfo) => {
    const shared = when.startsWith('afterShare');
    test.skip(shared && extension.mode === 'live', 'live: a challenge after a published story is E38 (Posted + lock)');
    await fake.setKnobs({ challenge: when });
    const page = await editor();
    await loadPhoto(page, await photoFile(context, testInfo));
    const t0 = Date.now();
    await postStory(page);
    await whenClosed(await composer());
    const rec0 = await (async () => {
      if (!shared) {
        const card = await waitResult(page, 'notPosted', { code: 'KILLED_CHALLENGE' });
        await expect(card).toContainText('Nothing was posted');
      } else {
        // Mock: the blocked upload's "Upload failed." came first, then the challenge, before the outcome
        // rules had settled: Share was pressed, so it is Couldn't confirm, and locked.
        const card = await waitResult(page, 'unknown');
        await expect(card).not.toContainText('Nothing was posted');
      }
      return lastRecord(handoffRecords);
    })();
    expect(rec0.outcome).toBe('killed:KILLED_CHALLENGE');
    expect(rec0.result?.killed).toBe('KILLED_CHALLENGE');
    if (shared) expect(phasesOf(rec0)).toContain('confirmingUpload');
    else expect(await taps(fake)).not.toContain('tap:share');
    expect(await fake.stories()).toHaveLength(0);
    expect((await storedSettings())?.msiteLockedUntil ?? 0).toBeGreaterThanOrEqual(t0 + WEEK_MS);
    await expect(page.getByTestId('pause-banner')).toBeVisible();
  });
}
