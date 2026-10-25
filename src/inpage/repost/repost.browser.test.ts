/**
 * docs/repost.md §11: B21 (detect-post on fixture DOM), B22 (the Share dialog and the strip, the
 * popover fallback), B23 (story mentions in a DM thread and the viewer), B28 (the labels fit, en and es).
 * Structure only (Research A S1/S2 shapes), no Instagram, no network: images are data: URLs whose CDN
 * `currentSrc` / `srcset` are stubbed, so nothing is ever requested from a CDN.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import type { PageUiToBackground } from '../messages.ts';
import { scanMentions, storyMedia, viewerMedia } from './detect-mention.ts';
import { readPostClick } from './detect-post.ts';
import { REPOST_CSS, startRepost } from './entry.ts';

const CDN = 'https://scontent-mad1-1.cdninstagram.com/v/t51.2885-15';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const D = { share: 'M13.973 20.046', like: 'M16.792 3.904', comment: 'M20.656 17.008', repost: 'M19.998 9.497' };
const icon = (d: string, label = '') =>
  `<svg width="24" height="24" viewBox="0 0 24 24"${label ? ` aria-label="${label}"` : ''}><path d="${d} 1 1h2v2z"/></svg>`;

beforeAll(async () => {
  await page.viewport(1280, 900);
});
afterEach(() => {
  document.body.innerHTML = '';
});

/** An image whose CDN source is stubbed (its real src is a data: URL). */
function cdnImg(id: string, w: number, h: number, natural = { w: 1080, h: 1350 }): HTMLImageElement {
  const img = document.createElement('img');
  img.src = GIF;
  Object.assign(img.style, { width: `${w}px`, height: `${h}px`, display: 'block' });
  const srcset = `${CDN}/${id}_640.jpg 640w, ${CDN}/${id}_1080.jpg 1080w`;
  const get = img.getAttribute.bind(img);
  img.getAttribute = (n: string) => (n === 'srcset' ? srcset : get(n));
  Object.defineProperty(img, 'currentSrc', { get: () => `${CDN}/${id}_1080.jpg` });
  Object.defineProperty(img, 'naturalWidth', { get: () => natural.w });
  Object.defineProperty(img, 'naturalHeight', { get: () => natural.h });
  Object.defineProperty(img, 'complete', { get: () => true });
  return img;
}

function bar(opts: { shareLabel?: string; shareD?: string } = {}): string {
  const share = icon(opts.shareD ?? D.share, opts.shareLabel ?? '');
  return `<section class="bar" style="display:flex;gap:12px">
    <span><div role="button" class="like">${icon(D.like)}</div></span>
    <span><div role="button" class="comment">${icon(D.comment)}</div></span>
    <span><div role="button" class="share">${share}</div></span></section>`;
}

/** A feed article: header (avatar, author, collaborator), the media, the action bar, the time link. */
function article(opts: {
  author?: string;
  collab?: string;
  code?: string;
  kind?: 'p' | 'reel';
  media?: 'photo' | 'carousel' | 'video';
  shareLabel?: string;
  shareD?: string;
  root?: 'article' | 'dialog';
}): HTMLElement {
  const { author = 'some.user', code = 'C1aBcDeFgH', kind = 'p', media = 'photo', root = 'article' } = opts;
  const el = document.createElement(root === 'article' ? 'article' : 'div');
  if (root === 'dialog') el.setAttribute('role', 'dialog');
  el.style.width = '470px';
  el.innerHTML = `<header style="display:flex;gap:8px;align-items:center">
      <a href="/${author}/"><img class="av" src="${GIF}" style="width:32px;height:32px"></a>
      <a href="/${author}/">${author}</a>${opts.collab ? ` and <a href="/${opts.collab}/">${opts.collab}</a>` : ''}
    </header><div class="media"></div>${bar(opts)}
    <a href="/${kind}/${code}/"><time datetime="2026-10-24T10:00:00.000Z">1d</time></a>`;
  const slot = el.querySelector('.media') as HTMLElement;
  if (media === 'photo') slot.append(cdnImg('one', 468, 585));
  else if (media === 'video') {
    const v = document.createElement('video');
    Object.assign(v.style, { width: '468px', height: '585px', display: 'block' });
    slot.append(v);
  } else {
    slot.innerHTML = `<div role="presentation" style="width:468px;overflow:hidden"><div><ul style="display:flex;margin:0;padding:0;list-style:none;transform:translateX(-468px)"></ul></div></div>`;
    const ul = slot.querySelector('ul') as HTMLUListElement;
    for (const id of ['s1', 's2', 's3']) {
      const li = document.createElement('li');
      li.style.flex = 'none';
      li.append(cdnImg(id, 468, 585));
      ul.append(li);
    }
  }
  document.body.append(el);
  return el;
}

/** A click's composed path from `el` up to the window. */
function pathOf(el: Element): EventTarget[] {
  const out: EventTarget[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) out.push(e);
  out.push(document, window);
  return out;
}
const shareOf = (root: Element) => root.querySelector('.share svg path') as Element;

describe('B21 detect-post', () => {
  it('a feed article: code, author, avatar candidates, widest first', () => {
    const a = article({});
    const r = readPostClick(pathOf(shareOf(a)), 'owner');
    expect(r?.ok).toBe(true);
    if (!r?.ok) return;
    expect(r.post.code).toBe('C1aBcDeFgH');
    expect(r.post.author).toBe('some.user');
    expect(r.post.media.map((m) => m.w)).toEqual([1080, 640]);
    expect(r.post.aspect).toBeCloseTo(0.8, 3);
    expect(r.post.video).toBe(false);
    expect(r.post.isOwn).toBe(false);
    expect(r.post.consent).toBe('unknown');
  });
  it('own post, collab (the first link is the owner), the modal root', () => {
    expect(readPostClick(pathOf(shareOf(article({ author: 'Owner' }))), 'owner')).toMatchObject({
      post: { isOwn: true },
    });
    document.body.innerHTML = '';
    expect(readPostClick(pathOf(shareOf(article({ collab: 'other.one' }))), null)).toMatchObject({
      post: { author: 'some.user' },
    });
    document.body.innerHTML = '';
    expect(readPostClick(pathOf(shareOf(article({ root: 'dialog' }))), null)).toMatchObject({ ok: true });
  });
  it('RV-4: the avatar is the author’s: inside their link, else the only one; a collab stack gives none', () => {
    const avatarIn = (a: HTMLElement) => readPostClick(pathOf(shareOf(a)), null);
    // The author's link holds a CDN avatar.
    let a = article({ collab: 'other.one' });
    (a.querySelector('header img.av') as HTMLImageElement).replaceWith(cdnImg('mine', 32, 32));
    const head = a.querySelector('header') as HTMLElement;
    head.prepend(cdnImg('theirs', 32, 32));
    let r = avatarIn(a);
    expect(r?.ok && r.post.avatar).toBe(`${CDN}/mine_1080.jpg`);
    // Instagram's collab header: two unlinked avatars, the collaborator's first, then the author's link.
    document.body.innerHTML = '';
    a = article({ collab: 'other.one' });
    a.querySelector('header a:has(img.av)')?.remove();
    const stack = document.createElement('div');
    for (const id of ['collab', 'author']) {
      const span = document.createElement('span');
      span.setAttribute('role', 'link');
      span.append(cdnImg(id, 32, 32));
      stack.append(span);
    }
    (a.querySelector('header') as HTMLElement).prepend(stack);
    r = avatarIn(a);
    expect(r?.ok && r.post.author).toBe('some.user');
    expect(r?.ok && r.post.avatar).toBe(null);
    // One unlinked avatar is the author's.
    stack.lastElementChild?.remove();
    r = avatarIn(a);
    expect(r?.ok && r.post.avatar).toBe(`${CDN}/collab_1080.jpg`);
  });
  it('the carousel slide in view, a video slide, a reel', () => {
    const r = readPostClick(pathOf(shareOf(article({ media: 'carousel' }))), null);
    expect(r?.ok && r.post.media[0]?.url).toBe(`${CDN}/s2_1080.jpg`);
    document.body.innerHTML = '';
    expect(readPostClick(pathOf(shareOf(article({ media: 'video' }))), null)).toMatchObject({ post: { video: true } });
    document.body.innerHTML = '';
    expect(readPostClick(pathOf(shareOf(article({ kind: 'reel' }))), null)).toMatchObject({ post: { video: true } });
  });
  it('EN and ES labels stand in for a changed glyph', () => {
    const es = article({ shareD: 'M1 2', shareLabel: 'Compartir' });
    expect(readPostClick(pathOf(shareOf(es)), null)?.ok).toBe(true);
    document.body.innerHTML = '';
    const en = article({ shareD: 'M1 2', shareLabel: 'Share' });
    expect(readPostClick(pathOf(shareOf(en)), null)?.ok).toBe(true);
    document.body.innerHTML = '';
    const none = article({ shareD: 'M1 2', shareLabel: 'Something else' });
    expect(readPostClick(pathOf(shareOf(none)), null)).toBe(null);
  });
  it('a Like click, or the sidebar Messages (Share glyph, no Comment), is ignored', () => {
    const a = article({});
    expect(readPostClick(pathOf(a.querySelector('.like path') as Element), null)).toBe(null);
    const nav = document.createElement('nav');
    nav.innerHTML = `<a href="/direct/inbox/" role="button">${icon(D.share)}</a><a href="#" role="button">${icon(D.like)}</a>`;
    document.body.append(nav);
    expect(readPostClick(pathOf(nav.querySelector('path') as Element), null)).toBe(null);
  });
});

function shareDialog(opts: { input?: boolean; w?: number; h?: number } = {}): HTMLElement {
  const d = document.createElement('div');
  d.setAttribute('role', 'dialog');
  Object.assign(d.style, { position: 'fixed', inset: '0', display: 'grid', placeItems: 'center' });
  const panel = document.createElement('div');
  Object.assign(panel.style, { width: `${opts.w ?? 548}px`, height: `${opts.h ?? 520}px`, background: '#fff' });
  panel.innerHTML = `${opts.input === false ? '' : '<input placeholder="Search">'}<a href="mailto:?body=x">e</a>`;
  d.append(panel);
  return d;
}

function host() {
  const sent: PageUiToBackground[] = [];
  let opened = 0;
  const wrap = document.createElement('div');
  wrap.className = 'ip';
  const style = document.createElement('style');
  style.textContent = REPOST_CSS;
  const h = document.createElement('div');
  h.append(style, wrap);
  document.documentElement.append(h);
  let lang: 'en' | 'es' = 'en';
  let busy = false;
  const handle = startRepost({
    win: window,
    host: h,
    wrap,
    lang: () => lang,
    prefOn: () => true,
    busy: () => busy,
    me: () => 'owner',
    send: (m) => sent.push(m),
    open: () => {
      opened++;
    },
    preload: () => undefined,
  });
  return {
    wrap,
    sent,
    opened: () => opened,
    setLang: (l: 'en' | 'es') => {
      lang = l;
      handle.refresh();
    },
    setBusy: (b: boolean) => {
      busy = b;
      handle.refresh();
    },
    stop: () => {
      handle.dispose();
      h.remove();
    },
  };
}

const until = async <T>(f: () => T | null | undefined, ms = 3000): Promise<T> => {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('B22 the Share dialog, the strip and the popover', () => {
  it('a dialog within 1500 ms gets the strip; its click sends the post and opens the composer', async () => {
    const h = host();
    try {
      const a = article({});
      (shareOf(a) as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      setTimeout(() => document.body.append(shareDialog()), 120);
      const strip = await until(() => h.wrap.querySelector<HTMLButtonElement>('.rp-strip'));
      expect(strip.disabled).toBe(false);
      expect(strip.textContent).toContain('Add to story');
      expect(strip.getAttribute('aria-label')).toBe('instapost: add this post to your story');
      const r = strip.getBoundingClientRect();
      expect(r.height).toBe(56);
      strip.click();
      const msg = h.sent.find((m) => m.type === 'inpage/repost');
      expect(msg).toMatchObject({ src: { kind: 'post', via: 'dialog', bar: 'seen', author: 'some.user' } });
      expect(h.opened()).toBe(1);
      h.setBusy(true);
      expect(strip.disabled).toBe(true);
      expect(strip.textContent).toContain('Wait until the current post finishes');
      document.querySelector('[role="dialog"]')?.remove();
      await until(() => !h.wrap.querySelector('.rp-strip'));
    } finally {
      h.stop();
    }
  });
  it('no dialog (or one without a contact search) gives the popover; a video post shows disabled', async () => {
    const h = host();
    try {
      const a = article({ media: 'video' });
      (shareOf(a) as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      document.body.append(shareDialog({ input: false }));
      const pop = await until(() => h.wrap.querySelector<HTMLButtonElement>('.rp-pop'), 2500);
      expect(pop.disabled).toBe(true);
      expect(pop.textContent).toContain('Videos come later');
      expect(h.sent.some((m) => m.type === 'inpage/repost-diag' && m.why === 'no-dialog')).toBe(true);
    } finally {
      h.stop();
    }
  });
});

describe('B28 the labels fit (en, es)', () => {
  it('the strip at its narrowest, the DM pill, the popover', async () => {
    const h = host();
    try {
      for (const l of ['en', 'es'] as const) {
        h.setLang(l);
        document.body.innerHTML = '';
        const a = article({});
        (shareOf(a) as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
        setTimeout(() => document.body.append(shareDialog({ w: 240 })), 20);
        const strip = await until(() => h.wrap.querySelector<HTMLButtonElement>('.rp-strip'));
        expect(strip.getBoundingClientRect().width).toBe(280);
        for (const el of Array.from(strip.querySelectorAll<HTMLElement>('.rp-l, .rp-s'))) {
          expect(el.scrollWidth, `${l} ${el.textContent}`).toBeLessThanOrEqual(el.clientWidth);
        }
      }
    } finally {
      h.stop();
    }
  });
});

function dmRow(text: string, href: string | null, opts: { video?: boolean; at?: string } = {}): string {
  const media = opts.video
    ? '<video style="width:160px;height:280px;display:block"></video>'
    : `<img class="pv" src="${GIF}">`;
  return `<div class="row"><span>${text}</span>${href ? `<a href="${href}">${media}</a>` : '<div>Story unavailable</div>'}${
    opts.at ? `<time datetime="${opts.at}">x</time>` : ''
  }</div>`;
}

describe('B23 story mentions', () => {
  it('EN and ES mention rows; not replies, shares, placeholders or own stories; videos and expired ones flagged', () => {
    const now = Date.parse('2026-10-25T12:00:00Z');
    const main = document.createElement('main');
    main.innerHTML = [
      dmRow('some.user mentioned you in their story', '/stories/some.user/3456789012/', { at: '2026-10-25T09:00:00Z' }),
      dmRow('otra.cuenta te ha mencionado en su historia', '/stories/otra.cuenta/3456789013/'),
      dmRow('replied to your story', '/stories/owner/3456789014/'),
      dmRow('sent a story', '/stories/third/3456789015/'),
      dmRow('mentioned you in their story', null),
      dmRow('mentioned you in their story', '/stories/owner/3456789016/'),
      dmRow('vid.user mentioned you in their story', '/stories/vid.user/3456789017/', { video: true }),
      dmRow('old.user mentioned you in their story', '/stories/old.user/3456789018/', { at: '2026-10-23T09:00:00Z' }),
    ].join('');
    document.body.append(main);
    const hits = scanMentions(main, 'owner', now);
    expect(hits.map((h) => h.key)).toEqual([
      'some.user/3456789012',
      'otra.cuenta/3456789013',
      'vid.user/3456789017',
      'old.user/3456789018',
    ]);
    expect(hits[0]?.ageMs).toBe(3 * 3600_000);
    expect(hits[2]?.video).toBe(true);
    expect((hits[3]?.ageMs ?? 0) > 24 * 3600_000).toBe(true);
  });
  it('the preview and viewer media', () => {
    const img = cdnImg('st', 320, 568, { w: 640, h: 1137 });
    const m = storyMedia(img);
    expect(m.media[0]?.w).toBe(1080);
    const section = document.createElement('section');
    section.append(cdnImg('viewer', 400, 711, { w: 1080, h: 1920 }));
    document.body.append(section);
    const v = viewerMedia(document, Date.now());
    expect(v.video).toBe(false);
    expect(v.img).not.toBe(null);
    expect(v.rect?.width).toBe(400);
    expect(storyMedia(v.img).aspect).toBeCloseTo(0.5625, 3);
  });
});
