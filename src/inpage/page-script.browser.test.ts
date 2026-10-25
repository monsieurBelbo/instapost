/**
 * B20 (strategy §11 AM48): the content script writes the entry and the coach mark in the language the
 * background sends with `inpage/state` (Settings → Language), and rewrites them when it changes: on a page
 * shaped like Instagram's wide desktop navigation, with a fake runtime (no extension, no network).
 * RL-10: the shortcut is the one the background read from the browser (none shown when there is none).
 * RL-6 (FX7): Instagram's login wall gets no entry, and the page reports itself logged out.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { DEFAULT_UI_PREFS, IDLE_RUN, type PageState } from './messages.ts';
import { type PageRuntime, startPageScript } from './page-script.ts';

const SVG = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M2 2h20v20H2z"/></svg>';
const AVATAR = '<img alt="" width="24" height="24" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';

/** Instagram's wide left navigation (structure only, as anchor.browser.test.ts builds it). */
function wideNav(): void {
  const el = document.createElement('nav');
  Object.assign(el.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    bottom: '0',
    width: '244px',
    display: 'flex',
    flexDirection: 'column',
  });
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
  items.forEach(([href, icon], i) => {
    if (i === items.length - 1) {
      const sp = document.createElement('div');
      sp.style.flex = '1';
      el.append(sp);
    }
    const a = document.createElement('a');
    a.href = href;
    a.style.display = 'flex';
    a.style.padding = '12px';
    a.innerHTML = `${icon}<span>item ${i}</span>`;
    el.append(a);
  });
  document.body.append(el);
}

// The host's shadow root is closed (P8); keep a handle on it for the assertions.
const roots: ShadowRoot[] = [];
const attach = Element.prototype.attachShadow;
beforeAll(async () => {
  Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
    const r = attach.call(this, init);
    roots.push(r);
    return r;
  };
  await page.viewport(1280, 800);
});
afterAll(() => {
  Element.prototype.attachShadow = attach;
});

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  roots.length = 0;
  document.body.innerHTML = '';
});

const stateIn = (lang: 'en' | 'es', shortcut: string | null = '⌥⇧S'): PageState => ({
  run: IDLE_RUN,
  pausedUntil: null,
  prefs: { ...DEFAULT_UI_PREFS, coachSeen: false },
  lang,
  shortcut,
});

function start(hello: PageState) {
  const listeners: Parameters<PageRuntime['listen']>[0][] = [];
  const sent: Record<string, unknown>[] = [];
  const rt: PageRuntime = {
    id: 'ext',
    alive: () => true,
    panelUrl: () => 'about:blank',
    send: (msg) => {
      sent.push(msg as unknown as Record<string, unknown>);
    },
    request: async (msg) => (msg.type === 'inpage/hello' ? hello : null),
    listen: (l) => {
      listeners.push(l);
    },
    connect: () => ({ disconnect: () => undefined, onDisconnect: () => undefined }),
  };
  const handle = startPageScript(window, rt);
  stop = () => handle.dispose();
  const push = (state: PageState) => {
    for (const l of listeners) l({ v: 1, type: 'inpage/state', state }, { id: 'ext' }, () => undefined);
  };
  const root = () => {
    const r = roots.at(-1);
    if (!r) throw new Error('no shadow root');
    return r;
  };
  return { push, root, sent };
}

describe('B20 the entry and the coach in the owner’s language', () => {
  it('Spanish from the start, then English at once when the setting changes', async () => {
    wideNav();
    const { push, root } = start(stateIn('es'));
    await vi.waitFor(
      () => {
        const entry = root().querySelector<HTMLButtonElement>('.entry');
        expect(entry?.classList.contains('off')).toBe(false);
        expect(entry?.querySelector('.lbl')?.textContent).toBe('Nueva historia');
        expect(entry?.getAttribute('aria-label')).toBe('instapost: nueva historia');
        expect(root().querySelector('.coach-h')?.textContent).toBe('Publica una historia desde aquí');
      },
      { timeout: 4000, interval: 50 },
    );
    expect(root().querySelector('.ip')?.getAttribute('lang')).toBe('es');
    expect(root().querySelector('.coach-ok')?.textContent).toBe('Entendido');
    expect(root().querySelector('.entry .key')?.textContent).toBe('⌥⇧S');

    push(stateIn('en'));
    await vi.waitFor(
      () => {
        expect(root().querySelector('.entry .lbl')?.textContent).toBe('New story');
        expect(root().querySelector('.coach-h')?.textContent).toBe('Post a story from here');
      },
      { timeout: 2000, interval: 50 },
    );
    expect(root().querySelector('.entry')?.getAttribute('aria-label')).toBe('instapost: new story');
    expect(root().querySelector('.ip')?.getAttribute('lang')).toBe('en');
    expect(root().querySelector('.coach-ok')?.textContent).toBe('Got it');
  });

  it('a state without a language (an older background) reads English', async () => {
    wideNav();
    const { root } = start({ ...stateIn('en'), lang: undefined as unknown as 'en' });
    await vi.waitFor(() => expect(root().querySelector('.entry .lbl')?.textContent).toBe('New story'), {
      timeout: 4000,
      interval: 50,
    });
  });
});

describe('RL-10 the shortcut is the browser’s, or none', () => {
  it('no shortcut set: no key on the entry or in the coach, no aria-keyshortcuts; then the one the owner set', async () => {
    wideNav();
    const { push, root } = start(stateIn('en', null));
    await vi.waitFor(() => expect(root().querySelector('.coach-h')?.textContent).toBe('Post a story from here'), {
      timeout: 4000,
      interval: 50,
    });
    const entry = root().querySelector('.entry') as HTMLElement;
    expect(entry.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect((entry.querySelector('.key') as HTMLElement).hidden).toBe(true);
    expect(root().querySelector('.coach-b kbd')).toBeNull();
    expect(root().querySelector('.coach-b')?.textContent).toBe(
      'instapost opens over Instagram, so you never leave the page.',
    );

    push(stateIn('en', 'Ctrl+Shift+Y'));
    await vi.waitFor(() => expect(root().querySelector('.coach-b kbd')?.textContent).toBe('Ctrl+Shift+Y'), {
      timeout: 2000,
      interval: 50,
    });
    expect(entry.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+Y');
    expect(entry.querySelector('.key')?.textContent).toBe('Ctrl+Shift+Y');
    expect(root().querySelector('.coach-b')?.textContent).toContain('Shortcut Ctrl+Shift+Y');
  });
});

describe('RL-6 Instagram’s login wall (FX7)', () => {
  it('no navigation and a page without a login form: the corner; a login form and no account link: none, logged out', async () => {
    document.body.innerHTML = '<main><h1>x</h1></main>';
    const { root, sent } = start(stateIn('en'));
    await vi.waitFor(
      () => {
        const entry = root().querySelector('.entry');
        expect(entry?.classList.contains('corner')).toBe(true);
        expect(entry?.classList.contains('off')).toBe(false);
      },
      { timeout: 4000, interval: 50 },
    );
    const form = document.createElement('form');
    form.innerHTML = '<input name="username"><input type="password" name="password"><button>Log in</button>';
    document.querySelector('main')?.append(form);
    await vi.waitFor(
      () => {
        expect(root().querySelector('.entry')?.classList.contains('off')).toBe(true);
        expect(sent.filter((m) => m.type === 'inpage/page').at(-1)).toMatchObject({ loggedIn: false });
      },
      { timeout: 4000, interval: 50 },
    );
  });
});

describe('RL-15 an overlay over the entry hides it, even while the pointer is in the nav', () => {
  it('Instagram’s More menu (a body-level popover) opens over the entry’s slot with the pointer still in the column', async () => {
    wideNav();
    const { root } = start(stateIn('en'));
    const entry = () => root().querySelector<HTMLElement>('.entry') as HTMLElement;
    await vi.waitFor(() => expect(entry().classList.contains('off')).toBe(false), { timeout: 4000, interval: 50 });
    const r = entry().getBoundingClientRect();
    expect(r.width).toBeGreaterThan(0);

    // The pointer goes to a nav item (More), inside the column: the entry's placement is frozen from here.
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 20, bubbles: true }));
    const menu = document.createElement('div');
    Object.assign(menu.style, {
      position: 'fixed',
      left: '12px',
      top: `${Math.max(0, r.top - 40)}px`,
      width: '266px',
      height: `${r.height + 80}px`,
      background: '#fff',
      zIndex: '10',
    });
    menu.setAttribute('role', 'dialog');
    document.body.append(menu);
    await vi.waitFor(() => expect(entry().classList.contains('off')).toBe(true), { timeout: 2000, interval: 30 });

    // The menu closes: the entry is back, in the same place.
    menu.remove();
    await vi.waitFor(() => expect(entry().classList.contains('off')).toBe(false), { timeout: 2000, interval: 30 });
    expect(entry().getBoundingClientRect().top).toBe(r.top);
  });
});
