/** @jsxImportSource react */
/**
 * The desktop shell (strategy §6.1; docs/inpage.md §3.2, §9.1; contract.md "Desktop Instagram's page"):
 * Instagram's desktop layout as far as the in-page entry needs it. No story entry and no story input (research
 * §1 item 1); only a post input.
 *
 * - **The left navigation** (`desktopNav`): links `/`, `#` (Search), `/explore/`, `/reels/`,
 *   `/direct/inbox/`, `#` (Notifications), `#` (Create), `/<handle>/` (Profile, with the avatar), a spacer and
 *   `#` (More), each an `a[role=link]` holding an svg, with a label when wide. Nothing in it depends on text:
 *   the extension's anchor finder is structural (Spanish UI, L21).
 *   - `auto` (production): responsive. From 1264 CSS px wide it is wide (244 px, labels); from 768 px it is
 *     collapsed (72 px, icons) and **widens to 244 px while hovered** (live, Arc, 2026-10-14/15): after a short
 *     hover intent it grows over the page (the feed does not move), shows its labels, and shrinks back as soon
 *     as the pointer leaves it, including onto anything drawn above it (instapost's entry is not in its DOM).
 *     Below 768 px a bottom bar. The breakpoints are approximate (unverified).
 *   - `hover`: the collapsed, hover-expanding navigation at any width; `wide`, `collapsed` (never expands),
 *     `bottomBar`, `absent`, `renamed` (`wide` with random class names): fixed shapes.
 * - **Create** opens the Post / Reel menu, as before. Every nav tap reports a control (IF9), so an untrusted
 *   one is a violation.
 * - **The Messages bubble** at the bottom right.
 * - **The theme** (`theme`; FT1, FX13): `__fb-light-mode` / `__fb-dark-mode` on `<html>`, Instagram's `--ig-*`
 *   variables as bare `r, g, b` triplets, and the page's and the navigation's backgrounds from them. `auto`
 *   follows `prefers-color-scheme` live. `data-fake-theme` on `<html>` says which one is shown (tests).
 * - **F9/R26:** the page keeps the same sessionStorage logging id msite keeps (`ht_persistent_session_id`),
 *   so a framed msite in this tab shares it (the in-page lane records whether it was reused).
 */
import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { accountShape, type Knobs, POST_ACCEPT } from '../knobs.ts';
import type { FakeBoot, FakeControl } from '../protocol.ts';
import { reportControl } from './control.ts';
import {
  NAV_COLLAPSED_W,
  NAV_GROW_MS,
  NAV_HOVER_DELAY_MS,
  NAV_NARROW_QUERY,
  NAV_WIDE_QUERY,
  NAV_WIDE_W,
  type NavLayout,
  navLayout,
  THEME_VARS,
  themeScheme,
} from './desktop-layout.ts';
import type { Strings } from './i18n.ts';
import { Feed } from './MsiteShell.tsx';
import { useCx } from './styles.ts';
import { AVATAR_SRC, GLYPH, Glyph, ToastContext, ToastList, useToastState } from './ui.tsx';

/** Instagram-like single-path icons for the navigation (no text, no ARIA the extension reads). */
const NAV_GLYPH = {
  home: 'M9 22V12h6v10M2 10l10-8 10 8v12H2Z',
  search: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm11 4-5.5-5.5',
  explore: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm4-14-2.5 5.5L8 16l2.5-5.5Z',
  reels: 'M2 7h20M7 2l3 5m4-5 3 5M2 2h20v20H2ZM10 11v6l5-3Z',
  messages: 'M2 21l2-6a9 9 0 1 1 3 3Zm6-9h8',
  notifications: 'M12 21s-9-5.5-9-11.5A5 5 0 0 1 12 6a5 5 0 0 1 9 3.5C21 15.5 12 21 12 21Z',
  more: 'M3 6h18M3 12h18M3 18h18',
} as const;

const NAV_QUERIES = [NAV_WIDE_QUERY, NAV_NARROW_QUERY] as const;

/** Re-renders when one of `queries` changes (a responsive layout follows the window live). */
function useMediaQueries(queries: readonly string[], on: boolean): void {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!on) return;
    const mqs = queries.map((q) => window.matchMedia(q));
    const sync = () => bump((n) => n + 1);
    for (const m of mqs) m.addEventListener('change', sync);
    return () => {
      for (const m of mqs) m.removeEventListener('change', sync);
    };
  }, [on, queries]);
}

function useNavLayout(kind: Knobs['desktopNav']): NavLayout {
  useMediaQueries(NAV_QUERIES, kind === 'auto');
  return navLayout(kind, (q) => window.matchMedia(q).matches);
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** `theme`: the scheme shown now (`auto` follows prefers-color-scheme live), applied to `<html>` and `<body>`. */
function useTheme(knob: Knobs['theme']): 'light' | 'dark' {
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    if (knob !== 'auto') return;
    const mq = window.matchMedia(DARK_QUERY);
    const sync = () => setPrefersDark(mq.matches);
    mq.addEventListener('change', sync);
    sync();
    return () => mq.removeEventListener('change', sync);
  }, [knob]);
  const scheme = themeScheme(knob, prefersDark);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('__fb-dark-mode', scheme === 'dark');
    root.classList.toggle('__fb-light-mode', scheme === 'light');
    for (const [k, v] of Object.entries(THEME_VARS[scheme])) root.style.setProperty(k, v);
    root.dataset.fakeTheme = scheme;
    root.style.colorScheme = scheme;
    document.body.style.background = 'rgb(var(--ig-primary-background))';
    document.body.style.color = 'rgb(var(--ig-primary-text))';
  }, [scheme]);
  return scheme;
}

/** One nav item: a link holding an svg (and a label when wide). */
function NavLink(p: {
  href: string;
  control: FakeControl;
  label: string | null;
  icon: ReactNode;
  style: CSSProperties;
  className?: string;
  onActivate?: () => void;
  testId?: string;
}) {
  return (
    <a
      href={p.href}
      tabIndex={0}
      className={p.className}
      style={p.style}
      {...(p.testId ? { 'data-testid': p.testId } : {})}
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        reportControl(p.control, e.nativeEvent.isTrusted, false, e.currentTarget);
        p.onActivate?.();
      }}
    >
      {p.icon}
      {p.label ? <span style={{ whiteSpace: 'nowrap' }}>{p.label}</span> : null}
    </a>
  );
}

const randomClass = (): string => `_${Math.random().toString(36).slice(2, 9)}`;

/** The left navigation (or the bottom bar), per its layout. */
function DesktopNav(p: {
  knobs: Knobs;
  layout: NavLayout;
  t: Strings;
  onCreate: () => void;
  menuOpen: boolean;
  children?: ReactNode;
}) {
  const kind = p.knobs.desktopNav;
  const { layout } = p;
  const classes = useMemo(
    () => (kind === 'renamed' ? { nav: randomClass(), item: randomClass() } : { nav: 'fk-dnav', item: 'fk-dnav-item' }),
    [kind],
  );
  const [expanded, setExpanded] = useState(false);
  const hoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (layout !== 'hover') setExpanded(false);
  }, [layout]);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  if (layout === 'absent') return null;
  const hover = layout === 'hover';
  const wide = layout === 'wide' || (hover && expanded);
  const bar = layout === 'bottomBar';
  const account = accountShape(p.knobs.account);
  const handle = account.kind === 'one' ? account.handle : account.kind === 'ambiguous' ? account.handles[0] : null;
  const navStyle: CSSProperties = bar
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        height: 48,
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        borderTop: '1px solid rgb(var(--ig-separator))',
        background: 'rgb(var(--ig-primary-background))',
        zIndex: 3,
      }
    : {
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        width: wide ? NAV_WIDE_W : NAV_COLLAPSED_W,
        boxSizing: 'border-box',
        padding: '24px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        overflow: 'hidden',
        borderRight: '1px solid rgb(var(--ig-separator))',
        background: 'rgb(var(--ig-primary-background))',
        zIndex: 3,
        ...(hover
          ? {
              transition: `width ${NAV_GROW_MS}ms ease, box-shadow ${NAV_GROW_MS}ms ease`,
              boxShadow: expanded ? '4px 0 24px rgba(0,0,0,.15)' : 'none',
            }
          : {}),
      };
  const itemStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: 12,
    borderRadius: 8,
    color: 'rgb(var(--ig-primary-text))',
    textDecoration: 'none',
    font: '15px system-ui',
    flex: 'none',
  };
  const label = (s: string) => (wide ? s : null);
  const icon = (d: string) => <Glyph d={d} />;
  // The hover expansion (live 2026-10-14/15): it grows after a short hover intent, and goes as soon as the
  // pointer leaves the navigation's own DOM (onto the page, or onto anything drawn above it).
  const hoverProps = hover
    ? {
        'data-fake-nav-expanded': expanded ? 'true' : 'false',
        onMouseEnter: () => {
          window.clearTimeout(hoverTimer.current);
          hoverTimer.current = window.setTimeout(() => setExpanded(true), NAV_HOVER_DELAY_MS);
        },
        onMouseLeave: () => {
          window.clearTimeout(hoverTimer.current);
          setExpanded(false);
        },
      }
    : {};
  return (
    <nav className={classes.nav} style={navStyle} data-fake-nav={layout} {...hoverProps}>
      <NavLink
        href="/"
        control="home"
        label={label(p.t.navHome)}
        icon={icon(NAV_GLYPH.home)}
        style={itemStyle}
        className={classes.item}
      />
      <NavLink
        href="#"
        control="home"
        label={label(p.t.navSearch)}
        icon={icon(NAV_GLYPH.search)}
        style={itemStyle}
        className={classes.item}
      />
      <NavLink
        href="/explore/"
        control="home"
        label={label('Explore')}
        icon={icon(NAV_GLYPH.explore)}
        style={itemStyle}
        className={classes.item}
      />
      <NavLink
        href="/reels/"
        control="home"
        label={label('Reels')}
        icon={icon(NAV_GLYPH.reels)}
        style={itemStyle}
        className={classes.item}
      />
      <NavLink
        href="/direct/inbox/"
        control="home"
        label={label('Messages')}
        icon={icon(NAV_GLYPH.messages)}
        style={itemStyle}
        className={classes.item}
      />
      <NavLink
        href="#"
        control="home"
        label={label('Notifications')}
        icon={icon(NAV_GLYPH.notifications)}
        style={itemStyle}
        className={classes.item}
      />
      <NavLink
        href="#"
        control="create"
        label={label(p.t.navCreate)}
        icon={icon(GLYPH.create)}
        style={itemStyle}
        className={classes.item}
        onActivate={p.onCreate}
        testId="fake-create"
      />
      {handle ? (
        <NavLink
          href={`/${handle}/`}
          control="profile"
          label={label('Profile')}
          icon={<img src={AVATAR_SRC} alt="" width={24} height={24} />}
          style={itemStyle}
          className={classes.item}
          testId="fake-nav-profile"
        />
      ) : null}
      {bar ? null : <div style={{ flex: 1 }} />}
      <NavLink
        href="#"
        control="home"
        label={label('More')}
        icon={icon(NAV_GLYPH.more)}
        style={itemStyle}
        className={classes.item}
      />
      {p.menuOpen ? p.children : null}
    </nav>
  );
}

/** F9/R26: the logging id desktop and msite keep in sessionStorage (shared within one tab). */
export const SESSION_LOG_KEY = 'ht_persistent_session_id';

export function keepSessionLogId(): { reused: boolean } {
  try {
    if (sessionStorage.getItem(SESSION_LOG_KEY)) return { reused: true };
    sessionStorage.setItem(SESSION_LOG_KEY, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
  } catch {
    // Storage blocked: nothing to share.
  }
  return { reused: false };
}

export function DesktopShell({ boot, t }: { boot: FakeBoot; t: Strings }) {
  const c = useCx();
  const [menuOpen, setMenuOpen] = useState(false);
  const [toasts, api] = useToastState();
  const showToast = (text: string) => api.show({ text });
  const postInput = useRef<HTMLInputElement>(null);
  useMemo(() => keepSessionLogId(), []);
  const layout = useNavLayout(boot.knobs.desktopNav);
  useTheme(boot.knobs.theme);
  const pick = (e: MouseEvent) => {
    reportControl('post', e.nativeEvent.isTrusted, false, e.currentTarget);
    setMenuOpen(false);
    postInput.current?.click();
  };
  // The page itself keeps the collapsed width under a hover-expanded navigation (it grows over the feed).
  const side = layout === 'wide' ? NAV_WIDE_W : layout === 'collapsed' || layout === 'hover' ? NAV_COLLAPSED_W : 0;
  const menu = (
    <div
      role="menu"
      data-testid="fake-create-menu"
      className={c('menu')}
      style={
        layout === 'bottomBar'
          ? { position: 'fixed', bottom: 56, top: 'auto', left: '50%', right: 'auto' }
          : { position: 'fixed', top: 'auto', bottom: 'auto', left: side + 8, right: 'auto', transform: 'none' }
      }
    >
      <button type="button" role="menuitem" data-testid="fake-create-post" className={c('menuItem')} onClick={pick}>
        {t.menuPost}
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="fake-create-reel"
        className={c('menuItem')}
        onClick={(e) => {
          reportControl('menuExtra', e.nativeEvent.isTrusted, false, e.currentTarget);
          setMenuOpen(false);
          postInput.current?.click();
        }}
      >
        {t.menuReel}
      </button>
    </div>
  );

  return (
    <ToastContext.Provider value={api}>
      <div
        className={c('app')}
        data-fake-layout="desktop"
        style={{ paddingLeft: side, paddingBottom: layout === 'bottomBar' ? 48 : 0 }}
      >
        <DesktopNav
          knobs={boot.knobs}
          layout={layout}
          t={t}
          onCreate={() => setMenuOpen((open) => !open)}
          menuOpen={menuOpen}
        >
          {menu}
        </DesktopNav>
        {layout === 'absent' ? (
          <header className={c('dtop')}>
            <span className={c('brand')}>{t.brand}</span>
          </header>
        ) : null}
        <Feed t={t} count={6} />
        <input
          ref={postInput}
          type="file"
          accept={POST_ACCEPT}
          hidden
          data-testid="fake-post-input"
          onChange={() => showToast(t.toastPostUnsupported)}
        />
        {/* Instagram's Messages bubble lives in the bottom-right corner (the in-page fallback avoids it). */}
        <div
          data-testid="fake-messages-bubble"
          style={{
            position: 'fixed',
            right: 24,
            bottom: layout === 'bottomBar' ? 64 : 24,
            width: 180,
            height: 44,
            borderRadius: 22,
            background: 'rgb(var(--ig-elevated-background))',
            color: 'rgb(var(--ig-primary-text))',
            boxShadow: '0 4px 12px rgba(0,0,0,.15)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 16px',
            boxSizing: 'border-box',
            zIndex: 3,
          }}
        >
          <Glyph d={NAV_GLYPH.messages} />
        </div>
        <ToastList toasts={toasts} />
      </div>
    </ToastContext.Provider>
  );
}
