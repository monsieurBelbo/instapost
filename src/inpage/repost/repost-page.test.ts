/**
 * docs/repost.md §11: U49 (the mention wording, EN and ES), U51 (placement), U43 (the background's
 * hold: accepted from frame 0 on www only, replayed once, dropped after 60 s).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RepostSource } from '../../core/repost/source.ts';
import { REPOST_HOLD_MS, repostHold } from '../background.ts';
import { acceptPageUiMessage, isPanelToBackground } from '../messages.ts';
import { fallbackPlace, mentionPillPlace, popoverPlace, stripPlace, viewerPillPlace } from './place.ts';
import { isMentionText, SHARE_LABELS } from './words.ts';

describe('U49 the mention wording', () => {
  it('EN and ES mentions match; replies and shares do not', () => {
    for (const t of [
      'mentioned you in their story',
      'Mentioned you in their story',
      'some.user mentioned you in their story · 2h',
      'te ha mencionado en su historia',
      'Te mencionó en su historia',
    ]) {
      expect(isMentionText(t), t).toBe(true);
    }
    for (const t of [
      'replied to your story',
      'respondió a tu historia',
      'sent a story',
      'You mentioned them in your story',
    ]) {
      expect(isMentionText(t), t).toBe(false);
    }
    expect(SHARE_LABELS).toContain('Compartir');
  });
});

describe('U51 placement', () => {
  const vp = { w: 1280, h: 800 };
  it('the strip goes below the panel, else above, else nowhere', () => {
    expect(stripPlace({ x: 400, y: 100, w: 480, h: 500 }, vp)).toEqual({ x: 400, y: 608, w: 480, h: 56 });
    expect(stripPlace({ x: 400, y: 200, w: 480, h: 560 }, vp)).toEqual({ x: 400, y: 136, w: 480, h: 56 });
    expect(stripPlace({ x: 400, y: 20, w: 480, h: 760 }, vp)).toBe(null);
    expect(stripPlace({ x: 400, y: 100, w: 900, h: 500 }, vp)?.w).toBe(560);
    expect(stripPlace({ x: 400, y: 100, w: 200, h: 500 }, vp)?.w).toBe(280);
  });
  it('the popover goes right of the control, else above, else nowhere', () => {
    expect(popoverPlace({ x: 600, y: 400, w: 24, h: 24 }, { w: 150, h: 36 }, vp)).toEqual({
      x: 632,
      y: 394,
      w: 150,
      h: 36,
    });
    expect(popoverPlace({ x: 1200, y: 400, w: 24, h: 24 }, { w: 150, h: 36 }, vp)).toEqual({
      x: 1122,
      y: 356,
      w: 150,
      h: 36,
    });
    expect(popoverPlace({ x: 1200, y: 10, w: 24, h: 24 }, { w: 150, h: 36 }, vp)).toBe(null);
  });
  it('RV-5: with a Share dialog open, the fallback pill goes beside it, never over it', () => {
    const wide = { w: 1440, h: 720 };
    const pill = { w: 160, h: 36 };
    // The home feed's Share control sits under Instagram's centred dialog (taller than the viewport here).
    const control = { x: 560, y: 400, w: 24, h: 24 };
    const dialog = { x: 446, y: -20, w: 548, h: 760 };
    const overlaps = (a: { x: number; y: number; w: number; h: number }) =>
      a.x < dialog.x + dialog.w && dialog.x < a.x + a.w && a.y < dialog.y + dialog.h && dialog.y < a.y + a.h;
    expect(overlaps(popoverPlace(control, pill, wide) ?? { x: 0, y: 0, w: 0, h: 0 })).toBe(true);
    expect(fallbackPlace(control, pill, wide, dialog)).toEqual({ x: 1002, y: 8, w: 160, h: 36 });
    // No room on the right: on the left.
    expect(fallbackPlace(control, pill, wide, { ...dialog, x: 760 })).toEqual({ x: 592, y: 8, w: 160, h: 36 });
    // A dialog as wide as the page: the popover's own place only if it misses the dialog, else nothing.
    const full = { x: 8, y: 40, w: 1424, h: 640 };
    expect(fallbackPlace(control, pill, wide, full)).toBe(null);
    expect(fallbackPlace({ x: 600, y: 690, w: 24, h: 24 }, pill, wide, { x: 8, y: 8, w: 1424, h: 600 })).toEqual({
      x: 532,
      y: 646,
      w: 160,
      h: 36,
    });
    // No dialog: the popover's place.
    expect(fallbackPlace(control, pill, wide, null)).toEqual(popoverPlace(control, pill, wide));
  });
  it('the DM pill is wide from 132 px, round below', () => {
    expect(mentionPillPlace({ x: 100, y: 100, w: 160, h: 280 })).toEqual({
      kind: 'wide',
      x: 108,
      y: 340,
      w: 144,
      h: 32,
    });
    expect(mentionPillPlace({ x: 100, y: 100, w: 300, h: 500 }).w).toBe(200);
    expect(mentionPillPlace({ x: 100, y: 100, w: 120, h: 200 })).toEqual({
      kind: 'round',
      x: 182,
      y: 262,
      w: 32,
      h: 32,
    });
  });
  it('the viewer pill goes right, else left, else nowhere', () => {
    const media = { x: 500, y: 60, w: 400, h: 700 };
    const size = { w: 160, h: 32 };
    expect(viewerPillPlace(media, size, vp, () => false)).toEqual({ x: 912, y: 728, w: 160, h: 32 });
    expect(viewerPillPlace(media, size, vp, (r) => r.x > 900)).toEqual({ x: 328, y: 728, w: 160, h: 32 });
    expect(viewerPillPlace(media, size, vp, () => true)).toBe(null);
  });
});

const SRC: RepostSource = {
  kind: 'post',
  author: 'owner',
  code: 'C1aBcDeFgH',
  storyPk: null,
  media: [{ url: 'https://scontent.cdninstagram.com/v/1_n.jpg', w: 1080 }],
  aspect: 1,
  avatar: null,
  slide: null,
  isOwn: false,
  consent: 'unknown',
  via: 'dialog',
  bar: 'absent',
};

describe('U43 the background', () => {
  const page = { id: 'rid', tab: { id: 3 }, frameId: 0, url: 'https://www.instagram.com/p/C1aBcDeFgH/' };
  it('accepts inpage/repost from frame 0 on www only', () => {
    const msg = { v: 1, type: 'inpage/repost', src: SRC };
    expect(acceptPageUiMessage(msg, page, 'rid')).toMatchObject({ ok: true, tabId: 3 });
    expect(acceptPageUiMessage(msg, { ...page, frameId: 2 }, 'rid')).toMatchObject({ ok: false, reason: 'frame' });
    expect(acceptPageUiMessage(msg, { ...page, url: 'https://i.instagram.com/' }, 'rid')).toMatchObject({ ok: false });
    expect(acceptPageUiMessage({ ...msg, src: { ...SRC, consent: 'blocked' } }, page, 'rid')).toMatchObject({
      ok: false,
      reason: 'shape',
    });
    expect(acceptPageUiMessage({ ...msg, extra: 1 }, page, 'rid')).toMatchObject({ ok: false });
    expect(
      acceptPageUiMessage({ v: 1, type: 'inpage/repost-diag', where: 'dialog', why: 'no-dialog' }, page, 'rid'),
    ).toMatchObject({ ok: true });
    expect(
      acceptPageUiMessage({ v: 1, type: 'inpage/repost-diag', where: 'dialog', why: 'https://x' }, page, 'rid'),
    ).toMatchObject({ ok: false });
    expect(isPanelToBackground({ v: 1, type: 'ui/open-settings' })).toBe(true);
  });
  it('holds one repost per tab, consumed once, dropped after 60 s', () => {
    let t = 1000;
    const h = repostHold(() => t);
    h.put(3, SRC);
    h.put(3, { ...SRC, author: 'newer' });
    expect(h.take(3)?.author).toBe('newer');
    expect(h.take(3)).toBe(null);
    h.put(4, SRC);
    t += REPOST_HOLD_MS + 1;
    expect(h.take(4)).toBe(null);
    h.put(5, SRC);
    h.drop(5);
    expect(h.size()).toBe(0);
  });
});

describe('RV-3 the composer styles every repost class', () => {
  it('each rp-* class the composer renders has a rule in composer.css', () => {
    const root = new URL('../../../entrypoints/composer/', import.meta.url).pathname;
    const css = readFileSync(`${root}composer.css`, 'utf8');
    const used = new Set<string>();
    for (const f of ['RepostIntake.tsx', 'PostTab.tsx']) {
      for (const m of readFileSync(`${root}${f}`, 'utf8').matchAll(/class="([^"]*)"/g)) {
        for (const c of (m[1] ?? '').split(/\s+/)) if (c.startsWith('rp-')) used.add(c);
      }
    }
    expect(used.size).toBeGreaterThan(5);
    // rp-consent is the shared .note (styled); its own class is a test hook.
    const missing = [...used].filter((c) => c !== 'rp-consent' && !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    expect(missing).toEqual([]);
  });
});
