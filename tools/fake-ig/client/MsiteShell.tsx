/** @jsxImportSource react */
/**
 * The mobile-web shell (strategy §6.1): top bar, feed, bottom nav with Create (+) → Post / Story.
 * Routes `/` and `/create/story/` client-side with the History API: Story from `/` pushes
 * /create/story/, and Share or Close push `/` (the background sees that as C9, composer left).
 * `challenge=afterShare…` follows Share with a security challenge; every control reports its
 * click's isTrusted (FID-2).
 */
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import { POST_ACCEPT } from '../knobs.ts';
import { CHALLENGE_DELAY_MS, FAKE_PATHS, type FakeBoot } from '../protocol.ts';
import { reportControl } from './control.ts';
import type { Strings } from './i18n.ts';
import { StoryComposer } from './StoryComposer.tsx';
import { useCx } from './styles.ts';
import { Toast, useToast } from './ui.tsx';

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

export function MsiteShell({ boot, t }: { boot: FakeBoot; t: Strings }) {
  const c = useCx();
  const { knobs } = boot;
  const [path, setPath] = useState(() => window.location.pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const [storyTapped, setStoryTapped] = useState(false);
  const [pickPending, setPickPending] = useState(false);
  const [toast, showToast] = useToast();
  const postInput = useRef<HTMLInputElement>(null);
  const onComposer = path.startsWith('/create/story');

  const navigate = useCallback((to: string) => {
    if (window.location.pathname !== to) window.history.pushState(null, '', to);
    setPath(to);
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Leaving the composer forgets the tap: with input=afterTap the next visit needs + → Story again.
  useEffect(() => {
    if (!onComposer) {
      setStoryTapped(false);
      setPickPending(false);
    }
  }, [onComposer]);

  const tapStory = (e: MouseEvent) => {
    reportControl('story', e.nativeEvent.isTrusted);
    setMenuOpen(false);
    setStoryTapped(true);
    setPickPending(true);
    if (!onComposer) navigate(FAKE_PATHS.composer);
  };
  const tapPost = (e: MouseEvent) => {
    reportControl('post', e.nativeEvent.isTrusted);
    setMenuOpen(false);
    postInput.current?.click();
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
  const onPickHandled = useCallback(() => setPickPending(false), []);

  return (
    <div className={c('app')}>
      <header className={c('top')}>
        <span className={c('brand')}>{t.brand}</span>
      </header>
      {onComposer ? (
        <StoryComposer
          knobs={knobs}
          t={t}
          inputMounted={knobs.input === 'present' || storyTapped}
          pickPending={pickPending}
          onPickHandled={onPickHandled}
          onExit={onExit}
        />
      ) : (
        <Feed t={t} />
      )}
      <nav className={c('nav')}>
        <button
          type="button"
          className={c('navBtn')}
          onClick={(e) => {
            reportControl('home', e.nativeEvent.isTrusted);
            navigate(FAKE_PATHS.home);
          }}
        >
          {t.navHome}
        </button>
        <button type="button" className={c('navBtn')}>
          {t.navSearch}
        </button>
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
      {toast ? (
        <div className={c('toasts')} style={{ top: 'auto', bottom: 72 }}>
          <Toast text={toast} />
        </div>
      ) : null}
    </div>
  );
}
