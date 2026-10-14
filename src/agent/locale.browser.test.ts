/**
 * B15 (strategy §11 AM45, live checklist L21): the autopilot's whole chain in the page, + → Story, the
 * insert into the armed story input, the compose watch and Share, against the msite fixture with
 * Instagram's UI in English and in Spanish (every visible word, the + link's aria-label, the menu items,
 * the Share footer, the close button and the rotate snackbar differ; `<html lang>` too). The results are
 * identical: no locator reads text (U31; docs/contract.md § "Instagram in Spanish").
 */
import { afterEach, describe, expect, it } from 'vitest';
import { insert, openEntry, share, watchCompose } from './drive.ts';
import { driveDeps, type FixtureLabels, type Mounted, mountHome, pngReply, wait } from './ig-fixture.browser-helper.ts';
import { composerState, readAccount } from './locators.ts';
import type { ShareToken } from './tap.ts';

const TOKEN: ShareToken = { share: true, handoffId: 'hof_b15' };

let m: Mounted | null = null;
const lang = document.documentElement.lang;
afterEach(() => {
  m?.remove();
  m = null;
  document.documentElement.lang = lang;
});

/** One post through the chain, as the background would drive it; what each step established. */
async function chain(labels: FixtureLabels, menu: ('story' | 'post')[]) {
  document.documentElement.lang = labels;
  m = mountHome({ labels, menu, account: 'testuser' });
  const h = m;
  const d = driveDeps(h.win);
  const account = readAccount(h.win);
  const entry = await openEntry(d, null);
  const inserted = await insert(d, h.storyInput, pngReply);
  await wait(60);
  const compose = await watchCompose(driveDeps(h.win, 0.05), null);
  const st = composerState(h.win);
  const shared = await share(driveDeps(h.win, 0.05), TOKEN, () => undefined);
  await wait(60);
  const { armedMs: _a, ...entryFacts } = entry;
  const { settleMs: _s, ...composeFacts } = compose;
  return {
    account,
    entry: entryFacts,
    inserted,
    compose: composeFacts,
    controls: st.controls.length,
    shared: shared.ok,
    clicks: h.clicks,
    shareClicks: h.composer?.shareClicks ?? [],
    wentHome: h.location.pathname,
  };
}

describe('B15 Instagram in Spanish: the same run as in English', () => {
  for (const menu of [
    ['story', 'post'],
    ['post', 'story'],
  ] as const) {
    it(`menu ${menu.join(', ')}: account, + → Story, insert, compose and Share are identical`, async () => {
      const en = await chain('en', [...menu]);
      m?.remove();
      const es = await chain('es', [...menu]);
      expect(es).toEqual(en);
      expect(en).toMatchObject({
        account: { handle: 'testuser', candidates: 1 },
        entry: { result: 'armed', menuCount: 2, storyIndex: menu.indexOf('story') },
        inserted: { ok: true },
        compose: { onComposer: true, drawn: true, controls: 1, variant: 'v1', settled: true },
        shared: true,
        shareClicks: [false],
        wentHome: '/',
      });
      // The Spanish page really was Spanish where the agent looked.
      expect(document.body.textContent).toContain('Tu historia');
    });
  }
});
