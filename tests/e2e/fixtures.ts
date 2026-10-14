/**
 * E2E fixtures (strategy §7.9, §11 AM1/AM4/AM5). Every test gets a fresh, sealed, persistent
 * Chromium profile with one unpacked artifact loaded, and the fake reset to its baseline knobs.
 *
 * - **Launch:** `launchPersistentContext(<fresh temp dir>)` with `sealedPlaywrightArgs(spki, dir,
 *   {headless})` after `assertSealed()`. Headless by default (AM1, spike S8), with the emulated
 *   owner screen; `viewport: null` always (a Playwright viewport turns popups landscape).
 * - **Identity:** the extension service worker must appear within 10 s (a refused extension is
 *   silent, S10); its ID must equal the key-derived ID and its manifest name the artifact's mode.
 * - **Exposes:** `extension` (id, mode, service worker), `editor()`, `composer()`, `fake`,
 *   `human`, `exportBytes(id)`, `handoffRecords()`, `downloadsSearch()`, `sessionRules()`,
 *   `handoffState()`, `storedSettings()`, `localKeys()`, `clearRateLog()`, `ageRateLog(ms)` and
 *   `seed(opts)` (all in the service worker), and `tripwire`.
 * - **Seeded by default** (ux.md §4.2, OD10, OD11): before the test body, storage.local says the setup
 *   test passed, the expected account is the fake's (`fake_owner`), the onboarding card was dismissed and,
 *   in guarded builds, the human-pace dwell is off (`__e2eDwellScale: 0`; live builds compile the hook
 *   out and keep their real dwell). A test that needs a fresh install uses `test.use({ seeded: false })`
 *   or calls `seed()` itself.
 * - **`clearRateLog()`** empties the rate guard's open log in storage.local. Only the specs that
 *   need a second composer open within 60 s in one test call it (E9, E12 d/l/m, E15); E14 proves
 *   the guard itself. It never touches the guard's code or caps.
 * - **Auto invariants after every test:** no request to a host outside the sealed set, whether it
 *   failed or not (§7.9 invariant 1; a test that goes outside on purpose declares it first with
 *   `tripwire.expectOutside`, AM26); no request the extension itself made to a web host (SG11:
 *   its service worker or its pages; E8/E9's canary writes are declared with
 *   `tripwire.expectFromExtension`); no fake violation; no fake request with an
 *   `Origin: chrome-extension://` header (SG11); in the mock project, no write reached the fake. A
 *   test that provokes a violation on purpose (E11) opts out of that one check with
 *   `invariants.allowViolations()`; `invariants.check()` runs the same checks on demand and throws
 *   (E11's meta-test). AM37: every composer the fake showed a photo in showed Share, never the rotate
 *   snackbar (the emulated screen is landscape, so this proves the portrait shim in every spec that
 *   reaches the composer); E28 (b) and (e) opt out with `invariants.allowLandscapeComposer()`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { type BrowserContext, test as base, chromium, expect, type Page, type Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';
import type { HandoffRecord, HandoffState, MenuFingerprint, Settings } from '../../src/core/handoff/state.ts';
import type { DnrRule } from '../../src/core/ig-contract/rules.ts';
import { extIdForMode } from '../../tools/chrome/ext-id.ts';
import { assertSealed, type HeadlessScreens, readSpki, sealedPlaywrightArgs } from '../../tools/chrome/flags.ts';
import { DEFAULT_KNOBS, FAKE_ACCOUNT } from '../../tools/fake-ig/knobs.ts';
import { type ArtifactMode, artifactMode, MANIFEST_NAMES } from './helpers/artifacts.ts';
import { createFakeClient, type FakeClient } from './helpers/fake-client.ts';
import { type Human, human } from './helpers/human.ts';

export type { ArtifactMode };
export { expect };

/** Per-project options (playwright.config.ts). */
export interface E2eOptions {
  artifact: string;
  executablePath: string | undefined;
}

/** Per-test options. */
export interface E2eTestOptions {
  /**
   * Install the fake's `desktopShell` service worker before the test, as everyday browsing installs
   * Instagram's own in the owner's profile (FID-1). On by default exactly when the baseline says the
   * first composer load is SW-served (DEFAULT_KNOBS.sw), so a baseline update changes the E2E
   * conditions, not only the knob. Since F2 (2026-10-12) the default worker (`claimOnRegister`) is
   * registered by every fake page itself, so this is off by default.
   */
  preinstallFakeSw: boolean;
  /**
   * The emulated screens of a headless run: the owner's MacBook (`owner`, S8) or, as on the first live
   * run, the MacBook plus the ultrawide at (1512,-428) (`ownerDual`, S11, AM29).
   */
  screens: HeadlessScreens;
  /** Seed storage.local as an install that passed its setup test (see the header). Default true. */
  seeded: boolean;
}

/** What `seed()` writes in storage.local (the header lists the defaults). */
export interface SeedOptions {
  /** `expectedAccount`; null removes it (a post then asks first, §4.8). */
  account?: string | null;
  /** `lastTestPassAt` (OD10); false removes it (K6: the setup test first). */
  testPassed?: boolean;
  /** `settings.onboardedAt`; false shows the onboarding card. */
  onboarded?: boolean;
  /** Guarded builds: `__e2eDwellScale` (0 = no dwell); null removes it (the real dwell). */
  dwellScale?: number | null;
  /** `menuFingerprint` (C10); null removes it; undefined leaves it alone. */
  fingerprint?: MenuFingerprint | null;
  /** `settings.accountLock` (OD11); undefined leaves it alone. */
  accountLock?: boolean;
}

export const IG_ORIGIN = 'https://www.instagram.com';
/** Hosts a sealed browser may reach (resolver allow-list plus the EXCLUDEs). */
export const SEALED_HOSTS: readonly string[] = ['www.instagram.com', 'i.instagram.com', 'localhost', '127.0.0.1'];

export interface Extension {
  id: string;
  mode: ArtifactMode;
  /** The extension's background service worker. */
  sw: Worker;
  /** Lines the service worker logged, for failure attachments. */
  logs: string[];
}

export interface DownloadItem {
  id: number;
  filename: string;
  state: string;
  bytesReceived: number;
  totalBytes: number;
  fileSize: number;
  mime: string;
}

export interface Tripwire {
  /**
   * Undeclared requests: to a host outside SEALED_HOSTS (failed or not, ERR_NAME_NOT_RESOLVED
   * included), or made by the extension itself (its service worker or pages) to any web URL.
   */
  leaks(): string[];
  /** Every URL requested so far (any host), in order. */
  urls(): string[];
  /** This test requests matching URLs outside the sealed hosts on purpose (E1's probes, off-host knobs). */
  expectOutside(pattern: string | RegExp): void;
  /** This test makes the extension itself request matching URLs on purpose (E8/E9's canary writes). */
  expectFromExtension(pattern: string | RegExp): void;
}

export interface Invariants {
  /** This test provokes a fake violation on purpose (E11): skip that check from now on. */
  allowViolations(): void;
  /**
   * AM37: this test makes the composer show its landscape gate on purpose (the portrait shim switched
   * off, E28 b): skip the "every composer showed Share" check from now on.
   */
  allowLandscapeComposer(): void;
  /** Runs every invariant now; rejects with the list of problems (the teardown runs it too). */
  check(): Promise<void>;
}

interface Fixtures {
  spki: string;
  extension: Extension;
  /** Opens chrome-extension://<id>/editor.html#<hash> and waits until it is connected. */
  editor: (hash?: string) => Promise<Page>;
  /**
   * The newest page that navigated to www.instagram.com during the test (the composer popup),
   * waiting up to `timeout`. It may already be closed again (probe mode is quick).
   */
  composer: (opts?: { timeout?: number; not?: readonly Page[] }) => Promise<Page>;
  fake: FakeClient;
  human: Human;
  /** An ExportRecord's bytes, read from IndexedDB in the service worker. */
  exportBytes: (exportId: string) => Promise<Buffer>;
  /** Every Handoff record in IndexedDB (`handoffs`), oldest first. */
  handoffRecords: () => Promise<HandoffRecord[]>;
  downloadsSearch: () => Promise<DownloadItem[]>;
  sessionRules: () => Promise<DnrRule[]>;
  /** The hand-off state the background persisted in storage.session (undefined before the first one). */
  handoffState: () => Promise<HandoffState | undefined>;
  /**
   * The settings in storage.local with the kill-switch lock (`msiteLock`, AM25) merged in as
   * `msiteLockedUntil`; undefined until the editor or the background wrote either.
   */
  storedSettings: () => Promise<Partial<Settings> | undefined>;
  /** Empties the rate guard's open log (storage.local `rateLog`). See the header. */
  clearRateLog: () => Promise<void>;
  /**
   * Moves every open in the rate guard's log `ms` into the past, so the 60 s spacing ends sooner (E39's
   * queue waits seconds, not a minute). Like clearRateLog, it never touches the guard's code or caps.
   */
  ageRateLog: (ms: number) => Promise<void>;
  /** Writes the seed (see SeedOptions); the auto fixture already wrote the defaults when `seeded`. */
  seed: (opts?: SeedOptions) => Promise<void>;
  /** storage.local values by key (the background-owned keys: expectedAccount, lastTestPassAt, menuFingerprint, lastResult, …). */
  localKeys: (keys: string[]) => Promise<Record<string, unknown>>;
  tripwire: Tripwire;
  invariants: Invariants;
}

/**
 * The extension APIs inside `sw.evaluate(fn)`. `fn` runs in the service worker, where `chrome`
 * is a global; tests read it as `(globalThis as ExtGlobal).chrome` so no global `chrome` type
 * leaks into the project's type check.
 */
export type ExtGlobal = typeof globalThis & { chrome: WxtBrowser };

/** Resolves when `page` is closed (at once if it already is). */
export function whenClosed(page: Page): Promise<void> {
  return page.isClosed() ? Promise.resolve() : new Promise((resolve) => page.once('close', () => resolve()));
}

/**
 * The auto invariants (§7.9): no request left the sealed hosts; no fake violation (unless
 * allowed); no fake request or write carried `Origin: chrome-extension://…` (SG11); in mock, no
 * write reached the fake. Throws one error listing every problem.
 */
export async function checkInvariants(o: {
  fake: FakeClient;
  tripwire: Tripwire;
  mode: ArtifactMode;
  violationsAllowed: boolean;
  /** AM37: this test shows the composer's landscape gate on purpose (E28 b, the shim switched off). */
  landscapeAllowed?: boolean;
}): Promise<void> {
  const { fake, tripwire } = o;
  const problems: string[] = [];
  // AM37: the E2E screen is landscape (HEADLESS_SCREEN_ARGS), so every composer that showed a photo
  // proves the portrait shim worked: it showed Share, not the rotate snackbar.
  if (!o.landscapeAllowed) {
    const blocked = (await fake.composerViews()).filter((v) => v.landscape);
    if (blocked.length > 0) {
      problems.push(
        `the composer showed its rotate snackbar and no Share (the portrait shim did not take effect): ${JSON.stringify(blocked)}`,
      );
    }
    // And every story was shared from a page that read a portrait screen (the shim's, here).
    const landscapeShares = (await fake.stories()).filter((s) => s.meta?.screenOrientation?.startsWith('landscape'));
    if (landscapeShares.length > 0) {
      problems.push(
        `stories shared while the page read a landscape screen: ${landscapeShares.map((s) => s.id).join(', ')}`,
      );
    }
  }
  // IF9: the menu's Post item (the autopilot's one trial without a fingerprint) at most once per page load.
  const posts = new Map<string, number>();
  for (const l of await fake.log()) {
    if (l.step === 'post_session_started') posts.set(l.doc, (posts.get(l.doc) ?? 0) + 1);
  }
  const repeated = [...posts].filter(([, n]) => n > 1);
  if (repeated.length > 0) problems.push(`more than one post session in one page: ${JSON.stringify(repeated)}`);
  const leaks = tripwire.leaks();
  if (leaks.length > 0)
    problems.push(`undeclared requests outside the seal or from the extension: ${leaks.join(', ')}`);
  if (!o.violationsAllowed) {
    const violations = await fake.violations();
    if (violations.length > 0) problems.push(`fake violations: ${JSON.stringify(violations)}`);
  }
  const fromExtension = (await fake.requests()).filter((r) => (r.origin ?? '').startsWith('chrome-extension://'));
  const writes = await fake.writes();
  const writesFromExtension = writes.filter((w) => (w.origin ?? '').startsWith('chrome-extension://'));
  if (fromExtension.length + writesFromExtension.length > 0) {
    const paths = [...fromExtension, ...writesFromExtension].map((r) => `${r.method} ${r.host}${r.path}`);
    problems.push(`the extension made its own requests to Instagram hosts: ${paths.join(', ')}`);
  }
  if (o.mode === 'mock' && writes.length > 0) {
    problems.push(`writes reached the fake in the mock build: ${writes.map((w) => w.path).join(', ')}`);
  }
  if (problems.length > 0) throw new Error(`e2e invariants failed:\n- ${problems.join('\n- ')}`);
}

/**
 * Installs the fake's desktop-shell service worker in this profile (FID-1): sets `sw=desktopShell`,
 * loads `/` in a normal tab until the worker is ready, closes the tab. The knob stays set.
 */
export async function installFakeSw(context: BrowserContext, fake: FakeClient): Promise<void> {
  await fake.setKnobs({ sw: 'desktopShell' });
  const visit = await context.newPage();
  await visit.goto(`${IG_ORIGIN}/`);
  await visit.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await visit.close();
}

export const test = base.extend<
  Fixtures & E2eTestOptions & { _autoInvariants: undefined; _preinstalledSw: undefined; _seeded: undefined },
  E2eOptions
>({
  artifact: ['.output/chrome-mv3-mock', { option: true, scope: 'worker' }],
  executablePath: [undefined, { option: true, scope: 'worker' }],
  preinstallFakeSw: [DEFAULT_KNOBS.sw === 'desktopShell', { option: true }],
  screens: ['owner', { option: true }],
  seeded: [true, { option: true }],

  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures take a destructured first argument
  spki: async ({}, use) => {
    const spki = readSpki();
    if (!spki) throw new Error('e2e: no valid fake certificate (pnpm run fake:cert)');
    await use(spki);
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures take a destructured first argument
  fake: async ({}, use) => {
    const fake = createFakeClient();
    await fake.reset();
    await use(fake);
  },

  context: async ({ artifact, executablePath, headless, spki, fake, screens }, use) => {
    void fake; // reset before the browser starts
    const extDir = resolve(artifact);
    const args = sealedPlaywrightArgs(spki, extDir, { headless, screens });
    assertSealed(args);
    const userDataDir = await mkdtemp(join(tmpdir(), 'instapost-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless,
      viewport: null,
      acceptDownloads: true,
      args,
    });
    try {
      await use(context);
    } finally {
      await context.close().catch(() => undefined);
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },

  tripwire: async ({ context, artifact }, use) => {
    // Who made each request: the extension's own service worker or pages, or anything else.
    const seen: { url: string; initiator: string }[] = [];
    context.on('request', (req) => {
      let initiator = req.serviceWorker()?.url() ?? '';
      if (!initiator) {
        try {
          initiator = req.frame().url();
        } catch {
          initiator = '';
        }
      }
      seen.push({ url: req.url(), initiator });
    });
    // Our own pages only: the key-derived id (the extension fixture asserts the loaded one equals it).
    const extId = extIdForMode(artifactMode(artifact));
    const parse = (raw: string): URL | null => {
      try {
        return new URL(raw);
      } catch {
        return null;
      }
    };
    const local = (u: URL | null): boolean =>
      u !== null &&
      (u.protocol === 'data:' ||
        u.protocol === 'blob:' ||
        u.protocol === 'about:' ||
        (u.protocol === 'chrome-extension:' && u.host === extId));
    const outside: (string | RegExp)[] = [];
    const fromExtension: (string | RegExp)[] = [];
    const matches = (list: (string | RegExp)[], url: string) =>
      list.some((p) => (typeof p === 'string' ? url === p || url.startsWith(p) : p.test(url)));
    await use({
      leaks: () => {
        const out: string[] = [];
        for (const r of seen) {
          const u = parse(r.url);
          if (local(u)) continue;
          if (!SEALED_HOSTS.includes(u?.hostname ?? '') && !matches(outside, r.url)) out.push(`outside: ${r.url}`);
          if (r.initiator.startsWith(`chrome-extension://${extId}/`) && !matches(fromExtension, r.url)) {
            out.push(`from the extension (${r.initiator}): ${r.url}`);
          }
        }
        return out;
      },
      urls: () => seen.map((r) => r.url),
      expectOutside: (p) => void outside.push(p),
      expectFromExtension: (p) => void fromExtension.push(p),
    });
  },

  extension: async ({ context, artifact }, use, testInfo) => {
    const mode = artifactMode(artifact);
    const isExt = (w: Worker) => w.url().startsWith('chrome-extension://');
    const sw =
      context.serviceWorkers().find(isExt) ??
      (await context.waitForEvent('serviceworker', { predicate: isExt, timeout: 10_000 }));
    const id = new URL(sw.url()).host;
    const logs: string[] = [];
    sw.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    expect(id, 'extension id must equal the key-derived id').toBe(extIdForMode(mode));
    const name = await sw.evaluate(() => (globalThis as ExtGlobal).chrome.runtime.getManifest().name);
    expect(name, 'manifest name must match the artifact mode').toBe(MANIFEST_NAMES[mode]);
    await use({ id, mode, sw, logs });
    if (testInfo.status !== testInfo.expectedStatus && logs.length > 0) {
      await testInfo.attach('extension-sw.log', { body: logs.join('\n'), contentType: 'text/plain' });
    }
  },

  editor: async ({ context, extension }, use, testInfo) => {
    const opened: Page[] = [];
    await use(async (hash = '') => {
      const page = await context.newPage();
      opened.push(page);
      await page.goto(`chrome-extension://${extension.id}/editor.html${hash ? `#${hash.replace(/^#/, '')}` : ''}`);
      // The hand-off port is up (the background pushed its first lane and status).
      await expect(page.locator('.app')).toHaveAttribute('data-connected', 'true');
      return page;
    });
    if (testInfo.status === testInfo.expectedStatus) return;
    for (const [i, page] of opened.entries()) {
      if (page.isClosed()) continue;
      const text = await page
        .locator('.app')
        .innerText({ timeout: 2000 })
        .catch((err: Error) => `(unreadable: ${err.message})`);
      await testInfo.attach(`editor-${i}.txt`, { body: text, contentType: 'text/plain' });
    }
  },

  composer: async ({ context }, use) => {
    // Event-driven: a probe-mode popup can open, navigate and close between two polls.
    const igPages: Page[] = [];
    const watch = (p: Page): void => {
      const check = () => {
        if (p.url().startsWith(`${IG_ORIGIN}/`) && !igPages.includes(p)) igPages.push(p);
      };
      p.on('framenavigated', (f) => {
        if (f === p.mainFrame()) check();
      });
      check();
    };
    for (const p of context.pages()) watch(p);
    context.on('page', watch);
    await use(async ({ timeout = 20_000, not = [] } = {}) => {
      const deadline = Date.now() + timeout;
      for (;;) {
        const hit = igPages.filter((p) => !not.includes(p)).at(-1);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`e2e: no composer page within ${timeout} ms`);
        await new Promise((r) => setTimeout(r, 50));
      }
    });
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures take a destructured first argument
  human: async ({}, use) => {
    await use(human);
  },

  exportBytes: async ({ extension }, use) => {
    await use(async (exportId) => {
      const b64 = await extension.sw.evaluate(async (id) => {
        const db = await new Promise<IDBDatabase>((ok, fail) => {
          const req = indexedDB.open('instapost');
          // Never create the database from here: that would skip the extension's own upgrade.
          req.onupgradeneeded = () => req.transaction?.abort();
          req.onsuccess = () => ok(req.result);
          req.onerror = () => fail(req.error ?? new Error('indexedDB.open failed'));
        });
        try {
          const rec = await new Promise<{ blob: Blob } | undefined>((ok, fail) => {
            const get = db.transaction('exports').objectStore('exports').get(id);
            get.onsuccess = () => ok(get.result as { blob: Blob } | undefined);
            get.onerror = () => fail(get.error);
          });
          if (!rec) return null;
          const u8 = new Uint8Array(await rec.blob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
          return btoa(bin);
        } finally {
          db.close();
        }
      }, exportId);
      if (b64 === null) throw new Error(`e2e: export ${exportId} not found in IndexedDB`);
      return Buffer.from(b64, 'base64');
    });
  },

  handoffRecords: async ({ extension }, use) => {
    await use(async () => {
      const records = await extension.sw.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((ok, fail) => {
          const req = indexedDB.open('instapost');
          req.onupgradeneeded = () => req.transaction?.abort();
          req.onsuccess = () => ok(req.result);
          req.onerror = () => fail(req.error ?? new Error('indexedDB.open failed'));
        });
        try {
          return await new Promise<unknown[]>((ok, fail) => {
            const all = db.transaction('handoffs').objectStore('handoffs').getAll();
            all.onsuccess = () => ok(all.result);
            all.onerror = () => fail(all.error);
          });
        } finally {
          db.close();
        }
      });
      return (records as HandoffRecord[]).sort((a, b) => a.startedAt - b.startedAt);
    });
  },

  downloadsSearch: async ({ extension }, use) => {
    await use(() =>
      extension.sw.evaluate(async () =>
        (await (globalThis as ExtGlobal).chrome.downloads.search({})).map((d) => ({
          id: d.id,
          filename: d.filename,
          state: d.state,
          bytesReceived: d.bytesReceived,
          totalBytes: d.totalBytes,
          fileSize: d.fileSize,
          mime: d.mime,
        })),
      ),
    );
  },

  sessionRules: async ({ extension }, use) => {
    await use(
      async () =>
        (await extension.sw.evaluate(() =>
          (globalThis as ExtGlobal).chrome.declarativeNetRequest.getSessionRules(),
        )) as unknown as DnrRule[],
    );
  },

  handoffState: async ({ extension }, use) => {
    await use(
      async () =>
        (await extension.sw.evaluate(async () => {
          const got = await (globalThis as ExtGlobal).chrome.storage.session.get('handoff');
          return got.handoff;
        })) as HandoffState | undefined,
    );
  },

  storedSettings: async ({ extension }, use) => {
    await use(
      async () =>
        (await extension.sw.evaluate(async () => {
          // The kill-switch lock has its own key since AM25 (only the background writes it).
          const got = await (globalThis as ExtGlobal).chrome.storage.local.get(['settings', 'msiteLock']);
          const settings = got.settings as Record<string, unknown> | undefined;
          if (settings === undefined && got.msiteLock === undefined) return undefined;
          const lock = (got.msiteLock as number | null | undefined) ?? settings?.msiteLockedUntil ?? null;
          return { ...settings, msiteLockedUntil: lock };
        })) as Partial<Settings> | undefined,
    );
  },

  clearRateLog: async ({ extension }, use) => {
    await use(() => extension.sw.evaluate(() => (globalThis as ExtGlobal).chrome.storage.local.remove('rateLog')));
  },

  ageRateLog: async ({ extension }, use) => {
    await use((ms) =>
      extension.sw.evaluate(async (by) => {
        const { chrome } = globalThis as ExtGlobal;
        const log = (await chrome.storage.local.get('rateLog')).rateLog as number[] | undefined;
        await chrome.storage.local.set({ rateLog: (log ?? []).map((t) => t - by) });
      }, ms),
    );
  },

  seed: async ({ extension }, use) => {
    await use((opts = {}) =>
      extension.sw.evaluate(
        async ([o, fallback]) => {
          const { chrome } = globalThis as ExtGlobal;
          const now = Date.now();
          const account = o.account === undefined ? fallback : o.account;
          if (account === null) await chrome.storage.local.remove('expectedAccount');
          else await chrome.storage.local.set({ expectedAccount: { handle: account, detectedAt: now } });
          if (o.testPassed === false) await chrome.storage.local.remove('lastTestPassAt');
          else await chrome.storage.local.set({ lastTestPassAt: now });
          const dwell = o.dwellScale === undefined ? 0 : o.dwellScale;
          if (dwell === null) await chrome.storage.local.remove('__e2eDwellScale');
          else await chrome.storage.local.set({ __e2eDwellScale: dwell });
          if (o.fingerprint === null) await chrome.storage.local.remove('menuFingerprint');
          else if (o.fingerprint !== undefined) await chrome.storage.local.set({ menuFingerprint: o.fingerprint });
          const settings = ((await chrome.storage.local.get('settings')).settings ?? {}) as Record<string, unknown>;
          await chrome.storage.local.set({
            settings: {
              ...settings,
              onboardedAt: o.onboarded === false ? null : now,
              ...(o.accountLock === undefined ? {} : { accountLock: o.accountLock }),
            },
          });
        },
        [opts, FAKE_ACCOUNT] as const,
      ),
    );
  },

  localKeys: async ({ extension }, use) => {
    await use(
      async (keys) =>
        (await extension.sw.evaluate((k) => (globalThis as ExtGlobal).chrome.storage.local.get(k), keys)) as Record<
          string,
          unknown
        >,
    );
  },

  invariants: async ({ fake, tripwire, extension }, use) => {
    let violationsAllowed = false;
    let landscapeAllowed = false;
    const check = () => checkInvariants({ fake, tripwire, mode: extension.mode, violationsAllowed, landscapeAllowed });
    await use({
      allowViolations: () => {
        violationsAllowed = true;
      },
      allowLandscapeComposer: () => {
        landscapeAllowed = true;
      },
      check,
    });
    // Let in-flight requests settle (a NOTFOUND failure arrives within a few ms).
    await new Promise((r) => setTimeout(r, 250));
    await check();
  },

  _autoInvariants: [
    async ({ invariants }, use) => {
      void invariants;
      await use(undefined);
    },
    { auto: true },
  ],

  _seeded: [
    async ({ seeded, seed }, use) => {
      if (seeded) await seed();
      await use(undefined);
    },
    { auto: true },
  ],

  _preinstalledSw: [
    async ({ context, fake, preinstallFakeSw }, use) => {
      if (preinstallFakeSw) await installFakeSw(context, fake);
      await use(undefined);
    },
    { auto: true },
  ],
});
