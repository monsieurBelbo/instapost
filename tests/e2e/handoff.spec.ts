/**
 * Hand-off specs (strategy §7.11; ux.md §7, §4.12) against the fake, on the mock and live artifacts:
 * E4 Check connection (was probe mode) and E4 (b) with msite's header mounting late (AL-1), E7 scoping
 * of the device profile, E10 the fake-marker guard and the FAKE bar, E14 the rate guard for a run that
 * cannot queue, E15 closing the window mid-flow, E16 settings that change a run apply to the next one
 * (AM21), E19 a restarted worker closes the window a hand-off left open (AM22).
 * E5 and E6 are struck: the autopilot's post is E29 (autopilot.spec.ts) and Finish by hand E40.
 *
 * Headers come from the fake's request log, never from Playwright's `request.headers()` (pre-dNR,
 * AM4). E4 and E7 prove the client-hint `remove` on the wire against a positive control (FID-4).
 * Nothing here reads the Instagram window before Share: Playwright's evaluate gives a page user
 * activation, which the autopilot waits out (R22).
 */
import type { Page } from '@playwright/test';
import { androidReducedUa, CH_REMOVE } from '../../src/core/ig-contract/device-profile.ts';
import { SESSION_RULE_IDS } from '../../src/core/ig-contract/rules.ts';
import { FAKE_ACCOUNT } from '../../tools/fake-ig/knobs.ts';
import { type ExtGlobal, expect, IG_ORIGIN, test, whenClosed } from './fixtures.ts';
import {
  accountPrompt,
  checkConnection,
  detailRow,
  lastRecord,
  loadPhoto,
  phasesOf,
  photoFile,
  postStory,
  refusal,
  stopRun,
  testRun,
  waitPhase,
  waitResult,
} from './helpers/editor-flow.ts';
import type { FakeClient, RequestRecord } from './helpers/fake-client.ts';

const ANDROID_UA =
  /^Mozilla\/5\.0 \(Linux; Android 10; K\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/(\d+)\.0\.0\.0 Mobile Safari\/537\.36$/;

/** Composer document requests (`sec-fetch-dest: document` on www /create/story/). */
const composerDocuments = (requests: RequestRecord[]) =>
  requests.filter(
    (r) => r.host === 'www.instagram.com' && r.path === '/create/story/' && r.fetch['sec-fetch-dest'] === 'document',
  );

/** The rule-1001 profile on the wire: Android reduced UA, ?1, "Android", no high-entropy hints. */
function expectAndroidProfile(r: RequestRecord): void {
  const m = ANDROID_UA.exec(r.ua ?? '');
  expect(m, `UA ${r.ua}`).not.toBeNull();
  expect(r.ua).toBe(androidReducedUa(Number(m?.[1])));
  expect(r.ch['sec-ch-ua-mobile']).toBe('?1');
  expect(r.ch['sec-ch-ua-platform']).toBe('"Android"');
  for (const hint of CH_REMOVE) expect(r.ch[hint], hint).toBeUndefined();
  expect(r.classification.is_mobile).toBe(true);
}

/** The newest sequence number in the fake's request log (0 when empty). */
async function lastSeq(fake: FakeClient): Promise<number> {
  return (await fake.requests()).at(-1)?.seq ?? 0;
}

/** The UA classification the fake embedded in a shell document (C1's source). */
async function pageIsMobile(page: Page): Promise<unknown> {
  const raw = await page.locator('script[type="application/json"][data-fake-ua]').textContent();
  return (JSON.parse(raw ?? 'null') as { InstagramUserAgent?: { is_mobile?: unknown } } | null)?.InstagramUserAgent
    ?.is_mobile;
}

test.describe('an install that has not met an account yet', () => {
  test.use({ seeded: false });

  test('E4 Check connection: the window opens, C1–C8 and the account are read and learned, it closes; nothing tapped', async ({
    editor,
    composer,
    fake,
    seed,
    handoffRecords,
    sessionRules,
    localKeys,
  }) => {
    await seed({ account: null });
    const page = await editor();
    await checkConnection(page);
    await whenClosed(await composer());
    const card = await waitResult(page, 'checked');
    await expect(card).toContainText(`Connected as @${FAKE_ACCOUNT}`);

    const rec = await lastRecord(handoffRecords);
    expect(rec).toMatchObject({ mode: 'check', exportId: null, outcome: 'checked', route: 'homeOnly' });
    // F3: /create/story/ without media lands on home; C5 records that, the normal production outcome.
    expect(rec.preflight).toMatchObject({ C1: 'pass', C2: 'pass', C3: 'pass', C4: 'pass', C5: 'fail' });
    expect(typeof rec.preflight?.swControlled).toBe('boolean');
    expect(rec.preflight?.swIntercepted).toBe(false);
    expect(rec.probe?.navType).toBe('reload');
    expect(rec.preflight?.C8).toEqual({ inner: rec.probe?.inner, dpr: rec.probe?.dpr, canvas: null });
    expect(rec.probe?.inner.h).toBeGreaterThan(rec.probe?.inner.w ?? Number.POSITIVE_INFINITY);
    expect(rec.probe).toMatchObject({
      marker: true,
      isMobile: true,
      storyInput: 'present',
      acceptOk: true,
      entryFound: true,
      account: { handle: FAKE_ACCOUNT, candidates: 1 },
      activation: { isActive: false },
      visibility: 'visible',
    });
    expect(rec.probe?.inner.w).toBeLessThanOrEqual(767);
    // A check learns the account without asking (it taps nothing).
    expect(rec.account).toMatchObject({ detected: FAKE_ACCOUNT, decision: 'learn' });
    expect((await localKeys(['expectedAccount'])).expectedAccount).toMatchObject({ handle: FAKE_ACCOUNT });
    // Details say what the probe saw, in words.
    await expect(await detailRow(page, 'page')).toHaveText(
      "/ (home: Instagram's usual landing; instapost taps + → Story there)",
    );
    await expect(await detailRow(page, 'story-input')).toHaveText('present');
    await expect(await detailRow(page, 'service-worker')).toHaveText(
      /^(controls the page — normal on Instagram|not in control)$/,
    );
    await expect(await detailRow(page, 'browser')).toHaveText('Chromium');
    // A check never touches Instagram's page: no tap, no file, no story.
    const phases = phasesOf(rec);
    expect(phases).toContain('probing');
    expect(phases).not.toContain('openingEntry');
    expect((await fake.log()).filter((l) => l.step.startsWith('tap:'))).toEqual([]);
    expect(await fake.stories()).toHaveLength(0);
    const docs = composerDocuments(await fake.requests());
    expect(docs.length).toBeGreaterThan(0);
    for (const r of docs) expectAndroidProfile(r);
    await expect.poll(sessionRules).toEqual([]);
  });
});

test('E4 (b) Check connection, msite’s header and navigation mounting 2.5 s late: the probe waits → present, C4 pass (AL-1)', async ({
  editor,
  composer,
  fake,
  handoffRecords,
}) => {
  // P5 (live checklist L14): the report must not come from a snapshot taken before hydration.
  await fake.setKnobs({ hydrateMs: 2500 });
  const page = await editor();
  await checkConnection(page);
  await whenClosed(await composer());
  await waitResult(page, 'checked');
  await expect(await detailRow(page, 'story-input')).toHaveText('present');
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ mode: 'check', outcome: 'checked', route: 'homeOnly' });
  expect(rec.probe).toMatchObject({ storyInput: 'present', acceptOk: true, account: { handle: FAKE_ACCOUNT } });
  expect(rec.preflight).toMatchObject({ C1: 'pass', C3: 'pass', C4: 'pass', C5: 'fail' });
  // The page's header came 2.5 s after it rendered: the probe that decided came after it.
  const probing = rec.phaseLog.find((p) => p.phase === 'probing')?.t ?? 0;
  const closing = rec.phaseLog.find((p) => p.phase === 'closing')?.t ?? 0;
  expect(closing - probing).toBeGreaterThan(500);
  expect(await fake.stories()).toHaveLength(0);
});

test('E7 scoping: while a run waits on its account prompt, a normal tab gets the desktop shell (Mac UA, is_mobile false)', async ({
  context,
  editor,
  composer,
  fake,
  seed,
  sessionRules,
}, testInfo) => {
  // Another account is expected, so the run pauses on Instagram's home before any tap (§4.8).
  await seed({ account: 'someone_else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  await expect(accountPrompt(page)).toHaveAttribute('data-kind', 'mismatch', { timeout: 30_000 });
  expect((await sessionRules()).map((r) => r.id)).toContain(1001);

  // While rule 1001 is in force for the popup, an ordinary tab opens instagram.com.
  const since = await lastSeq(fake);
  const tab = await context.newPage();
  await tab.goto(`${IG_ORIGIN}/`);
  expect(await pageIsMobile(tab)).toBe(false);
  const docs = (await fake.requests(since)).filter(
    (r) => r.host === 'www.instagram.com' && r.path === '/' && r.fetch['sec-fetch-dest'] === 'document',
  );
  expect(docs).toHaveLength(1);
  const doc = docs[0] as RequestRecord;
  expect(doc.ua).toContain('Macintosh');
  expect(doc.ua).not.toContain('Android');
  expect(doc.ch['sec-ch-ua-mobile']).toBe('?0');
  expect(doc.ch['sec-ch-ua-platform']).toBe('"macOS"');
  // Positive control (FID-4): this tab sends every hint that rule 1001 removes from the popup.
  for (const hint of CH_REMOVE) expect(doc.ch[hint], hint).toBeDefined();
  expect(doc.classification.is_mobile).toBe(false);
  // The popup itself still carries the Android profile (on home, where /create/story/ landed, F3).
  await expect(popup).toHaveURL(`${IG_ORIGIN}/`);
  expect(await pageIsMobile(popup)).toBe(true);

  await page.getByTestId('account-cancel').click();
  await whenClosed(popup);
  await waitResult(page, 'stopped');
  await expect.poll(sessionRules).toEqual([]);
  expect((await fake.log()).filter((l) => l.step.startsWith('tap:'))).toEqual([]);
});

test('E10 marker=off: mock refuses with GUARD_NOT_FAKE (nothing tapped, no story); live proceeds, unflagged', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
  sessionRules,
}, testInfo) => {
  await fake.setKnobs({ marker: 'off' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  await whenClosed(await composer());
  if (extension.mode === 'mock') {
    await waitResult(page, 'notPosted', { code: 'GUARD_NOT_FAKE' });
    const rec = await lastRecord(handoffRecords);
    expect(rec.outcome).toBe('failed:GUARD_NOT_FAKE');
    expect(rec.probe?.marker).toBe(false);
    expect(phasesOf(rec)).not.toContain('openingEntry');
    expect((await fake.log()).filter((l) => l.step.startsWith('tap:'))).toEqual([]);
  } else {
    // Live ignores the marker (§3.6 step 7): the test runs, without the FAKE bar.
    await waitResult(page, 'tested');
    await expect(page.getByTestId('run-fake-bar')).toHaveCount(0);
    const rec = await lastRecord(handoffRecords);
    expect(rec.outcome).toBe('tested');
    expect(rec.probe?.marker).toBe(false);
  }
  expect(await fake.stories()).toHaveLength(0);
  await expect.poll(sessionRules).toEqual([]);
});

test('E10 marker on: live shows the FAKE INSTAGRAM bar, mock does not', async ({
  extension,
  editor,
  composer,
  handoffRecords,
}) => {
  const page = await editor();
  await checkConnection(page);
  await whenClosed(await composer());
  await waitResult(page, 'checked');
  const bar = page.getByTestId('run-fake-bar');
  if (extension.mode === 'live')
    await expect(bar).toHaveText('FAKE INSTAGRAM — this window is the test server, not Instagram.');
  else await expect(bar).toHaveCount(0);
  const rec = await lastRecord(handoffRecords);
  expect(rec.probe?.marker).toBe(true);
  expect(rec.outcome).toBe('checked');
});

test('E14 a second check within 60 s is refused (RATE_LIMITED, the spacing named) and opens no window', async ({
  context,
  editor,
  composer,
  handoffRecords,
  sessionRules,
}) => {
  const page = await editor();
  await checkConnection(page);
  await whenClosed(await composer());
  await waitResult(page, 'checked');
  await page.getByTestId('result-done').click();
  expect(await handoffRecords()).toHaveLength(1);

  let opened = 0;
  context.on('page', () => {
    opened++;
  });
  await checkConnection(page);
  await expect(refusal(page)).toHaveAttribute('data-error', 'RATE_LIMITED');
  await expect(refusal(page)).toContainText('at least a minute apart');
  // Give a (wrongly) opened popup time to show up.
  await page.waitForTimeout(1500);
  expect(opened).toBe(0);
  expect(await handoffRecords()).toHaveLength(1);
  await expect.poll(sessionRules).toEqual([]);
});

test('E15 closing the window before Share stops the run (nothing posted), removes the rules; the next run starts cleanly', async ({
  context,
  editor,
  composer,
  seed,
  handoffRecords,
  sessionRules,
  handoffState,
  clearRateLog,
}, testInfo) => {
  // The account prompt holds the run on home, before any tap, with its rules in force.
  await seed({ account: 'someone_else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  const first = await composer();
  await expect(accountPrompt(page)).toBeVisible({ timeout: 30_000 });
  // 1001 (device profile) plus the test's write blocks 1002…
  const during = (await sessionRules()).map((r) => r.id).sort((a, b) => a - b);
  expect(during[0]).toBe(1001);
  expect(during.length).toBeGreaterThan(1);
  for (const id of during) expect(SESSION_RULE_IDS).toContain(id);

  // The owner closes the Instagram window.
  await first.close();
  const card = await waitResult(page, 'stopped');
  await expect(card).toContainText('Nothing was posted');
  await expect.poll(sessionRules).toEqual([]);
  await expect.poll(async () => (await handoffState())?.phase).toBe('idle');
  const [stopped] = await handoffRecords();
  expect(stopped?.outcome).toBe('cancelled');
  expect(stopped?.result).toMatchObject({ kind: 'stopped', stoppedBy: 'window' });

  // The next run starts from scratch (the 60 s spacing is E14's subject).
  await clearRateLog();
  await page.getByTestId('result-done').click();
  await testRun(page);
  const second = await composer({ not: [first] });
  await expect(accountPrompt(page)).toBeVisible({ timeout: 30_000 });
  const state = await handoffState();
  const tabId = state && 'tabId' in state ? state.tabId : null;
  const rules = await sessionRules();
  expect(rules.find((r) => r.id === 1001)?.condition.tabIds).toEqual([tabId]);
  await stopRun(page);
  await whenClosed(second);
  await waitResult(page, 'stopped');
  await expect.poll(sessionRules).toEqual([]);
  expect((await handoffRecords()).map((r) => r.outcome)).toEqual(['cancelled', 'cancelled']);
});

test('E16 a run keeps its own account lock: Settings says it applies to the next run (AM21)', async ({
  context,
  editor,
  composer,
  seed,
}, testInfo) => {
  await seed({ account: 'someone_else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  const popup = await composer();
  await expect(accountPrompt(page)).toHaveAttribute('data-kind', 'mismatch', { timeout: 30_000 });

  // Settings, while the run waits: the switch that changes a run is locked, and says why.
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-sheet')).toContainText('A post is running; this applies to the next one.');
  await expect(page.getByTestId('settings-account-lock')).toBeDisabled();

  // Another editor tab turns the lock off anyway: the running prompt stays (the run took its settings).
  await page.evaluate(async () => {
    const { chrome } = globalThis as unknown as ExtGlobal;
    const got = (await chrome.storage.local.get('settings')).settings as Record<string, unknown>;
    await chrome.storage.local.set({ settings: { ...got, accountLock: false } });
  });
  await expect(page.getByTestId('settings-account-lock')).not.toBeChecked();
  await page.getByTestId('settings-close').click();
  await page.waitForTimeout(1000);
  await expect(accountPrompt(page)).toBeVisible();
  await page.getByTestId('account-cancel').click();
  await whenClosed(popup);
  await waitResult(page, 'stopped');
  // Idle: the setting applies to the next run and can be changed again.
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-account-lock')).toBeEnabled();
});

test('E19 a worker that starts without its stored session closes the window the hand-off left open (AM22)', async ({
  context,
  extension,
  editor,
  composer,
  seed,
}, testInfo) => {
  await seed({ account: 'someone_else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  const popup = await composer();
  await expect(accountPrompt(page)).toBeVisible({ timeout: 30_000 });
  // The page's own worker claims it about a second after it loads (F2), and the agent reports that
  // `controllerchange`, which the background counts and persists (P2). Let that land first: a write
  // by the still-running old worker after the storage.session.clear() below would hand the popup back
  // to a "stored session" (a race of this simulation only).
  await expect.poll(() => popup.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.waitForTimeout(500);
  // What reloading, updating or disabling and re-enabling the extension leaves behind: no
  // storage.session and no session rules, but the https popup still open.
  await extension.sw.evaluate(async () => {
    const { chrome } = globalThis as unknown as ExtGlobal;
    await chrome.storage.session.clear();
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: Array.from({ length: 19 }, (_, i) => 1001 + i),
    });
  });
  const closed = whenClosed(popup);
  // A new worker instance starts (the editor's port reconnects and wakes it).
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await closed;
  await expect(page.locator('.app')).toHaveAttribute('data-connected', 'true');
  const left = await page.evaluate(async () => {
    const { chrome } = globalThis as unknown as ExtGlobal;
    return (await chrome.storage.local.get('composerWindow')).composerWindow ?? null;
  });
  expect(left).toBeNull();
  await waitPhase(page, 'idle').catch(() => undefined);
});
