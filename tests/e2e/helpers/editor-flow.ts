/**
 * The owner's side in the editor tab, for the hand-off specs: load a photo, set the hand-off
 * switches, start a hand-off, read the hand-off panel. Only the editor's own test ids (§7.10) and
 * its visible texts are used here.
 */
import { writeFile } from 'node:fs/promises';
import { type BrowserContext, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { ErrorCode, HandoffPhase } from '../../../src/core/handoff/state.ts';
import { syntheticImage } from './psnr.ts';

/** Writes a synthetic portrait JPEG (iPhone-sized by default) into the test's output dir. */
export async function photoFile(context: BrowserContext, testInfo: TestInfo, w = 3024, h = 4032): Promise<string> {
  const path = testInfo.outputPath(`photo-${w}x${h}.jpg`);
  await writeFile(path, await syntheticImage(context, w, h, 'image/jpeg'));
  return path;
}

export interface HandoffSwitches {
  /** H1 assisted insert (default ON in mock, OFF in live until OD3). */
  assisted?: boolean;
  /** Rehearsal rules 1002–1019 (default ON in every build). */
  rehearsal?: boolean;
}

/**
 * Sets the hand-off switches in Settings and returns to the editor route. Each switch is stated
 * explicitly by the specs that depend on it, so mock and live run the same flow.
 */
export async function setSwitches(page: Page, sw: HandoffSwitches): Promise<void> {
  await gotoRoute(page, '#/settings');
  await expect(page.getByTestId('setting-assisted')).toBeVisible();
  const set = async (id: string, key: 'assistedInsert' | 'rehearsal', on: boolean | undefined) => {
    if (on === undefined) return;
    const box = page.getByTestId(id);
    // Already so: the checkbox shows the effective setting (stored, or the mode's default).
    if ((await box.isChecked()) === on) return;
    await box.setChecked(on);
    await expect(box).toBeChecked({ checked: on });
    // The checkbox is optimistic; the background reads storage.local when the hand-off starts.
    const stored = () =>
      page.evaluate(async (k) => {
        const { chrome } = globalThis as unknown as {
          chrome: { storage: { local: { get(key: string): Promise<Record<string, unknown>> } } };
        };
        const got = (await chrome.storage.local.get('settings')).settings as Record<string, unknown> | undefined;
        return got?.[k];
      }, key);
    await expect.poll(stored).toBe(on);
  };
  await set('setting-assisted', 'assistedInsert', sw.assisted);
  await set('setting-rehearsal', 'rehearsal', sw.rehearsal);
  await gotoRoute(page, '#/');
  await expect(page.getByTestId('editor-post-desktop')).toBeVisible();
}

/** Switches the editor's hash route in place (the page, its port and its state stay). */
export async function gotoRoute(page: Page, hash: '#/' | '#/settings'): Promise<void> {
  await page.goto(`${page.url().replace(/#.*$/, '')}${hash}`);
}

/** The H0/H1 instruction line in the hand-off panel. */
export const instruction = (page: Page): Locator => page.locator('.handoff .instruction');

/** "Cancel hand-off" in the panel. */
export async function cancelHandoff(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cancel hand-off' }).click();
}

/** Loads `path` as the frame's photo and waits until the stage shows it. */
export async function loadPhoto(page: Page, path: string): Promise<void> {
  await page.getByTestId('editor-file-input').setInputFiles(path);
  await expect(page.getByTestId('editor-stage')).not.toHaveAttribute('data-asset-id', '');
}

export const phaseLocator = (page: Page): Locator => page.getByTestId('handoff-phase');

/** Waits until the hand-off panel shows `phase`. */
export async function waitPhase(page: Page, phase: HandoffPhase, timeout = 30_000): Promise<void> {
  await expect(phaseLocator(page)).toHaveAttribute('data-phase', phase, { timeout });
}

/** Waits until the phase timeline has passed through `phase` (it may have moved on already). */
export async function waitSeen(page: Page, phase: HandoffPhase, timeout = 30_000): Promise<void> {
  await expect(page.locator(`.timeline li[data-phase="${phase}"]`)).toHaveCount(1, { timeout });
}

/** "Post from desktop": exports the PNG, downloads it and starts the hand-off. Returns the export id. */
export async function postFromDesktop(page: Page): Promise<string> {
  const panel = page.locator('.panel');
  const before = await panel.getAttribute('data-export-id');
  await page.getByTestId('editor-post-desktop').click();
  await expect(panel).not.toHaveAttribute('data-export-id', before ?? '', { timeout: 30_000 });
  const id = await panel.getAttribute('data-export-id');
  if (!id) throw new Error('post from desktop produced no export id');
  return id;
}

/** Answers the panel's "Posted?" question. */
export async function answerPosted(page: Page, posted: boolean): Promise<void> {
  await page.getByRole('button', { name: posted ? 'Yes, posted' : 'Not posted' }).click();
}

/** The error code the panel shows, or null. */
export async function shownError(page: Page): Promise<ErrorCode | null> {
  const box = page.getByTestId('handoff-error');
  if ((await box.count()) === 0) return null;
  return (await box.getAttribute('data-error')) as ErrorCode | null;
}
