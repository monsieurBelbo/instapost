/**
 * The autopilot's way into Instagram's story editor, and the owner's exceptions (ux.md §4.8, §4.9, §10;
 * docs/contract.md C10, C11, C14), against the fake, on the mock and live artifacts.
 *
 * | Id  | Case | Expected |
 * |-----|------|----------|
 * | E33 (a) | `trusted=require` (Instagram ignores untrusted taps) | + opens no menu, one re-tap: STORY_ENTRY_MISSING (no menu), the window kept for Finish by hand |
 * | E33 (b) | `menuItems=3` | STORY_ENTRY_MISSING (3 items): an unknown third item is never tapped |
 * | E33 (c) | no fingerprint, Post first | exactly one wrong item (a post session), then Story; the fingerprint is stored |
 * | E33 (d) | with that fingerprint | Story first time: no post session |
 * | E34 | the owner clicks the window just before + → Story | the autopilot waits for the activation to lapse, no file chooser, then carries on; clicking on → WINDOW_IN_USE |
 * | E36 | another account, an unreadable one, nobody answering | the prompt before any tap; Cancel → stopped; confirm → it carries on and remembers; 60 s → ACCOUNT_UNCONFIRMED |
 * | E40 | Finish by hand after STORY_ENTRY_MISSING | the owner taps + → Story, picks the export and taps Share; instapost only observes; the result from the requests (live Posted, mock Share test) |
 *
 * E41 (a hidden window raised once) is covered by the reducer (U19) and the runner (U11): headless Chromium keeps a minimised
 * window's page `visible`, so the case cannot be produced here (checked 2026-10-13).
 * Nothing reads the Instagram window before the autopilot's taps unless the case is about that: a
 * Playwright evaluate or click gives the page user activation (R22).
 */
import { writeFile } from 'node:fs/promises';
import { FAKE_ACCOUNT } from '../../tools/fake-ig/knobs.ts';
import { expect, test, whenClosed } from './fixtures.ts';
import {
  accountPrompt,
  lastRecord,
  loadPhoto,
  phasesOf,
  photoFile,
  postStory,
  resultAction,
  testRun,
  waitResult,
} from './helpers/editor-flow.ts';
import { countFileChoosers } from './helpers/fake-page.ts';

const taps = async (fake: { log(): Promise<{ step: string }[]> }) =>
  (await fake.log()).filter((l) => l.step.startsWith('tap:')).map((l) => l.step);

test('E33 (a) trusted=require: + opens no menu (one re-tap), STORY_ENTRY_MISSING; Finish by hand is offered', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ trusted: 'require' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  const card = await waitResult(page, 'notPosted', { code: 'STORY_ENTRY_MISSING', timeout: 45_000 });
  await expect(card).toContainText('Couldn’t start a story');
  await expect(card).toContainText('Nothing was posted');
  // The window is kept a minute for Finish by hand (§4.9).
  await expect(card).toHaveAttribute('data-held', 'offerManual');
  await expect(resultAction(page, 'finishByHand')).toBeVisible();
  expect(popup.isClosed()).toBe(false);
  // + twice (one re-tap when no menu appeared), nothing else.
  expect(await taps(fake)).toEqual(['tap:create', 'tap:create']);
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ outcome: 'failed:STORY_ENTRY_MISSING', detail: 'no menu after +' });
  expect(rec.entry).toMatchObject({ result: 'MENU_MISSING', plusTaps: 2, menuCount: null });
  expect(await fake.uploads()).toEqual([]);
  // Done closes it.
  await page.getByTestId('result-done').click();
  await whenClosed(popup);
});

test('E33 (b) menuItems=3: an unknown third item is never tapped → STORY_ENTRY_MISSING (menu 3 items)', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ menuItems: '3' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  await whenClosed(await composer());
  await waitResult(page, 'notPosted', { code: 'STORY_ENTRY_MISSING' });
  expect(await taps(fake)).toEqual(['tap:create']);
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ outcome: 'failed:STORY_ENTRY_MISSING', detail: 'menu 3 items' });
  expect(rec.entry).toMatchObject({ result: 'MENU_DRIFT', menuCount: 3 });
});

test('E33 (c) (d) no fingerprint, Post first: one wrong item, then Story; with the fingerprint stored, Story first time', async ({
  context,
  editor,
  composer,
  fake,
  seed,
  handoffRecords,
  localKeys,
  clearRateLog,
}, testInfo) => {
  await seed({ fingerprint: null });
  await fake.setKnobs({ menuOrder: 'postStory' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  const first = await composer();
  await whenClosed(first);
  await waitResult(page, 'tested');
  expect(await taps(fake)).toEqual(['tap:create', 'tap:post', 'tap:create', 'tap:story']);
  expect((await fake.log()).filter((l) => l.step === 'post_session_started')).toHaveLength(1);
  expect((await lastRecord(handoffRecords)).entry).toMatchObject({
    result: 'armed',
    trials: 1,
    storyIndex: 1,
    fpUsed: false,
  });
  const fp = (await localKeys(['menuFingerprint'])).menuFingerprint;
  expect(fp).toMatchObject({ count: 2, storyIndex: 1 });

  // (d) The next run uses the fingerprint: Story at once, no post session.
  await clearRateLog();
  const since = (await fake.log()).at(-1)?.seq ?? 0;
  await page.getByTestId('result-done').click();
  await testRun(page);
  await whenClosed(await composer({ not: [first] }));
  await waitResult(page, 'tested');
  const later = await fake.log(since);
  expect(later.filter((l) => l.step.startsWith('tap:')).map((l) => l.step)).toEqual(['tap:create', 'tap:story']);
  expect(later.filter((l) => l.step === 'post_session_started')).toEqual([]);
  expect((await lastRecord(handoffRecords)).entry).toMatchObject({ result: 'armed', trials: 0, fpUsed: true });
});

test('E34 the owner clicks the window just before + → Story: the autopilot waits, opens no file chooser, carries on', async ({
  context,
  editor,
  composer,
  human,
  seed,
  handoffRecords,
}, testInfo) => {
  // The account prompt holds the run on home; the owner clicks in the window, then confirms in the editor.
  await seed({ account: 'someone_else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  const choosers = countFileChoosers(context);
  await testRun(page);
  const popup = await composer();
  await expect(accountPrompt(page)).toBeVisible({ timeout: 30_000 });
  await human.touch(popup);
  const touchedAt = Date.now();
  await page.getByTestId('account-proceed').click();
  await whenClosed(popup);
  await waitResult(page, 'tested');
  // Chrome's transient activation lasts about 5 s: + → Story came after it lapsed, and no chooser opened.
  const rec = await lastRecord(handoffRecords);
  const armed = rec.steps?.armed ?? 0;
  expect(armed - touchedAt).toBeGreaterThan(3500);
  expect(choosers()).toBe(0);
  expect(rec.entry).toMatchObject({ result: 'armed' });
});

test('E34 (b) the owner keeps clicking the window: WINDOW_IN_USE, nothing tapped while it lasts', async ({
  context,
  editor,
  composer,
  fake,
  human,
  seed,
  handoffRecords,
}, testInfo) => {
  await seed({ account: 'someone_else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  const choosers = countFileChoosers(context);
  await testRun(page);
  const popup = await composer();
  await expect(accountPrompt(page)).toBeVisible({ timeout: 30_000 });
  await human.touch(popup);
  await page.getByTestId('account-proceed').click();
  // Click on, every second, for longer than the 6 s the autopilot waits.
  const until = Date.now() + 9000;
  while (Date.now() < until && !popup.isClosed()) {
    await human.touch(popup).catch(() => undefined);
    await page.waitForTimeout(1000);
  }
  await waitResult(page, 'notPosted', { code: 'WINDOW_IN_USE' });
  expect((await taps(fake)).filter((t) => t !== 'tap:home')).toEqual([]);
  expect(choosers()).toBe(0);
  expect((await lastRecord(handoffRecords)).entry).toMatchObject({ result: 'ACTIVATION_ACTIVE', plusTaps: 0 });
});

test('E36 (a) another account: the prompt before any tap; Cancel → stopped, nothing tapped', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ account: 'other:someone.else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  const prompt = accountPrompt(page);
  await expect(prompt).toHaveAttribute('data-kind', 'mismatch', { timeout: 30_000 });
  await expect(prompt).toContainText('@someone.else');
  await expect(prompt).toContainText(`@${FAKE_ACCOUNT}`);
  await expect(page.getByTestId('account-proceed')).toHaveText('Post as @someone.else');
  await page.getByTestId('account-cancel').click();
  await whenClosed(popup);
  await waitResult(page, 'stopped');
  expect(await taps(fake)).toEqual([]);
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ outcome: 'cancelled' });
  expect(rec.account).toMatchObject({ detected: 'someone.else', expected: FAKE_ACCOUNT, decision: 'prompt-mismatch' });
  expect(phasesOf(rec)).not.toContain('openingEntry');
});

test('E36 (b) another account, confirmed: it carries on and remembers the account', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
  localKeys,
}, testInfo) => {
  await fake.setKnobs({ account: 'someone.else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  await expect(accountPrompt(page)).toHaveAttribute('data-kind', 'mismatch', { timeout: 30_000 });
  await page.getByTestId('account-proceed').click();
  await whenClosed(popup);
  await waitResult(page, extension.mode === 'live' ? 'posted' : 'shareTested');
  expect((await localKeys(['expectedAccount'])).expectedAccount).toMatchObject({ handle: 'someone.else' });
  const rec = await lastRecord(handoffRecords);
  expect(rec.account).toMatchObject({ detected: 'someone.else', confirmedBy: 'owner' });
  expect(await fake.stories()).toHaveLength(extension.mode === 'live' ? 1 : 0);
});

test('E36 (c) an unreadable account (no profile link): the prompt says so; Post anyway carries on without learning it', async ({
  context,
  editor,
  composer,
  fake,
  localKeys,
}, testInfo) => {
  await fake.setKnobs({ account: 'none' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  const popup = await composer();
  const prompt = accountPrompt(page);
  // The P5 wait for a late account link runs first (6 s), then the prompt.
  await expect(prompt).toHaveAttribute('data-kind', 'unreadable', { timeout: 30_000 });
  await expect(prompt).toContainText('couldn’t tell which account is logged in');
  await page.getByTestId('account-proceed').click();
  await whenClosed(popup);
  await waitResult(page, 'tested');
  expect((await localKeys(['expectedAccount'])).expectedAccount).toMatchObject({ handle: FAKE_ACCOUNT });
});

test('E36 (d) nobody answers the prompt: ACCOUNT_UNCONFIRMED after 60 s, nothing tapped', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  test.skip(extension.mode === 'live', 'the same reducer path in both builds; one 60 s wait is enough');
  test.setTimeout(150_000);
  await fake.setKnobs({ account: 'someone.else' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await testRun(page);
  const popup = await composer();
  await expect(accountPrompt(page)).toBeVisible({ timeout: 30_000 });
  await expect(accountPrompt(page)).toContainText('Cancels itself in');
  await whenClosed(popup);
  await waitResult(page, 'notPosted', { code: 'ACCOUNT_UNCONFIRMED', timeout: 80_000 });
  expect(await taps(fake)).toEqual([]);
  expect((await lastRecord(handoffRecords)).outcome).toBe('failed:ACCOUNT_UNCONFIRMED');
});

test('E40 Finish by hand: after STORY_ENTRY_MISSING the owner taps + → Story, picks the file and Share; no question', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  human,
  exportBytes,
  handoffRecords,
}, testInfo) => {
  // Instagram ignores untrusted taps: the autopilot stops before anything happened, the owner finishes.
  await fake.setKnobs({ trusted: 'require' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  await waitResult(page, 'notPosted', { code: 'STORY_ENTRY_MISSING', timeout: 45_000 });
  // The safety copy is in Downloads/instapost (§5) and named by Finish by hand.
  await expect(page.getByTestId('result-copy')).toContainText('Downloads/instapost/');
  await resultAction(page, 'finishByHand').click();
  const line = page.getByTestId('finish-by-hand');
  await expect(line).toHaveAttribute('data-needs', 'pick');
  await expect(line).toContainText('tap +, then Story');

  // The owner, in the Instagram window: + → Story, the export from Downloads, then Share.
  const rec0 = await lastRecord(handoffRecords);
  const picked = testInfo.outputPath('story.png');
  await writeFile(picked, await exportBytes(rec0.exportId as string));
  await human.pickViaStory(popup, picked);
  const closed = whenClosed(popup);
  await human.share(popup);
  await waitResult(page, extension.mode === 'live' ? 'posted' : 'shareTested');
  await closed;
  // No "Posted?" question anywhere.
  await expect(page.getByText('Posted?')).toHaveCount(0);

  const rec = await lastRecord(handoffRecords);
  expect(phasesOf(rec)).toContain('manual');
  expect(rec.evidence?.sharedBy).toBe('owner');
  if (extension.mode === 'live') {
    expect(rec.outcome).toBe('posted');
    const stories = await fake.stories();
    expect(stories).toHaveLength(1);
    // The owner's taps were trusted; their + → Story started the story session.
    expect(stories[0]?.isTrusted).toBe(true);
    expect(stories[0]?.meta?.sessionStarted).toBe(true);
  } else {
    expect(rec.outcome).toBe('share-tested');
    expect(await fake.stories()).toEqual([]);
  }
  // After Finish by hand began, instapost tapped nothing: every tap after the autopilot's two + was the owner's.
  const after = (await fake.log()).filter((l) => l.step.startsWith('tap:')).slice(2);
  expect(after.length).toBeGreaterThanOrEqual(3);
  for (const l of after) expect(l.fields.isTrusted, l.step).toBe(true);
});
