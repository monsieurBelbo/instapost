/** @jsxImportSource react */
/**
 * The mobile-web shell (strategy §6.1, §11 AM35: production-shaped since 2026-10-12, F3).
 *
 * - **Width breakpoint.** While the viewport is at most MSITE_MAX_CSS_WIDTH (767) CSS px wide, the
 *   shell renders msite's mobile layout: a header with the + entry (+ → Post / Story) and, beside it,
 *   the hidden image-only story input (`input=present`; with `input=afterTap` only once + → Story was
 *   tapped), plus the bottom nav. Wider, it renders a wide layout with no create entry and no story
 *   input at all. The breakpoint is live (matchMedia `change`), so a refit re-renders the header.
 * - **Hydration.** The + entry and its input mount `hydrateMs` after the shell renders (P5).
 * - **Story session** (AM37, Instagram's code as read on 2026-10-12). Tapping Story first runs the
 *   session start (`startStoryCreationSession`): `innerHeight < innerWidth` → the "Rotate your device"
 *   toast and no file chooser; otherwise a session id is issued and Story clicks the header input
 *   (the file chooser). A file in that input (a pick, or H1's insert, which never tapped Story) passes
 *   the input's `listen`/`trusted` knobs and the photo-only check, with no orientation check, then an
 *   SPA navigation (pushState) to /create/story/ with the composer holding the file and the session id
 *   (null after an insert). The composer page then applies its own landscape gate (StoryComposer).
 * - Routes `/` and `/create/story/` client-side with the History API: Share or Close push `/` (the
 *   background sees that as C9, composer left). `challenge=afterShare…` follows Share with a security
 *   challenge; every control reports its click's isTrusted (FID-2).
 */
import { type ChangeEvent, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { MSITE_MAX_CSS_WIDTH } from '../../../src/core/ig-contract/contract.ts';
import { POST_ACCEPT, STORY_ACCEPT_LISTS } from '../knobs.ts';
import { CHALLENGE_DELAY_MS, FAKE_PATHS, type FakeBoot } from '../protocol.ts';
import { reportControl } from './control.ts';
import type { Strings } from './i18n.ts';
import { sessionStartRejected } from './orientation.ts';
import { markInput, StoryComposer } from './StoryComposer.tsx';
import { useCx } from './styles.ts';
import { Toast, useToast } from './ui.tsx';

/** msite's mobile layout (header with + → Story) applies up to this media query (F3). */
export const MOBILE_LAYOUT_QUERY = `(max-width: ${MSITE_MAX_CSS_WIDTH}px)`;

export function Feed({ t, count = 4 }: { t: Strings; count?: number }) {
  const c = useCx();
  return (
    <main className={c('feed')}>
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
        <article key={i} className={c('post')}>
          {t.feedPost} {i + 1}
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

export function MsiteShell({ boot, t }: { boot: FakeBoot; t: Strings }) {
  const c = useCx();
  const { knobs } = boot;
  const mobile = useMobileLayout();
  const hydrated = useHydrated(knobs.hydrateMs);
  const [path, setPath] = useState(() => window.location.pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const [storyTapped, setStoryTapped] = useState(false);
  const [pickPending, setPickPending] = useState(false);
  /** The file that brought the current story to the composer, with the session id + → Story issued (null: none). */
  const [session, setSession] = useState<{ file: File; id: string | null } | null>(null);
  /** AM37: the session id the last accepted + → Story tap issued (startStoryCreationSession); null before. */
  const sessionId = useRef<string | null>(null);
  const [toast, showToast] = useToast();
  const [rotateToast, showRotate] = useToast();
  const postInput = useRef<HTMLInputElement>(null);
  const storyInput = useRef<HTMLInputElement>(null);
  const onComposer = path.startsWith('/create/story');
  /** The + entry (and its story input) exist: mobile layout, hydrated. */
  const entry = mobile && hydrated;
  const inputMounted = entry && (knobs.input === 'present' || storyTapped);

  const navigate = useCallback((to: string) => {
    if (window.location.pathname !== to) window.history.pushState(null, '', to);
    setPath(to);
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Leaving the composer ends the story session and forgets the tap (input=afterTap: + → Story again).
  useEffect(() => {
    if (!onComposer) {
      setSession(null);
      setStoryTapped(false);
      setPickPending(false);
      sessionId.current = null;
    }
  }, [onComposer]);

  // No create entry in the wide layout: its menu goes with it.
  useEffect(() => {
    if (!entry) setMenuOpen(false);
  }, [entry]);

  // + → Story opens the file chooser of the header's story input once it is mounted.
  useEffect(() => {
    if (!pickPending || !inputMounted) return;
    storyInput.current?.click();
    setPickPending(false);
  }, [pickPending, inputMounted]);

  const tapStory = (e: MouseEvent) => {
    reportControl('story', e.nativeEvent.isTrusted);
    setMenuOpen(false);
    // AM37: startStoryCreationSession, before the chooser: a landscape viewport is refused with a toast.
    if (sessionStartRejected()) {
      showRotate(t.toastRotate);
      return;
    }
    sessionId.current = crypto.randomUUID();
    setStoryTapped(true);
    setPickPending(true);
  };
  const tapPost = (e: MouseEvent) => {
    reportControl('post', e.nativeEvent.isTrusted);
    setMenuOpen(false);
    postInput.current?.click();
  };

  /**
   * A file in the header's story input (a pick, or H1's insert): the media goes straight to the composer
   * (Instagram's onFileChange → storyCreationSelectMedia; no orientation check here). The session id is
   * the one + → Story issued, or null when the file came without that tap.
   */
  const onStoryFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (knobs.listen !== 'change') return markInput('ignored-listen');
    if (knobs.trusted === 'require' && !e.nativeEvent.isTrusted) return markInput('ignored-untrusted');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast(t.toastPhotoOnly);
      return markInput('rejected-type');
    }
    markInput('accepted');
    setSession({ file, id: sessionId.current });
    navigate(FAKE_PATHS.composer);
  };

  const onExit = useCallback(
    (reason: 'shared' | 'closed') => {
      navigate(FAKE_PATHS.home);
      if (reason !== 'shared') return;
      showToast(t.toastShared);
      const challenge = `${FAKE_PATHS.challenge}?next=%2F`;
      if (knobs.challenge === 'afterShare') {
        window.setTimeout(() => window.location.assign(challenge), CHALLENGE_DELAY_MS);
      }
      if (knobs.challenge === 'afterShareSpa') window.setTimeout(() => navigate(challenge), CHALLENGE_DELAY_MS);
    },
    [navigate, showToast, t, knobs.challenge],
  );

  const goHome = (e: MouseEvent) => {
    reportControl('home', e.nativeEvent.isTrusted);
    navigate(FAKE_PATHS.home);
  };

  const content = onComposer ? (
    <StoryComposer
      knobs={knobs}
      t={t}
      inputMounted={false}
      sessionFile={session?.file ?? null}
      sessionId={session?.id ?? null}
      onExit={onExit}
    />
  ) : (
    <Feed t={t} count={mobile ? 4 : 6} />
  );

  if (!mobile) {
    // The wide layout (>= 768 CSS px): no + entry and no story input at all (F3).
    return (
      <div className={c('app')} data-fake-layout="wide">
        <header className={c('dtop')}>
          <span className={c('brand')}>{t.brand}</span>
          <div className={c('dlinks')}>
            <button type="button" className={c('navBtn')} onClick={goHome}>
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
        {content}
        {toast ? (
          <div className={c('toasts')}>
            <Toast text={toast} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={c('app')} data-fake-layout="mobile">
      <header className={c('top')}>
        <span className={c('brand')}>{t.brand}</span>
        {entry ? (
          <div className={c('topEntry')}>
            <button
              type="button"
              data-testid="fake-create"
              className={c('create')}
              aria-label={t.navCreate}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => {
                reportControl('create', e.nativeEvent.isTrusted);
                setMenuOpen((open) => !open);
              }}
            >
              +
            </button>
            {inputMounted ? (
              <input
                ref={storyInput}
                type="file"
                accept={STORY_ACCEPT_LISTS[knobs.accept]}
                hidden
                data-testid="fake-story-input"
                onChange={onStoryFile}
              />
            ) : null}
          </div>
        ) : null}
      </header>
      {content}
      <nav className={c('nav')}>
        <button type="button" className={c('navBtn')} onClick={goHome}>
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
      </nav>
      {menuOpen ? (
        <div role="menu" data-testid="fake-create-menu" className={c('menu')}>
          <button
            type="button"
            role="menuitem"
            data-testid="fake-create-post"
            className={c('menuItem')}
            onClick={tapPost}
          >
            {t.menuPost}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="fake-create-story"
            className={c('menuItem')}
            onClick={tapStory}
          >
            {t.menuStory}
          </button>
        </div>
      ) : null}
      <input
        ref={postInput}
        type="file"
        accept={POST_ACCEPT}
        hidden
        data-testid="fake-post-input"
        onChange={() => showToast(t.toastPostUnsupported)}
      />
      {toast || (rotateToast && !onComposer) ? (
        <div className={c('toasts')} style={{ top: 'auto', bottom: 72 }}>
          {rotateToast && !onComposer ? <Toast rotate text={rotateToast} /> : null}
          {toast ? <Toast text={toast} /> : null}
        </div>
      ) : null}
    </div>
  );
}
