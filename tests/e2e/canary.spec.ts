/**
 * Canaries for the write blocks (strategy §7.11 E8/E9, SG3, SG5, §11 AM5/AM6). The fake's
 * `share=real-paths` knob makes its Share also fire real-shaped subresource POSTs: one to
 * `i.instagram.com/rupload_igphoto/fb_uploader_<t>` and one to
 * `www.instagram.com/api/v1/media/configure_to_story/`.
 *
 * - **E8 (mock only):** the static `block_ig_writes` ruleset stops both, from the composer tab, from
 *   any other tab and from the extension's own service worker (tabId -1); `onRuleMatchedDebug`
 *   (unpacked, `declarativeNetRequestFeedback`) names the ruleset. Rehearsal is switched off, so
 *   no session rule can take the credit.
 * - **E9 (live only):** live has no static ruleset. The tab-scoped rehearsal rules 1002–1019
 *   (`tabIds: [tab, -1]`) stop both writes and an extension-service-worker request during the
 *   session; after close, a non-rehearsal session installs no block at all and both writes
 *   arrive. Live has no `onRuleMatchedDebug`, so E9 asserts through the fake's writes log and
 *   `requestfailed` (AM5).
 */
import type { Page, Request } from '@playwright/test';
import { CLOSE_DELAY_MS } from '../../src/core/handoff/state.ts';
import { SESSION_RULE_IDS } from '../../src/core/ig-contract/rules.ts';
import { type Extension, type ExtGlobal, expect, IG_ORIGIN, test, whenClosed } from './fixtures.ts';
import {
  answerPosted,
  loadPhoto,
  photoFile,
  postFromDesktop,
  setSwitches,
  waitPhase,
  waitSeen,
} from './helpers/editor-flow.ts';
import type { Human } from './helpers/human.ts';

const BLOCKED = 'net::ERR_BLOCKED_BY_CLIENT';
const RUPLOAD = 'https://i.instagram.com/rupload_igphoto/';
const CONFIGURE = 'https://www.instagram.com/api/v1/media/configure_to_story/';

/** A no-cors POST to a real-shaped upload path from the extension's service worker (tabId -1). */
function swWrite(extension: Extension, tag: string): Promise<string> {
  return extension.sw.evaluate(
    (url) =>
      fetch(url, { method: 'POST', mode: 'no-cors', body: 'canary' }).then(
        () => 'reached',
        (err: Error) => err.name,
      ),
    `${RUPLOAD}e2e_canary_${tag}`,
  );
}

/** The same POST from a web page. */
function pageWrite(page: Page, tag: string): Promise<string> {
  return page.evaluate(
    (url) =>
      fetch(url, { method: 'POST', mode: 'no-cors', body: 'canary' }).then(
        () => 'reached',
        (err: Error) => err.name,
      ),
    `${RUPLOAD}e2e_canary_${tag}`,
  );
}

/**
 * Shares in the composer and waits until the session is over. Rehearsal on: C9, close after 3 s.
 * Rehearsal off (`heldOpen`, §11 AM19): the popup stays open past the 3 s so an upload can finish,
 * until the owner answers "Posted?".
 */
async function shareAndFinish(editorPage: Page, popup: Page, human: Human, heldOpen = false): Promise<void> {
  const closed = whenClosed(popup);
  await human.share(popup);
  await waitSeen(editorPage, 'finished');
  if (heldOpen) {
    await expect(editorPage.getByTestId('handoff-hold-open')).toBeVisible();
    await editorPage.waitForTimeout(CLOSE_DELAY_MS + 750);
    expect(popup.isClosed(), 'the popup must stay open until the owner answers').toBe(false);
    await answerPosted(editorPage, true);
  }
  await closed;
  await waitPhase(editorPage, 'idle');
}

test('E8 @smoke canary (mock): real-shaped writes are blocked everywhere; the story is still recorded', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  human,
  handoffState,
  sessionRules,
  tripwire,
}, testInfo) => {
  test.skip(extension.mode !== 'mock', 'the static block ruleset exists only in guarded builds; E9 covers live');
  // The canary's own write from the extension's service worker is deliberate.
  tripwire.expectFromExtension(`${RUPLOAD}e2e_canary_`);
  await fake.setKnobs({ share: 'real-paths' });
  const failed: { url: string; error: string }[] = [];
  context.on('requestfailed', (r: Request) => failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
  // onRuleMatchedDebug, collected inside the extension's service worker.
  await extension.sw.evaluate(() => {
    const g = globalThis as ExtGlobal & { __e2eMatches?: unknown[] };
    g.__e2eMatches = [];
    g.chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
      g.__e2eMatches?.push({
        rulesetId: info.rule.rulesetId,
        url: info.request.url,
        tabId: info.request.tabId,
      });
    });
  });
  const matches = () =>
    extension.sw.evaluate(() => (globalThis as { __e2eMatches?: unknown[] }).__e2eMatches ?? []) as Promise<
      { rulesetId: string; url: string; tabId: number }[]
    >;

  const page = await editor();
  // Rehearsal off: its session rules would block the same writes, and E8 is the static ruleset's canary.
  await setSwitches(page, { assisted: true, rehearsal: false });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingShare');
  const state = await handoffState();
  if (state?.phase !== 'awaitingShare') throw new Error(`unexpected state ${state?.phase}`);
  const composerTab = state.tabId;
  expect((await sessionRules()).map((r) => r.id)).toEqual([1001]);
  await shareAndFinish(page, popup, human, true);

  // The story went through; neither real-shaped write reached the fake.
  expect(await fake.stories()).toHaveLength(1);
  expect(await fake.writes()).toEqual([]);
  // Rule 1001 (modifyHeaders) also reports every composer request; the writes must be the static ruleset's.
  const isWrite = (url: string) => url.startsWith(RUPLOAD) || url.startsWith(CONFIGURE);
  await expect
    .poll(async () =>
      (await matches()).filter((m) => m.tabId === composerTab && isWrite(m.url)).map((m) => m.url.split('fb_')[0]),
    )
    .toEqual(expect.arrayContaining([RUPLOAD, CONFIGURE]));
  for (const m of (await matches()).filter((x) => isWrite(x.url))) expect(m.rulesetId).toBe('block_ig_writes');
  for (const url of [RUPLOAD, CONFIGURE]) {
    expect(failed.find((f) => f.url.startsWith(url))?.error, url).toBe(BLOCKED);
  }

  // From the extension's own service worker (tabId -1) and from an ordinary page.
  expect(await swWrite(extension, 'sw')).toBe('TypeError');
  const tab = await context.newPage();
  await tab.goto(`${IG_ORIGIN}/`);
  expect(await pageWrite(tab, 'page')).toBe('TypeError');
  await expect.poll(async () => (await matches()).find((m) => m.url.endsWith('e2e_canary_sw'))?.tabId).toBe(-1);
  await expect.poll(() => failed.find((f) => f.url.endsWith('e2e_canary_page'))?.error).toBe(BLOCKED);
  expect(await fake.writes()).toEqual([]);
  expect(await sessionRules()).toEqual([]);
});

test('E9 @smoke canary (live): rehearsal blocks writes, tabId -1 included; no stale block after close', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  human,
  handoffState,
  sessionRules,
  clearRateLog,
  tripwire,
}, testInfo) => {
  test.skip(extension.mode !== 'live', 'rehearsal is the live build’s only block; E8 covers the guarded ruleset');
  tripwire.expectFromExtension(`${RUPLOAD}e2e_canary_`);
  await fake.setKnobs({ share: 'real-paths' });
  const failed: { url: string; error: string }[] = [];
  context.on('requestfailed', (r: Request) => failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
  const page = await editor();
  await setSwitches(page, { assisted: true, rehearsal: true });
  await loadPhoto(page, await photoFile(context, testInfo));

  // 1. Rehearsal ON.
  await postFromDesktop(page);
  const first = await composer();
  await waitPhase(page, 'awaitingShare');
  const state = await handoffState();
  if (state?.phase !== 'awaitingShare') throw new Error(`unexpected state ${state?.phase}`);
  const rules = await sessionRules();
  const blocks = rules.filter((r) => r.action.type === 'block');
  expect(blocks.length).toBeGreaterThan(0);
  for (const r of blocks) {
    expect(SESSION_RULE_IDS).toContain(r.id);
    expect(r.condition.tabIds).toEqual([state.tabId, -1]);
  }
  // An extension-service-worker upload (tabId -1) is blocked while the session runs.
  expect(await swWrite(extension, 'rehearsal')).toBe('TypeError');
  await shareAndFinish(page, first, human);
  expect(await fake.stories()).toHaveLength(1);
  expect(await fake.writes()).toEqual([]);
  for (const url of [RUPLOAD, CONFIGURE]) {
    expect(failed.find((f) => f.url.startsWith(url))?.error, url).toBe(BLOCKED);
  }
  expect(await sessionRules()).toEqual([]);

  // 2. Rehearsal OFF, in a new session: no block rule at all, and both writes arrive.
  await setSwitches(page, { rehearsal: false });
  await clearRateLog();
  await postFromDesktop(page);
  const second = await composer({ not: [first] });
  await waitPhase(page, 'awaitingShare');
  expect((await sessionRules()).map((r) => r.id)).toEqual([1001]);
  await shareAndFinish(page, second, human, true);
  expect(await fake.stories()).toHaveLength(2);
  const writes = await fake.writes();
  expect(writes.map((w) => `${w.host}${w.path.split('fb_')[0]}`).sort()).toEqual([
    'i.instagram.com/rupload_igphoto/',
    'www.instagram.com/api/v1/media/configure_to_story/',
  ]);
  for (const w of writes) expect(w.origin).toBe(IG_ORIGIN);
  expect(await sessionRules()).toEqual([]);
});
