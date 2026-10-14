/**
 * The owner's side in the editor tab, for the autopilot specs (ux.md §4, IU15): load a photo, press Post
 * story / Test run / Share test / Check connection, read the run view and the result. Only the editor's
 * own test ids (ux.md IU15, strategy §7.10) and, where a spec checks copy, its visible texts are used.
 *
 * After Post story nothing here touches Instagram's window: that is the point (ux.md P1). The exceptions
 * are the owner's own choices the spec names: the account prompt (§4.8), Stop, and Finish by hand (§4.9,
 * where tests/e2e/helpers/human.ts plays the owner in the window).
 */
import { writeFile } from 'node:fs/promises';
import { type BrowserContext, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type {
  ErrorCode,
  HandoffMode,
  HandoffRecord,
  ResultKind,
  SessionPhase,
} from '../../../src/core/handoff/state.ts';
import { syntheticImage } from './psnr.ts';

/** Writes a synthetic portrait JPEG (iPhone-sized by default) into the test's output dir. */
export async function photoFile(context: BrowserContext, testInfo: TestInfo, w = 3024, h = 4032): Promise<string> {
  const path = testInfo.outputPath(`photo-${w}x${h}.jpg`);
  await writeFile(path, await syntheticImage(context, w, h, 'image/jpeg'));
  return path;
}

/**
 * Loads `path` as the story's photo and waits until the stage shows it and the Post card has its export:
 * a new asset on the stage, then a fresh thumbnail rendered from it (a replaced photo first shows the old
 * export, stale, until the new one renders).
 */
export async function loadPhoto(page: Page, path: string): Promise<void> {
  const stage = page.getByTestId('editor-stage');
  const thumb = page.getByTestId('post-thumb');
  // Read without waiting: an empty editor has no stage and no thumbnail yet.
  const before = (await stage.count()) > 0 ? ((await stage.getAttribute('data-asset-id')) ?? '') : '';
  const beforeSrc = (await thumb.locator('img').count()) > 0 ? await thumb.locator('img').getAttribute('src') : null;
  await page.getByTestId('editor-file-input').setInputFiles(path);
  await expect(stage).toHaveAttribute('data-asset-id', /.+/);
  if (before !== '') await expect(stage).not.toHaveAttribute('data-asset-id', before);
  await expect
    .poll(
      async () => {
        const stale = await thumb.getAttribute('data-stale');
        const src = (await thumb.locator('img').count()) > 0 ? await thumb.locator('img').getAttribute('src') : null;
        return stale === 'false' && src !== null && src !== beforeSrc;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** The Post card (ux.md §4.5) and its state K1–K13. */
export const postCard = (page: Page): Locator => page.getByTestId('post-card');

/** Post story (⌘↵): the Post card's primary button, which must be the post action. */
export async function postStory(page: Page): Promise<void> {
  const primary = page.getByTestId('post-primary');
  await expect(primary).toHaveAttribute('data-action', /^(post|queuePost)$/);
  await primary.click();
  await expect(page.getByTestId('run-view')).toBeVisible();
}

/** Test run (⌥⌘↵): the link under the Post card, or its primary in K6 (the setup test). */
export async function testRun(page: Page): Promise<void> {
  const link = page.getByTestId('post-test');
  if ((await link.count()) > 0) await link.click();
  else {
    await expect(page.getByTestId('post-primary')).toHaveAttribute('data-action', 'setupTest');
    await page.getByTestId('post-primary').click();
  }
  await expect(page.getByTestId('run-view')).toBeVisible();
}

async function advanced(page: Page): Promise<void> {
  await page.getByTestId('settings-open').click();
  await expect(page.getByTestId('settings-sheet')).toBeVisible();
  await page.getByTestId('settings-advanced').click();
}

/** Settings → Advanced → Share test (presses Share with publishing blocked, ux.md §7). */
export async function shareTest(page: Page): Promise<void> {
  await advanced(page);
  await page.getByTestId('settings-share-test').click();
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('run-view')).toBeVisible();
}

/** Settings → Advanced → Check connection (window, probe and account; no file). */
export async function checkConnection(page: Page): Promise<void> {
  await advanced(page);
  await page.getByTestId('settings-check-connection').click();
  await page.getByTestId('settings-close').click();
}

/** Starts a run of `mode` from the editor as the owner would. */
export async function startRun(page: Page, mode: HandoffMode): Promise<void> {
  switch (mode) {
    case 'post':
      return postStory(page);
    case 'test':
      return testRun(page);
    case 'shareTest':
      return shareTest(page);
    case 'check':
      return checkConnection(page);
  }
}

export const runView = (page: Page): Locator => page.getByTestId('run-view');

/** Waits until the run view shows `phase` (the background's status). */
export async function waitPhase(page: Page, phase: SessionPhase | 'idle', timeout = 30_000): Promise<void> {
  await expect(runView(page)).toHaveAttribute('data-phase', phase, { timeout });
}

/** A step line of the run view (ux.md §4.6): instagram, account, story, share, confirm. */
export const runStep = (page: Page, step: 'instagram' | 'account' | 'story' | 'share' | 'confirm'): Locator =>
  page.locator(`[data-testid="run-step"][data-step="${step}"]`);

export const resultCard = (page: Page): Locator => page.getByTestId('result');

/** Waits for the result card (ux.md §4.7) of `kind` (and `code`, when given). */
export async function waitResult(
  page: Page,
  kind: ResultKind,
  opts: { code?: ErrorCode | ''; timeout?: number } = {},
): Promise<Locator> {
  const card = resultCard(page);
  await expect(card).toHaveAttribute('data-kind', kind, { timeout: opts.timeout ?? 60_000 });
  if (opts.code !== undefined) await expect(card).toHaveAttribute('data-code', opts.code);
  return card;
}

/** The result card's action button `action` (primary or secondary, ux.md §5). */
export const resultAction = (page: Page, action: string): Locator =>
  page.locator(
    `[data-testid="result-primary"][data-action="${action}"], [data-testid="result-secondary"][data-action="${action}"]`,
  );

/** Done: the result card goes, the editor keeps the story. */
export async function dismissResult(page: Page): Promise<void> {
  await page.getByTestId('result-done').click();
  await expect(resultCard(page)).toHaveCount(0);
}

/** Stop (Esc), honoured before Share only. */
export async function stopRun(page: Page): Promise<void> {
  await page.getByTestId('run-stop').click();
}

export const accountPrompt = (page: Page): Locator => page.getByTestId('account-prompt');

/**
 * The newest hand-off record, once it has settled: the background tells the editor the result just before
 * it writes (or patches) the record, so a spec that read it at once could see the one before.
 */
export async function lastRecord(records: () => Promise<HandoffRecord[]>): Promise<HandoffRecord> {
  let prev = '';
  for (let i = 0; i < 20; i++) {
    const rec = (await records()).at(-1);
    const now = rec ? JSON.stringify(rec) : '';
    if (rec && now === prev) return rec;
    prev = now;
    await new Promise((r) => setTimeout(r, 150));
  }
  const rec = (await records()).at(-1);
  if (!rec) throw new Error('no hand-off record');
  return rec;
}

/** The phases a record passed through, in order. */
export const phasesOf = (rec: HandoffRecord): string[] => rec.phaseLog.map((p) => p.phase);

/** Opens Details (ux.md §4.13) in the run view or result, and returns its row `key` (`data-row`). */
export async function detailRow(page: Page, key: string): Promise<Locator> {
  const details = page.getByTestId('details').last();
  if ((await details.getAttribute('data-open')) !== 'true') await details.locator('.details-toggle').click();
  return details.locator(`[data-row="${key}"]`);
}

/** The refusal under the Post card (a start the background refused before any window, ux.md §5). */
export const refusal = (page: Page): Locator => page.getByTestId('post-refusal');
