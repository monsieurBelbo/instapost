/**
 * Browser-test fixtures for the autopilot (B11–B14): Instagram's msite structure as instapost's locators
 * read it (src/agent/locators.ts, docs/contract.md C10–C14), rebuilt with plain DOM in the test page. No
 * network, no Instagram: the handlers do what Instagram's React handlers do (the + opens a menu dialog;
 * Story clicks the story input; Post clicks the post input; a file on the story input opens the composer
 * after an SPA navigation; Share shows the upload progress and goes home).
 *
 * The agent's window is a proxy of the test page's window whose `location` is a plain object the fixture
 * moves (`/`, `/create/story/`), so the tap helper's path checks hold without navigating the test frame.
 * Not a test file (no `.test.`): imported by the `*.browser.test.ts` files only.
 */
import { STORY_ACCEPT } from '../core/ig-contract/contract.ts';
import type { DriveDeps } from './drive.ts';
import type { AgentWindow } from './probes.ts';
import { newBudget } from './tap.ts';

export interface FakeLocation {
  pathname: string;
}

export interface WindowOverrides {
  innerWidth?: number;
  innerHeight?: number;
  visibility?: () => DocumentVisibilityState;
}

/** The test page's window, with its location (and optionally its size and visibility) replaced. */
export function agentWindow(location: FakeLocation, over: WindowOverrides = {}): AgentWindow {
  const doc = new Proxy(document, {
    get(target, key) {
      if (key === 'visibilityState' && over.visibility) return over.visibility();
      const v = Reflect.get(target, key, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return new Proxy(window, {
    get(target, key) {
      if (key === 'location') return location;
      if (key === 'document') return doc;
      if (key === 'innerWidth' && over.innerWidth !== undefined) return over.innerWidth;
      if (key === 'innerHeight' && over.innerHeight !== undefined) return over.innerHeight;
      const v = Reflect.get(target, key, target);
      // Methods need the real window as `this`; constructors (File, Event, AbortController) stay as they are.
      return typeof v === 'function' && typeof key === 'string' && /^[a-z]/.test(key) ? v.bind(target) : v;
    },
  }) as unknown as AgentWindow;
}

/** Drive deps over `win`, with every wait scaled down. */
export function driveDeps(win: AgentWindow, scale = 0.05): DriveDeps {
  return {
    win,
    budget: newBudget(),
    now: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: () => 0,
    scale,
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An inline glyph like Instagram's icons: an svg with one path. */
export function glyph(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

export const GLYPHS = {
  plus: 'M12 5v14M5 12h14',
  story: 'M12 2a10 10 0 1 0 0 20',
  post: 'M3 3h18v18H3z',
  extra: 'M4 12h16',
} as const;

export type MenuItem = 'story' | 'post' | 'extra';

/**
 * AM45 (L21): the visible words and ARIA labels of the fixture, as Instagram's English or Spanish UI would
 * show them (es: unverified renderings, see tools/fake-ig/client/i18n.ts). Unset: the fixture's neutral
 * labels (the item keys), as before. The locators never read any of them (U31).
 */
export type FixtureLabels = 'en' | 'es';

const WORDS: Readonly<
  Record<FixtureLabels, { items: Record<MenuItem, string>; home: string; share: string; close: string; rotate: string }>
> = {
  en: {
    items: { story: 'Story', post: 'Post', extra: 'Reel' },
    home: 'Home',
    share: 'Your story',
    close: 'Close',
    rotate: 'Rotate your device to add to your story.',
  },
  es: {
    items: { story: 'Historia', post: 'Publicación', extra: 'Reel' },
    home: 'Inicio',
    share: 'Tu historia',
    close: 'Cerrar',
    rotate: 'Gira tu dispositivo para añadir contenido a tu historia.',
  },
};

export interface HomeOpts {
  /** The menu's items in order (Instagram's order is not known logged out, L18). */
  menu?: MenuItem[];
  /** The + beside the forms: one, none, or two glyph pressables (ambiguous). */
  plus?: 'one' | 'none' | 'two';
  /** Whether + opens the menu: always, never, or only from its second tap. */
  menuOpens?: 'always' | 'never' | 'second';
  /** The popover closes when an item is picked (Instagram's does). */
  closeOnPick?: boolean;
  /** Story refuses to start a session (a landscape viewport, C3a): a toast instead of the input's click. */
  refuseStory?: boolean;
  /** The account link in the navigation, or none. */
  account?: string | null;
  /** What the composer does once a file arrives (see mountComposer). */
  composer?: ComposerOpts;
  /** The composer's SPA navigation happens this long after the file (ms). */
  openAfterMs?: number;
  /** AM45: Instagram's UI language (words and ARIA labels); also passed to the composer. */
  labels?: FixtureLabels;
}

export interface ComposerOpts {
  /** The Share footer: one button (v1), the avatar control (v2, with the Facebook badge), v1 then v2, none, or two. */
  footer?: 'v1' | 'v2' | 'v2plain' | 'v1-then-v2' | 'none' | 'two' | 'flapping';
  /** The canvas is drawn (a backing store) this long after mounting; null: never. */
  drawAfterMs?: number | null;
  /** The rotate snackbar shows instead of the header and footer (C3b failed). */
  landscape?: boolean;
  /** v1 → v2 switch delay. */
  switchAfterMs?: number;
  /** AM45: Instagram's UI language (words and ARIA labels). */
  labels?: FixtureLabels;
}

export interface Mounted {
  root: HTMLElement;
  location: FakeLocation;
  win: AgentWindow;
  storyInput: HTMLInputElement;
  postInput: HTMLInputElement;
  plus: HTMLElement | null;
  /** Clicks each element received, in order: [what, trusted]. */
  clicks: [string, boolean][];
  /** Files the story input's change handler received. */
  files: File[];
  /** How many times + opened a menu. */
  menus: number;
  composer: ComposerParts | null;
  remove(): void;
}

export interface ComposerParts {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  share: HTMLElement | null;
  shareClicks: boolean[];
}

const box = (tag: string, style = ''): HTMLElement => {
  const el = document.createElement(tag);
  if (style) el.setAttribute('style', style);
  return el;
};

function pressable(kind: 'button' | 'link', d: string, label: string): HTMLElement {
  const el = kind === 'link' ? document.createElement('a') : box('div');
  if (kind === 'link') (el as HTMLAnchorElement).href = '#';
  else el.setAttribute('role', 'button');
  el.setAttribute('style', 'display:inline-flex;width:44px;height:44px;align-items:center;justify-content:center');
  el.append(glyph(d));
  const span = document.createElement('span');
  span.textContent = label;
  span.setAttribute('style', 'font-size:10px');
  el.append(span);
  return el;
}

/** Instagram's home (`/`) with the + entry, its two forms, the navigation and, later, the composer. */
export function mountHome(opts: HomeOpts = {}): Mounted {
  const menu = opts.menu ?? ['story', 'post'];
  const location: FakeLocation = { pathname: '/' };
  const root = box('div', 'position:fixed;inset:0;background:#fff;font:12px sans-serif');
  root.dataset.igFixture = '1';
  const m: Mounted = {
    root,
    location,
    win: agentWindow(location),
    storyInput: document.createElement('input'),
    postInput: document.createElement('input'),
    plus: null,
    clicks: [],
    files: [],
    menus: 0,
    composer: null,
    remove: () => root.remove(),
  };

  // The navigation, with the profile link (C14).
  const nav = box('nav', 'display:flex;gap:8px;height:48px');
  nav.setAttribute('role', 'navigation');
  if (opts.account !== null) {
    const me = document.createElement('a');
    me.href = `/${opts.account ?? 'testuser'}/`;
    const avatar = document.createElement('img');
    avatar.alt = '';
    avatar.width = 24;
    avatar.height = 24;
    me.append(avatar);
    me.addEventListener('click', (e) => e.preventDefault());
    nav.append(me);
  }

  // The entry: a 48 px box holding the + and, in the next box, the story form and the post form (C10).
  const entry = box('div', 'display:flex;height:48px;align-items:center');
  const plusBox = box('div');
  const words = opts.labels ? WORDS[opts.labels] : null;
  if (opts.plus !== 'none') {
    const plus = pressable('link', GLYPHS.plus, '');
    // Instagram's + carries its Home string as aria-label (a bug of theirs); never read (C10).
    if (words) plus.querySelector('svg')?.setAttribute('aria-label', words.home);
    plusBox.append(plus);
    m.plus = plus;
    if (opts.plus === 'two') plusBox.append(pressable('link', GLYPHS.extra, ''));
  } else {
    plusBox.append(box('span'));
  }
  const forms = box('div', 'display:flex');
  const storyForm = document.createElement('form');
  storyForm.setAttribute('role', 'presentation');
  m.storyInput.type = 'file';
  m.storyInput.accept = STORY_ACCEPT.join(',');
  m.storyInput.setAttribute('style', 'display:none');
  storyForm.append(m.storyInput);
  const postForm = document.createElement('form');
  postForm.setAttribute('role', 'presentation');
  m.postInput.type = 'file';
  m.postInput.accept = 'image/jpeg,image/png,image/heic,image/heif,video/mp4,video/quicktime';
  m.postInput.setAttribute('style', 'display:none');
  postForm.append(m.postInput);
  forms.append(storyForm, postForm);
  entry.append(plusBox, forms);
  root.append(nav, entry);

  const note = (what: string) => (e: Event) => void m.clicks.push([what, e.isTrusted]);
  m.storyInput.addEventListener('click', note('storyInput'));
  m.postInput.addEventListener('click', note('postInput'));

  let dialog: HTMLElement | null = null;
  let plusTaps = 0;
  m.plus?.addEventListener('click', (e) => {
    e.preventDefault();
    m.clicks.push(['plus', e.isTrusted]);
    plusTaps++;
    const opens = opts.menuOpens ?? 'always';
    if (opens === 'never' || (opens === 'second' && plusTaps < 2)) return;
    if (dialog?.isConnected) return;
    m.menus++;
    dialog = box('div', 'position:fixed;left:8px;top:60px;display:flex;flex-direction:column;background:#eee');
    dialog.setAttribute('role', 'dialog');
    for (const item of menu) {
      const el = pressable('button', GLYPHS[item], words ? words.items[item] : item);
      el.addEventListener('click', (ev) => {
        m.clicks.push([`item:${item}`, ev.isTrusted]);
        if (item === 'story') {
          if (opts.refuseStory) {
            const toast = box('div');
            toast.setAttribute('role', 'alert');
            toast.textContent = words ? words.rotate : 'rotate';
            root.append(toast);
          } else {
            m.storyInput.click();
          }
        } else if (item === 'post') {
          m.postInput.click();
        }
        if (opts.closeOnPick !== false) dialog?.remove();
      });
      dialog.append(el);
    }
    root.append(dialog);
  });

  // Instagram's onChange: reads the file, processes it, SPA-navigates to the composer.
  m.storyInput.addEventListener('change', () => {
    const f = m.storyInput.files?.[0];
    if (!f) return;
    m.files.push(f);
    setTimeout(() => {
      location.pathname = '/create/story/';
      entry.style.display = 'none';
      m.composer = mountComposer(root, location, {
        ...(opts.labels ? { labels: opts.labels } : {}),
        ...opts.composer,
      });
    }, opts.openAfterMs ?? 20);
  });

  document.body.append(root);
  return m;
}

/** The story composer (C12): canvas._aa3c, header._aa3d, the trash footer and the Share footer. */
export function mountComposer(parent: HTMLElement, location: FakeLocation, opts: ComposerOpts = {}): ComposerParts {
  const root = box('div', 'position:absolute;inset:0;display:flex;flex-direction:column;background:#000');
  const parts: ComposerParts = { root, canvas: document.createElement('canvas'), share: null, shareClicks: [] };
  const canvas = parts.canvas;
  canvas.className = '_aa3c';
  canvas.width = 0;
  canvas.height = 0;
  canvas.setAttribute('style', 'flex:1;width:100%;min-height:200px');

  const words = opts.labels ? WORDS[opts.labels] : null;
  if (opts.landscape) {
    const snack = box('div', 'position:absolute;bottom:0;left:0;right:0;height:40px;background:#333');
    snack.className = '_aa3b';
    if (words) snack.textContent = words.rotate;
    root.append(canvas, snack);
  } else {
    const header = box('header', 'height:44px');
    header.className = '_aa3d';
    const close = document.createElement('button');
    close.textContent = '×';
    if (words) close.setAttribute('aria-label', words.close);
    header.append(close);
    const trash = box('footer', 'height:10px');
    trash.className = '_aa3k';
    trash.append(document.createElement('button'));
    root.append(header, canvas, trash);
    const footer = (variant: 'v1' | 'v2' | 'v2plain'): HTMLElement => {
      const f = box('footer', 'height:56px;display:flex;justify-content:flex-end;align-items:center');
      const control =
        variant === 'v1' ? document.createElement('button') : box('div', 'display:inline-flex;width:120px;height:44px');
      if (variant !== 'v1') {
        control.setAttribute('role', 'button');
        const avatar = document.createElement('img');
        avatar.alt = '';
        avatar.width = 24;
        avatar.height = 24;
        control.append(avatar);
        if (variant === 'v2') control.append(glyph(GLYPHS.extra));
      } else {
        control.setAttribute('style', 'width:120px;height:44px');
      }
      control.append(document.createTextNode(words ? words.share : 'Share'));
      control.addEventListener('click', (e) => {
        parts.shareClicks.push(e.isTrusted);
        // Instagram's upload progress, then home.
        const progress = box('div');
        progress.setAttribute('role', 'progressbar');
        parent.append(progress);
        setTimeout(() => {
          location.pathname = '/';
        }, 30);
      });
      f.append(control);
      parts.share = control;
      return f;
    };
    const kind = opts.footer ?? 'v1';
    if (kind === 'two') {
      root.append(footer('v1'), footer('v1'));
    } else if (kind === 'v1-then-v2') {
      const first = footer('v1');
      root.append(first);
      setTimeout(() => first.replaceWith(footer('v2')), opts.switchAfterMs ?? 40);
    } else if (kind === 'flapping') {
      let f = footer('v1');
      root.append(f);
      let n = 0;
      const t = setInterval(() => {
        const next = footer(n++ % 2 === 0 ? 'v2' : 'v1');
        f.replaceWith(next);
        f = next;
        if (!root.isConnected) clearInterval(t);
      }, 30);
    } else if (kind !== 'none') {
      root.append(footer(kind));
    }
  }
  parent.append(root);
  const draw = opts.drawAfterMs === undefined ? 10 : opts.drawAfterMs;
  if (draw !== null) {
    setTimeout(() => {
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#264653';
        ctx.fillRect(0, 0, 1080, 1920);
      }
    }, draw);
  }
  return parts;
}

/** A tiny PNG payload as agent/get-file answers it. */
export async function pngReply(): Promise<{ ok: true; name: string; mime: string; b64: string }> {
  const c = new OffscreenCanvas(9, 16);
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#e9c46a';
    ctx.fillRect(0, 0, 9, 16);
  }
  const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return { ok: true, name: 'story.png', mime: 'image/png', b64: btoa(bin) };
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
