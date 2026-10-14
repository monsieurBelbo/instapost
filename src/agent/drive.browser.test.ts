/**
 * B11 (ux.md §10, IA3): + → Story against a DOM fixture of Instagram's msite home (ig-fixture.browser-
 * helper.ts), in Chromium. The agent finds the + beside the story input (C10), taps it through the audited
 * helper, picks the Story item by the stored fingerprint or by trial (C11), and sees the story input armed
 * by Story's own click (no chooser: the page has no user activation). Then the insert reaches Instagram's
 * onChange and its SPA navigation to the composer.
 *
 * Covered: both menu orders, the fingerprint (hit, stale glyph, stale count), a menu that needs a second
 * tap of +, a menu that never shows, a third item (MENU_DRIFT), no + and two (ENTRY_MISSING), a story
 * session Instagram refuses in a landscape viewport (SESSION_NOT_STARTED), the tap budget.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { MenuFingerprint } from '../core/handoff/state.ts';
import { insert, openEntry } from './drive.ts';
import {
  agentWindow,
  driveDeps,
  type HomeOpts,
  type Mounted,
  mountHome,
  pngReply,
  wait,
} from './ig-fixture.browser-helper.ts';
import { findEntry, glyphHash } from './locators.ts';

let m: Mounted | null = null;
afterEach(() => {
  m?.remove();
  m = null;
});

function home(opts: HomeOpts = {}): Mounted {
  m = mountHome(opts);
  return m;
}

/** The fingerprint a first run stores for a menu (count, Story's index, its glyph). */
function fingerprintOf(h: Mounted, storyIndex: number): MenuFingerprint {
  const dialog = document.querySelector('[role="dialog"]');
  const items = dialog ? Array.from(dialog.querySelectorAll('[role="button"]')) : [];
  const glyph = items[storyIndex] ? glyphHash(items[storyIndex] as Element) : null;
  if (!glyph) throw new Error(`no menu open in ${h.menus} menus`);
  return { count: items.length, storyIndex, glyph, savedAt: 1 };
}

describe('B11 C10: the + beside the story input', () => {
  it('is found structurally from the story input’s form, with the post input beside it', () => {
    const h = home();
    const e = findEntry(h.win);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.parts.plus).toBe(h.plus);
    expect(e.parts.storyInput).toBe(h.storyInput);
    expect(e.parts.postInput).toBe(h.postInput);
    expect(e.parts.box.contains(h.plus)).toBe(true);
  });

  it('no + or two candidates fail closed: ENTRY_MISSING, nothing tapped', async () => {
    for (const plus of ['none', 'two'] as const) {
      const h = home({ plus });
      expect(findEntry(h.win)).toMatchObject({ ok: false, why: plus === 'none' ? 'no-plus' : 'ambiguous' });
      const out = await openEntry(driveDeps(h.win), null);
      expect(out).toMatchObject({ result: 'ENTRY_MISSING', plusTaps: 0, menuCount: null });
      expect(h.clicks).toEqual([]);
      h.remove();
    }
  });
});

describe('B11 C11: + → Story', () => {
  it('Story first: armed by Story’s own click on the story input, no trial', async () => {
    const h = home({ menu: ['story', 'post'] });
    const out = await openEntry(driveDeps(h.win), null);
    expect(out).toMatchObject({
      result: 'armed',
      fpUsed: false,
      storyIndex: 0,
      menuCount: 2,
      trials: 0,
      plusTaps: 1,
    });
    expect(out.glyph).toMatch(/^[0-9a-f]{8}$/);
    expect(out.armedMs).not.toBeNull();
    // Every click came from the agent's taps (untrusted), and no chooser: the input only got Story's click.
    expect(h.clicks).toEqual([
      ['plus', false],
      ['item:story', false],
      ['storyInput', false],
    ]);
  });

  it('Post first: the wrong item only clicks the post input; the other item, once, arms the story input', async () => {
    const h = home({ menu: ['post', 'story'] });
    const out = await openEntry(driveDeps(h.win), null);
    expect(out).toMatchObject({ result: 'armed', fpUsed: false, storyIndex: 1, trials: 1, menuCount: 2 });
    // The popover closed after the wrong pick: + was tapped again for the second item.
    expect(out.plusTaps).toBe(2);
    expect(h.clicks.map(([what]) => what)).toEqual([
      'plus',
      'item:post',
      'postInput',
      'plus',
      'item:story',
      'storyInput',
    ]);
  });

  it('a menu that stays open after the wrong pick is reused (no second + tap)', async () => {
    const h = home({ menu: ['post', 'story'], closeOnPick: false });
    const out = await openEntry(driveDeps(h.win), null);
    expect(out).toMatchObject({ result: 'armed', storyIndex: 1, trials: 1, plusTaps: 1 });
  });

  it('a stored fingerprint picks Story directly, whatever the order', async () => {
    const first = home({ menu: ['post', 'story'] });
    first.plus?.click(); // the test opens the menu to read it, as a first run would have
    const fp = fingerprintOf(first, 1);
    first.remove();
    const h = home({ menu: ['post', 'story'] });
    const out = await openEntry(driveDeps(h.win), fp);
    expect(out).toMatchObject({
      result: 'armed',
      fpUsed: true,
      storyIndex: 1,
      trials: 0,
      plusTaps: 1,
      glyph: fp.glyph,
    });
    expect(h.clicks.map(([what]) => what)).not.toContain('postInput');
  });

  it('a stale fingerprint (another glyph, or another count) falls back to the trial', async () => {
    const h = home({ menu: ['story', 'post'] });
    const out = await openEntry(driveDeps(h.win), { count: 2, storyIndex: 1, glyph: 'deadbeef', savedAt: 1 });
    expect(out).toMatchObject({ result: 'armed', fpUsed: false, storyIndex: 0, trials: 0 });
    h.remove();
    const k = home({ menu: ['story', 'post'] });
    const out2 = await openEntry(driveDeps(k.win), { count: 3, storyIndex: 1, glyph: out.glyph ?? '', savedAt: 1 });
    expect(out2).toMatchObject({ fpUsed: false, storyIndex: 0 });
  });

  it('a menu that shows only on the second tap of + is found; one that never shows is MENU_MISSING', async () => {
    const h = home({ menuOpens: 'second' });
    expect(await openEntry(driveDeps(h.win), null)).toMatchObject({ result: 'armed', plusTaps: 2 });
    h.remove();
    const k = home({ menuOpens: 'never' });
    expect(await openEntry(driveDeps(k.win), null)).toMatchObject({ result: 'MENU_MISSING', plusTaps: 2 });
    expect(k.clicks.map(([w]) => w)).toEqual(['plus', 'plus']);
  });

  it('a third item: MENU_DRIFT, no item tapped', async () => {
    const h = home({ menu: ['story', 'post', 'extra'] });
    expect(await openEntry(driveDeps(h.win), null)).toMatchObject({ result: 'MENU_DRIFT', menuCount: 3 });
    expect(h.clicks.map(([w]) => w)).toEqual(['plus']);
  });

  it('an item that clicks nothing: NOT_ARMED; the wrong item is tried once at most', async () => {
    const h = home({ menu: ['post', 'extra'] });
    const out = await openEntry(driveDeps(h.win), null);
    // Index 0 (post) is wrong; index 1 (extra) clicks nothing at all: not armed.
    expect(out.result).toBe('NOT_ARMED');
    expect(h.clicks.filter(([w]) => w === 'postInput')).toHaveLength(1);
  });

  it('both items open the post input: WRONG_ITEM after the one trial', async () => {
    const h = home({ menu: ['post', 'post'] });
    expect(await openEntry(driveDeps(h.win), null)).toMatchObject({ result: 'WRONG_ITEM', trials: 1 });
    expect(h.clicks.filter(([w]) => w === 'postInput')).toHaveLength(2);
    expect(h.clicks.filter(([w]) => w === 'storyInput')).toHaveLength(0);
  });

  it('Instagram refuses a story session in a landscape viewport: SESSION_NOT_STARTED', async () => {
    const h = home({ refuseStory: true });
    const wide = agentWindow(h.location, { innerWidth: 900, innerHeight: 600 });
    expect(await openEntry(driveDeps(wide), null)).toMatchObject({ result: 'SESSION_NOT_STARTED' });
    expect(h.clicks.map(([w]) => w)).toEqual(['plus', 'item:story']);
  });

  it('a hidden page is never tapped: HIDDEN after the wait', async () => {
    const h = home();
    const hidden = agentWindow(h.location, { visibility: () => 'hidden' });
    expect(await openEntry(driveDeps(hidden, 0.01), null)).toMatchObject({ result: 'HIDDEN', plusTaps: 0 });
    expect(h.clicks).toEqual([]);
  });

  it('the + budget: three taps per document at most', async () => {
    const h = home({ menuOpens: 'never' });
    const d = driveDeps(h.win);
    await openEntry(d, null);
    const again = await openEntry(d, null);
    // Two taps per attempt; the third attempt's first tap is the last the budget allows.
    expect(again.plusTaps).toBe(3);
    expect(again.result).toBe('REFUSED');
    expect(h.clicks.filter(([w]) => w === 'plus')).toHaveLength(3);
  });
});

describe('B11 the insert into the armed input', () => {
  it('reaches Instagram’s onChange, which SPA-navigates to the composer', async () => {
    const h = home();
    const d = driveDeps(h.win);
    expect(await openEntry(d, null)).toMatchObject({ result: 'armed' });
    const reply = await pngReply();
    expect(await insert(d, h.storyInput, async () => reply)).toEqual({ ok: true });
    expect(h.files).toHaveLength(1);
    expect(h.files[0]).toMatchObject({ name: 'story.png', type: 'image/png' });
    await wait(60);
    expect(h.location.pathname).toBe('/create/story/');
    expect(h.composer).not.toBeNull();
  });

  it('a refused or non-image file is never assigned', async () => {
    const h = home();
    const d = driveDeps(h.win);
    expect(await insert(d, h.storyInput, async () => ({ ok: false }))).toEqual({ ok: false, why: 'no-file' });
    expect(
      await insert(d, h.storyInput, async () => ({ ok: true, name: 'x.mp4', mime: 'video/mp4', b64: 'AAAA' })),
    ).toEqual({ ok: false, why: 'no-file' });
    expect(await insert(d, h.storyInput, async () => Promise.reject(new Error('gone')))).toEqual({
      ok: false,
      why: 'no-file',
    });
    expect(h.files).toEqual([]);
    h.storyInput.remove();
    expect(await insert(d, h.storyInput, async () => pngReply())).toEqual({ ok: false, why: 'not-armed' });
  });
});
