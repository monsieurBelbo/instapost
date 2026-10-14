/**
 * The autopilot (ux.md §0, §3, §6, §7; strategy §11 AM39–AM41) against the production-shaped fake, on
 * the mock and live artifacts. After Post story the owner does nothing: instapost opens Instagram's
 * mobile page in the docked window, reads the account, taps + → Story, adds the photo to the armed story
 * input, presses Share once and decides the result from Instagram's own requests.
 *
 * | Id  | Case | Expected |
 * |-----|------|----------|
 * | E29 | @smoke live: Post story, both menu orders | Posted from a 2xx JSON publish; one story; the story session started (uuid waterfall_id); no DOUBLE_SHARE, RETRY_CLICKED or tap outside the allow-list; window closed; badge ✓; Android profile on the wire; PSNR ≥ 38 dB; no session rule left |
 * | E29 (mock) | the same click in a guarded build | the static ruleset blocks the upload: Share test semantics (`shareTested`), never "Posted" |
 * | E30 | Test run (setup test from a fresh install) | stops at Share: no upload request; `tested`; the fingerprint, the account and lastTestPassAt are stored |
 * | E31 | Share test | rules 1002–1019 `[tab, -1]` during the run; Share pressed; the upload blocked (status 0); Instagram's "Upload failed." toast; no story; `shareTested` |
 * | E31 (b) | Share test whose block rules vanish before the composer | the background's check at the composer catches it: AGENT_UNREACHABLE, Share never pressed |
 * | E31 (c) | Share test whose block rules vanish after that check, before Share | live: Instagram's publish goes through → TEST_LEAK, killed and locked, the leak named; mock: the static ruleset still blocks → `shareTested` |
 */

import type { HandoffState } from '../../src/core/handoff/state.ts';
import { androidReducedUa, CH_REMOVE } from '../../src/core/ig-contract/device-profile.ts';
import { SESSION_RULE_IDS } from '../../src/core/ig-contract/rules.ts';
import { FAKE_ACCOUNT } from '../../tools/fake-ig/knobs.ts';
import { type ExtGlobal, expect, IG_ORIGIN, test, whenClosed } from './fixtures.ts';
import {
  accountPrompt,
  dismissResult,
  lastRecord,
  loadPhoto,
  phasesOf,
  photoFile,
  postCard,
  postStory,
  runStep,
  shareTest,
  testRun,
  waitResult,
} from './helpers/editor-flow.ts';
import type { RequestRecord } from './helpers/fake-client.ts';
import { countFileChoosers } from './helpers/fake-page.ts';
import { decodeSize, psnr } from './helpers/psnr.ts';

const ANDROID_UA =
  /^Mozilla\/5\.0 \(Linux; Android 10; K\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/(\d+)\.0\.0\.0 Mobile Safari\/537\.36$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

for (const order of ['postStory', 'storyPost'] as const) {
  test(`E29 @smoke autopilot post (${order}): one click, Posted from Instagram's publish answer, one story`, async ({
    context,
    extension,
    editor,
    composer,
    fake,
    exportBytes,
    handoffRecords,
    sessionRules,
  }, testInfo) => {
    test.skip(extension.mode !== 'live', 'a guarded build blocks every upload (E29 mock, E31): it can never post');
    await fake.setKnobs({ geometry: 'fixed:1080x1920', menuOrder: order });
    const choosers = countFileChoosers(context);
    const page = await editor();
    await loadPhoto(page, await photoFile(context, testInfo));
    await expect(postCard(page)).toHaveAttribute('data-state', 'K13');
    const before = (await fake.requests()).at(-1)?.seq ?? 0;
    await postStory(page);
    const popup = await composer();
    const closed = whenClosed(popup);

    // Nothing else from the owner: the run view shows the five steps and the result.
    const card = await waitResult(page, 'posted');
    await expect(card).toContainText(`Posted to @${FAKE_ACCOUNT}’s story`);
    for (const step of ['instagram', 'account', 'story', 'share', 'confirm'] as const) {
      await expect(runStep(page, step)).toHaveAttribute('data-status', 'done');
    }
    await expect(runStep(page, 'account')).toContainText(`@${FAKE_ACCOUNT}`);
    await closed;
    // The live build carries on against the fake, flagged.
    await expect(page.getByTestId('run-fake-bar')).toBeVisible();

    // Server truth: exactly one story, published after the autopilot's (untrusted) Share.
    const stories = await fake.stories();
    expect(stories).toHaveLength(1);
    const story = stories[0];
    if (!story) throw new Error('no story');
    expect(story.isTrusted).toBe(false);
    expect(story.size).toEqual({ w: 1080, h: 1920 });
    // + → Story started Instagram's story session: a uuid that is also the telemetry's waterfall_id.
    expect(story.meta).toMatchObject({ sessionStarted: true, screenOrientation: 'portrait-primary', variant: 'v1' });
    expect(story.meta?.sessionId).toMatch(UUID);
    const log = await fake.log();
    const enter = log.filter((l) => l.step === 'enter');
    expect(enter).toHaveLength(1);
    expect(enter[0]?.fields.waterfall_id).toBe(story.meta?.sessionId);
    for (const step of ['image_process_success', 'compose']) {
      const l = log.find((x) => x.step === step);
      expect(l?.fields.waterfall_id, step).toBe(story.meta?.sessionId);
      // A sane duration (seconds since the session start), not the 1.76e9 s of a missing session.
      expect(Number(l?.fields.waterfall_duration), step).toBeLessThan(120);
    }
    // The taps: + (twice when the first item was Post), Story, Share; every one untrusted, none outside the list.
    const taps = log.filter((l) => l.step.startsWith('tap:')).map((l) => l.step);
    expect(taps).toEqual(
      order === 'storyPost'
        ? ['tap:create', 'tap:story', 'tap:share']
        : ['tap:create', 'tap:post', 'tap:create', 'tap:story', 'tap:share'],
    );
    expect(log.filter((l) => l.step === 'post_session_started')).toHaveLength(order === 'storyPost' ? 0 : 1);
    expect(choosers(), 'no file chooser may open (no user activation)').toBe(0);
    expect(await fake.uploads()).toHaveLength(1);

    // The composer documents carried the Android profile; the composer came by pushState, not a new document.
    const popupDocs = (await fake.requests(before)).filter(
      (r) => r.host === 'www.instagram.com' && r.fetch['sec-fetch-dest'] === 'document',
    );
    expect(popupDocs.map((r) => r.path)).toEqual(['/create/story/', '/', '/']);
    for (const r of popupDocs) expectAndroidProfile(r);
    // The upload and the publish request came from the page, with the Android profile too.
    const writes = await fake.writes();
    expect(writes.filter((w) => w.method === 'POST').map((w) => w.path.replace(/_\d+$/, '_<n>'))).toEqual([
      '/rupload_igphoto/fb_uploader_<n>',
      '/api/v1/media/configure_to_story/',
    ]);
    for (const w of writes) expect(w.origin).toBe(IG_ORIGIN);

    const rec = await lastRecord(handoffRecords);
    expect(rec).toMatchObject({ mode: 'post', outcome: 'posted', route: 'homeOnly' });
    expect(rec.result).toMatchObject({ kind: 'posted', account: FAKE_ACCOUNT, alarms: [] });
    expect(rec.evidence?.sharedBy).toBe('autopilot');
    // Record paths are normalised (ux.md §4.13: digits as <n>).
    const publish = rec.evidence?.net.find((e) => e.path === '/api/v<n>/media/configure_to_story/');
    expect(publish).toMatchObject({ host: 'www', status: 200, redirected: false });
    expect(publish?.type).toMatch(/^application\/json/);
    expect(rec.entry).toMatchObject({ result: 'armed', menuCount: 2, trials: order === 'storyPost' ? 0 : 1 });
    expect(rec.compose).toMatchObject({ variant: 'v1', fbAuto: false, controls: 1, drawn: true });
    // AM16: the insert's SPA navigation is the same document: one probe only.
    expect(phasesOf(rec).filter((p) => p === 'probing')).toHaveLength(1);
    expect(phasesOf(rec)).toEqual(
      expect.arrayContaining(['openingEntry', 'inserting', 'composeReady', 'sharing', 'confirmingUpload']),
    );

    // The exact export, PSNR against the published JPEG.
    const png = await exportBytes(rec.exportId as string);
    expect(await decodeSize(context, png)).toEqual({ w: 1080, h: 1920 });
    const db = await psnr(context, await fake.storyBytes(story.id), png);
    testInfo.annotations.push({ type: 'psnr', description: `${db.toFixed(2)} dB` });
    expect(db).toBeGreaterThanOrEqual(38);

    // The toolbar badge says ✓ until the editor has shown it; no rule is left.
    await expect.poll(sessionRules).toEqual([]);
    const badge = await extension.sw.evaluate(() => (globalThis as ExtGlobal).chrome.action.getBadgeText({}));
    expect(['✓', '']).toContain(badge);
    // The same story again is K12 (Post again), not a fresh post.
    await dismissResult(page);
    await expect(postCard(page)).toHaveAttribute('data-state', 'K12');
  });
}

test('E29 (mock) the same click in a guarded build ends as a Share test: the upload is blocked, never Posted', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
  sessionRules,
}, testInfo) => {
  test.skip(extension.mode !== 'mock', 'live posts (E29)');
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  await whenClosed(await composer());
  const card = await waitResult(page, 'shareTested');
  await expect(card).not.toContainText('Posted');
  expect(await fake.stories()).toEqual([]);
  expect(await fake.writes()).toEqual([]);
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ mode: 'post', outcome: 'share-tested' });
  // Only the static ruleset blocked it: no session block rule was installed for a post.
  expect(phasesOf(rec)).toContain('confirmingUpload');
  const upload = rec.evidence?.net.find((e) => e.path.startsWith('/rupload_igphoto/'));
  expect(upload).toMatchObject({ host: 'i', status: 0 });
  await expect.poll(sessionRules).toEqual([]);
});

test.describe('a fresh install', () => {
  test.use({ seeded: false });

  test('E30 the setup test: everything up to Share, no upload; tested; the account, the menu and the pass are stored', async ({
    context,
    editor,
    composer,
    fake,
    seed,
    handoffRecords,
    localKeys,
  }, testInfo) => {
    // A fresh install: no account, no fingerprint, the onboarding card; only the dwell is shortened (mock).
    await seed({ account: null, testPassed: false, onboarded: false });
    const page = await editor();
    await expect(page.getByTestId('onboarding')).toBeVisible();
    await loadPhoto(page, await photoFile(context, testInfo));
    await expect(postCard(page)).toHaveAttribute('data-state', 'K6');
    const choosers = countFileChoosers(context);
    await testRun(page);
    await whenClosed(await composer());
    const card = await waitResult(page, 'tested');
    await expect(card).toContainText('Test passed');
    await expect(runStep(page, 'share')).toContainText('not pressed');

    // Share was never pressed: no upload, no publish, no story.
    expect(await fake.uploads()).toEqual([]);
    expect(await fake.writes()).toEqual([]);
    expect(await fake.stories()).toEqual([]);
    const taps = (await fake.log()).filter((l) => l.step.startsWith('tap:')).map((l) => l.step);
    expect(taps).not.toContain('tap:share');
    expect(taps).toContain('tap:story');
    expect(choosers()).toBe(0);
    const rec = await lastRecord(handoffRecords);
    expect(rec).toMatchObject({ mode: 'test', outcome: 'tested' });
    expect(rec.account).toMatchObject({ detected: FAKE_ACCOUNT, decision: 'learn', confirmedBy: 'learned' });
    const keys = await localKeys(['expectedAccount', 'lastTestPassAt', 'menuFingerprint']);
    expect(keys.expectedAccount).toMatchObject({ handle: FAKE_ACCOUNT });
    expect(typeof keys.lastTestPassAt).toBe('number');
    // The fake's default menu is Post, Story: the trial found Story at index 1.
    expect(keys.menuFingerprint).toMatchObject({ count: 2, storyIndex: 1 });
    // The Post card leaves K6; the onboarding card says Ready.
    await page.getByTestId('result-done').click();
    await expect(page.getByTestId('onboarding-ready')).toContainText(`@${FAKE_ACCOUNT}`);
    await expect(postCard(page)).not.toHaveAttribute('data-state', 'K6');
  });
});

test('E31 Share test: Share pressed with publishing blocked; the upload is blocked; shareTested; no story', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  handoffState,
  sessionRules,
}, testInfo) => {
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await shareTest(page);
  const popup = await composer();
  // The write-block rules are in force for the composer tab and the extension's own worker (tabId -1).
  await expect
    .poll(async () => (await sessionRules()).filter((r) => r.action.type === 'block').length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const state = await handoffState();
  const tabId = state && 'tabId' in state ? state.tabId : null;
  for (const r of (await sessionRules()).filter((x) => x.action.type === 'block')) {
    expect(SESSION_RULE_IDS).toContain(r.id);
    expect(r.condition.tabIds).toEqual([tabId, -1]);
  }
  // Nothing reads the window before Share: Playwright's evaluate gives a page user activation, and the
  // autopilot then waits for it to lapse (R22).
  const card = await waitResult(page, 'shareTested');
  await expect(card).toContainText('Share test passed');
  await whenClosed(popup);
  expect(await fake.stories()).toEqual([]);
  expect(await fake.writes()).toEqual([]);
  const taps = (await fake.log()).filter((l) => l.step.startsWith('tap:')).map((l) => l.step);
  expect(taps.filter((t) => t === 'tap:share')).toHaveLength(1);
  expect(taps).not.toContain('tap:retry');
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ mode: 'shareTest', outcome: 'share-tested' });
  expect(rec.evidence?.net.find((e) => e.path.startsWith('/rupload_igphoto/'))).toMatchObject({ host: 'i', status: 0 });
  expect(rec.evidence?.net.some((e) => e.path.includes('configure_to_story'))).toBe(false);
  // Instagram's own "Upload failed." toast with its Retry (which nobody tapped), as the agent saw it. (Its
  // progress modal shows for a few ms only when the upload is blocked, so progressSeen is not asserted.)
  expect(rec.evidence?.ui.toast).toBe('action');
  expect((await fake.log()).map((l) => l.step)).toContain('compose_failure');
  await expect.poll(sessionRules).toEqual([]);
});

/** Removes the test's write-block rules (1002–1019) from the extension's worker, as a broken build might. */
async function dropBlockRules(sw: { evaluate: <T>(fn: () => Promise<T>) => Promise<T> }): Promise<void> {
  await sw.evaluate(async () => {
    const { chrome } = globalThis as unknown as ExtGlobal;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: Array.from({ length: 18 }, (_, i) => 1002 + i),
    });
  });
}

test('E31 (b) a Share test whose block rules are gone before the composer: caught there, Share never pressed', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  seed,
  handoffRecords,
}, testInfo) => {
  // The account prompt holds the run on home, before any tap, while the rules disappear.
  await seed({ account: 'someone_else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await shareTest(page);
  const popup = await composer();
  await expect(accountPrompt(page)).toBeVisible({ timeout: 30_000 });
  await dropBlockRules(extension.sw);
  await page.getByTestId('account-proceed').click();
  await whenClosed(popup);
  await waitResult(page, 'notPosted', { code: 'AGENT_UNREACHABLE' });
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ mode: 'shareTest', detail: 'write-block rules not installed' });
  expect(phasesOf(rec)).toContain('composeReady');
  expect(phasesOf(rec)).not.toContain('sharing');
  expect((await fake.log()).map((l) => l.step)).not.toContain('tap:share');
  expect(await fake.uploads()).toEqual([]);
});

test('E31 (c) a Share test whose block rules vanish after the check: live TEST_LEAK, killed and locked; mock still blocked', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  seed,
  handoffState,
  handoffRecords,
  storedSettings,
  sessionRules,
}, testInfo) => {
  // Mock: a dwell before Share long enough to act in (live builds always have theirs).
  if (extension.mode === 'mock') await seed({ dwellScale: 0.9 });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await shareTest(page);
  const popup = await composer();
  // The background verified the rules on the composer; the dwell before Share runs.
  await expect
    .poll(
      async () => {
        const st = (await handoffState()) as (HandoffState & { testRulesVerified?: boolean }) | undefined;
        return st?.phase === 'composeReady' && st.testRulesVerified === true;
      },
      { intervals: [50], timeout: 30_000 },
    )
    .toBe(true);
  await dropBlockRules(extension.sw);
  expect((await sessionRules()).map((r) => r.id)).toEqual([1001]);
  if (extension.mode === 'mock') {
    // The guarded build's static ruleset still blocks the upload: no leak.
    await waitResult(page, 'shareTested');
    await whenClosed(popup);
    expect(await fake.stories()).toEqual([]);
    expect((await lastRecord(handoffRecords)).outcome).toBe('share-tested');
    return;
  }
  const t0 = Date.now();
  const card = await waitResult(page, 'unknown', { code: 'TEST_LEAK' });
  await expect(card).toContainText('The test didn’t block publishing');
  await expect(card).toContainText('check your story now and delete it');
  await whenClosed(popup);
  const rec = await lastRecord(handoffRecords);
  expect(rec.outcome).toBe('killed:TEST_LEAK');
  expect(rec.result).toMatchObject({ kind: 'unknown', code: 'TEST_LEAK', killed: 'TEST_LEAK' });
  expect(rec.result?.detail).toMatch(/^(upload|publish) 200$/);
  // Killed: desktop posting is paused; the fake shows what leaked.
  expect((await storedSettings())?.msiteLockedUntil ?? 0).toBeGreaterThan(t0);
  await expect(page.getByTestId('pause-banner')).toBeVisible();
  // AP-12: the banner names the leak and its action, not a security check.
  await expect(page.getByTestId('pause-banner')).toContainText('delete the test story');
  await expect(page.getByTestId('pause-banner')).not.toContainText('security check');
  expect((await fake.uploads()).length).toBe(1);
});
