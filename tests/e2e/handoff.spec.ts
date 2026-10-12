/**
 * Hand-off specs (strategy §7.11), against the fake, on the mock and live artifacts:
 * E4 probe mode, E5 the H1 happy path, E6 H0 by hand, E7 scoping of the device profile,
 * E10 the fake-marker guard, E14 the rate guard, E15 closing the popup mid-flow; and (§11 AM21,
 * AM22) E16 the panel shows the open session's switches, E19 a reloaded extension closes its popup.
 * Headers come from the fake's request log, never from Playwright's `request.headers()`
 * (pre-dNR, AM4). E5 and E7 prove the client-hint `remove` on the wire against a positive
 * control: a normal tab of the same profile does send those hints (FID-4).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import { androidReducedUa, CH_REMOVE } from '../../src/core/ig-contract/device-profile.ts';
import { SESSION_RULE_IDS } from '../../src/core/ig-contract/rules.ts';
import { DEFAULT_KNOBS } from '../../tools/fake-ig/knobs.ts';
import { type ExtGlobal, expect, IG_ORIGIN, test, whenClosed } from './fixtures.ts';
import {
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
import type { RequestRecord } from './helpers/fake-client.ts';
import { decodeSize, psnr, syntheticImage } from './helpers/psnr.ts';

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

test('E4 probe mode: the popup opens, C1-C8 are reported, the window closes, no file, no story', async ({
  editor,
  composer,
  fake,
  handoffRecords,
  sessionRules,
}) => {
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  const popup = await composer();
  await whenClosed(popup);
  await waitPhase(page, 'idle');

  // The editor shows the report; no error.
  const probe = page.getByTestId('handoff-probe');
  await expect(probe).toBeVisible();
  await expect(probe).toContainText('Mobile page');
  await expect(page.getByTestId('handoff-error')).toHaveCount(0);

  const records = await handoffRecords();
  expect(records).toHaveLength(1);
  const rec = records[0];
  if (!rec) throw new Error('no hand-off record');
  expect(rec.mode).toBe('probe');
  expect(rec.exportId).toBeNull();
  expect(rec.level).toBeNull();
  expect(rec.outcome).toBe('not-posted');
  expect(rec.route).toBe('direct');
  expect(rec.preflight).toMatchObject({ C1: 'pass', C2: 'pass', C3: 'pass', C4: 'pass', C5: 'pass' });
  expect(rec.preflight?.swControlled).toBe(false);
  // C8 without a picked file: viewport and DPR of the fitted popup, no canvas yet.
  expect(rec.preflight?.C8).toEqual({ inner: rec.probe?.inner, dpr: rec.probe?.dpr, canvas: null });
  expect(rec.probe?.inner.h).toBeGreaterThan(rec.probe?.inner.w ?? Number.POSITIVE_INFINITY);
  expect(rec.probe?.marker).toBe(true);
  expect(rec.probe?.isMobile).toBe(true);
  expect(rec.probe?.storyInput).toBe('present');
  expect(rec.probe?.acceptOk).toBe(true);
  // Probe mode never injects and never serves a file.
  const phases = rec.phaseLog.map((p) => p.phase);
  expect(phases).toContain('probing');
  expect(phases).not.toContain('injecting');
  expect(phases).not.toContain('awaitingPick');

  expect(await fake.stories()).toHaveLength(0);
  const docs = composerDocuments(await fake.requests());
  expect(docs.length).toBeGreaterThan(0);
  for (const r of docs) expectAndroidProfile(r);
  expect(await sessionRules()).toEqual([]);
});

test('E5 @smoke H1 happy path: Android profile on the wire, trusted Share, PSNR >= 38 dB, rules gone', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
  sessionRules,
}, testInfo) => {
  // FID-5: once L6 shows Instagram ignores a synthetic insert, the baseline makes the fake ignore it
  // too, and H1 is off (OD3); E6 and E12 f–j then carry the flow.
  test.skip(
    DEFAULT_KNOBS.trusted === 'require' || DEFAULT_KNOBS.listen === 'drop',
    'the baseline says the composer ignores a synthetic insert (L6)',
  );
  await fake.setKnobs({ geometry: 'fixed:1080x1920' });
  // Positive control for the client-hint `remove` (FID-4): a normal tab of this profile, once the
  // origin's Accept-CH is known, sends every high-entropy hint rule 1001 strips from the composer.
  const baseline = await context.newPage();
  await baseline.goto(`${IG_ORIGIN}/`);
  const before = await lastSeq(fake);
  await baseline.goto(`${IG_ORIGIN}/`);
  const desktopDoc = (await fake.requests(before)).find(
    (r) => r.path === '/' && r.fetch['sec-fetch-dest'] === 'document',
  );
  if (!desktopDoc) throw new Error('no desktop baseline document');
  for (const hint of CH_REMOVE) expect(desktopDoc.ch[hint], hint).toBeDefined();
  await baseline.close();
  const src = testInfo.outputPath('photo-3024x4032.jpg');
  await writeFile(src, await syntheticImage(context, 3024, 4032, 'image/jpeg'));

  // H1 is the owner's switch: on by default in guarded builds, off in live until OD3 (§7.10).
  const page = await editor('#/settings');
  await page.getByTestId('setting-assisted').check();
  await page.goto(page.url().replace(/#.*$/, '#/'));
  await loadPhoto(page, src);
  const exportId = await postFromDesktop(page);
  const popup = await composer({ not: [baseline] });

  await waitPhase(page, 'awaitingShare');
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H1');
  // The live build carries on against the fake, flagged (§3.6 step 7 row 2); mock never shows it.
  await expect(page.getByTestId('handoff-banner')).toHaveCount(extension.mode === 'live' ? 1 : 0);
  await expect(popup).toHaveURL(`${IG_ORIGIN}/create/story/`);

  // The composer documents carried the Android profile (fake's log = post-dNR headers, AM4): the
  // navigation (usually) and the one hard reload. The positive control above shows this profile
  // sends the high-entropy hints, so their absence here proves rule 1001's `remove` ops.
  const docs = composerDocuments(await fake.requests(before));
  expect(docs.length).toBeGreaterThanOrEqual(1);
  expect(docs.length).toBeLessThanOrEqual(2);
  for (const r of docs) expectAndroidProfile(r);

  const closed = whenClosed(popup);
  await human.share(popup);
  await waitSeen(page, 'finished');
  await closed;
  await waitPhase(page, 'idle');

  const stories = await fake.stories();
  expect(stories).toHaveLength(1);
  const story = stories[0];
  if (!story) throw new Error('no story');
  expect(story.isTrusted).toBe(true);
  expect(story.size).toEqual({ w: 1080, h: 1920 });

  const png = await exportBytes(exportId);
  expect(await decodeSize(context, png)).toEqual({ w: 1080, h: 1920 });
  const db = await psnr(context, await fake.storyBytes(story.id), png);
  testInfo.annotations.push({ type: 'psnr', description: `${db.toFixed(2)} dB` });
  expect(db).toBeGreaterThanOrEqual(38);

  const [rec] = await handoffRecords();
  expect(rec?.level).toBe('H1');
  expect(rec?.outcome).toBe('posted-confirmed');
  expect(await sessionRules()).toEqual([]);
});

/** The newest sequence number in the fake's request log (0 when empty). */
async function lastSeq(fake: { requests(since?: number): Promise<RequestRecord[]> }): Promise<number> {
  return (await fake.requests()).at(-1)?.seq ?? 0;
}

/** The UA classification the fake embedded in a shell document (C1's source). */
async function pageIsMobile(page: Page): Promise<unknown> {
  const raw = await page.locator('script[type="application/json"][data-fake-ua]').textContent();
  return (JSON.parse(raw ?? 'null') as { InstagramUserAgent?: { is_mobile?: unknown } } | null)?.InstagramUserAgent
    ?.is_mobile;
}

test('E6 H0 with assisted insert OFF: instructions, + → Story, the human picks the export, story recorded', async ({
  context,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  downloadsSearch,
  handoffRecords,
  sessionRules,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: false });
  await loadPhoto(page, await photoFile(context, testInfo));
  const exportId = await postFromDesktop(page);
  const popup = await composer();

  await waitPhase(page, 'awaitingPick');
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H0');
  // The export as it landed in Downloads (the PNG of this hand-off). Under Playwright the file is
  // stored under a GUID name in Playwright's download dir; the product reports whatever name
  // chrome.downloads gives it, so the instruction is checked against that name.
  const png = await exportBytes(exportId);
  const downloaded = (await downloadsSearch()).filter((d) => d.state === 'complete' && d.mime === 'image/png');
  expect(downloaded).toHaveLength(1);
  const file = downloaded[0]?.filename ?? '';
  expect(await readFile(file)).toEqual(png);

  // H1 switched off is not an error: plain H0 instructions, with the downloaded file's name.
  expect(await shownError(page)).toBeNull();
  await expect(instruction(page)).toHaveText(
    `In the Instagram window tap + → Story and pick instapost/${basename(file)}.`,
  );
  // That GUID name has no extension, so a file input would report an empty MIME type and the
  // composer would refuse it as "not a photo". The human picks the identical bytes as a .png.
  const picked = testInfo.outputPath('story.png');
  await writeFile(picked, png);
  await human.pickViaStory(popup, picked);

  await waitPhase(page, 'awaitingShare');
  await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H0');
  const closed = whenClosed(popup);
  await human.share(popup);
  await waitSeen(page, 'finished');
  await closed;
  await waitPhase(page, 'idle');

  const stories = await fake.stories();
  expect(stories).toHaveLength(1);
  expect(stories[0]?.isTrusted).toBe(true);
  const [rec] = await handoffRecords();
  expect(rec?.level).toBe('H0');
  expect(rec?.outcome).toBe('posted-confirmed');
  expect(rec?.phaseLog.map((p) => p.phase)).not.toContain('injecting');
  expect(await sessionRules()).toEqual([]);
});

test('E7 scoping: a second normal tab during a session gets the desktop shell (Mac UA, is_mobile false)', async ({
  context,
  editor,
  composer,
  fake,
  sessionRules,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: false });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
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
  // Positive control (FID-4): Accept-CH took effect for the origin, so this tab sends every hint
  // that rule 1001 removes from the popup.
  for (const hint of CH_REMOVE) expect(doc.ch[hint], hint).toBeDefined();
  expect(doc.classification.is_mobile).toBe(false);
  // The popup itself still carries the Android profile.
  await expect(popup).toHaveURL(`${IG_ORIGIN}/create/story/`);
  expect(await pageIsMobile(popup)).toBe(true);

  await cancelHandoff(page);
  await waitPhase(page, 'idle');
  expect(await sessionRules()).toEqual([]);
});

test('E10 marker=off: mock refuses with GUARD_NOT_FAKE (nothing injected, no story); live proceeds', async ({
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
  // H1 on in both builds, so a guard that failed to stop mock would visibly inject.
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();

  if (extension.mode === 'mock') {
    await whenClosed(popup);
    await waitPhase(page, 'idle');
    expect(await shownError(page)).toBe('GUARD_NOT_FAKE');
    const [rec] = await handoffRecords();
    expect(rec?.outcome).toBe('failed:GUARD_NOT_FAKE');
    expect(rec?.probe?.marker).toBe(false);
    expect(rec?.phaseLog.map((p) => p.phase)).not.toContain('injecting');
  } else {
    // Live ignores the marker (§3.6 step 7): it carries on to H1, without the banner.
    await waitPhase(page, 'awaitingShare');
    await expect(phaseLocator(page)).toHaveAttribute('data-level', 'H1');
    await expect(page.getByTestId('handoff-banner')).toHaveCount(0);
    await cancelHandoff(page);
    await waitPhase(page, 'idle');
    const [rec] = await handoffRecords();
    expect(rec?.outcome).toBe('abandoned');
    expect(rec?.probe?.marker).toBe(false);
  }
  expect(await fake.stories()).toHaveLength(0);
  expect(await sessionRules()).toEqual([]);
});

test('E10 marker on: live shows the FAKE INSTAGRAM banner, mock does not', async ({
  extension,
  editor,
  composer,
  handoffRecords,
}) => {
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  const banner = page.getByTestId('handoff-banner');
  if (extension.mode === 'live') await expect(banner).toHaveText('FAKE INSTAGRAM');
  else await expect(banner).toHaveCount(0);
  const [rec] = await handoffRecords();
  expect(rec?.probe?.marker).toBe(true);
  expect(rec?.outcome).toBe('not-posted');
});

test('E14 a second start within 60 s gives RATE_LIMITED and opens no window', async ({
  context,
  editor,
  composer,
  handoffRecords,
  sessionRules,
}) => {
  const page = await editor('#/settings');
  await page.getByTestId('setting-probe').click();
  await whenClosed(await composer());
  await waitPhase(page, 'idle');
  expect(await handoffRecords()).toHaveLength(1);

  let opened = 0;
  context.on('page', () => {
    opened++;
  });
  await page.getByTestId('setting-probe').click();
  await expect(page.getByTestId('handoff-error')).toHaveAttribute('data-error', 'RATE_LIMITED');
  await expect(page.getByTestId('handoff-error')).toContainText('The next one is possible at');
  await waitPhase(page, 'idle');
  // Give a (wrongly) opened popup time to show up.
  await page.waitForTimeout(1500);
  expect(opened).toBe(0);
  expect(await handoffRecords()).toHaveLength(1);
  expect(await sessionRules()).toEqual([]);
});

test('E15 closing the popup mid-flow removes the rules and resets to idle; the next session starts cleanly', async ({
  context,
  editor,
  composer,
  handoffRecords,
  sessionRules,
  handoffState,
  clearRateLog,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: false, rehearsal: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const first = await composer();
  await waitPhase(page, 'awaitingPick');
  // 1001 (device profile) plus the rehearsal blocks 1002…
  const during = (await sessionRules()).map((r) => r.id).sort((a, b) => a - b);
  expect(during[0]).toBe(1001);
  expect(during.length).toBeGreaterThan(1);
  for (const id of during) expect(SESSION_RULE_IDS).toContain(id);

  // The owner closes the composer window.
  await first.close();
  await waitPhase(page, 'idle');
  await expect.poll(sessionRules).toEqual([]);
  await expect.poll(async () => (await handoffState())?.phase).toBe('idle');
  const [abandoned] = await handoffRecords();
  expect(abandoned?.outcome).toBe('abandoned');

  // The next session starts from scratch (the rate guard's 60 s spacing is E14's subject).
  await clearRateLog();
  await postFromDesktop(page);
  const second = await composer({ not: [first] });
  await waitPhase(page, 'awaitingPick');
  const state = await handoffState();
  if (state?.phase !== 'awaitingPick') throw new Error(`unexpected state ${state?.phase}`);
  const rules = await sessionRules();
  expect(rules.find((r) => r.id === 1001)?.condition.tabIds).toEqual([state.tabId]);
  await cancelHandoff(page);
  await whenClosed(second);
  await waitPhase(page, 'idle');
  expect(await sessionRules()).toEqual([]);
  expect((await handoffRecords()).map((r) => r.outcome)).toEqual(['abandoned', 'abandoned']);
});

test('E16 the panel shows the open hand-off’s own switches; Settings cannot change them mid-session (AM21)', async ({
  context,
  editor,
  composer,
  sessionRules,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: false, rehearsal: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  const rehearsal = page.getByTestId('handoff-chip-rehearsal');
  const assisted = page.getByTestId('handoff-chip-assisted');
  await expect(rehearsal).toHaveAttribute('data-on', 'true');
  await expect(assisted).toHaveAttribute('data-on', 'false');

  // Settings, with the hand-off panel beside it: both switches are locked while it runs.
  await gotoRoute(page, '#/settings');
  await expect(page.getByTestId('setting-rehearsal')).toBeDisabled();
  await expect(page.getByTestId('setting-assisted')).toBeDisabled();
  await expect(page.getByTestId('setting-switches-locked')).toBeVisible();

  // Another editor tab flips the stored settings anyway.
  await page.evaluate(async () => {
    const { chrome } = globalThis as unknown as ExtGlobal;
    const got = (await chrome.storage.local.get('settings')).settings as Record<string, unknown>;
    await chrome.storage.local.set({ settings: { ...got, rehearsal: false, assistedInsert: true } });
  });
  await expect(page.getByTestId('setting-rehearsal')).not.toBeChecked();
  // The panel keeps the session's switches, and so do the session's rules.
  await expect(rehearsal).toHaveAttribute('data-on', 'true');
  await expect(rehearsal).toHaveText('Rehearsal on');
  await expect(assisted).toHaveAttribute('data-on', 'false');
  expect((await sessionRules()).filter((r) => r.action.type === 'block').length).toBeGreaterThan(0);

  await cancelHandoff(page);
  await whenClosed(popup);
  await waitPhase(page, 'idle');
  // Idle: the stored settings show again (they apply to the next hand-off), and are editable.
  await expect(rehearsal).toHaveAttribute('data-on', 'false');
  await expect(page.getByTestId('setting-rehearsal')).toBeEnabled();
});

test('E19 a worker that starts without its stored session closes the popup the hand-off left open (AM22)', async ({
  context,
  extension,
  editor,
  composer,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: false });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingPick');
  // What reloading, updating or disabling and re-enabling the extension leaves behind: no
  // storage.session and no session rules, but the https popup still open. (Under Playwright,
  // chrome.runtime.reload() unloads a --load-extension build for good, so the reload is simulated.)
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
  await waitPhase(page, 'idle');
  const left = await page.evaluate(async () => {
    const { chrome } = globalThis as unknown as ExtGlobal;
    return (await chrome.storage.local.get('composerWindow')).composerWindow ?? null;
  });
  expect(left).toBeNull();
});
