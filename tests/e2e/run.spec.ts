/**
 * Pacing, stopping and the duplicate guard around the autopilot (ux.md §4.5 K8/K10–K12, §4.6 Stop, §6 O8,
 * §4.10), against the fake, on the mock and live artifacts.
 *
 * | Id  | Case | Expected |
 * |-----|------|----------|
 * | E39 | a second Post story within 60 s; then a third, cancelled while queued | K10 → queued (K11, "Starting in …") → it starts by itself once the spacing ends; Cancel drops the queue, no window |
 * | E42 (a) | Stop mid-autopilot, before Share | stopped, Nothing was posted; no Share tap, no upload; the window closed |
 * | E42 (b) | the owner closes the Instagram window before Share | stopped by the window, Nothing was posted |
 * | E42 (c) | the owner closes it after Share | Stop is gone once Share was pressed; Couldn't confirm (window closed), never Posted and never "Nothing was posted"; the Post card says the story may already be posted (K8); "It didn't post" clears that |
 * | E43 | live: the same story again after Posted; after Couldn't confirm | K12 "Post again"; K8 "Check my story ↗" with "It didn't post — post again" |
 *
 * E41 (a hidden window raised once) is not here: headless Chromium keeps a minimised or covered popup's page
 * `visible` (checked 2026-10-13 with windows.update minimized and CDP focus emulation), so the case is the
 * reducer's (U19 "§4.6: hidden before a tap → raised once …"), the runner's (U11 "E41 (moved here)": one
 * focus-only windows.update) and the live checklist's (L23).
 */
import type { HandoffState } from '../../src/core/handoff/state.ts';
import { expect, test, whenClosed } from './fixtures.ts';
import {
  dismissResult,
  lastRecord,
  loadPhoto,
  photoFile,
  postCard,
  postStory,
  stopRun,
  waitResult,
} from './helpers/editor-flow.ts';
import { quietWaitFor } from './helpers/fake-page.ts';

const taps = async (fake: { log(): Promise<{ step: string }[]> }) =>
  (await fake.log()).filter((l) => l.step.startsWith('tap:')).map((l) => l.step);

test('E39 a second post within 60 s is queued and starts by itself; a third, cancelled while queued, never opens', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
  localKeys,
  ageRateLog,
}, testInfo) => {
  test.setTimeout(150_000);
  const result = extension.mode === 'live' ? 'posted' : 'shareTested';
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const first = await composer();
  await waitResult(page, result);
  await whenClosed(first);
  await dismissResult(page);

  // Another photo (another story), within the minute: the Post card queues it (K10).
  await loadPhoto(page, await photoFile(context, testInfo, 4000, 3000));
  await expect(postCard(page)).toHaveAttribute('data-state', 'K10');
  await expect(page.getByTestId('post-primary')).toHaveText(/^Post story · in \d:\d\d/);
  // Shorten the wait to about 6 s (the guard's code and caps are untouched).
  const log = (await localKeys(['rateLog'])).rateLog as number[];
  const last = log.at(-1) ?? Date.now();
  await ageRateLog(Math.max(0, last + 60_000 - Date.now() - 6000));
  const clickedAt = Date.now();
  await page.getByTestId('post-primary').click();
  await expect(page.getByTestId('run-queued')).toContainText(/Starting in 0:0\d…/);
  await expect(postCard(page)).toHaveAttribute('data-state', 'K11');
  await expect(page.getByTestId('post-primary')).toHaveText('Cancel');
  expect(await handoffRecords()).toHaveLength(1);
  // It starts by itself.
  const second = await composer({ not: [first], timeout: 30_000 });
  await waitResult(page, result);
  await whenClosed(second);
  const records = await handoffRecords();
  expect(records).toHaveLength(2);
  expect((records[1]?.startedAt ?? 0) - clickedAt).toBeGreaterThanOrEqual(3000);
  expect(records.map((r) => r.mode)).toEqual(['post', 'post']);
  await dismissResult(page);

  // A third within the minute, queued, then cancelled: nothing opens.
  await expect(page.getByTestId('post-primary')).toHaveAttribute('data-action', 'queuePost');
  let opened = 0;
  context.on('page', () => {
    opened++;
  });
  await page.getByTestId('post-primary').click();
  await expect(postCard(page)).toHaveAttribute('data-state', 'K11');
  await page.getByTestId('post-primary').click();
  await expect(postCard(page)).not.toHaveAttribute('data-state', 'K11');
  await page.waitForTimeout(1500);
  expect(opened).toBe(0);
  expect(await handoffRecords()).toHaveLength(2);
  expect(await fake.stories()).toHaveLength(extension.mode === 'live' ? 2 : 0);
});

test('E42 (a) Stop mid-autopilot, before Share: stopped, nothing posted, nothing tapped after it', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  sessionRules,
}, testInfo) => {
  // The composer draws the photo 4 s after it took the file: Stop comes while the autopilot waits for it.
  await fake.setKnobs({ slowMs: 4000 });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  await quietWaitFor(popup, () => location.pathname === '/create/story/');
  await stopRun(page);
  await whenClosed(popup);
  const card = await waitResult(page, 'stopped');
  await expect(card).toContainText('Stopped');
  await expect(card).toContainText('Nothing was posted.');
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ outcome: 'cancelled' });
  expect(rec.result).toMatchObject({ kind: 'stopped', stoppedBy: 'owner' });
  // Let the composer's late photo come (it never does: the window is gone).
  await page.waitForTimeout(4500);
  expect(await taps(fake)).not.toContain('tap:share');
  expect(await fake.uploads()).toEqual([]);
  await expect.poll(sessionRules).toEqual([]);
});

test('E42 (b) the owner closes the Instagram window before Share: stopped by the window, nothing posted', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ slowMs: 4000 });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  await quietWaitFor(popup, () => location.pathname === '/create/story/');
  await popup.close();
  const card = await waitResult(page, 'stopped');
  await expect(card).toContainText('Stopped — you closed the Instagram window');
  await expect(card).toContainText('Nothing was posted.');
  const rec = await lastRecord(handoffRecords);
  expect(rec.result).toMatchObject({ kind: 'stopped', stoppedBy: 'window' });
  expect(await fake.uploads()).toEqual([]);
});

test('E42 (c) the owner closes the window after Share: Couldn’t confirm, never Posted; K8 until “It didn’t post”', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffState,
  handoffRecords,
}, testInfo) => {
  // Live: Instagram's publish request never answers; mock: the blocked upload settles for 3 s first.
  if (extension.mode === 'live') await fake.setKnobs({ configure: 'hang' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  await expect
    .poll(async () => ((await handoffState()) as HandoffState | undefined)?.phase, { intervals: [50], timeout: 30_000 })
    .toBe('confirmingUpload');
  // From the Share command on, the run cannot be stopped.
  await expect(page.getByTestId('run-cant-stop')).toBeVisible();
  await expect(page.getByTestId('run-stop')).toHaveCount(0);
  await popup.close();
  const card = await waitResult(page, 'unknown', { code: 'OUTCOME_UNKNOWN' });
  await expect(card).toContainText('Couldn’t confirm the post');
  await expect(card).toContainText('the Instagram window was closed before Instagram answered');
  await expect(card).not.toContainText('Nothing was posted');
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ outcome: 'unknown' });
  expect(rec.result).toMatchObject({ kind: 'unknown', why: 'window-closed' });
  expect(rec.evidence?.sharedBy).toBe('autopilot');

  // The duplicate guard: this story may already be posted (K8) …
  await dismissResult(page);
  await expect(postCard(page)).toHaveAttribute('data-state', 'K8');
  await expect(page.getByTestId('post-primary')).toHaveText('Check my story ↗');
  await expect(page.getByTestId('post-note')).toContainText('This story may already be posted');
  await expect(page.getByTestId('post-link')).toHaveText('It didn’t post — post again');
  // … until the owner says it did not (History's mark, also from the result card).
  await page.getByTestId('history-open').click();
  const row = page.locator(`[data-testid="history-row"][data-id="${rec.id}"]`);
  await expect(row).toHaveAttribute('data-kind', 'unknown');
  await row.getByTestId('history-more').click();
  await row.getByTestId('history-mark-not-posted').click();
  await page.getByTestId('history-close').click();
  await expect(postCard(page)).not.toHaveAttribute('data-state', 'K8');
  await expect.poll(async () => (await lastRecord(handoffRecords)).markedBy).toBe('owner');
});

test('E43 live: the same story again after Posted is “Post again” (K12)', async ({
  context,
  extension,
  editor,
  composer,
  handoffRecords,
}, testInfo) => {
  test.skip(extension.mode !== 'live', 'a guarded build never posts (E42 c covers K8 in both builds)');
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  await whenClosed(await composer());
  await waitResult(page, 'posted');
  await dismissResult(page);
  await expect(postCard(page)).toHaveAttribute('data-state', 'K12');
  await expect(page.getByTestId('post-primary')).toHaveText(/^Post again/);
  await expect(page.getByTestId('post-note')).toContainText('You posted this story at');
  // Another edit is another story: the guard lets it go (after the spacing).
  await page.getByTestId('editor-text').fill('a different story');
  await expect(page.getByTestId('post-thumb')).toHaveAttribute('data-stale', 'false', { timeout: 15_000 });
  await expect(postCard(page)).toHaveAttribute('data-state', 'K10');
  expect(await handoffRecords()).toHaveLength(1);
});
