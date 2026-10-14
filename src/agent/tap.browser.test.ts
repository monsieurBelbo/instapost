/**
 * B14 (ux.md P2, §10, IA2): the one audited synthetic-action helper, in Chromium. Before every tap, in
 * order: the kind's budget, Share's token, the element connected, visible and in the viewport, inside the
 * expected container, on the page where that control lives, the page without user activation (R22: right
 * after a real click Story's input.click() would open the OS file chooser) and visible. observeClick sees
 * clicks in the capture phase, once, and tells a real click from a synthetic one.
 *
 * The user-activation test comes last: a real click activates this frame for about 5 s.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { agentWindow, type FakeLocation, wait } from './ig-fixture.browser-helper.ts';
import { newBudget, observeClick, type ShareToken, TAP_LIMITS, type TapGuard, tap } from './tap.ts';

const TOKEN: ShareToken = { share: true, handoffId: 'hof_b14' };

let root: HTMLElement | null = null;
afterEach(() => {
  root?.remove();
  root = null;
});

function page(path = '/') {
  root = document.createElement('div');
  root.setAttribute('style', 'position:fixed;inset:0');
  const container = document.createElement('div');
  const button = document.createElement('button');
  button.textContent = '+';
  button.setAttribute('style', 'width:44px;height:44px');
  const clicks: boolean[] = [];
  button.addEventListener('click', (e) => clicks.push(e.isTrusted));
  container.append(button);
  const outside = document.createElement('button');
  outside.setAttribute('style', 'width:44px;height:44px');
  root.append(container, outside);
  document.body.append(root);
  const location: FakeLocation = { pathname: path };
  const win = agentWindow(location);
  const guard = (over: Partial<TapGuard> = {}): TapGuard => ({ win, container, budget: newBudget(), ...over });
  return { root, container, button, outside, clicks, location, win, guard };
}

describe('B14 tap: the guards, in order', () => {
  it('taps a visible control in its container, on its page, and returns the audited marker', () => {
    const p = page('/');
    expect(tap('plus', p.button, p.guard())).toEqual({ ok: true, kind: 'plus', via: 'instapost:tap' });
    expect(p.clicks).toEqual([false]);
  });

  it('the budget: + three times per document, Story twice, Share once', () => {
    const p = page('/');
    const budget = newBudget();
    for (let i = 0; i < TAP_LIMITS.plus; i++) expect(tap('plus', p.button, p.guard({ budget })).ok).toBe(true);
    expect(tap('plus', p.button, p.guard({ budget }))).toEqual({ ok: false, kind: 'plus', why: 'budget' });
    for (let i = 0; i < TAP_LIMITS.storyItem; i++)
      expect(tap('storyItem', p.button, p.guard({ budget })).ok).toBe(true);
    expect(tap('storyItem', p.button, p.guard({ budget })).ok).toBe(false);
    p.location.pathname = '/create/story/';
    expect(tap('share', p.button, p.guard({ budget, token: TOKEN })).ok).toBe(true);
    expect(tap('share', p.button, p.guard({ budget, token: TOKEN }))).toMatchObject({ why: 'budget' });
    expect(p.clicks).toHaveLength(TAP_LIMITS.plus + TAP_LIMITS.storyItem + TAP_LIMITS.share);
  });

  it('Share needs the Share command’s token', () => {
    const p = page('/create/story/');
    expect(tap('share', p.button, p.guard())).toMatchObject({ ok: false, why: 'token' });
    expect(tap('share', p.button, p.guard({ token: null }))).toMatchObject({ ok: false, why: 'token' });
    expect(p.clicks).toEqual([]);
  });

  it('a detached, hidden or off-screen element is never tapped', () => {
    const p = page('/');
    const gone = document.createElement('button');
    expect(tap('plus', gone, p.guard({ container: gone }))).toMatchObject({ why: 'detached' });
    p.button.style.display = 'none';
    expect(tap('plus', p.button, p.guard())).toMatchObject({ why: 'not-visible' });
    p.button.style.display = '';
    p.button.style.visibility = 'hidden';
    expect(tap('plus', p.button, p.guard())).toMatchObject({ why: 'not-visible' });
    p.button.style.visibility = '';
    p.button.style.opacity = '0';
    expect(tap('plus', p.button, p.guard())).toMatchObject({ why: 'not-visible' });
    p.button.style.opacity = '';
    p.root.style.top = '5000px';
    expect(tap('plus', p.button, p.guard())).toMatchObject({ why: 'outside-viewport' });
    expect(p.clicks).toEqual([]);
  });

  it('an element outside the expected container is never tapped', () => {
    const p = page('/');
    expect(tap('plus', p.outside, p.guard())).toMatchObject({ why: 'container' });
  });

  it('each control only on its page: + and Story at /, Share on the composer', () => {
    const p = page('/create/story/');
    expect(tap('plus', p.button, p.guard())).toMatchObject({ why: 'path' });
    expect(tap('storyItem', p.button, p.guard())).toMatchObject({ why: 'path' });
    p.location.pathname = '/';
    expect(tap('share', p.button, p.guard({ token: TOKEN }))).toMatchObject({ why: 'path' });
    p.location.pathname = '/explore/';
    expect(tap('plus', p.button, p.guard())).toMatchObject({ why: 'path' });
    expect(p.clicks).toEqual([]);
  });

  it('a hidden page is never tapped (Instagram throttles hidden pages)', () => {
    const p = page('/');
    const hidden = agentWindow(p.location, { visibility: () => 'hidden' });
    expect(tap('plus', p.button, p.guard({ win: hidden }))).toMatchObject({ why: 'page-hidden' });
  });

  it('a refused tap spends no budget', () => {
    const p = page('/');
    const budget = newBudget();
    p.button.style.display = 'none';
    tap('plus', p.button, p.guard({ budget }));
    expect(budget.plus).toBe(0);
  });
});

describe('B14 observeClick', () => {
  it('sees the tap’s synthetic click (untrusted), once, in the capture phase', async () => {
    const p = page('/');
    const seen = observeClick(p.win, p.container, 500);
    let bubbled = false;
    p.container.addEventListener('click', () => {
      bubbled = true;
    });
    tap('plus', p.button, p.guard());
    const c = await seen;
    expect(c).toMatchObject({ target: p.button, trusted: false });
    expect(bubbled).toBe(true); // observation only: nothing prevented
  });

  it('resolves null when nothing is clicked in time', async () => {
    const p = page('/');
    expect(await observeClick(p.win, p.container, 30)).toBeNull();
  });

  it('a real click is trusted; right after it the page has user activation, and nothing is tapped', async () => {
    const p = page('/');
    const seen = observeClick(p.win, p.container, 2000);
    await userEvent.click(p.button);
    expect(await seen).toMatchObject({ trusted: true });
    expect(tap('plus', p.button, p.guard())).toMatchObject({ ok: false, why: 'activation' });
    expect(p.clicks).toEqual([true]);
    await wait(10);
  });
});
