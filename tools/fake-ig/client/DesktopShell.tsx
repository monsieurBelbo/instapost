/** @jsxImportSource react */
/**
 * The desktop shell (strategy §6.1): top nav, Create → Post / Reel. No story entry and no story
 * input (research §1 item 1); only the post input, which also accepts video.
 */
import { type MouseEvent, useRef, useState } from 'react';
import { POST_ACCEPT } from '../knobs.ts';
import type { FakeBoot } from '../protocol.ts';
import { reportControl } from './control.ts';
import type { Strings } from './i18n.ts';
import { Feed } from './MsiteShell.tsx';
import { useCx } from './styles.ts';
import { Toast, useToast } from './ui.tsx';

export function DesktopShell({ t }: { boot: FakeBoot; t: Strings }) {
  const c = useCx();
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, showToast] = useToast();
  const postInput = useRef<HTMLInputElement>(null);
  const pick = (e: MouseEvent) => {
    reportControl('post', e.nativeEvent.isTrusted);
    setMenuOpen(false);
    postInput.current?.click();
  };

  return (
    <div className={c('app')}>
      <header className={c('dtop')}>
        <span className={c('brand')}>{t.brand}</span>
        <div className={c('dlinks')}>
          <button type="button" className={c('navBtn')}>
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
          {menuOpen ? (
            <div
              role="menu"
              data-testid="fake-create-menu"
              className={c('menu')}
              style={{ position: 'absolute', top: 44, bottom: 'auto', left: 'auto', right: 0, transform: 'none' }}
            >
              <button
                type="button"
                role="menuitem"
                data-testid="fake-create-post"
                className={c('menuItem')}
                onClick={pick}
              >
                {t.menuPost}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="fake-create-reel"
                className={c('menuItem')}
                onClick={pick}
              >
                {t.menuReel}
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <Feed t={t} count={6} />
      <input
        ref={postInput}
        type="file"
        accept={POST_ACCEPT}
        hidden
        data-testid="fake-post-input"
        onChange={() => showToast(t.toastPostUnsupported)}
      />
      {toast ? (
        <div className={c('toasts')}>
          <Toast text={toast} />
        </div>
      ) : null}
    </div>
  );
}
