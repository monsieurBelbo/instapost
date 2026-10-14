/**
 * Playwright playing the owner inside the fake Instagram window (strategy §7.9 `human`; ux.md §4.9 Finish
 * by hand, IF12). These are the only places that use the fake's `data-testid` hooks; the extension never
 * may (T3).
 *
 * - Taps and Share are real `locator.click()`s, so the fake records `isTrusted: true` and the page gets
 *   user activation (the file chooser can open).
 * - Files are picked **by path** in the file chooser: Playwright sets them through CDP and the page sees
 *   trusted `input`/`change` events.
 */
import type { Page } from '@playwright/test';

export interface Human {
  /** + → Story (the story input's file chooser then opens, the click being trusted). */
  tapCreateStory(page: Page): Promise<void>;
  /** + → Story, then pick `path` in the file chooser it opens. */
  pickViaStory(page: Page, path: string): Promise<void>;
  /** Taps Share once the composer canvas is drawn. */
  share(page: Page): Promise<void>;
  /** Taps Save. */
  save(page: Page): Promise<void>;
  /** A click on the feed: the page gets user activation, nothing else happens. */
  touch(page: Page): Promise<void>;
}

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);

export const human: Human = {
  async tapCreateStory(page) {
    await tid(page, 'fake-create').click();
    await tid(page, 'fake-create-story').click();
  },
  async pickViaStory(page, path) {
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await human.tapCreateStory(page);
    await (await chooser).setFiles(path);
  },
  async share(page) {
    await tid(page, 'fake-composer-canvas').waitFor({ state: 'visible' });
    await tid(page, 'fake-share').click();
  },
  async save(page) {
    await tid(page, 'fake-save').click();
  },
  async touch(page) {
    await page
      .locator('article')
      .first()
      .click({ position: { x: 5, y: 40 } });
  },
};
