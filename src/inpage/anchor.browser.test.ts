/**
 * U35 (docs/inpage.md §9.2; inpage-ui-spec.md FE1–FE5): the entry's place on DOM fixtures shaped like
 * Instagram's desktop navigation: wide (labels), collapsed (icons only), renamed (random classes, Spanish
 * labels), no free room, a bottom bar and none. Structural only: the same result whatever the labels and
 * class names.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { entryPlace, findNav, findProfile, isLoginWall, isRtl, navColumn, navItems } from './anchor.ts';

const SVG = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M2 2h20v20H2z"/></svg>';
const AVATAR = '<img alt="" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';

function nav(opts: {
  width: number;
  labels: string[] | null;
  bottom?: boolean;
  cls?: () => string;
  spacer?: boolean;
  /** RL-9: Instagram mirrored (a right-to-left language): the nav at the right edge. */
  right?: boolean;
}): HTMLElement {
  const cls = opts.cls ?? (() => '');
  const items: [string, string][] = [
    ['/', SVG],
    ['#', SVG],
    ['/explore/', SVG],
    ['/reels/', SVG],
    ['/direct/inbox/', SVG],
    ['#', SVG],
    ['#', SVG],
    ['/fake_owner/', AVATAR],
    ['#', SVG],
  ];
  const el = document.createElement('nav');
  el.className = cls();
  Object.assign(
    el.style,
    opts.bottom
      ? { position: 'fixed', left: '0', right: '0', bottom: '0', height: '48px', display: 'flex' }
      : {
          position: 'fixed',
          ...(opts.right ? { right: '0' } : { left: '0' }),
          top: '0',
          bottom: '0',
          width: `${opts.width}px`,
          display: 'flex',
          flexDirection: 'column',
        },
  );
  items.forEach(([href, icon], i) => {
    // The free space between Profile and More (Instagram's spacer).
    if (i === items.length - 1 && opts.spacer !== false && !opts.bottom) {
      const sp = document.createElement('div');
      sp.style.flex = '1';
      el.append(sp);
    }
    const a = document.createElement('a');
    a.href = href;
    a.className = cls();
    a.style.display = 'flex';
    a.style.padding = '12px';
    a.innerHTML = `${icon}${opts.labels ? `<span>${opts.labels[i]}</span>` : ''}`;
    el.append(a);
  });
  document.body.append(el);
  return el;
}

const EN = ['Home', 'Search', 'Explore', 'Reels', 'Messages', 'Notifications', 'Create', 'Profile', 'More'];
const ES = ['Inicio', 'Buscar', 'Explorar', 'Reels', 'Mensajes', 'Notificaciones', 'Crear', 'Perfil', 'Más'];
const rnd = () => `_${Math.random().toString(36).slice(2, 9)}`;

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('dir');
});

const VP = { w: 1280, h: 800 };
const place = (path = '/') => {
  const n = findNav(document);
  return entryPlace(n ? navColumn(n, VP.h) : null, VP, path, true, {
    loginWall: isLoginWall(document),
    rtl: isRtl(document),
  });
};

describe('U35 entry place', () => {
  it('wide: a row 8 px below Profile, as wide as it, with room for the chip', () => {
    const n = nav({ width: 244, labels: EN });
    expect(findNav(document)).toBe(n);
    const profile = findProfile(navItems(n));
    expect(profile?.textContent).toBe('Profile');
    const p = place();
    expect(p.kind).toBe('row');
    const r = (profile as Element).getBoundingClientRect();
    expect(p.rect.x).toBe(Math.round(r.left));
    expect(p.rect.y).toBe(Math.round(r.bottom + 8));
    expect(p.rect.w).toBe(Math.round(r.width));
    expect(p.room).toBeGreaterThanOrEqual(84);
  });

  it('collapsed: a 48×48 tile in the same column', () => {
    nav({ width: 72, labels: null });
    const p = place();
    expect(p.kind).toBe('tile');
    expect(p.rect.w).toBe(48);
  });

  it('renamed classes and a Spanish UI: the same place', () => {
    const n = nav({ width: 244, labels: ES, cls: rnd });
    expect(findProfile(navItems(n))?.textContent).toBe('Perfil');
    expect(place().kind).toBe('row');
  });

  it('no free room below Profile: no entry', () => {
    nav({ width: 244, labels: EN, spacer: false });
    expect(place().kind).toBe('none');
  });

  it('a bottom bar or no navigation: the corner button, none on routes without a nav', () => {
    nav({ width: 0, labels: EN, bottom: true });
    expect(place().kind).toBe('corner');
    document.body.innerHTML = '<main><a href="/explore/">x</a></main>';
    expect(place().kind).toBe('corner');
    expect(place('/stories/someone/').kind).toBe('none');
  });

  it('a narrow viewport: no entry', () => {
    const n = nav({ width: 244, labels: EN });
    expect(entryPlace(navColumn(n, VP.h), { w: 700, h: 800 }, '/', true).kind).toBe('none');
  });

  it('feed links to /explore/ and /reels/ elsewhere on the page are not a navigation', () => {
    const main = document.createElement('main');
    main.style.marginLeft = '300px';
    main.innerHTML = `<a href="/explore/">${SVG}</a><a href="/reels/">${SVG}</a>`;
    document.body.append(main);
    expect(findNav(document)).toBeNull();
  });

  it('RL-9 right to left (Arabic, Hebrew…): the nav at the right edge is found; the row follows Profile', () => {
    document.documentElement.dir = 'rtl';
    const n = nav({ width: 244, labels: EN, right: true });
    expect(findNav(document)).toBe(n);
    const profile = findProfile(navItems(n)) as Element;
    const p = place();
    expect(p.kind).toBe('row');
    expect(p.rect.x).toBe(Math.round(profile.getBoundingClientRect().left));
    // Without a nav the corner mirrors to the top left.
    document.body.innerHTML = '<main></main>';
    expect(place()).toMatchObject({ kind: 'corner', rect: { x: 16, y: 16 } });
    // Left to right, a nav at the right edge is not Instagram's.
    document.documentElement.removeAttribute('dir');
    nav({ width: 244, labels: EN, right: true });
    expect(findNav(document)).toBeNull();
  });

  it('RL-6 (FX7) a login wall (a password field, no account link): no entry, not even the corner', () => {
    document.body.innerHTML = '<main><form><input name="u"><input type="password" name="p"></form></main>';
    expect(isLoginWall(document)).toBe(true);
    expect(place().kind).toBe('none');
    // Logged in (Profile's link somewhere), a password field is just a field (Settings → Password).
    document.body.insertAdjacentHTML('beforeend', `<a href="/fake_owner/">${AVATAR}</a>`);
    expect(isLoginWall(document)).toBe(false);
  });
});
