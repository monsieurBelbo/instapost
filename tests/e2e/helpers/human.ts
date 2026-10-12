/**
 * Playwright playing the owner inside the fake composer (strategy §7.9 `human`). These are the
 * only places that use the fake's `data-testid` hooks; the extension never may (T3).
 *
 * - Taps and Share are real `locator.click()`s, so the fake records `isTrusted: true` (SG6).
 * - Files are picked **by path**: Playwright then sets them through CDP and the page sees trusted
 *   `input`/`change` events. An in-memory `{name, mimeType, buffer}` payload fires untrusted ones,
 *   which `trusted=require` ignores (tools/fake-ig/README.md).
 * - `dropFile` is the exception: Playwright cannot drag a file from the OS, so it dispatches a
 *   `drop` carrying a DataTransfer, which the page sees as untrusted. Use it only for
 *   `listen=drop` with the default `trusted=ignore`.
 */
import type { Page } from '@playwright/test';

export interface Human {
  /** + → Story (the composer then opens the file chooser once the story input is mounted). */
  tapCreateStory(page: Page): Promise<void>;
  /** + → Story, then pick `path` in the file chooser it opens. */
  pickViaStory(page: Page, path: string): Promise<void>;
  /** Picks `path` on the story input directly (it must be mounted). */
  pickFile(page: Page, path: string): Promise<void>;
  /** Taps Share once the composer canvas is ready. */
  share(page: Page): Promise<void>;
  /** Taps Save. */
  save(page: Page): Promise<void>;
  /** Drops `bytes` as a file on the composer (untrusted; see the header). */
  dropFile(page: Page, bytes: Buffer, name: string, mime: string): Promise<void>;
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
  async pickFile(page, path) {
    await tid(page, 'fake-story-input').setInputFiles(path);
  },
  async share(page) {
    await tid(page, 'fake-composer-canvas').waitFor({ state: 'visible' });
    await tid(page, 'fake-share').click();
  },
  async save(page) {
    await tid(page, 'fake-save').click();
  },
  async dropFile(page, bytes, name, mime) {
    const dataTransfer = await page.evaluateHandle(
      ([b64, fileName, type]) => {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        dt.items.add(new File([u8], fileName, { type }));
        return dt;
      },
      [bytes.toString('base64'), name, mime] as const,
    );
    await tid(page, 'fake-composer').dispatchEvent('drop', { dataTransfer });
  },
};
