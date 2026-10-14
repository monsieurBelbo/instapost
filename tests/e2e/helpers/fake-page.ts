/**
 * Test-side reads of the fake composer page (strategy §7.6 "test hooks"): the geometry ground
 * truth and a counter of the synthetic file events the page received. Main world only, through
 * Playwright; the extension's isolated-world agent never sees any of this.
 *
 * **User activation.** Playwright's `page.evaluate` (and every locator action, which evaluates its injected
 * script the same way) runs with `userGesture: true`, so it gives the page transient user activation for
 * about 5 s. Before the autopilot's Share that is the owner clicking in the window (R22): the agent waits
 * for it to lapse, or stops with WINDOW_IN_USE. `quietEvaluate()` reads the page through CDP
 * `Runtime.evaluate` without a gesture, so a spec can look at the window mid-run without touching the run.
 */
import type { BrowserContext, Page } from '@playwright/test';
import type { FakeGeometry } from '../../../tools/fake-ig/protocol.ts';

export type { FakeGeometry };

/**
 * Evaluates `fn` (no arguments, no closures) in the page's main world without user activation. Returns its
 * (JSON) value; rejects with the page's exception.
 */
export async function quietEvaluate<T>(page: Page, fn: () => T | Promise<T>): Promise<T> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(${fn.toString()})()`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: false,
    });
    if (r.exceptionDetails) {
      throw new Error(`quietEvaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result.value as T;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** Polls `fn` quietly (no user activation) until it returns true, or rejects after `timeout` ms. */
export async function quietWaitFor(page: Page, fn: () => boolean, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await quietEvaluate(page, fn).catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`quietWaitFor: still false after ${timeout} ms: ${fn.toString()}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

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

/**
 * Counts the file choosers that opened in every Instagram page of the context (R22: the autopilot's
 * taps carry no user activation, so Story's input.click() must never open one). Listening enables
 * Playwright's chooser interception; Chrome still refuses a chooser without activation before that point.
 */
export function countFileChoosers(context: BrowserContext): () => number {
  let n = 0;
  const watch = (p: Page) => {
    p.on('filechooser', () => {
      n++;
    });
  };
  for (const p of context.pages()) watch(p);
  context.on('page', watch);
  return () => n;
}

const COUNTER = '__e2eUntrustedFileChanges';

/**
 * Counts untrusted `change` events on file inputs in every Instagram document of the context
 * (the autopilot's insert is the only source; a human pick by path is trusted). Install before the
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

/**
 * Reads PageScreen in the page's main world, where Instagram's code runs. Quietly (no user activation),
 * so a spec may read it while the autopilot is still to tap.
 */
export function pageScreen(page: Page): Promise<PageScreen> {
  return quietEvaluate(page, () => {
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
