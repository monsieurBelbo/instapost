/**
 * The owner's side of the in-page lane (strategy §11 AM46–AM48; inpage-ui-spec.md; docs/inpage.md §9.4) for
 * tests/e2e/inpage.spec.ts: desktop Instagram in a tab of a chosen size, instapost's host UI on it (the entry,
 * the coach, the composer iframe, the engine frame, the chip's badge: inside a closed shadow root, so read
 * through CDP's pierced DOM, never by a script in the page), the composer (an extension page framed in the
 * tab) and the run records.
 *
 * **User activation (R22, N5, AM42).** A Playwright action or evaluate in Instagram's top document runs with a
 * user gesture, and so does the hit-target check of a locator click inside the composer: both activate the
 * top document and, with it, the same-origin engine frame, which makes the autopilot wait (or stop with
 * PAGE_IN_USE). So while a run is in progress the specs only read: the background's records, the fake's
 * logs, the host's DOM over CDP, the composer and the engine frame through CDP `Runtime.evaluate` without a
 * gesture (`composerQuiet`, `engineQuiet`), and the owner's own input is raw CDP input (`page.mouse`,
 * `page.keyboard`) at coordinates read the same quiet way. Playwright locators drive the composer only before
 * a run starts and after it ended.
 */
import type { BrowserContext, CDPSession, Frame, Page } from '@playwright/test';
import { androidReducedUa, CH_REMOVE } from '../../../src/core/ig-contract/device-profile.ts';
import type { InpageRecord } from '../../../src/inpage/driver.ts';
import type { DevToggles } from '../../../src/inpage/messages.ts';
import { type Extension, type ExtGlobal, expect, IG_ORIGIN, test } from '../fixtures.ts';
import type { RequestRecord } from './fake-client.ts';
import { quietWaitFor } from './fake-page.ts';

export const ANDROID_UA = /\(Linux; Android 10; K\) .* Mobile Safari\/537\.36$/;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const centre = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

// ---- the tab ----------------------------------------------------------------------------------------------

/** Resizes the tab's window (CDP Browser.setWindowBounds; headless has no browser UI, so this is the viewport). */
export async function setWindowSize(page: Page, width: number, height: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number };
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width, height } });
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** A desktop Instagram tab, `w`×`h` (CSS px), its shell rendered. */
export async function openInstagram(
  context: BrowserContext,
  opts: { w?: number; h?: number; path?: string } = {},
): Promise<Page> {
  const page = await context.newPage();
  await setWindowSize(page, opts.w ?? 1280, opts.h ?? 860);
  await page.goto(`${IG_ORIGIN}${opts.path ?? '/'}`);
  await quietWaitFor(page, () => document.querySelector('[data-fake-layout="desktop"]') !== null, 15_000);
  return page;
}

// ---- instapost's host UI (closed shadow root, read over CDP) -------------------------------------------------

interface DomNode {
  nodeId: number;
  nodeType: number;
  nodeName: string;
  nodeValue?: string;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}

export interface HostEl {
  nodeId: number;
  attrs: Record<string, string>;
  classes: string[];
  /** Its text, descendants included. */
  text: string;
  /** Its border box (viewport CSS px), null when it has none. */
  box: Box | null;
}

export interface HostSnapshot {
  /** `.ip[data-scheme]`: the page's scheme as the content script read it. */
  scheme: string | null;
  /** `.ip[lang]`: the language of what it writes on the page. */
  lang: string | null;
  entry: HostEl | null;
  composer: HostEl | null;
  engine: HostEl | null;
  coach: HostEl | null;
  badge: HostEl | null;
}

const attrsOf = (n: DomNode): Record<string, string> => {
  const a = n.attributes ?? [];
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < a.length; i += 2) out[a[i] as string] = a[i + 1] as string;
  return out;
};

function textOf(n: DomNode): string {
  if (n.nodeType === 3) return n.nodeValue ?? '';
  return (n.children ?? []).map(textOf).join('');
}

/** instapost's shadow root: the closed one whose `.ip` wrapper holds the host UI. */
function hostRoot(n: DomNode): DomNode | null {
  for (const sr of n.shadowRoots ?? []) {
    if ((sr.children ?? []).some((c) => c.nodeName === 'DIV' && (attrsOf(c).class ?? '').split(' ').includes('ip'))) {
      return sr;
    }
  }
  for (const c of n.children ?? []) {
    const hit = hostRoot(c);
    if (hit) return hit;
  }
  return null;
}

function find(n: DomNode, pred: (n: DomNode) => boolean): DomNode | null {
  if (pred(n)) return n;
  for (const c of [...(n.shadowRoots ?? []), ...(n.children ?? [])]) {
    const hit = find(c, pred);
    if (hit) return hit;
  }
  return null;
}

const hasClass = (name: string, cls: string) => (n: DomNode) =>
  n.nodeName === name && (attrsOf(n).class ?? '').split(/\s+/).includes(cls);

async function boxOf(cdp: CDPSession, nodeId: number): Promise<Box | null> {
  const got = (await cdp.send('DOM.getBoxModel', { nodeId }).catch(() => null)) as {
    model: { border: number[] };
  } | null;
  if (!got) return null;
  const q = got.model.border;
  const xs = [q[0], q[2], q[4], q[6]] as number[];
  const ys = [q[1], q[3], q[5], q[7]] as number[];
  // Rounded to 0.1 px: a transformed box (the engine scaled into a slot) carries float noise.
  const r = (v: number) => Math.round(v * 10) / 10;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: r(x), y: r(y), w: r(Math.max(...xs) - x), h: r(Math.max(...ys) - y) };
}

async function hostEl(cdp: CDPSession, n: DomNode | null): Promise<HostEl | null> {
  if (!n) return null;
  const attrs = attrsOf(n);
  return {
    nodeId: n.nodeId,
    attrs,
    classes: (attrs.class ?? '').split(/\s+/).filter(Boolean),
    text: textOf(n),
    box: await boxOf(cdp, n.nodeId),
  };
}

/** The host UI now. Reads only (CDP DOM), no script in the page, no user activation. */
export async function hostSnapshot(page: Page, session?: CDPSession): Promise<HostSnapshot> {
  const cdp = session ?? (await page.context().newCDPSession(page));
  try {
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
    const sr = hostRoot(root);
    if (!sr) return { scheme: null, lang: null, entry: null, composer: null, engine: null, coach: null, badge: null };
    const ip = find(sr, hasClass('DIV', 'ip'));
    const ipAttrs = ip ? attrsOf(ip) : {};
    return {
      scheme: ipAttrs['data-scheme'] ?? null,
      lang: ipAttrs.lang ?? null,
      entry: await hostEl(cdp, find(sr, hasClass('BUTTON', 'entry'))),
      composer: await hostEl(cdp, find(sr, hasClass('IFRAME', 'composer'))),
      engine: await hostEl(cdp, find(sr, hasClass('DIV', 'engine'))),
      coach: await hostEl(cdp, find(sr, hasClass('DIV', 'coach'))),
      badge: await hostEl(cdp, find(sr, hasClass('SPAN', 'badge'))),
    };
  } finally {
    if (!session) await cdp.detach().catch(() => undefined);
  }
}

export const entryShown = (e: HostEl | null): e is HostEl & { box: Box } =>
  e !== null && !e.classes.includes('off') && e.box !== null && e.box.w > 0 && e.box.h > 0;

/** The entry's kind: a row, a tile, the corner button. */
export const entryKind = (e: HostEl): 'row' | 'tile' | 'corner' =>
  e.classes.includes('tile') ? 'tile' : e.classes.includes('corner') ? 'corner' : 'row';

/** Waits until the host shows the entry (placed after its anchor has been still 150 ms), and returns it. */
export async function waitEntry(page: Page, timeout = 10_000): Promise<HostEl & { box: Box }> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const e = (await hostSnapshot(page)).entry;
    if (entryShown(e)) return e;
    if (Date.now() > deadline) throw new Error(`no entry on the Instagram page: ${JSON.stringify(e)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** The composer iframe's mode as the host shows it (its class): open, chip, closed. */
export const composerMode = (s: HostSnapshot): string | null =>
  s.composer?.classes.find((c) => c === 'open' || c === 'chip' || c === 'closed') ?? null;

/**
 * Watches the entry from now until `stop()`: every change of its `class` attribute (CDP DOM events: a fade is
 * `off`), and its box and class sampled every 40 ms (inline-style moves reach CDP as `inlineStyleInvalidated`
 * without the value, so the geometry is sampled). One CDP session, one `DOM.getDocument`: the node id stays valid.
 */
export async function watchEntry(page: Page): Promise<{
  /** The entry when the watch began. */
  initial: { box: Box; classes: string[] };
  /** `class` values the entry took, in order. */
  classChanges: string[];
  /** Every distinct box the samples saw (JSON), in order of appearance. */
  boxes: () => Box[];
  /** Every distinct class list the samples saw. */
  classes: () => string[];
  stop: () => Promise<void>;
}> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  const snap = await hostSnapshot(page, cdp);
  if (!snap.entry?.box) throw new Error('watchEntry: no entry');
  const id = snap.entry.nodeId;
  const classChanges: string[] = [];
  cdp.on('DOM.attributeModified', (e: { nodeId: number; name: string; value: string }) => {
    if (e.nodeId === id && e.name === 'class') classChanges.push(e.value);
  });
  const boxes = new Set<string>([JSON.stringify(snap.entry.box)]);
  const classes = new Set<string>([snap.entry.classes.join(' ')]);
  let on = true;
  const loop = (async () => {
    while (on) {
      const box = await boxOf(cdp, id);
      const attrs = (await cdp.send('DOM.getAttributes', { nodeId: id }).catch(() => null)) as {
        attributes: string[];
      } | null;
      if (!on) break;
      if (box) boxes.add(JSON.stringify(box));
      if (attrs) {
        const a = attrs.attributes;
        const i = a.indexOf('class');
        classes.add(i >= 0 ? (a[i + 1] ?? '') : '');
      }
      await new Promise((r) => setTimeout(r, 40));
    }
  })();
  return {
    initial: { box: snap.entry.box, classes: snap.entry.classes },
    classChanges,
    boxes: () => [...boxes].map((b) => JSON.parse(b) as Box),
    classes: () => [...classes],
    stop: async () => {
      on = false;
      await loop.catch(() => undefined);
      await cdp.detach().catch(() => undefined);
    },
  };
}

// ---- the composer (an extension page framed in the tab) ------------------------------------------------------

export const composerFrame = (page: Page): Frame | undefined =>
  page.frames().find((f) => f.url().startsWith('chrome-extension://') && f.url().includes('/composer.html'));

export const engineFrame = (page: Page): Frame | undefined =>
  page.frames().find((f) => f.parentFrame() === page.mainFrame() && f.url().startsWith(`${IG_ORIGIN}/`));

/** Evaluates `fn` in the composer without user activation (CDP on its out-of-process frame). */
export async function composerQuiet<T>(page: Page, fn: () => T): Promise<T> {
  const frame = composerFrame(page);
  if (!frame) throw new Error('composerQuiet: no composer frame');
  const cdp = await page.context().newCDPSession(frame);
  try {
    const r = (await cdp.send('Runtime.evaluate', {
      expression: `(${fn.toString()})()`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: false,
    })) as { result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } };
    if (r.exceptionDetails) {
      throw new Error(`composerQuiet: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result.value;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** Polls `fn` in the composer quietly until it returns true. */
export async function composerWait(page: Page, fn: () => boolean, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await composerQuiet(page, fn).catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`composerWait: still false after ${timeout} ms: ${fn.toString()}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** A composer element's box in the tab's viewport (quiet: its rect in the composer plus the iframe's offset). */
export async function composerBox(page: Page, selector: string): Promise<Box> {
  const iframe = (await hostSnapshot(page)).composer?.box;
  if (!iframe) throw new Error('composerBox: no composer iframe');
  const frame = composerFrame(page);
  if (!frame) throw new Error('composerBox: no composer frame');
  const cdp = await page.context().newCDPSession(frame);
  try {
    const r = (await cdp.send('Runtime.evaluate', {
      expression: `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`,
      returnByValue: true,
      userGesture: false,
    })) as { result: { value: Box | null } };
    const b = r.result.value;
    if (!b) throw new Error(`composerBox: no ${selector} in the composer`);
    return { x: iframe.x + b.x, y: iframe.y + b.y, w: b.w, h: b.h };
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** The owner's real click on a composer element (raw input: no script evaluates in Instagram's page). */
export async function rawClickComposer(page: Page, selector: string): Promise<void> {
  const c = centre(await composerBox(page, selector));
  await page.mouse.click(c.x, c.y);
}

/** The owner clicks the entry (raw input); the composer opens, connected, its dialog shown. */
export async function openComposer(page: Page): Promise<Frame> {
  // A dialog still fading out ignores the entry (FC1): wait until it is closed (or a chip).
  await expect.poll(async () => composerMode(await hostSnapshot(page)) !== 'open').toBe(true);
  const e = await waitEntry(page);
  const c = centre(e.box);
  await page.mouse.move(c.x, c.y, { steps: 4 });
  await page.mouse.click(c.x, c.y);
  return waitComposerOpen(page);
}

/** Waits until the composer iframe is open and its dialog is shown (it only renders once its port is up). */
export async function waitComposerOpen(page: Page, timeout = 15_000): Promise<Frame> {
  const deadline = Date.now() + timeout;
  let last = 'no composer frame';
  for (;;) {
    const f = composerFrame(page);
    const host = await hostSnapshot(page);
    if (f && composerMode(host) === 'open') {
      // Shown, and laid out for the viewport it covers: the dialog inside it (the composer once kept the 0×0
      // size of its preload when the page opened it at once, and drew the dialog off screen).
      const state = await composerQuiet(page, () => {
        const d = document.querySelector('[data-testid="inpage-dialog"]');
        const box = d?.querySelector('.dialog')?.getBoundingClientRect();
        return {
          shown: d?.classList.contains('shown') === true,
          vw: innerWidth,
          vh: innerHeight,
          dialog: box ? { x: box.left, y: box.top, r: box.right, b: box.bottom } : null,
        };
      }).catch(() => null);
      last = JSON.stringify({ host: host.composer?.box, state });
      const b = host.composer?.box;
      const inside =
        state?.dialog != null &&
        b != null &&
        Math.abs(state.vw - b.w) <= 1 &&
        state.dialog.x >= 0 &&
        state.dialog.y >= 0 &&
        state.dialog.r <= state.vw + 1 &&
        state.dialog.b <= state.vh + 1;
      if (state?.shown && inside) return f;
    }
    if (Date.now() > deadline) throw new Error(`the composer did not open in the viewport: ${last}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Waits until the composer is the chip: the host sized it to the chip's slot, the composer draws the chip, and
 * its rise into place is over (two equal reads). Returns the chip's box.
 */
export async function waitChip(page: Page, timeout = 10_000): Promise<Box> {
  const deadline = Date.now() + timeout;
  let last = '';
  for (;;) {
    const s = await hostSnapshot(page);
    const drawn =
      composerMode(s) === 'chip' &&
      (await composerQuiet(page, () => document.querySelector('[data-testid="inpage-chip"]') !== null).catch(
        () => false,
      ));
    const key = drawn ? JSON.stringify(s.composer?.box) : '';
    if (drawn && key === last && s.composer?.box) return s.composer.box;
    last = key;
    if (Date.now() > deadline) throw new Error(`the composer did not become the chip: ${composerMode(s)}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** The dialog's view (import, edit, run, result), quietly; null when the dialog is not rendered. */
export const dialogView = (page: Page): Promise<string | null> =>
  composerQuiet(page, () => document.querySelector('[data-testid="inpage-dialog"]')?.getAttribute('data-view') ?? null);

/**
 * Loads `path` as the story's photo with Choose photo… (before a run): the edit view, then the Post card's
 * export rendered from it.
 */
export async function choosePhoto(page: Page, composer: Frame, path: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  await composer.getByTestId('import-choose').click();
  const c = await chooser;
  // The picker is the composer's own hidden input (created by the first Choose photo…).
  if (c) await c.setFiles(path);
  else await composer.locator('input[type="file"]').setInputFiles(path);
  await waitEdited(composer);
}

/** The photo is on the stage and its export rendered (the thumbnail is the exact upload, not stale). */
export async function waitEdited(composer: Frame, timeout = 30_000): Promise<void> {
  await expect(composer.getByTestId('inpage-dialog')).toHaveAttribute('data-view', 'edit', { timeout });
  await expect(composer.getByTestId('editor-stage')).toHaveAttribute('data-asset-id', /.+/, { timeout });
  await expect(composer.getByTestId('inpage-thumb')).toHaveAttribute('data-stale', 'false', { timeout });
}

/** ⋯ → Test run (before a run; Playwright clicks are fine until it starts). */
export async function startTestRun(composer: Frame): Promise<void> {
  await composer.locator('#more-btn').click();
  await composer.getByTestId('inpage-test').click();
}

/** ⋯ → Settings → Advanced. */
export async function openAdvanced(composer: Frame): Promise<void> {
  await composer.locator('#more-btn').click();
  await composer.getByTestId('inpage-menu-settings').click();
  const adv = composer.getByTestId('inpage-advanced');
  if ((await adv.getAttribute('open')) === null) await adv.locator('summary').click();
}

/** Settings → Advanced → Check connection → Run. */
export async function startCheck(composer: Frame): Promise<void> {
  await openAdvanced(composer);
  await composer.getByTestId('inpage-check').click();
}

/** Settings → Advanced → Share test → Run… → the inline confirmation. */
export async function startShareTest(composer: Frame): Promise<void> {
  await openAdvanced(composer);
  await composer.getByTestId('inpage-share-confirm').click();
  await composer.getByTestId('inpage-share').click();
}

// ---- runs ----------------------------------------------------------------------------------------------------

export async function records(extension: Extension): Promise<InpageRecord[]> {
  return (await extension.sw.evaluate(async () => {
    const got = await (globalThis as ExtGlobal).chrome.storage.local.get('inpageRecords');
    return got.inpageRecords ?? [];
  })) as InpageRecord[];
}

/** Waits for the n-th (1-based) run record, i.e. the end of that run, and attaches it. */
export async function waitRecord(extension: Extension, n = 1, timeout = 60_000): Promise<InpageRecord> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const r = (await records(extension))[n - 1];
    if (r) {
      await test
        .info()
        .attach(`inpage-record-${n}.json`, { body: JSON.stringify(r, null, 2), contentType: 'application/json' });
      return r;
    }
    if (Date.now() > deadline) throw new Error(`no in-page record #${n} within ${timeout} ms`);
    await new Promise((res) => setTimeout(res, 250));
  }
}

/** Guarded builds only: the Developer toggles (Settings → Advanced → Developer) the next run reads. */
export async function setToggles(extension: Extension, toggles: Partial<DevToggles>): Promise<void> {
  await extension.sw.evaluate((t) => (globalThis as ExtGlobal).chrome.storage.local.set({ __e2eInpageToggles: t }), {
    ua: 'tabwide',
    frame: 'auto',
    view: 'phone',
    xfoRule: 'on',
    fetchDest: 'document',
    ...toggles,
  } satisfies DevToggles);
}

/** Evaluates `fn` in the engine frame without user activation (a CDP isolated world, no gesture). */
export async function engineQuiet<T>(page: Page, fn: () => T): Promise<T> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  try {
    const { frameTree } = (await cdp.send('Page.getFrameTree')) as {
      frameTree: { frame: { id: string; url: string }; childFrames?: { frame: { id: string; url: string } }[] };
    };
    const child = (frameTree.childFrames ?? []).find((c) => c.frame.url.startsWith(`${IG_ORIGIN}/`));
    if (!child) throw new Error('no engine frame');
    const { executionContextId } = (await cdp.send('Page.createIsolatedWorld', {
      frameId: child.frame.id,
      worldName: 'e2e-quiet',
    })) as { executionContextId: number };
    const r = (await cdp.send('Runtime.evaluate', {
      expression: `(${fn.toString()})()`,
      contextId: executionContextId,
      returnByValue: true,
      awaitPromise: true,
      userGesture: false,
    })) as { result: { value: T }; exceptionDetails?: { text: string } };
    if (r.exceptionDetails) throw new Error(`engineQuiet: ${r.exceptionDetails.text}`);
    return r.result.value;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

export async function waitEngine(page: Page, timeout = 20_000): Promise<Frame> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const f = engineFrame(page);
    if (f) return f;
    if (Date.now() > deadline) throw new Error('no engine frame');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** The engine frame's pathname, quietly (null while there is none or it is unreadable). */
export const enginePath = (page: Page): Promise<string | null> =>
  engineQuiet(page, () => location.pathname).catch(() => null);

// ---- the fake's request log ----------------------------------------------------------------------------------

export function expectAndroid(r: RequestRecord | undefined, what: string): void {
  expect(r, what).toBeDefined();
  expect(r?.ua ?? '', `${what}: UA`).toMatch(ANDROID_UA);
  const major = Number(/Chrome\/(\d+)\./.exec(r?.ua ?? '')?.[1]);
  expect(r?.ua).toBe(androidReducedUa(major));
  expect(r?.ch['sec-ch-ua-mobile'], `${what}: sec-ch-ua-mobile`).toBe('?1');
  expect(r?.ch['sec-ch-ua-platform'], `${what}: platform`).toBe('"Android"');
  for (const hint of CH_REMOVE) expect(r?.ch[hint], `${what}: ${hint}`).toBeUndefined();
}

export function expectDesktop(r: RequestRecord | undefined, what: string): void {
  expect(r, what).toBeDefined();
  expect(r?.ua ?? '', `${what}: UA`).not.toMatch(/Android/);
  expect(r?.ch['sec-ch-ua-mobile'] ?? '?0', `${what}: sec-ch-ua-mobile`).toBe('?0');
}

/**
 * The engine frame's document requests: `/` navigations with the Android profile (rule 1001 never touches a
 * `main_frame`, so the desktop page's own loads keep the desktop UA).
 */
export const engineDocs = (reqs: RequestRecord[]): RequestRecord[] =>
  reqs.filter(
    (r) =>
      r.path === '/' && r.method === 'GET' && r.fetch['sec-fetch-mode'] === 'navigate' && ANDROID_UA.test(r.ua ?? ''),
  );
