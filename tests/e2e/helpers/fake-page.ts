/**
 * Test-side reads of the fake composer page (strategy §7.6 "test hooks"): the geometry ground
 * truth and a counter of the synthetic file events the page received. Main world only, through
 * Playwright; the extension's isolated-world agent never sees any of this.
 */
import type { BrowserContext, Page } from '@playwright/test';
import type { FakeGeometry } from '../../../tools/fake-ig/protocol.ts';

export type { FakeGeometry };

/** `document.documentElement.dataset.fakeGeometry` while the composer canvas is mounted. */
export async function fakeGeometry(page: Page): Promise<FakeGeometry> {
  const raw = await page.evaluate(() => document.documentElement.dataset.fakeGeometry ?? null);
  if (raw === null) throw new Error('fake composer: no geometry ground truth (canvas not mounted)');
  return JSON.parse(raw) as FakeGeometry;
}

/** The composer's verdict on the last file event (`data-fake-input` on <html>). */
export function fakeInputOutcome(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.dataset.fakeInput ?? null);
}

const COUNTER = '__e2eUntrustedFileChanges';

/**
 * Counts untrusted `change` events on file inputs in every Instagram document of the context
 * (H1's synthetic insert is the only source; a human pick by path is trusted). Install before the
 * composer opens; read with untrustedFileChanges() while the document is alive.
 */
export async function countUntrustedFileChanges(context: BrowserContext): Promise<void> {
  await context.addInitScript((key: string) => {
    if (location.hostname !== 'www.instagram.com') return;
    const w = window as unknown as Record<string, number>;
    w[key] = 0;
    document.addEventListener(
      'change',
      (e) => {
        const t = e.target as HTMLInputElement | null;
        if (!e.isTrusted && t?.tagName === 'INPUT' && t.type === 'file') w[key] = (w[key] ?? 0) + 1;
      },
      true,
    );
  }, COUNTER);
}

export function untrustedFileChanges(page: Page): Promise<number> {
  return page.evaluate((key) => (window as unknown as Record<string, number>)[key] ?? -1, COUNTER);
}
