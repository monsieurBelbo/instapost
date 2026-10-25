/**
 * docs/repost.md RV-3 (RP-20, RP-22): the repost's intake with the composer's own CSS, in both themes: the card
 * is centred in the stage (not stacked in its top-left corner), ✕ sits in the top-right corner, the initial is a
 * 56 px circle, the actions are a row, and the loading spinner is a 16 px ring in the text's colour (visible on
 * the light surface too). The markup is RepostIntake.tsx's.
 */
import '../../entrypoints/composer/composer.css';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
});

function mount(state: 'loading' | 'permission'): HTMLElement {
  const stage = document.createElement('div');
  stage.className = 'view-import';
  Object.assign(stage.style, { position: 'relative', width: '540px', height: '700px' });
  const body =
    state === 'loading'
      ? '<div class="rp-in" role="status"><span class="rp-av">S</span><p class="rp-t"><i class="spinner"></i>Loading @some.user’s post…</p></div>'
      : '<div class="rp-in"><span class="rp-mark"><svg class="i mark" width="24" height="24" viewBox="0 0 24 24"></svg></span>' +
        '<p class="rp-t">Allow instapost to load this picture</p><p class="rp-b">Once, for Instagram’s image servers.</p>' +
        '<div class="rp-a"><button type="button" class="btn primary">Allow</button><button type="button" class="btn secondary">Choose photo…</button></div></div>';
  stage.innerHTML = `<div class="stage-col" style="position:absolute;inset:0"><div class="import rp-intake" data-state="${state}"><button type="button" class="icon-btn rp-x">×</button>${body}</div></div>`;
  document.body.append(stage);
  return stage;
}

const rect = (root: Element, sel: string): DOMRect => (root.querySelector(sel) as Element).getBoundingClientRect();

describe('RV-3 the intake is laid out', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: centred card, ✕ in the corner, the avatar circle, a visible spinner`, () => {
      if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      const stage = mount('loading');
      const box = stage.getBoundingClientRect();
      const card = rect(stage, '.rp-in');
      expect(Math.abs(card.left + card.width / 2 - (box.left + box.width / 2))).toBeLessThan(2);
      expect(Math.abs(card.top + card.height / 2 - (box.top + box.height / 2))).toBeLessThan(2);
      const x = rect(stage, '.rp-x');
      expect(box.right - x.right).toBeLessThanOrEqual(16);
      expect(x.top - box.top).toBeLessThanOrEqual(16);
      const av = rect(stage, '.rp-av');
      expect([av.width, av.height]).toEqual([56, 56]);
      expect(getComputedStyle(stage.querySelector('.rp-av') as Element).borderRadius).toBe('50%');
      const spin = stage.querySelector('.rp-t .spinner') as HTMLElement;
      const sr = spin.getBoundingClientRect();
      expect([sr.width, sr.height]).toEqual([16, 16]);
      const text = getComputedStyle(stage.querySelector('.rp-t') as Element).color;
      expect(getComputedStyle(spin).borderTopColor).toBe(text);
      expect(getComputedStyle(spin).borderTopColor).not.toBe(
        getComputedStyle(stage.querySelector('.stage-col') as Element).backgroundColor,
      );
    });
  }
  it('the permission card: its actions side by side, under the text', () => {
    const stage = mount('permission');
    const [allow, choose] = Array.from(stage.querySelectorAll('.rp-a .btn')).map((b) => b.getBoundingClientRect());
    expect(allow && choose).toBeTruthy();
    if (!allow || !choose) return;
    expect(Math.abs(allow.top - choose.top)).toBeLessThan(1);
    expect(choose.left).toBeGreaterThan(allow.right);
    expect(allow.top).toBeGreaterThan(rect(stage, '.rp-b').bottom);
    const mark = rect(stage, '.rp-mark');
    expect([mark.width, mark.height]).toEqual([56, 56]);
  });
});
