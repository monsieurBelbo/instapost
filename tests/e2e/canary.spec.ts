/**
 * Canaries for the write blocks (strategy §7.11 E8/E9, SG3, SG5, §11 AM5/AM6/AM41), on Instagram's own
 * write requests: since AM39 the fake's composer uploads as Instagram's client does (an XHR to
 * `i.instagram.com/rupload_igphoto/fb_uploader_<id>`, then `www.instagram.com/api/v1/media/configure_to_story/`
 * only after a 2xx upload), and the autopilot presses Share, so the canaries need no special Share knob.
 *
 * - **E8 (mock only):** a Post story in a guarded build. The static `block_ig_writes` ruleset stops
 *   Instagram's upload from the composer tab (no session block rule exists for a post: only rule 1001),
 *   `onRuleMatchedDebug` (unpacked, `declarativeNetRequestFeedback`) names the ruleset, Instagram never
 *   publishes, and the run ends as a Share test, never "Posted". Both write paths are also blocked from
 *   any other tab and from the extension's own service worker (tabId -1).
 * - **E9 (live only):** live has no static ruleset. A Share test installs the tab-scoped rules 1002–1019
 *   (`tabIds: [tab, -1]`): they stop Instagram's upload and an extension-service-worker request during the
 *   run. After it, a Post story installs no block at all: both of Instagram's writes arrive and the story
 *   is posted. Live has no `onRuleMatchedDebug`, so E9 asserts through the fake's writes log and
 *   `requestfailed` (AM5).
 */
import type { Page, Request } from '@playwright/test';
import { SESSION_RULE_IDS } from '../../src/core/ig-contract/rules.ts';
import { type Extension, type ExtGlobal, expect, IG_ORIGIN, test, whenClosed } from './fixtures.ts';
import { lastRecord, loadPhoto, photoFile, postStory, shareTest, waitResult } from './helpers/editor-flow.ts';

const BLOCKED = 'net::ERR_BLOCKED_BY_CLIENT';
const RUPLOAD = 'https://i.instagram.com/rupload_igphoto/';
const CONFIGURE = 'https://www.instagram.com/api/v1/media/configure_to_story/';

/** A no-cors POST to a real-shaped write path from the extension's service worker (tabId -1). */
function swWrite(extension: Extension, url: string): Promise<string> {
  return extension.sw.evaluate(
    (u) =>
      fetch(u, { method: 'POST', mode: 'no-cors', body: 'canary' }).then(
        () => 'reached',
        (err: Error) => err.name,
      ),
    url,
  );
}

/** The same POST from a web page. */
function pageWrite(page: Page, url: string): Promise<string> {
  return page.evaluate(
    (u) =>
      fetch(u, { method: 'POST', mode: 'no-cors', body: 'canary' }).then(
        () => 'reached',
        (err: Error) => err.name,
      ),
    url,
  );
}

test('E8 @smoke canary (mock): the static ruleset blocks Instagram’s upload in a Post story, and every write elsewhere', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
  sessionRules,
  tripwire,
}, testInfo) => {
  test.skip(extension.mode !== 'mock', 'the static block ruleset exists only in guarded builds; E9 covers live');
  // The canary's own write from the extension's service worker is deliberate.
  tripwire.expectFromExtension(`${RUPLOAD}e2e_canary_`);
  const failed: { url: string; error: string }[] = [];
  context.on('requestfailed', (r: Request) => failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
  // onRuleMatchedDebug, collected inside the extension's service worker.
  await extension.sw.evaluate(() => {
    const g = globalThis as ExtGlobal & { __e2eMatches?: unknown[] };
    g.__e2eMatches = [];
    g.chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
      g.__e2eMatches?.push({ rulesetId: info.rule.rulesetId, url: info.request.url, tabId: info.request.tabId });
    });
  });
  const matches = () =>
    extension.sw.evaluate(() => (globalThis as { __e2eMatches?: unknown[] }).__e2eMatches ?? []) as Promise<
      { rulesetId: string; url: string; tabId: number }[]
    >;

  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  // A post installs no session block: the static ruleset is the only one in force.
  await expect.poll(async () => (await sessionRules()).map((r) => r.id)).toEqual([1001]);
  const card = await waitResult(page, 'shareTested');
  await expect(card).not.toContainText('Posted');
  await whenClosed(popup);
  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ mode: 'post', outcome: 'share-tested' });

  // Instagram's upload went out from the composer tab and was blocked by the static ruleset; Instagram
  // never published, and nothing reached the fake.
  expect(await fake.writes()).toEqual([]);
  expect(await fake.stories()).toEqual([]);
  expect(failed.find((f) => f.url.startsWith(RUPLOAD))?.error).toBe(BLOCKED);
  expect(failed.some((f) => f.url.startsWith(CONFIGURE))).toBe(false);
  await expect
    .poll(async () => (await matches()).filter((m) => m.url.startsWith(RUPLOAD)).map((m) => m.rulesetId))
    .toEqual(['block_ig_writes']);

  // From an ordinary page, both write paths; from the extension's own service worker (tabId -1).
  const tab = await context.newPage();
  await tab.goto(`${IG_ORIGIN}/`);
  expect(await pageWrite(tab, `${RUPLOAD}e2e_canary_page`)).toBe('TypeError');
  expect(await pageWrite(tab, `${CONFIGURE}?e2e_canary_page`)).toBe('TypeError');
  expect(await swWrite(extension, `${RUPLOAD}e2e_canary_sw`)).toBe('TypeError');
  await expect.poll(async () => (await matches()).find((m) => m.url.endsWith('e2e_canary_sw'))?.tabId).toBe(-1);
  for (const m of (await matches()).filter((x) => x.url.includes('e2e_canary'))) {
    expect(m.rulesetId).toBe('block_ig_writes');
  }
  await expect
    .poll(() => failed.filter((f) => f.url.includes('e2e_canary_page')).map((f) => f.error))
    .toEqual([BLOCKED, BLOCKED]);
  expect(await fake.writes()).toEqual([]);
  await expect.poll(sessionRules).toEqual([]);
});

test('E9 @smoke canary (live): a Share test blocks writes, tabId -1 included; the next Post story has no stale block', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffState,
  handoffRecords,
  sessionRules,
  clearRateLog,
  tripwire,
}, testInfo) => {
  test.skip(extension.mode !== 'live', 'the test rules are the live build’s only block; E8 covers the guarded ruleset');
  tripwire.expectFromExtension(`${RUPLOAD}e2e_canary_`);
  const failed: { url: string; error: string }[] = [];
  context.on('requestfailed', (r: Request) => failed.push({ url: r.url(), error: r.failure()?.errorText ?? '' }));
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));

  // 1. A Share test: the write-block rules for the tab and for service workers.
  await shareTest(page);
  const first = await composer();
  await expect
    .poll(async () => (await sessionRules()).filter((r) => r.action.type === 'block').length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const state = await handoffState();
  const tabId = state && 'tabId' in state ? state.tabId : null;
  for (const r of (await sessionRules()).filter((x) => x.action.type === 'block')) {
    expect(SESSION_RULE_IDS).toContain(r.id);
    expect(r.condition.tabIds).toEqual([tabId, -1]);
  }
  // An extension-service-worker upload (tabId -1) is blocked while the run lasts.
  expect(await swWrite(extension, `${RUPLOAD}e2e_canary_test`)).toBe('TypeError');
  await waitResult(page, 'shareTested');
  await whenClosed(first);
  expect(failed.find((f) => f.url.startsWith(RUPLOAD) && !f.url.includes('e2e_canary'))?.error).toBe(BLOCKED);
  expect(await fake.writes()).toEqual([]);
  expect(await fake.stories()).toEqual([]);
  await expect.poll(sessionRules).toEqual([]);

  // 2. A Post story in a new run: no block rule at all, and both of Instagram's writes arrive.
  await clearRateLog();
  await page.getByTestId('result-done').click();
  await postStory(page);
  const second = await composer({ not: [first] });
  await expect.poll(async () => (await sessionRules()).map((r) => r.id)).toEqual([1001]);
  await waitResult(page, 'posted');
  await whenClosed(second);
  expect(await fake.stories()).toHaveLength(1);
  // The upload's CORS preflight (OPTIONS) reaches the same path; the writes are the two POSTs.
  const writes = (await fake.writes()).filter((w) => w.method === 'POST');
  expect(writes.map((w) => `${w.host}${w.path.split('fb_')[0]}`)).toEqual([
    'i.instagram.com/rupload_igphoto/',
    'www.instagram.com/api/v1/media/configure_to_story/',
  ]);
  for (const w of writes) expect(w.origin).toBe(IG_ORIGIN);
  expect((await handoffRecords()).map((r) => r.outcome)).toEqual(['share-tested', 'posted']);
  await expect.poll(sessionRules).toEqual([]);
});
