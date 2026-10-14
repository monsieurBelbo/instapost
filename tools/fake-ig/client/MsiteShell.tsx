/** @jsxImportSource react */
/**
 * The mobile-web shell (strategy §6.1, §11 AM35; ux.md IF1–IF3, IF10): production-shaped.
 *
 * - **Width breakpoint.** While the viewport is at most MSITE_MAX_CSS_WIDTH (767) CSS px wide, the
 *   shell renders msite's mobile layout: the header with the + entry and, after hydration, the
 *   navigation with the account link. Wider, a wide layout with no create entry and no story input at
 *   all. The breakpoint is live (matchMedia `change`), so a refit re-renders the header.
 * - **The + entry** (PolarisMobileCreationNavItem, C10): a box holding the popover trigger, a link
 *   `a[href="#"][role=link][tabindex=0]._a6hd` with an svg (its aria-label is Instagram's Home string, by
 *   a bug of theirs), and the next box holding the story form and the post form (each
 *   `form[role=presentation][method=POST][enctype=multipart/form-data]` around a hidden file input; the
 *   form's onClick selects the file, the nested click does nothing). The story input's accept is
 *   STORY_ACCEPT_LISTS[accept]; the post input's `image/jpeg`. With `input=afterTap` the story form mounts
 *   only once Story was tapped. Both mount `hydrateMs` after the shell renders (P5).
 * - **The menu** (the lazy PolarisMobileCreationMenuPopover, unverified L18): + opens a portal
 *   `div[role=dialog]` `menuDelayMs` later, with `div[role=button][tabindex=0]` items holding a glyph and a
 *   label, in `menuOrder`, plus a third (Reel) with `menuItems=3`. A second + or an outside click closes it;
 *   an item closes it. Story runs startStoryCreationSession: the viewport check (`innerHeight <
 *   innerWidth`: the "Rotate your device" toast and nothing else), else a uuid session, the `enter`
 *   telemetry, then (a promise later) the story input's selectFile (value cleared, `click()`: the file
 *   chooser when the page has user activation). Post starts a post session (`post_session_started`) and
 *   clicks the post input. `trusted=require`: untrusted clicks on + and the items do nothing.
 * - **The file** (IF3): the story input's change → (`listen`, `trusted`) → not an image: the "Upload
 *   failed. Only images can be posted." toast; else `image_process_attempt`, the read, then
 *   `image_process_success` and an SPA navigation (pushState) to /create/story/ with the composer holding
 *   the file, the session id (null without + → Story) and its start time.
 * - **The account** (C14, IF10): one navigation link to `/<handle>/` holding the avatar (`account` knob:
 *   a handle, `none`, `ambiguous`), plus feed posts with their authors' links inside `article`.
 * - **Toasts** live here (ToastContext), so a persistent one survives the route change. Share's flow is the
 *   composer's; after it settles, `challenge=afterShare…` follows. `rtClear=on` clears the resource timing
 *   buffer every 2 s. Every control reports its click's isTrusted (IF9).
 */
import { type ChangeEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { MSITE_MAX_CSS_WIDTH } from '../../../src/core/ig-contract/contract.ts';
import { accountShape, type Knobs, POST_ACCEPT, STORY_ACCEPT_LISTS } from '../knobs.ts';
import { CHALLENGE_DELAY_MS, FAKE_PATHS, type FakeBoot, type FakeControl } from '../protocol.ts';
import { logStep, reportControl } from './control.ts';
import type { Strings } from './i18n.ts';
import { sessionStartRejected } from './orientation.ts';
import { clearTimings, startClearing } from './rt-clear.ts';
import { markInput, StoryComposer } from './StoryComposer.tsx';
import { useCx } from './styles.ts';
import { AVATAR_SRC, GLYPH, Glyph, ToastContext, ToastList, useToastState, useToasts } from './ui.tsx';

/** msite's mobile layout (header with + → Story) applies up to this media query (F3). */
export const MOBILE_LAYOUT_QUERY = `(max-width: ${MSITE_MAX_CSS_WIDTH}px)`;

export function Feed({ t, count = 4 }: { t: Strings; count?: number }) {
  const c = useCx();
  return (
    <main className={c('feed')}>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
        <article key={i} className={c('post')}>
          {/* C14: authors' profile links sit inside feed posts; the agent ignores those. */}
          <a href={`/author_${i + 1}/`} className={c('author')} onClick={(e) => e.preventDefault()}>
            <img src={AVATAR_SRC} alt="" width={20} height={20} />
            author_{i + 1}
          </a>
          <span style={{ marginLeft: 8 }}>
            {t.feedPost} {i + 1}
          </span>
        </article>
      ))}
    </main>
  );
}

/** Whether msite's mobile layout applies now; re-evaluated on every change (the breakpoint is live). */
function useMobileLayout(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_LAYOUT_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const sync = () => setMobile(mq.matches);
    mq.addEventListener('change', sync);
    sync();
    return () => mq.removeEventListener('change', sync);
  }, []);
  return mobile;
}

/** true once `ms` have passed since the shell rendered (at once for 0). */
function useHydrated(ms: number): boolean {
  const [done, setDone] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) return;
    const id = window.setTimeout(() => setDone(true), ms);
    return () => window.clearTimeout(id);
  }, [ms]);
  return done;
}

interface Session {
  file: File;
  id: string | null;
  start: number | null;
}

type MenuItemKind = 'story' | 'post' | 'reel';

function menuItems(knobs: Knobs): MenuItemKind[] {
  const two: MenuItemKind[] = knobs.menuOrder === 'storyPost' ? ['story', 'post'] : ['post', 'story'];
  return knobs.menuItems === '3' ? [...two, 'reel'] : two;
}

/** Instagram's ImageFileForm: a presentation form whose onClick selects the file (the nested click does nothing). */
function FileForm({
  accept,
  inputRef,
  onChange,
  testId,
}: {
  accept: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  testId: string;
}) {
  const c = useCx();
  const selectFile = () => {
    const input = inputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Instagram's ImageFileForm: a role=presentation form whose onClick selects the file
    <form role="presentation" method="POST" encType="multipart/form-data" onClick={selectFile}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className={c('hiddenInput')}
        data-testid={testId}
        onChange={onChange}
      />
    </form>
  );
}

export function MsiteShell({ boot, t }: { boot: FakeBoot; t: Strings }) {
  const [toasts, api] = useToastState();
  return (
    <ToastContext.Provider value={api}>
      <Shell boot={boot} t={t} />
      <ToastList toasts={toasts} />
    </ToastContext.Provider>
  );
}

function Shell({ boot, t }: { boot: FakeBoot; t: Strings }) {
  const c = useCx();
  const { knobs } = boot;
  const toasts = useToasts();
  const mobile = useMobileLayout();
  const hydrated = useHydrated(knobs.hydrateMs);
  const [path, setPath] = useState(() => window.location.pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const [storyTapped, setStoryTapped] = useState(false);
  const [pickPending, setPickPending] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  /** AM37: the session + → Story started (startStoryCreationSession), until a file brings it to the composer. */
  const sessionRef = useRef<{ id: string; start: number } | null>(null);
  const menuTimer = useRef<number | undefined>(undefined);
  const plusRef = useRef<HTMLAnchorElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const postInput = useRef<HTMLInputElement>(null);
  const storyInput = useRef<HTMLInputElement>(null);
  const onComposer = path.startsWith('/create/story');
  /** The + entry (and its story input) exist: mobile layout, hydrated. */
  const entry = mobile && hydrated;
  const storyFormMounted = entry && (knobs.input === 'present' || storyTapped);

  const navigate = useCallback(
    (to: string) => {
      if (window.location.pathname !== to) window.history.pushState(null, '', to);
      setPath(to);
      toasts.navigated();
    },
    [toasts],
  );

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => (knobs.rtClear === 'on' ? startClearing() : undefined), [knobs.rtClear]);

  // Leaving the composer ends the story session and forgets the tap (input=afterTap: + → Story again).
  useEffect(() => {
    if (!onComposer) {
      setSession(null);
      setStoryTapped(false);
      setPickPending(false);
    }
  }, [onComposer]);

  // No create entry in the wide layout: its menu goes with it.
  useEffect(() => {
    if (!entry) setMenuOpen(false);
  }, [entry]);

  // An outside click closes the menu (the popover's own behaviour).
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: Event) => {
      const target = e.target as Node | null;
      if (target && (menuRef.current?.contains(target) || plusRef.current?.contains(target))) return;
      setMenuOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [menuOpen]);

  useEffect(() => () => window.clearTimeout(menuTimer.current), []);

  const selectStoryFile = useCallback(() => {
    const input = storyInput.current;
    if (!input) return false;
    input.value = '';
    input.click();
    return true;
  }, []);

  // input=afterTap: the story form mounts after Story; its selectFile runs once it is there.
  useEffect(() => {
    if (!pickPending || !storyFormMounted) return;
    if (selectStoryFile()) setPickPending(false);
  }, [pickPending, storyFormMounted, selectStoryFile]);

  const ignored = (e: MouseEvent) => knobs.trusted === 'require' && !e.nativeEvent.isTrusted;

  const onPlus = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    reportControl('create', e.nativeEvent.isTrusted, false, e.currentTarget);
    if (ignored(e)) return;
    window.clearTimeout(menuTimer.current);
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    // The popover module loads lazily: the dialog shows up a little later.
    menuTimer.current = window.setTimeout(() => {
      setMenuOpen(true);
      logStep('menu_opened', { items: menuItems(knobs).length });
    }, knobs.menuDelayMs);
  };

  /** PolarisStoryCreationActions.startStoryCreationSession, then the file form's selectFile. */
  const tapStory = (e: MouseEvent) => {
    reportControl('story', e.nativeEvent.isTrusted, false, e.currentTarget);
    if (ignored(e)) return;
    setMenuOpen(false);
    if (sessionStartRejected()) {
      toasts.show({ text: t.toastRotate, kind: 'rotate' });
      return;
    }
    const id = crypto.randomUUID();
    sessionRef.current = { id, start: Date.now() };
    logStep('enter', { entry_point: 'quick_cam_button', waterfall_id: id });
    setStoryTapped(true);
    // onStartStoryCreation(entryPoint).then(() => selectFile()): a microtask later.
    void Promise.resolve().then(() => {
      if (!selectStoryFile()) setPickPending(true);
    });
  };

  const tapPost = (e: MouseEvent) => {
    reportControl('post', e.nativeEvent.isTrusted, false, e.currentTarget);
    if (ignored(e)) return;
    setMenuOpen(false);
    postInput.current?.click();
    logStep('post_session_started', { creation_mode: 'POST' });
  };

  const tapReel = (e: MouseEvent) => {
    reportControl('menuExtra', e.nativeEvent.isTrusted, false, e.currentTarget);
    if (ignored(e)) return;
    setMenuOpen(false);
  };

  /**
   * The story input's file (Instagram's onFileChange → storyCreationSelectMedia): no orientation check
   * here. The session is the one + → Story started, or none.
   */
  const onStoryFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (knobs.listen !== 'change') return markInput('ignored-listen');
    if (knobs.trusted === 'require' && !e.nativeEvent.isTrusted) return markInput('ignored-untrusted');
    if (!file) return;
    const s = sessionRef.current;
    const fields = () => ({ waterfall_id: s?.id ?? '', waterfall_duration: (Date.now() - (s?.start ?? 0)) / 1000 });
    if (!file.type.startsWith('image/')) {
      toasts.show({ text: t.toastPhotoOnly, persist: true });
      logStep('image_process_failure', fields());
      return markInput('rejected-type');
    }
    markInput('accepted');
    logStep('image_process_attempt', fields());
    void createImageBitmap(file).then(
      (bmp) => {
        bmp.close();
        if (knobs.rtClear === 'on') clearTimings();
        logStep('image_process_success', fields());
        setSession({ file, id: s?.id ?? null, start: s?.start ?? null });
        sessionRef.current = null;
        navigate(FAKE_PATHS.composer);
      },
      () => {
        logStep('image_process_failure', fields());
        toasts.show({ text: t.toastPhotoOnly, persist: true });
      },
    );
  };

  const challengeAfterShare = useCallback(() => {
    const challenge = `${FAKE_PATHS.challenge}?next=%2F`;
    if (knobs.challenge === 'afterShare') {
      window.setTimeout(() => window.location.assign(challenge), CHALLENGE_DELAY_MS);
    }
    if (knobs.challenge === 'afterShareSpa') window.setTimeout(() => navigate(challenge), CHALLENGE_DELAY_MS);
  }, [knobs.challenge, navigate]);

  const onExit = useCallback(
    (reason: 'shared' | 'closed') => {
      navigate(FAKE_PATHS.home);
      if (reason === 'shared') challengeAfterShare();
    },
    [navigate, challengeAfterShare],
  );

  const onShareSettled = useCallback(
    (kind: 'published' | 'failed') => {
      if (kind === 'failed') challengeAfterShare();
    },
    [challengeAfterShare],
  );

  const control = (name: FakeControl, then?: () => void) => (e: MouseEvent) => {
    reportControl(name, e.nativeEvent.isTrusted, false, e.currentTarget);
    then?.();
  };

  const composer = (
    <StoryComposer
      knobs={knobs}
      t={t}
      inputMounted={false}
      sessionFile={session?.file ?? null}
      sessionId={session?.id ?? null}
      sessionStart={session?.start ?? null}
      onExit={onExit}
      onShareSettled={onShareSettled}
    />
  );

  if (!mobile) {
    // The wide layout (>= 768 CSS px): no + entry and no story input at all (F3).
    return (
      <div className={c('app')} data-fake-layout="wide">
        <header className={c('dtop')}>
          <span className={c('brand')}>{t.brand}</span>
          <div className={c('dlinks')}>
            <button type="button" className={c('navBtn')} onClick={control('home', () => navigate(FAKE_PATHS.home))}>
              {t.navHome}
            </button>
            <button type="button" className={c('navBtn')}>
              {t.navSearch}
            </button>
            <button type="button" className={c('navBtn')}>
              {t.navReels}
            </button>
            <button type="button" className={c('navBtn')}>
              {t.navProfile}
            </button>
          </div>
        </header>
        {onComposer ? composer : <Feed t={t} count={6} />}
      </div>
    );
  }

  // The composer with a photo is the whole page (PolarisStoryCreationPage); without one (route=direct)
  // msite's header stays above the empty composer.
  if (onComposer && session)
    return (
      <div className={c('app')} data-fake-layout="mobile">
        {composer}
      </div>
    );

  const account = accountShape(knobs.account);
  const profileLink = (handle: string) => (
    <a
      key={handle}
      href={`/${handle}/`}
      className={c('navBtn')}
      data-testid="fake-profile-link"
      onClick={(e) => {
        e.preventDefault();
        reportControl('profile', e.nativeEvent.isTrusted, false, e.currentTarget);
      }}
    >
      <img src={AVATAR_SRC} alt="" width={24} height={24} />
    </a>
  );

  return (
    <div className={c('app')} data-fake-layout="mobile">
      <header className={c('top')}>
        <span className={c('brand')}>{t.brand}</span>
        {entry ? (
          <div className={c('topEntry')}>
            <div>
              {/* biome-ignore lint/a11y/useValidAnchor: Instagram's nav item is a link with href="#" and an onClick (C10) */}
              <a
                ref={plusRef}
                href="#"
                // biome-ignore lint/a11y/noRedundantRoles: Instagram sets role=link on it; the agent counts it as pressable either way
                role="link"
                tabIndex={0}
                data-testid="fake-create"
                className={`${c('_a6hd')} ${c('navItem')}`}
                onClick={onPlus}
              >
                <Glyph d={GLYPH.create} label={t.navHome} />
              </a>
            </div>
            <div className={c('forms')}>
              {storyFormMounted ? (
                <FileForm
                  accept={STORY_ACCEPT_LISTS[knobs.accept]}
                  inputRef={storyInput}
                  onChange={onStoryFile}
                  testId="fake-story-input"
                />
              ) : null}
              <FileForm
                accept={POST_ACCEPT}
                inputRef={postInput}
                onChange={() => toasts.show({ text: t.toastPostUnsupported })}
                testId="fake-post-input"
              />
            </div>
          </div>
        ) : null}
      </header>
      {onComposer ? composer : <Feed t={t} count={4} />}
      {hydrated ? (
        // biome-ignore lint/a11y/noRedundantRoles: Instagram's navigation carries the role explicitly
        <nav role="navigation" className={c('nav')}>
          <button type="button" className={c('navBtn')} onClick={control('home', () => navigate(FAKE_PATHS.home))}>
            {t.navHome}
          </button>
          <button type="button" className={c('navBtn')}>
            {t.navSearch}
          </button>
          <button type="button" className={c('navBtn')}>
            {t.navReels}
          </button>
          {account.kind === 'one' ? profileLink(account.handle) : null}
          {account.kind === 'ambiguous' ? account.handles.map(profileLink) : null}
          {account.kind === 'none' ? (
            <button type="button" className={c('navBtn')}>
              {t.navProfile}
            </button>
          ) : null}
        </nav>
      ) : null}
      {menuOpen ? (
        <div ref={menuRef} role="dialog" data-testid="fake-create-menu" className={c('menu')}>
          {menuItems(knobs).map((item) => (
            // biome-ignore lint/a11y/useSemanticElements: the popover's items are role=button divs (C10)
            <div
              key={item}
              role="button"
              tabIndex={0}
              data-testid={`fake-create-${item}`}
              className={c('menuIcon')}
              onClick={item === 'story' ? tapStory : item === 'post' ? tapPost : tapReel}
              onKeyDown={() => undefined}
            >
              <Glyph d={GLYPH[item]} />
              <span>{item === 'story' ? t.menuStory : item === 'post' ? t.menuPost : t.menuReel}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
