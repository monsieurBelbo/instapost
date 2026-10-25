/**
 * The in-page content script (inpage-ui-spec.md FI1–FI3, FE1–FE9, FS7, FS8; docs/inpage.md §3, §8.4):
 * Instagram's desktop top frame only, at document_idle, isolated world.
 *
 * It owns one host element appended to `<html>` with a closed shadow root (P8: Instagram's DOM is never
 * edited), at the top of the page's stacking order, and inside it:
 * - **the entry** ("New story"): a twin of Instagram's nav rows in the nav's free space below Profile (FE1),
 *   or above More (FE2), a 48×48 tile in the collapsed nav (FE3), a 40-px corner button when there is no
 *   nav (FE4), or nothing (FE5). Placed by measurement (anchor.ts), tracked with a ResizeObserver and
 *   MutationObservers coalesced per animation frame, faded while its anchor moves and whenever an Instagram
 *   overlay covers it (occlusion, FE7). Its states (FE6): idle, open, posting in another tab (a ring that
 *   fills per step), a result in another tab, paused. A tooltip and a one-time coach mark (FE8).
 * - **the composer**: one iframe of the extension's `composer.html` (web-accessible, dynamic URL),
 *   preloaded on the entry's hover or focus and kept loaded. Open: the whole viewport (it draws its own
 *   scrim, so no click reaches Instagram). Chip: the entry's slot (it draws the chip). Closed: 0×0, hidden.
 *   The content script owns the mode; the composer asks for changes through the background (never
 *   `postMessage`, which Instagram would see).
 * - **the engine frame**, only while a run is in progress, on the background's command: an iframe of
 *   `https://www.instagram.com/` (no sandbox, `referrerpolicy="origin"`, camera and the rest denied), sized
 *   by frameBox() and restyled (transform, radius, opacity), never re-parented, between the dialog's stage
 *   (Small, Large or Hidden, geometry.ts) and the chip's thumbnail. `pointer-events: none`. Removed on
 *   command or when the background's port goes away.
 * - **the chip's badge** (✓ ! ?) above the thumbnail.
 *
 * It reports the frame's `load` and its pathname (polled every 250 ms: msite moves by pushState), and sets
 * a `beforeunload` guard on command. It never clicks, never uses the network, never stores anything, never
 * binds a key on Instagram's page (FX18), and never writes into Instagram's DOM other than appending its
 * host (check-bundle T3, in-page mode).
 */
import { frameBoxFor } from '../core/inpage/frame-box.ts';
import {
  type EntryPlace,
  entryPlace,
  findNav,
  findProfile,
  isControl,
  isLoginWall,
  isRtl,
  NONE,
  navColumn,
  navItems,
  profileHandle,
} from './anchor.ts';
import { chipPlace, dialogLayout, type PreviewMode, previewSlot, type Slot, thumbSlot } from './geometry.ts';
import {
  type BackgroundToPage,
  type ComposerMode,
  DEFAULT_UI_PREFS,
  IDLE_RUN,
  isBackgroundToPage,
  type OpenFrameReply,
  PAGE_PORT,
  type PageState,
  type PageToBackground,
  type PageUiToBackground,
} from './messages.ts';
import {
  ariaShortcut,
  coachCopy,
  type EntryLook,
  FRAME_TITLE,
  type Glyph,
  entryLook as lookOf,
  OTHER_RESULT_MS,
  shortcutOf,
  toLang,
} from './page-copy.ts';
import { type PagePalette, pagePalette } from './theme.ts';

export interface PageRuntime {
  id: string;
  /** False once the extension was reloaded or updated (this script is then an orphan). */
  alive(): boolean;
  panelUrl(): string;
  send(msg: PageToBackground | PageUiToBackground): void;
  request(msg: PageUiToBackground): Promise<unknown>;
  listen(listener: (msg: unknown, sender: { id?: string }, reply: (r: unknown) => void) => boolean | undefined): void;
  connect(name: string): { disconnect(): void; onDisconnect(cb: () => void): void };
}

const ENGINE_SRC = 'https://www.instagram.com/';
const ENGINE_ALLOW =
  "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; payment 'none'; clipboard-read 'none'; web-share 'none'";
const POLL_MS = 250;
/** FE7: the entry returns once its anchor has been still this long. */
const STABLE_MS = 150;
/** FC1: the composer's dialog fades out this long before the iframe shrinks. */
const FADE_MS = 200;
const FADE_REDUCED_MS = 100;
const GLIDE_MS = 280;
/** FS8: Posted, Test passed and Stopped stay on the chip this long. */
const CHIP_RESULT_MS = 10_000;
const TIP_DELAY_MS = 350;
/** How often the nav is looked for while the page has none. */
const LOOKUP_MS = 500;
const RING = 100.5;

const STROKE = { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' };

const CSS = `
:host{all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647}
.ip{--font:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--ease:cubic-bezier(.2,0,0,1);
  --accent:#0b7a6c;--on-accent:#fff;--danger:#c62828;--warn:#a15c00;--on-warn:#fff;
  --pop-shadow:0 4px 12px rgba(0,0,0,.15);--pop-border:transparent;--tip-bg:#262626;--tip-fg:#f5f5f5;
  --d1:120ms;--d2:200ms;--d3:280ms;font:400 16px/20px var(--font);color:var(--ig-text);-webkit-font-smoothing:antialiased}
.ip[data-scheme=dark]{--accent:#3dd6be;--on-accent:#00231e;--danger:#ff6b6b;--warn:#ffb547;--on-warn:#000;
  --pop-shadow:0 8px 24px rgba(0,0,0,.55);--pop-border:#363636;--tip-bg:#363636}
@media (prefers-reduced-motion: reduce){.ip{--d2:100ms;--d3:0ms}}
*{box-sizing:border-box}
svg{display:block;flex:none}
.entry{position:fixed;z-index:1;display:flex;align-items:center;gap:16px;height:48px;margin:0;padding:12px;border:0;border-radius:8px;
  background:transparent;color:var(--ig-text);font:inherit;text-align:left;cursor:pointer;--dot-ring:var(--ig-bg);
  transition:background-color var(--d1),opacity var(--d1),visibility 0s}
.entry:hover{background:var(--ig-hover)}
.entry:active{background:color-mix(in srgb,var(--ig-text) 9%,transparent)}
.entry:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.entry.off{opacity:0;visibility:hidden;pointer-events:none;transition:opacity var(--d1),visibility 0s linear var(--d1)}
.entry .mk{position:relative;width:24px;height:24px;flex:none;transition:scale var(--d1) var(--ease)}
.entry:hover .mk{scale:1.05}
.entry .mark{position:absolute;inset:0;width:24px;height:24px;transition:scale var(--d2) var(--ease)}
.mark-dot{fill:var(--accent);stroke:var(--dot-ring);stroke-width:2;transition:opacity var(--d2)}
.entry .lbl{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.entry .lbl small{font-size:14px;color:var(--ig-text-2);font-variant-numeric:tabular-nums;margin-left:6px}
kbd{font:500 11px/16px var(--font);padding:0 5px;border-radius:4px;background:color-mix(in srgb,currentColor 12%,transparent);letter-spacing:.02em;white-space:nowrap}
.entry .key{opacity:0;transition:opacity var(--d1)}
.entry:is(:hover,:focus-visible) .key{opacity:1}
.entry:not([data-state=idle]) .key{display:none}
.entry.tile{width:48px!important;justify-content:center}
.entry.tile .lbl,.entry.tile .key,.entry.corner .lbl,.entry.corner .key{display:none}
.entry[aria-expanded=true] .lbl{font-weight:700}
.entry.corner{width:40px;height:40px;padding:0;border-radius:50%;justify-content:center;background:var(--ig-elev);
  box-shadow:var(--pop-shadow);border:1px solid var(--pop-border);--dot-ring:var(--ig-elev)}
.entry.corner:active{scale:.96}
.ring{position:absolute;left:-5px;top:-5px;width:34px;height:34px;rotate:-90deg;opacity:0;transition:opacity var(--d2)}
.ring circle{fill:none;stroke-width:2}
.ring .tr{stroke:var(--ig-sep)}
.ring .pr{stroke:var(--accent);stroke-linecap:round;stroke-dasharray:${RING};stroke-dashoffset:${RING};transition:stroke-dashoffset 500ms var(--ease)}
.entry[data-state=busy] .ring{opacity:1}
.entry[data-state=busy] .mark{scale:.66}
.entry:is([data-state=busy],[data-state=paused],[data-state=result]) .mark-dot{opacity:0}
.e-badge{position:absolute;right:-5px;top:-5px;width:14px;height:14px;border-radius:50%;border:2px solid var(--ig-bg);display:grid;place-items:center;
  opacity:0;scale:.25;background:var(--ig-text);color:var(--ig-bg);transition:opacity var(--d2) var(--ease),scale var(--d2) var(--ease)}
.e-badge svg{width:8px;height:8px}
.entry:is([data-state=paused],[data-state=result]) .e-badge{opacity:1;scale:1}
.entry[data-k=ok] .e-badge{background:var(--accent);color:var(--on-accent)}
.entry[data-k=bad] .e-badge{background:var(--danger);color:#fff}
.entry[data-k=unk] .e-badge{background:var(--warn);color:var(--on-warn)}
.tip{position:fixed;z-index:7;left:0;top:0;padding:6px 10px;border-radius:8px;background:var(--tip-bg);color:var(--tip-fg);font:12px/16px var(--font);
  pointer-events:none;opacity:0;transition:opacity var(--d1) var(--ease);white-space:nowrap}
.tip.on{opacity:1}
.tip kbd{background:rgba(255,255,255,.16);margin-left:6px}
.coach{position:fixed;z-index:6;width:268px;padding:14px 16px 12px;border-radius:12px;background:var(--ig-elev);color:var(--ig-text);
  box-shadow:var(--pop-shadow);border:1px solid var(--pop-border);--dot-ring:var(--ig-elev);font:14px/18px var(--font);
  animation:rise var(--d3) var(--ease) both}
.coach::before{content:"";position:absolute;left:-7px;top:22px;width:12px;height:12px;background:inherit;border-left:1px solid var(--pop-border);
  border-bottom:1px solid var(--pop-border);rotate:45deg;border-radius:0 0 0 3px}
.rtl .coach::before{left:auto;right:-7px;rotate:-135deg}
.coach-h{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:4px}
.coach-h svg{width:24px;height:24px}
.coach-b{color:var(--ig-text-2);margin:0 0 10px;padding-left:32px}
.coach-f{display:flex;justify-content:flex-end}
.coach-ok{height:32px;padding:0 16px;border:0;border-radius:8px;font:600 14px/18px var(--font);background:color-mix(in srgb,var(--ig-text) 8%,transparent);
  color:var(--ig-text);cursor:pointer;transition:background-color var(--d1),scale var(--d1) var(--ease)}
.coach-ok:hover{background:color-mix(in srgb,var(--ig-text) 14%,transparent)}
.coach-ok:active{scale:.96}
.coach-ok:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.composer{position:fixed;z-index:3;left:0;top:0;margin:0;padding:0;border:0;display:block;background:transparent}
.composer.closed{width:0;height:0;visibility:hidden}
.composer.chip{border-radius:12px;box-shadow:var(--pop-shadow);outline:1px solid var(--pop-border);outline-offset:-1px;animation:rise var(--d2) var(--ease) both}
.engine{position:fixed;left:0;top:0;transform-origin:0 0;overflow:hidden;pointer-events:none;background:#000;opacity:0;transition:opacity var(--d2) var(--ease)}
.engine.glide{transition:opacity var(--d2) var(--ease),transform var(--d3) var(--ease),border-radius var(--d3) var(--ease),box-shadow var(--d3) var(--ease)}
.engine iframe{border:0;display:block;pointer-events:none;background:#fff}
.badge{position:fixed;z-index:5;left:0;top:0;width:20px;height:20px;border-radius:50%;display:grid;place-items:center;border:2px solid var(--ig-elev);
  pointer-events:none;opacity:0;scale:.25;transition:opacity var(--d2) var(--ease),scale var(--d2) var(--ease)}
.badge svg{width:12px;height:12px}
.badge.on{opacity:1;scale:1}
.badge[data-k=ok]{background:var(--accent);color:var(--on-accent)}
.badge[data-k=bad]{background:var(--danger);color:#fff}
.badge[data-k=unk]{background:var(--warn);color:var(--on-warn)}
@keyframes rise{from{opacity:0;translate:0 6px}to{opacity:1;translate:0 0}}
@media (prefers-reduced-motion: reduce){@keyframes rise{from{opacity:0}to{opacity:1}}.entry:hover .mk{scale:1}}
`;

const GLYPH_PATHS: Readonly<Record<Glyph, string>> = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 6.5v7M12 17.2v.3',
  q: 'M9.2 9a2.9 2.9 0 1 1 4 2.7c-.7.3-1.2 1-1.2 1.8v.5M12 17.4v.2',
  pause: 'M9 6v12M15 6v12',
};

interface Engine {
  runId: string;
  wrap: HTMLDivElement;
  frame: HTMLIFrameElement;
  port: { disconnect(): void } | null;
  poll: number;
  last: string;
  box: { w: number; h: number };
  revealed: boolean;
  scale: number;
}

export function startPageScript(win: Window, rt: PageRuntime): { dispose(): void } {
  const doc = win.document;
  const docEl = doc.documentElement;
  const NS = 'http://www.w3.org/2000/svg';
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };
  const svg = (tag: string, attrs: Record<string, string>, ...kids: SVGElement[]): SVGElement => {
    const e = doc.createElementNS(NS, tag) as SVGElement;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    e.append(...kids);
    return e;
  };
  const markSvg = (): SVGElement =>
    svg(
      'svg',
      { class: 'mark', viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      svg('rect', { x: '5.25', y: '2.75', width: '13.5', height: '18.5', rx: '3.75', ...STROKE }),
      svg('path', { d: 'M12 16V9.2M9.2 11.8 12 9l2.8 2.8', ...STROKE, 'stroke-linejoin': 'round' }),
      svg('circle', { class: 'mark-dot', cx: '18.4', cy: '4.6', r: '3' }),
    );
  const glyphSvg = (g: Glyph): SVGElement =>
    svg(
      'svg',
      { viewBox: '0 0 24 24', 'aria-hidden': 'true' },
      svg('path', { d: GLYPH_PATHS[g], ...STROKE, 'stroke-width': '3', 'stroke-linejoin': 'round' }),
    );

  // ---- the host ---------------------------------------------------------------------------------------

  const host = doc.createElement('div');
  const root = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const wrap = el('div', 'ip');
  // Our own texts are English or Spanish: left to right even on a mirrored (right-to-left) Instagram (RL-9).
  wrap.setAttribute('dir', 'ltr');
  root.append(style, wrap);
  docEl.append(host);

  // The entry.
  const entry = el('button', 'entry off');
  entry.type = 'button';
  entry.setAttribute('aria-haspopup', 'dialog');
  entry.setAttribute('aria-expanded', 'false');
  entry.dataset.state = 'idle';
  const mk = el('span', 'mk');
  mk.setAttribute('aria-hidden', 'true');
  const ringPr = svg('circle', { class: 'pr', cx: '17', cy: '17', r: '16' });
  const ring = svg(
    'svg',
    { class: 'ring', viewBox: '0 0 34 34' },
    svg('circle', { class: 'tr', cx: '17', cy: '17', r: '16' }),
    ringPr,
  );
  const eBadge = el('span', 'e-badge');
  mk.append(ring, markSvg(), eBadge);
  const lbl = el('span', 'lbl');
  // RL-10: the toolbar shortcut as the browser has it (applyShortcut); none shown when there is none.
  const key = el('kbd', 'key');
  entry.append(mk, lbl, key);

  const tip = el('div', 'tip');
  tip.setAttribute('role', 'tooltip');
  const badge = el('span', 'badge');
  badge.setAttribute('aria-hidden', 'true');
  wrap.append(entry, tip, badge);

  // ---- state ------------------------------------------------------------------------------------------

  let state: PageState = { run: IDLE_RUN, pausedUntil: null, prefs: DEFAULT_UI_PREFS, lang: 'en', shortcut: null };
  /** RL-10: the toolbar shortcut (the background reads it from chrome.commands), or null. */
  let shortcut: string | null = null;
  function applyShortcut(next: string | null): void {
    shortcut = next;
    key.textContent = next ?? '';
    key.hidden = next === null;
    const aria = ariaShortcut(next);
    if (aria) entry.setAttribute('aria-keyshortcuts', aria);
    else entry.removeAttribute('aria-keyshortcuts');
  }
  applyShortcut(null);
  /** The owner's language (Settings → Language, resolved by the background, AM48). */
  let lang = toLang(state.lang);
  let ready = false;
  let preview: PreviewMode = DEFAULT_UI_PREFS.preview;
  let mode: ComposerMode = 'closed';
  /** The mode the composer is fading towards (the iframe still covers the viewport until then). */
  let leaving: ComposerMode | null = null;
  let composer: HTMLIFrameElement | null = null;
  let engine: Engine | null = null;
  let guard: ((e: BeforeUnloadEvent) => void) | null = null;
  let palette: PagePalette = pagePalette({ background: null, text: null, vars: {} });
  let pageKey = '';
  let current: EntryPlace = NONE;
  let shownKey = '';
  let pendingKey = '';
  let occluded = false;
  /** The pointer's last position: while it is over Instagram's nav or the entry, the entry stays put. */
  let pointer: { x: number; y: number } | null = null;
  let column: Element | null = null;
  let profile: Element | null = null;
  /** FX7 (RL-6): no navigation, a password field and no account link: Instagram's login wall. */
  let loginWall = false;
  /** RL-9: Instagram's layout is mirrored (a right-to-left language): the nav, and our entry, at the right. */
  let rtl = false;
  let lastPath = '';
  let coach: HTMLDivElement | null = null;
  let disposed = false;
  const timers = { raf: 0, stable: 0, leave: 0, chip: 0, other: 0, tick: 0, tip: 0, glide: 0, lookup: 0 };
  let vpKey = '';

  const reduced = () => win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const viewport = () => ({ w: docEl.clientWidth || win.innerWidth, h: docEl.clientHeight || win.innerHeight });
  const runHere = () => state.run.here && state.run.phase === 'running';
  const schedule = () => {
    if (!timers.raf && !disposed) timers.raf = win.requestAnimationFrame(update);
  };
  const inside = (r: { left: number; top: number; right: number; bottom: number } | null, pad = 8) =>
    !!r &&
    !!pointer &&
    pointer.x >= r.left - pad &&
    pointer.x <= r.right + pad &&
    pointer.y >= r.top - pad &&
    pointer.y <= r.bottom + pad;
  /**
   * Instagram's sidebar expands while hovered and collapses when the pointer leaves it (for our entry, which
   * is not in its DOM). Re-placing the entry then would chase it away from the pointer: freeze it instead.
   */
  const frozen = () =>
    current.kind !== 'none' &&
    (inside(entry.getBoundingClientRect(), 4) || inside(column?.getBoundingClientRect() ?? null, 0));

  // ---- theme (FT1, FT2) -------------------------------------------------------------------------------

  function readPalette(): PagePalette {
    let background: string | null = null;
    const behind: (Element | null)[] = [];
    for (let e: Element | null = column; e; e = e.parentElement) behind.push(e);
    behind.push(doc.body, docEl);
    for (const e of behind) {
      if (!e) continue;
      const bg = win.getComputedStyle(e).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) {
        background = bg;
        break;
      }
    }
    const root = win.getComputedStyle(docEl);
    const v = (name: string) => root.getPropertyValue(name).trim() || undefined;
    return pagePalette({
      background,
      text: profile ? win.getComputedStyle(profile).color : null,
      vars: {
        text2: v('--ig-secondary-text'),
        sep: v('--ig-separator'),
        elev: v('--ig-elevated-background'),
      },
    });
  }

  function applyPalette(): void {
    const p = readPalette();
    const changed = p.scheme !== palette.scheme;
    palette = p;
    wrap.dataset.scheme = p.scheme;
    const s = wrap.style;
    s.setProperty('--ig-bg', p.bg);
    s.setProperty('--ig-elev', p.elev);
    s.setProperty('--ig-text', p.text);
    s.setProperty('--ig-text-2', p.text2);
    s.setProperty('--ig-sep', p.sep);
    s.setProperty('--ig-hover', p.hover);
    if (composer) composer.style.colorScheme = p.scheme;
    const loggedIn = profile
      ? true
      : loginWall || /^\/accounts\/(login|emailsignup)/.test(win.location.pathname)
        ? false
        : null;
    const handle = profileHandle(profile);
    const k = `${p.scheme}|${loggedIn}|${handle}`;
    if (k !== pageKey || changed) {
      pageKey = k;
      rt.send({ v: 1, type: 'inpage/page', scheme: p.scheme, loggedIn, handle });
    }
  }

  // ---- tracking (FE7) ---------------------------------------------------------------------------------

  const ro = new ResizeObserver(schedule);
  const navMo = new MutationObserver(schedule);
  const bodyMo = new MutationObserver(schedule);
  const themeMo = new MutationObserver(() => {
    applyPalette();
    schedule();
  });
  themeMo.observe(docEl, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  const scheme = win.matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => {
    applyPalette();
    schedule();
  };
  scheme.addEventListener('change', onScheme);
  /** Overlays open after a press and slide in: look again just after, and once they have settled. */
  const onInput = () => {
    win.setTimeout(schedule, 60);
    win.setTimeout(schedule, 400);
  };
  win.addEventListener('resize', schedule, { passive: true });
  win.addEventListener(
    'pointermove',
    (e: PointerEvent) => {
      const wasFrozen = frozen();
      pointer = { x: e.clientX, y: e.clientY };
      if (wasFrozen && !frozen()) schedule();
    },
    { passive: true, capture: true },
  );
  docEl.addEventListener('pointerleave', () => {
    pointer = null;
    schedule();
  });
  win.addEventListener('pointerup', onInput, { passive: true, capture: true });
  win.addEventListener('keyup', onInput, { passive: true, capture: true });
  win.addEventListener('popstate', schedule);

  /** The nav is cached and looked up again only when it is detached or the route changes (EN5). */
  let lookedAt = 0;
  function locate(path: string, h: number): void {
    if (column?.isConnected && path === lastPath) {
      if (!profile?.isConnected) profile = findProfile(navItems(column));
      return;
    }
    // Without a nav (the story viewer, a login wall) the whole page is observed: look again at most twice a
    // second, not on every mutation.
    const t = Date.now();
    if (!column && path === lastPath && t - lookedAt < LOOKUP_MS) {
      if (!timers.lookup) {
        timers.lookup = win.setTimeout(() => {
          timers.lookup = 0;
          schedule();
        }, LOOKUP_MS);
      }
      return;
    }
    lookedAt = t;
    lastPath = path;
    rtl = isRtl(doc);
    wrap.classList.toggle('rtl', rtl);
    const nav = findNav(doc);
    const col = nav ? navColumn(nav, h) : null;
    loginWall = col === null && isLoginWall(doc);
    if (col === column && col !== null) return;
    column = col;
    ro.disconnect();
    navMo.disconnect();
    bodyMo.disconnect();
    if (col) {
      profile = findProfile(navItems(col));
      ro.observe(col);
      if (profile) ro.observe(profile);
      navMo.observe(col, { childList: true, subtree: true });
      // Instagram mounts its dialogs as children of body.
      if (doc.body) bodyMo.observe(doc.body, { childList: true });
    } else {
      profile = null;
      // Until the nav mounts, any change in the page may be it.
      if (doc.body) bodyMo.observe(doc.body, { childList: true, subtree: true });
    }
    applyPalette();
  }

  const keyOf = (p: EntryPlace): string =>
    p.kind === 'none' ? 'none' : `${p.kind}:${p.rect.x},${p.rect.y},${p.rect.w},${p.rect.h},${p.room}`;

  /** FE7: the entry's centre must hit Instagram's nav (or, for the corner, no Instagram control). */
  function isOccluded(p: EntryPlace): boolean {
    if (p.kind === 'none') return false;
    const pts =
      p.kind === 'row' ? [p.rect.x + 24, p.rect.x + p.rect.w / 2, p.rect.x + p.rect.w - 24] : [p.rect.x + p.rect.w / 2];
    const y = p.rect.y + p.rect.h / 2;
    for (const x of pts) {
      const hit = doc.elementsFromPoint(x, y).find((e) => e !== host);
      if (!hit) return true;
      if (p.kind === 'corner') {
        if (isControl(hit)) return true;
      } else if (!column?.contains(hit) || isControl(hit)) return true;
    }
    return false;
  }

  function update(): void {
    timers.raf = 0;
    if (disposed) return;
    if (!rt.alive()) {
      dispose();
      return;
    }
    const vp = viewport();
    const path = win.location.pathname;
    locate(path, vp.h);
    // FX12: the viewport changed (a resize, Arc's sidebar): the dialog relays out, the phone follows.
    const vk = `${vp.w}x${vp.h}`;
    if (vk !== vpKey) {
      vpKey = vk;
      applyComposer();
      placeEngine(false);
      placeBadge();
    }
    if (frozen()) {
      // Pointer on the nav or the entry: keep it where it is (no chasing the hover-expanding nav). RL-15: only
      // the placement is frozen, not the visibility: Instagram's More menu, Create dialog or Search panel opening
      // over the entry's slot while the pointer is still in the column hides it, so it never takes their clicks.
      occluded = isOccluded(current);
      renderEntry();
      return;
    }
    const place = ready ? entryPlace(column, vp, path, state.prefs.entry === 'sidebar', { loginWall, rtl }) : NONE;
    const k = keyOf(place);
    if (k !== shownKey) {
      if (k !== pendingKey) {
        pendingKey = k;
        win.clearTimeout(timers.stable);
        timers.stable = win.setTimeout(() => {
          timers.stable = 0;
          schedule();
        }, STABLE_MS);
      }
      if (timers.stable) {
        // The anchor is moving (the nav animating, Arc's sidebar): stay where it was until it settles. No
        // fading: hiding on every nav animation made the entry flicker and impossible to click.
        return;
      }
      shownKey = k;
      current = place;
      applyComposer();
      placeEngine(false);
      placeBadge();
    }
    // Back where it was shown: a pending move is moot.
    pendingKey = k;
    occluded = isOccluded(current);
    renderEntry();
  }

  // ---- the entry (FE1–FE6) ----------------------------------------------------------------------------

  /** FE6 (page-copy.ts): the entry's texts for the run in another tab, the pause and the language. */
  const entryLook = (): EntryLook =>
    lookOf(state.run, state.pausedUntil, lang, Date.now(), win.navigator.language || null);

  let lookKey = '';
  function renderEntry(): void {
    const p = current;
    const hidden = p.kind === 'none' || mode === 'chip' || leaving === 'chip' || occluded || !ready;
    entry.classList.toggle('off', hidden);
    entry.classList.toggle('tile', p.kind === 'tile');
    entry.classList.toggle('corner', p.kind === 'corner');
    if (p.kind !== 'none') {
      const st = entry.style;
      st.left = `${p.rect.x}px`;
      st.top = `${p.rect.y}px`;
      st.width = `${p.rect.w}px`;
      st.height = `${p.rect.h}px`;
    }
    entry.setAttribute('aria-expanded', String(mode === 'open' && leaving === null));
    const look = entryLook();
    entry.dataset.state = look.st;
    entry.dataset.k = look.k;
    entry.setAttribute('aria-label', look.name);
    const lk = `${look.label}|${look.small}|${look.glyph}`;
    if (lk !== lookKey) {
      lookKey = lk;
      lbl.textContent = look.label;
      if (look.small) {
        const sm = el('small');
        sm.textContent = look.small;
        lbl.append(sm);
      }
      eBadge.replaceChildren(...(look.glyph ? [glyphSvg(look.glyph)] : []));
    }
    ringPr.style.strokeDashoffset = String(RING * (1 - Math.min(1, state.run.progress)));
    // FE6: the clock ticks while another tab posts.
    if (look.st === 'busy' && !timers.tick) {
      timers.tick = win.setInterval(() => renderEntry(), 1000);
    } else if (look.st !== 'busy' && timers.tick) {
      win.clearInterval(timers.tick);
      timers.tick = 0;
    }
    if (tip.classList.contains('on')) positionTip();
    renderCoach(hidden);
  }

  // ---- tooltip and coach (FE3, FE6, FE8) --------------------------------------------------------------

  function tipWanted(): boolean {
    if (coach) return false;
    return current.kind === 'tile' || current.kind === 'corner' || entry.dataset.state !== 'idle';
  }
  function positionTip(): void {
    const r = entry.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const vp = viewport();
    // Beside the entry, towards the page: right of a sidebar row, left of the corner (mirrored right to left).
    const towardsLeft = (current.kind === 'corner') !== rtl;
    const left = towardsLeft ? r.left - t.width - 8 : r.right + 8;
    const top = r.top + r.height / 2 - t.height / 2;
    tip.style.left = `${Math.max(8, Math.min(vp.w - t.width - 8, left))}px`;
    tip.style.top = `${Math.max(8, Math.min(vp.h - t.height - 8, top))}px`;
  }
  function showTip(): void {
    win.clearTimeout(timers.tip);
    timers.tip = win.setTimeout(() => {
      if (!tipWanted() || entry.classList.contains('off')) return;
      const look = entryLook();
      tip.textContent = look.tip;
      if (look.st === 'idle' && shortcut !== null) {
        const k = el('kbd');
        k.textContent = shortcut;
        tip.append(k);
      }
      tip.classList.add('on');
      positionTip();
    }, TIP_DELAY_MS);
  }
  function hideTip(): void {
    win.clearTimeout(timers.tip);
    tip.classList.remove('on');
  }

  function hideCoach(): void {
    coach?.remove();
    coach = null;
  }
  function dismissCoach(): void {
    hideCoach();
    if (!state.prefs.coachSeen) {
      state = { ...state, prefs: { ...state.prefs, coachSeen: true } };
      rt.send({ v: 1, type: 'inpage/coach-seen' });
    }
  }
  function renderCoach(entryHidden: boolean): void {
    const want =
      ready &&
      !state.prefs.coachSeen &&
      !entryHidden &&
      (current.kind === 'row' || current.kind === 'tile') &&
      mode === 'closed' &&
      column !== null;
    if (!want) {
      hideCoach();
      return;
    }
    if (!coach) {
      const s = coachCopy(lang);
      coach = el('div', 'coach');
      coach.setAttribute('role', 'note');
      const h = el('div', 'coach-h');
      h.append(markSvg(), doc.createTextNode(s.title));
      const b = el('p', 'coach-b');
      b.append(doc.createTextNode(s.body));
      if (shortcut !== null) {
        const k = el('kbd');
        k.textContent = shortcut;
        b.append(doc.createTextNode(` ${s.key} `), k);
      }
      const f = el('div', 'coach-f');
      const ok = el('button', 'coach-ok');
      ok.type = 'button';
      ok.textContent = s.ok;
      ok.addEventListener('click', () => dismissCoach());
      f.append(ok);
      coach.append(h, b, f);
      wrap.append(coach);
      hideTip();
    }
    const nav = column?.getBoundingClientRect();
    // FE8: 12 px beside the nav, on the page's side (left of it right to left, RL-9).
    coach.style.left = rtl
      ? `${Math.round((nav?.left ?? current.rect.x) - 12 - coach.offsetWidth)}px`
      : `${Math.round((nav?.right ?? current.rect.x + current.rect.w) + 12)}px`;
    coach.style.top = `${Math.round(current.rect.y - 4)}px`;
  }

  // ---- the composer (FC1, FC4, FS8) -------------------------------------------------------------------

  function ensureComposer(): HTMLIFrameElement {
    if (composer) return composer;
    const f = el('iframe', 'composer closed');
    f.setAttribute('allow', 'clipboard-write; web-share');
    f.setAttribute('title', FRAME_TITLE);
    f.style.colorScheme = palette.scheme;
    // The scheme in the fragment gives the composer a themed first paint (no white flash).
    f.src = `${rt.panelUrl()}#${palette.scheme}`;
    wrap.append(f);
    composer = f;
    return f;
  }

  const chipOf = () => chipPlace(current.kind === 'none' ? null : current, viewport().w, rtl);

  function applyComposer(): void {
    const f = composer;
    if (!f) return;
    const shown = leaving !== null ? 'open' : mode;
    const s = f.style;
    if (shown === 'open') {
      const vp = viewport();
      Object.assign(s, { left: '0px', top: '0px', width: `${vp.w}px`, height: `${vp.h}px` });
    } else if (shown === 'chip') {
      const c = chipOf().rect;
      Object.assign(s, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
    } else {
      Object.assign(s, { left: '0px', top: '0px', width: '0px', height: '0px' });
    }
    f.className = `composer ${shown}`;
  }

  /** The composer draws what its mode says; `closing` asks it to fade its dialog out first. */
  function tellComposer(closing = false): void {
    rt.send({ v: 1, type: 'inpage/composer', mode, compact: chipOf().compact, closing });
  }

  function setMode(next: ComposerMode): void {
    win.clearTimeout(timers.leave);
    leaving = null;
    const changed = next !== mode;
    mode = next;
    if (next !== 'closed') ensureComposer();
    applyComposer();
    placeEngine(changed);
    placeBadge();
    renderEntry();
    tellComposer();
    syncChipTimer();
  }

  function open(): void {
    hideTip();
    dismissCoach();
    setMode('open');
  }

  /** Close or hide: the composer fades its dialog, the phone glides to the chip, then the iframe shrinks. */
  function leave(action: 'close' | 'hide', auto: boolean): void {
    if (mode === 'chip') {
      if (action === 'close' && !runHere()) setMode('closed');
      return;
    }
    if (mode !== 'open' || leaving !== null) return;
    const toChip = action === 'hide' || runHere() || (auto && state.run.here && state.run.phase === 'result');
    leaving = toChip ? 'chip' : 'closed';
    tellComposer(true);
    renderEntry();
    placeEngine(true);
    placeBadge();
    timers.leave = win.setTimeout(() => setMode(leaving ?? 'closed'), reduced() ? FADE_REDUCED_MS : FADE_MS);
  }

  function toggle(): void {
    if (mode === 'open') leave(runHere() ? 'hide' : 'close', false);
    else open();
  }

  /** FS8: Posted, Test passed and Stopped leave the chip after 10 s; failures stay until opened. */
  function syncChipTimer(): void {
    const r = state.run;
    const fades =
      mode === 'chip' &&
      r.here &&
      r.phase === 'result' &&
      (r.result === 'posted' ||
        r.result === 'tested' ||
        r.result === 'shareTested' ||
        r.result === 'checked' ||
        r.result === 'stopped');
    if (fades && !timers.chip) {
      timers.chip = win.setTimeout(() => {
        timers.chip = 0;
        if (mode === 'chip' && !runHere()) setMode('closed');
      }, CHIP_RESULT_MS);
    } else if (!fades && timers.chip) {
      win.clearTimeout(timers.chip);
      timers.chip = 0;
    }
  }

  function placeBadge(): void {
    const r = state.run;
    const k =
      r.here && r.phase === 'result'
        ? r.result === 'failed'
          ? 'bad'
          : r.result === 'unknown'
            ? 'unk'
            : r.result === 'stopped'
              ? ''
              : 'ok'
        : '';
    const on = (mode === 'chip' || leaving === 'chip') && k !== '';
    badge.classList.toggle('on', on);
    if (!on) return;
    if (badge.dataset.k !== k) {
      badge.dataset.k = k;
      badge.replaceChildren(glyphSvg(k === 'bad' ? 'alert' : k === 'unk' ? 'q' : 'check'));
    }
    const t = thumbSlot(chipOf().rect);
    badge.style.left = `${t.x + t.w - 14}px`;
    badge.style.top = `${t.y - 6}px`;
  }

  // ---- the engine frame (FS7) -------------------------------------------------------------------------

  function engineSlot(): { slot: Slot; above: boolean; lifted: boolean } {
    const vp = viewport();
    if (mode === 'open' && leaving === null) {
      const slot = previewSlot(dialogLayout(vp.w, vp.h).stage, preview);
      return { slot, above: preview !== 'hidden', lifted: preview !== 'hidden' };
    }
    return { slot: thumbSlot(chipOf().rect), above: preview !== 'hidden', lifted: false };
  }

  function placeEngine(glide: boolean): void {
    const e = engine;
    if (!e) return;
    const { slot, above, lifted } = engineSlot();
    const s = slot.w / e.box.w;
    e.scale = s;
    const st = e.wrap.style;
    const animate = glide && !reduced();
    e.wrap.classList.toggle('glide', animate);
    st.transform = `translate(${slot.x}px, ${slot.y}px) scale(${s})`;
    st.borderRadius = `${slot.r / s}px`;
    st.boxShadow = lifted
      ? `0 ${10 / s}px ${26 / s}px ${-6 / s}px rgba(0,0,0,.45), 0 0 0 ${1 / s}px rgba(255,255,255,.16)`
      : 'none';
    st.zIndex = above ? '4' : '2';
    // Hidden (N15): under the composer, barely visible, still rendering.
    st.opacity = e.revealed && above ? '1' : '0.01';
    win.clearTimeout(timers.glide);
    if (animate) timers.glide = win.setTimeout(() => e.wrap.classList.remove('glide'), GLIDE_MS + 40);
  }

  function isInitialBlank(frame: HTMLIFrameElement): boolean {
    try {
      return frame.contentWindow?.location.href === 'about:blank';
    } catch {
      return false;
    }
  }

  function readPath(frame: HTMLIFrameElement): { readable: boolean; path: string | null } {
    try {
      const loc = frame.contentWindow?.location;
      const path = loc?.pathname ?? null;
      if (loc?.origin !== 'https://www.instagram.com') return { readable: false, path: null };
      return { readable: true, path };
    } catch {
      return { readable: false, path: null };
    }
  }

  function openFrame(msg: Extract<BackgroundToPage, { type: 'inpage/open-frame' }>): OpenFrameReply {
    if (engine) return { ok: false, why: 'a frame is already open' };
    const dpr = win.devicePixelRatio || 1;
    const box = frameBoxFor(msg.frame, dpr);
    const w = el('div', 'engine');
    Object.assign(w.style, { width: `${box.w}px`, height: `${box.h}px` });
    w.setAttribute('aria-hidden', 'true');
    const frame = el('iframe');
    frame.setAttribute('referrerpolicy', 'origin');
    frame.setAttribute('loading', 'eager');
    frame.setAttribute('allow', ENGINE_ALLOW);
    frame.setAttribute('tabindex', '-1');
    Object.assign(frame.style, { width: `${box.w}px`, height: `${box.h}px` });
    const runId = msg.runId;
    frame.addEventListener('load', () => {
      if (!engine || engine.runId !== runId) return;
      // The initial about:blank (same origin, readable) is not Instagram's document.
      if (isInitialBlank(frame)) return;
      const at = readPath(frame);
      engine.last = `${at.readable}:${at.path}`;
      rt.send({ v: 1, type: 'inpage/frame-loaded', runId, readable: at.readable, path: at.path });
      // RV7: reveal after the first load plus one frame.
      if (!engine.revealed) {
        win.requestAnimationFrame(() => {
          if (!engine || engine.runId !== runId) return;
          engine.revealed = true;
          placeEngine(false);
        });
      }
    });
    // The src goes first, so the frame never has an about:blank document of its own to report.
    frame.src = ENGINE_SRC;
    w.append(frame);
    wrap.append(w);
    const port = rt.connect(PAGE_PORT);
    engine = { runId, wrap: w, frame, port, poll: 0, last: '', box, revealed: false, scale: 1 };
    // The background went away (an extension reload or update): no driver, no rules; the frame goes too.
    port.onDisconnect(() => {
      if (engine?.runId === runId) {
        engine.port = null;
        removeFrame();
      }
    });
    engine.poll = win.setInterval(() => {
      if (!engine || engine.runId !== runId) return;
      if (isInitialBlank(frame)) return;
      const at = readPath(frame);
      const k = `${at.readable}:${at.path}`;
      if (k === engine.last || engine.last === '') return;
      engine.last = k;
      rt.send({ v: 1, type: 'inpage/frame-path', runId, readable: at.readable, path: at.path });
    }, POLL_MS);
    placeEngine(false);
    return { ok: true, box, dpr, scale: engine.scale };
  }

  function removeFrame(): void {
    if (!engine) return;
    win.clearInterval(engine.poll);
    const port = engine.port;
    engine.wrap.remove();
    engine = null;
    port?.disconnect();
    setGuard(false);
  }

  function setGuard(on: boolean): void {
    if (on && !guard) {
      guard = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = '';
      };
      win.addEventListener('beforeunload', guard);
    } else if (!on && guard) {
      win.removeEventListener('beforeunload', guard);
      guard = null;
    }
  }

  // ---- the run's state (FI4) --------------------------------------------------------------------------

  function applyState(next: PageState): void {
    const prev = state;
    state = next;
    const nextLang = toLang(next.lang);
    const nextKey = shortcutOf(next.shortcut);
    if (nextKey !== shortcut) {
      applyShortcut(nextKey);
      hideTip();
      hideCoach();
    }
    if (nextLang !== lang) {
      // AM48: Settings → Language changed (or Auto now resolves otherwise): rewrite every text we own.
      lang = nextLang;
      lookKey = '';
      hideTip();
      hideCoach();
    }
    wrap.setAttribute('lang', lang);
    if (!ready) {
      ready = true;
      preview = next.prefs.preview;
    } else if (next.prefs.preview !== prev.prefs.preview) {
      preview = next.prefs.preview;
    }
    const r = next.run;
    // FD8: a run that starts here while the dialog is closed (a queued post) shows on the chip only.
    if (r.here && r.phase === 'running' && mode === 'closed' && leaving === null) setMode('chip');
    else if (mode === 'chip' && r.phase === 'idle') setMode('closed');
    if (prev.run.runId !== r.runId || prev.run.phase !== r.phase) placeEngine(false);
    // FE6: a result in another tab clears itself after 10 s.
    win.clearTimeout(timers.other);
    if (r.phase === 'result' && !r.here && r.endedAt !== null) {
      timers.other = win.setTimeout(schedule, Math.max(0, OTHER_RESULT_MS - (Date.now() - r.endedAt)) + 50);
    }
    syncChipTimer();
    placeBadge();
    schedule();
    renderEntry();
  }

  // ---- input ------------------------------------------------------------------------------------------

  const preload = () => {
    if (ready) ensureComposer();
  };
  entry.addEventListener('click', () => toggle());
  entry.addEventListener('pointerenter', () => {
    preload();
    showTip();
  });
  entry.addEventListener('pointerleave', hideTip);
  entry.addEventListener('focus', () => {
    preload();
    if (entry.matches(':focus-visible')) showTip();
  });
  entry.addEventListener('blur', hideTip);

  rt.listen((msg, sender, reply) => {
    if (disposed || sender.id !== rt.id || !isBackgroundToPage(msg)) return undefined;
    switch (msg.type) {
      case 'inpage/toggle-panel':
        if (msg.open === false) leave(runHere() ? 'hide' : 'close', false);
        else if (msg.open === true) open();
        else toggle();
        reply({ ok: true });
        return undefined;
      case 'inpage/ui':
        if (msg.action === 'open') open();
        else leave(msg.action, msg.auto === true);
        reply({ ok: true });
        return undefined;
      case 'inpage/preview':
        preview = msg.preview;
        placeEngine(true);
        reply({ ok: true });
        return undefined;
      case 'inpage/state':
        applyState(msg.state);
        reply({ ok: true });
        return undefined;
      case 'inpage/open-frame':
        reply(openFrame(msg));
        return undefined;
      case 'inpage/remove-frame':
        if (engine?.runId === msg.runId) removeFrame();
        reply({ ok: true });
        return undefined;
      case 'inpage/unload-guard':
        if (engine?.runId === msg.runId || !msg.on) setGuard(msg.on);
        reply({ ok: true });
        return undefined;
      case 'inpage/run-state':
        reply({ ok: true });
        return undefined;
    }
  });

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const t of [timers.stable, timers.leave, timers.chip, timers.other, timers.tip, timers.glide, timers.lookup])
      win.clearTimeout(t);
    win.clearInterval(timers.tick);
    if (timers.raf) win.cancelAnimationFrame(timers.raf);
    if (engine) win.clearInterval(engine.poll);
    ro.disconnect();
    navMo.disconnect();
    bodyMo.disconnect();
    themeMo.disconnect();
    scheme.removeEventListener('change', onScheme);
    win.removeEventListener('resize', schedule);
    win.removeEventListener('pointerup', onInput, { capture: true });
    win.removeEventListener('keyup', onInput, { capture: true });
    win.removeEventListener('popstate', schedule);
    setGuard(false);
    host.remove();
  }

  // ---- start ------------------------------------------------------------------------------------------

  applyPalette();
  rt.request({ v: 1, type: 'inpage/hello' }).then(
    (st) => {
      if (st && typeof st === 'object' && 'run' in st && 'prefs' in st) applyState(st as PageState);
      else applyState(state);
    },
    () => applyState(state),
  );
  schedule();
  return { dispose };
}
