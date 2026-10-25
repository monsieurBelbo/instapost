/**
 * Repost (docs/repost.md §2): the Add to story entries, drawn in the content script's closed shadow root
 * (Instagram's DOM is never edited, P8), wired by page-script.ts.
 *
 * - Posts (RP-4–RP-7): one passive, capture-phase `click` listener reads the click's path. A click on a
 *   post's own Share control (detect-post.ts) waits up to 1500 ms for Instagram's Share dialog
 *   (detect-dialog.ts) and docks an **Add to story** strip to it; without a dialog a pill shows beside the
 *   Share control for 8 s, and with a dialog but no room for the strip, beside the dialog (never over it,
 *   L47). Nothing shows on posts until Share is clicked.
 * - Story mentions (RP-9, RP-10): on a DM thread, an **Add to your story** pill on each confirmed mention's
 *   preview; in the story viewer, the same pill beside a mention seen in the DM (`mentionsSeen`, in memory).
 * - States (RP-8, gate.ts): videos, blocked posts, a run in progress and expired stories show disabled with
 *   their reason; unreadable ones show nothing.
 *
 * A click on an entry sends `inpage/repost` (metadata only, RP-18), then opens the composer. Nothing here
 * clicks, focuses, dispatches, stores, fetches or navigates (RP-17); Instagram's Share dialog stays open
 * under instapost's scrim (R36). Diagnostics: a short reason (`inpage/repost-diag`) when an entry cannot
 * attach, at most once per reason every 10 s.
 */
import { type EntryState, entryEnabled, entryShown, entryState } from '../../core/repost/gate.ts';
import { isDmThread, storyPathOf } from '../../core/repost/paths.ts';
import { isRepostSource, type RepostSource, type ShareBar } from '../../core/repost/source.ts';
import type { PageKey } from '../../ui/catalog.page.en.ts';
import type { Lang } from '../../ui/i18n-core.ts';
import { isControl } from '../anchor.ts';
import type { PageUiToBackground, RepostDiagWhere } from '../messages.ts';
import { pageT } from '../page-copy.ts';
import { DIALOG_WAIT_MS, findShareDialog, panelOf, shareBarOf, visible } from './detect-dialog.ts';
import { type MentionHit, mentionKey, scanMentions, storyMedia, viewerMedia } from './detect-mention.ts';
import { type PostFacts, readPostClick } from './detect-post.ts';
import { fallbackPlace, mentionPillPlace, POPOVER, type Rect, stripPlace, viewerPillPlace } from './place.ts';

export interface RepostDeps {
  win: Window;
  /** The content script's host element (elementsFromPoint returns it for our own UI). */
  host: Element;
  /** Where the entries go (inside the closed shadow root). */
  wrap: HTMLElement;
  lang(): Lang;
  /** Settings → On Instagram → Show Add to story. */
  prefOn(): boolean;
  /** A run is in progress in any tab. */
  busy(): boolean;
  /** The account the page shows (Profile's handle), or null. */
  me(): string | null;
  send(msg: PageUiToBackground): void;
  open(): void;
  preload(): void;
}

export interface RepostHandle {
  /** The language, the pref or the run changed. */
  refresh(): void;
  dispose(): void;
}

export const REPOST_CSS = `
.rp-strip,.rp-pop,.rp-pill{position:fixed;z-index:2;box-sizing:border-box;margin:0;border:0;font:inherit;text-align:left;cursor:pointer;
  -webkit-tap-highlight-color:transparent;animation:rise var(--d2) var(--ease) both}
.rp-strip{display:flex;align-items:center;gap:12px;height:56px;padding:0 14px 0 8px;border-radius:12px;background:var(--ig-elev);
  color:var(--ig-text);box-shadow:var(--pop-shadow);outline:1px solid var(--pop-border);outline-offset:-1px;--dot-ring:var(--ig-elev)}
.rp-strip:hover:not(:disabled),.rp-pop:hover:not(:disabled){background-image:linear-gradient(var(--ig-hover),var(--ig-hover))}
.rp-strip:disabled,.rp-pop:disabled,.rp-pill:disabled{cursor:default}
.rp-strip:disabled .rp-mk,.rp-strip:disabled .rp-l,.rp-strip:disabled .rp-chev{opacity:.45}
.rp-mk{width:40px;height:40px;flex:none;color:var(--ig-text)}
.rp-mk .rp-ring{stroke:var(--accent)}
.rp-tx{flex:1;min-width:0;display:flex;flex-direction:column}
.rp-l{font:600 14px/18px var(--font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-s{font:400 12px/16px var(--font);color:var(--ig-text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-chev{width:16px;height:16px;color:var(--ig-text-2)}
.rp-pop{display:flex;align-items:center;gap:8px;height:${POPOVER.h}px;padding:0 14px 0 6px;border-radius:18px;background:var(--ig-elev);
  color:var(--ig-text);box-shadow:var(--pop-shadow);outline:1px solid var(--pop-border);outline-offset:-1px;white-space:nowrap;
  font:600 14px/18px var(--font);--dot-ring:var(--ig-elev)}
.rp-pop .rp-mk{width:26px;height:26px}
.rp-pop:disabled{color:var(--ig-text-2);font-weight:400}
.rp-pill{display:flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:16px;
  background:rgba(0,0,0,.62);color:#fff;font:600 13px/16px var(--font);white-space:nowrap;overflow:hidden;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 2px 8px rgba(0,0,0,.25)}
.rp-pill span{overflow:hidden;text-overflow:ellipsis}
.rp-pill.round{width:32px;padding:0;border-radius:50%}
.rp-pill.round span{display:none}
.rp-pill:hover:not(:disabled){background:rgba(0,0,0,.78)}
.rp-pill.viewer{background:#fff;color:#000}
.rp-pill.viewer:hover:not(:disabled){background:#efefef}
.rp-pill:disabled{opacity:.72}
.rp-pill svg{width:16px;height:16px}
.rp-off{visibility:hidden;pointer-events:none}
.rp-strip:focus-visible,.rp-pop:focus-visible,.rp-pill:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
`;

const NS = 'http://www.w3.org/2000/svg';
const POPOVER_MS = 8000;
const SCROLL_DISMISS_PX = 40;
const SCAN_MS = 500;
const ROUTE_MS = 400;
const TRACK_MS = 300;
const DIAG_MS = 10_000;

type PostVia = 'dialog' | 'popover';

interface PostEntry {
  post: PostFacts;
  control: Element;
  dialog: Element | null;
  panel: Element | null;
  bar: ShareBar;
  via: PostVia;
  el: HTMLButtonElement;
  anchorY: number;
  timer: number;
}

interface Pending {
  post: PostFacts;
  control: Element;
  root: Element;
  before: Set<Element>;
  mo: MutationObserver;
  timer: number;
}

interface Pill {
  el: HTMLButtonElement;
  hit: MentionHit;
}

interface ViewerPill {
  el: HTMLButtonElement;
  key: string;
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

export function startRepost(d: RepostDeps): RepostHandle {
  const { win, wrap } = d;
  const doc = win.document;
  let disposed = false;
  const T = (key: PageKey, args?: Readonly<Record<string, string>>): string =>
    (pageT as (lang: Lang, key: PageKey, args?: Readonly<Record<string, string>>) => string)(d.lang(), key, args);
  const vp = () => ({
    w: doc.documentElement.clientWidth || win.innerWidth,
    h: doc.documentElement.clientHeight || win.innerHeight,
  });
  const svg = (tag: string, attrs: Record<string, string>, ...kids: SVGElement[]): SVGElement => {
    const e = doc.createElementNS(NS, tag) as SVGElement;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...kids);
    return e;
  };
  const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' };
  /** instapost's mark for reposts: a story ring with a "+" and the jade dot. */
  const markSvg = (): SVGElement =>
    svg(
      'svg',
      { class: 'rp-mk', viewBox: '0 0 40 40', 'aria-hidden': 'true' },
      svg('circle', { class: 'rp-ring', cx: '20', cy: '20', r: '17', fill: 'none', 'stroke-width': '2.5' }),
      svg('path', { d: 'M20 13.5v13M13.5 20h13', ...stroke }),
      svg('circle', { class: 'mark-dot', cx: '32', cy: '8', r: '4' }),
    );
  const plusSvg = (): SVGElement =>
    svg('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' }, svg('path', { d: 'M8 3v10M3 8h10', ...stroke }));
  const chevSvg = (): SVGElement =>
    svg(
      'svg',
      { class: 'rp-chev', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      svg('path', { d: 'M6 3.5 10.5 8 6 12.5', ...stroke }),
    );
  const button = (cls: string): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = cls;
    return b;
  };
  const place = (el: HTMLElement, r: Rect | null) => {
    el.classList.toggle('rp-off', r === null);
    if (!r) return;
    Object.assign(el.style, {
      left: `${Math.round(r.x)}px`,
      top: `${Math.round(r.y)}px`,
      width: `${Math.round(r.w)}px`,
    });
  };

  // ---- diagnostics --------------------------------------------------------------------------------------

  const lastDiag = new Map<string, number>();
  function diag(where: RepostDiagWhere, why: string): void {
    const k = `${where}:${why}`;
    const t = Date.now();
    if ((lastDiag.get(k) ?? -Infinity) > t - DIAG_MS) return;
    lastDiag.set(k, t);
    d.send({ v: 1, type: 'inpage/repost-diag', where, why });
  }

  // ---- states and texts ---------------------------------------------------------------------------------

  const postState = (p: PostFacts): EntryState =>
    entryState({
      pref: d.prefOn(),
      readable: true,
      video: p.video,
      consent: p.consent,
      isOwn: p.isOwn,
      busy: d.busy(),
    });

  /** The second line (and tooltip) of a disabled entry. */
  function reason(s: EntryState, handle: string): string {
    if (s === 'video') return T('page.repost.video');
    if (s === 'blocked') return T('page.repost.blocked', { handle });
    if (s === 'busy') return T('page.repost.busy');
    if (s === 'expired') return T('page.repost.expired');
    return '';
  }

  function setTip(el: HTMLElement, text: string): void {
    if (text) el.setAttribute('title', text);
    else el.removeAttribute('title');
  }

  // ---- posts: the strip and the popover (RP-4–RP-7) -------------------------------------------------------

  let pending: Pending | null = null;
  let entry: PostEntry | null = null;

  function stopPending(): void {
    if (!pending) return;
    pending.mo.disconnect();
    win.clearTimeout(pending.timer);
    pending = null;
  }

  function clearPost(): void {
    stopPending();
    if (!entry) return;
    win.clearTimeout(entry.timer);
    entry.el.remove();
    entry = null;
  }

  function renderPost(e: PostEntry): void {
    const s = postState(e.post);
    if (!entryShown(s)) {
      clearPost();
      return;
    }
    const on = entryEnabled(s);
    e.el.disabled = !on;
    const why = reason(s, e.post.author);
    setTip(e.el, why);
    e.el.setAttribute('aria-label', on ? T('page.repost.addName') : `${T('page.repost.add')}: ${why}`);
    if (e.via === 'dialog') {
      const l = e.el.querySelector('.rp-l');
      const sm = e.el.querySelector('.rp-s');
      if (l) l.textContent = T('page.repost.add');
      if (sm) sm.textContent = on ? T('page.repost.with') : why;
    } else {
      const l = e.el.querySelector('.rp-l');
      if (l) l.textContent = on ? T('page.repost.add') : why;
    }
  }

  function postSource(e: PostEntry): RepostSource {
    const p = e.post;
    return {
      kind: 'post',
      author: p.author,
      code: p.code,
      storyPk: null,
      media: p.media.map((m) => ({ url: m.url, w: m.w })),
      aspect: p.aspect,
      avatar: p.avatar,
      slide: p.slide,
      isOwn: p.isOwn,
      consent: p.consent === 'allowed' ? 'allowed' : 'unknown',
      via: e.via,
      bar: e.bar,
    };
  }

  function go(src: RepostSource, where: RepostDiagWhere): boolean {
    if (!isRepostSource(src)) {
      diag(where, 'invalid-source');
      return false;
    }
    d.send({ v: 1, type: 'inpage/repost', src });
    d.open();
    return true;
  }

  function newPostEntry(
    post: PostFacts,
    control: Element,
    via: PostVia,
    dialog: Element | null,
    panel: Element | null,
    bar: ShareBar,
  ): PostEntry {
    const el = button(via === 'dialog' ? 'rp-strip' : 'rp-pop');
    const l = doc.createElement('span');
    l.className = 'rp-l';
    if (via === 'dialog') {
      const tx = doc.createElement('span');
      tx.className = 'rp-tx';
      const sm = doc.createElement('span');
      sm.className = 'rp-s';
      tx.append(l, sm);
      el.append(markSvg(), tx, chevSvg());
    } else {
      el.append(markSvg(), l);
    }
    const e: PostEntry = { post, control, dialog, panel, bar, via, el, anchorY: rectOf(control).y, timer: 0 };
    el.addEventListener('pointerenter', () => d.preload());
    el.addEventListener('click', () => {
      if (entry !== e || !entryEnabled(postState(e.post))) return;
      if (go(postSource(e), 'post') && e.via === 'popover') clearPost();
    });
    wrap.append(el);
    renderPost(e);
    return e;
  }

  function showStrip(p: Pending, dialog: Element): void {
    const panel = panelOf(dialog, vp());
    if (!panel) {
      diag('dialog', 'no-panel');
      showPopover(p, 'unknown', dialog);
      return;
    }
    const bar = shareBarOf(panel);
    const at = stripPlace(rectOf(panel), vp());
    if (!at) {
      diag('dialog', 'strip-no-room');
      showPopover(p, bar, panel);
      return;
    }
    entry = newPostEntry(p.post, p.control, 'dialog', dialog, panel, bar);
    if (entry) place(entry.el, at);
    schedule();
  }

  /** The fallback pill; `avoid` is the open Share dialog (or its panel) it must never cover (L47). */
  function showPopover(p: Pick<Pending, 'post' | 'control'>, bar: ShareBar, avoid: Element | null = null): void {
    if (!p.control.isConnected) {
      diag('post', 'control-gone');
      return;
    }
    const e = newPostEntry(p.post, p.control, 'popover', avoid, null, bar);
    const at = popoverAt(e);
    if (!at) {
      diag('post', 'popover-no-room');
      e.el.remove();
      return;
    }
    entry = e;
    place(e.el, at);
    e.timer = win.setTimeout(() => {
      if (entry === e) clearPost();
    }, POPOVER_MS);
  }

  function onShareClick(ev: Event): void {
    if (disposed || !d.prefOn()) return;
    const path = ev.composedPath();
    if (path.includes(d.host)) return;
    const read = readPostClick(path, d.me());
    if (read === null) return;
    if (!read.ok) {
      diag('post', read.why);
      return;
    }
    clearPost();
    const before = new Set(Array.from(doc.querySelectorAll('[role="dialog"]')));
    const check = () => {
      const p = pending;
      if (!p) return;
      const dialog = findShareDialog(doc, p.before, p.root);
      if (!dialog) return;
      stopPending();
      showStrip(p, dialog);
    };
    const mo = new MutationObserver(check);
    if (doc.body) mo.observe(doc.body, { childList: true, subtree: true });
    pending = {
      post: read.post,
      control: read.control,
      root: read.root,
      before,
      mo,
      timer: win.setTimeout(() => {
        const p = pending;
        if (!p) return;
        stopPending();
        diag('dialog', 'no-dialog');
        showPopover(p, 'unknown');
      }, DIALOG_WAIT_MS),
    };
    win.requestAnimationFrame(check);
  }

  function popoverAt(e: PostEntry): Rect | null {
    const avoid = e.dialog && visible(e.dialog) ? rectOf(e.dialog) : null;
    return fallbackPlace(rectOf(e.control), { w: e.el.offsetWidth || 160, h: POPOVER.h }, vp(), avoid);
  }

  function trackPost(): void {
    const e = entry;
    if (!e) return;
    if (e.via === 'dialog') {
      if (!e.dialog || !e.panel || !visible(e.dialog) || !visible(e.panel)) {
        clearPost();
        return;
      }
      place(e.el, stripPlace(rectOf(e.panel), vp()));
      return;
    }
    if (!e.control.isConnected || Math.abs(rectOf(e.control).y - e.anchorY) > SCROLL_DISMISS_PX) {
      clearPost();
      return;
    }
    // Beside a Share dialog: it goes with the dialog.
    if (e.dialog && !visible(e.dialog)) {
      clearPost();
      return;
    }
    place(e.el, popoverAt(e));
  }

  // ---- story mentions (RP-9, RP-10) -----------------------------------------------------------------------

  const mentionsSeen = new Set<string>();
  const pills = new Map<string, Pill>();
  let viewer: ViewerPill | null = null;
  let routeMo: MutationObserver | null = null;
  let lastScan = 0;
  let scanTimer = 0;
  let route = '';
  let lastMe: string | null = null;
  const me = () => {
    const m = d.me();
    if (m !== null) lastMe = m;
    return m ?? lastMe;
  };

  const mentionState = (hit: MentionHit): EntryState =>
    entryState({
      pref: d.prefOn(),
      readable: hit.video || storyMedia(hit.img).media.length > 0,
      video: hit.video,
      consent: 'allowed',
      isOwn: false,
      busy: d.busy(),
      ageMs: hit.ageMs,
    });

  function renderPill(el: HTMLButtonElement, s: EntryState, handle: string): void {
    const on = entryEnabled(s);
    el.disabled = !on;
    const why = reason(s, handle);
    setTip(el, on ? T('page.repost.mention') : why);
    el.setAttribute(
      'aria-label',
      on ? T('page.repost.mentionName', { handle }) : `${T('page.repost.mention')}: ${why}`,
    );
    const span = el.querySelector('span');
    if (span) span.textContent = on ? T('page.repost.mention') : why;
  }

  function newPill(cls: string, onClick: () => void): HTMLButtonElement {
    const el = button(cls);
    const span = doc.createElement('span');
    el.append(plusSvg(), span);
    el.addEventListener('pointerenter', () => d.preload());
    el.addEventListener('click', onClick);
    wrap.append(el);
    return el;
  }

  function clearPills(): void {
    for (const p of pills.values()) p.el.remove();
    pills.clear();
  }

  function clearViewer(): void {
    viewer?.el.remove();
    viewer = null;
  }

  /** The point's topmost element that is not our host. */
  const hitAt = (x: number, y: number): Element | null => doc.elementsFromPoint(x, y).find((e) => e !== d.host) ?? null;

  function placePills(): void {
    for (const p of pills.values()) {
      const a = p.hit.anchor;
      if (!a.isConnected) {
        place(p.el, null);
        continue;
      }
      const r = rectOf(a);
      if (r.w <= 0 || r.h <= 0) {
        place(p.el, null);
        continue;
      }
      const at = mentionPillPlace(r);
      p.el.classList.toggle('round', at.kind === 'round');
      const hit = hitAt(at.x + at.w / 2, at.y + at.h / 2);
      // Clipped by the thread's scroller or covered by an overlay: hidden.
      place(p.el, hit && (hit === a || a.contains(hit)) ? at : null);
    }
  }

  function scanDm(): void {
    const scope = doc.querySelector('main') ?? doc.body;
    if (!scope) return;
    const hits = scanMentions(scope, me(), Date.now());
    const keep = new Set<string>();
    for (const hit of hits) {
      const s = mentionState(hit);
      if (!entryShown(s)) {
        if (s === 'unreadable') diag('mention', 'no-cdn-media');
        continue;
      }
      mentionsSeen.add(hit.key);
      keep.add(hit.key);
      let p = pills.get(hit.key);
      if (!p) {
        const key = hit.key;
        const el = newPill('rp-pill', () => {
          const cur = pills.get(key);
          if (!cur || !entryEnabled(mentionState(cur.hit))) return;
          const m = storyMedia(cur.hit.img);
          go(
            {
              kind: 'mention',
              author: cur.hit.user,
              code: null,
              storyPk: cur.hit.pk,
              media: m.media,
              aspect: m.aspect,
              avatar: null,
              slide: null,
              isOwn: false,
              consent: 'allowed',
              via: 'dm',
              bar: 'unknown',
            },
            'mention',
          );
        });
        p = { el, hit };
        pills.set(key, p);
      }
      p.hit = hit;
      renderPill(p.el, s, hit.user);
    }
    for (const [k, p] of pills) {
      if (!keep.has(k)) {
        p.el.remove();
        pills.delete(k);
      }
    }
    placePills();
  }

  function viewerState(now: number): { s: EntryState; vm: ReturnType<typeof viewerMedia> } {
    const vm = viewerMedia(doc, now);
    const s = entryState({
      pref: d.prefOn(),
      readable: vm.rect !== null && (vm.video || storyMedia(vm.img).media.length > 0),
      video: vm.video,
      consent: 'allowed',
      isOwn: false,
      busy: d.busy(),
      ageMs: vm.ageMs,
    });
    return { s, vm };
  }

  function scanViewer(): void {
    const sp = storyPathOf(win.location.pathname);
    const key = sp ? mentionKey(sp.user, sp.pk) : '';
    if (!sp || !mentionsSeen.has(key)) {
      clearViewer();
      return;
    }
    const { s, vm } = viewerState(Date.now());
    // RP-10: no pill at 24 h or older; unreadable shows nothing.
    if (!entryShown(s) || s === 'expired' || !vm.rect) {
      if (viewer) place(viewer.el, null);
      return;
    }
    if (!viewer || viewer.key !== key) {
      clearViewer();
      const v: ViewerPill = {
        key,
        el: newPill('rp-pill viewer', () => {
          // R39: the viewer may have advanced under the pill: re-read the pk and the image.
          const now = storyPathOf(win.location.pathname);
          if (!now || mentionKey(now.user, now.pk) !== v.key) {
            diag('viewer', 'advanced');
            clearViewer();
            return;
          }
          const st = viewerState(Date.now());
          if (!entryEnabled(st.s)) return;
          const m = storyMedia(st.vm.img);
          go(
            {
              kind: 'mention',
              author: now.user,
              code: null,
              storyPk: now.pk,
              media: m.media,
              aspect: m.aspect,
              avatar: null,
              slide: null,
              isOwn: false,
              consent: 'allowed',
              via: 'viewer',
              bar: 'unknown',
            },
            'viewer',
          );
        }),
      };
      viewer = v;
    }
    renderPill(viewer.el, s, sp.user);
    const r = vm.rect;
    const size = { w: viewer.el.offsetWidth || 160, h: 32 };
    const blocked = (c: Rect) => {
      const hit = hitAt(c.x + c.w / 2, c.y + c.h / 2);
      return hit !== null && isControl(hit);
    };
    const at = viewerPillPlace({ x: r.left, y: r.top, w: r.width, h: r.height }, size, vp(), blocked);
    if (!at) diag('viewer', 'no-room');
    place(viewer.el, at ? { ...at, w: size.w } : null);
  }

  function scan(): void {
    scanTimer = 0;
    if (disposed) return;
    lastScan = Date.now();
    if (!d.prefOn()) {
      clearPills();
      clearViewer();
      return;
    }
    const path = win.location.pathname;
    if (isDmThread(path)) scanDm();
    else clearPills();
    if (storyPathOf(path)) scanViewer();
    else clearViewer();
  }

  /** Mutations are throttled to one scan per 500 ms. */
  function scheduleScan(): void {
    if (disposed || scanTimer) return;
    const wait = Math.max(0, SCAN_MS - (Date.now() - lastScan));
    scanTimer = win.setTimeout(scan, wait);
  }

  function routeTick(): void {
    const path = win.location.pathname;
    if (path === route) return;
    route = path;
    // A route change ends the popover (RP-7) and the previous route's pills.
    if (entry?.via === 'popover') clearPost();
    clearPills();
    clearViewer();
    routeMo?.disconnect();
    routeMo = null;
    if ((isDmThread(path) || storyPathOf(path)) && doc.body) {
      routeMo = new MutationObserver(scheduleScan);
      routeMo.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'srcset'],
      });
      scheduleScan();
    }
  }

  // ---- tracking -------------------------------------------------------------------------------------------

  let raf = 0;
  function frame(): void {
    raf = 0;
    if (disposed) return;
    trackPost();
    if (pills.size > 0) placePills();
    if (viewer) scanViewer();
  }
  function schedule(): void {
    if (!raf && !disposed) raf = win.requestAnimationFrame(frame);
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && entry?.via === 'popover') clearPost();
  };
  const onPointerDown = (e: Event) => {
    if (entry?.via !== 'popover') return;
    const path = e.composedPath();
    // Using Instagram's Share dialog (search, scroll) keeps the pill beside it; anything else dismisses it.
    if (path.includes(entry.el) || (entry.dialog && path.includes(entry.dialog))) return;
    clearPost();
  };
  win.addEventListener('click', onShareClick, { passive: true, capture: true });
  win.addEventListener('keyup', onKeyUp, { passive: true, capture: true });
  win.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
  win.addEventListener('scroll', schedule, { passive: true, capture: true });
  win.addEventListener('resize', schedule, { passive: true });
  const routeTimer = win.setInterval(routeTick, ROUTE_MS);
  const trackTimer = win.setInterval(() => {
    if (entry || pills.size > 0 || viewer) schedule();
  }, TRACK_MS);
  routeTick();

  return {
    refresh() {
      if (disposed) return;
      if (!d.prefOn()) {
        clearPost();
        clearPills();
        clearViewer();
        return;
      }
      if (entry) renderPost(entry);
      for (const p of pills.values()) renderPill(p.el, mentionState(p.hit), p.hit.user);
      scheduleScan();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearPost();
      clearPills();
      clearViewer();
      routeMo?.disconnect();
      win.clearInterval(routeTimer);
      win.clearInterval(trackTimer);
      win.clearTimeout(scanTimer);
      if (raf) win.cancelAnimationFrame(raf);
      win.removeEventListener('click', onShareClick, { capture: true });
      win.removeEventListener('keyup', onKeyUp, { capture: true });
      win.removeEventListener('pointerdown', onPointerDown, { capture: true });
      win.removeEventListener('scroll', schedule, { capture: true });
      win.removeEventListener('resize', schedule);
    },
  };
}
