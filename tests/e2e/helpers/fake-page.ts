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

/** AM37: the screen orientation as the page's own scripts read it, and what the screen really is. */
export interface PageScreen {
  /** `screen.orientation.type` and `.angle` as Instagram reads them (after the portrait shim). */
  type: string | null;
  angle: number | null;
  /** The ScreenOrientation prototype's own getter: the emulated screen itself, whatever the shim did. */
  real: string | null;
  /** Own properties of the page's ScreenOrientation instance (the shim's two getters, or none). */
  own: string[];
  /** The prototype still has its native `type` getter (the shim never touches it). */
  nativeProto: boolean;
  /** What the shim leaves alone. */
  mqPortrait: boolean;
  screen: { w: number; h: number };
}

/** Reads PageScreen in the page's main world (Playwright evaluates there, as Instagram's code runs). */
export function pageScreen(page: Page): Promise<PageScreen> {
  return page.evaluate(() => {
    const o = screen.orientation as ScreenOrientation | undefined;
    const proto = Object.getOwnPropertyDescriptor(ScreenOrientation.prototype, 'type');
    return {
      type: o ? String(o.type) : null,
      angle: o ? Number(o.angle) : null,
      real: o && proto?.get ? String(proto.get.call(o)) : null,
      own: o ? Object.getOwnPropertyNames(o).sort() : [],
      nativeProto:
        typeof proto?.get === 'function' && /\[native code\]/.test(Function.prototype.toString.call(proto.get)),
      mqPortrait: matchMedia('(orientation: portrait)').matches,
      screen: { w: screen.width, h: screen.height },
    };
  });
}
