/**
 * The editor (ux.md §4, §8, IU1): one page. A top bar, the pause banner, the main area (the stage with the
 * import surface and the onboarding card, the run view, or the result in its place) and a rail (photo and
 * text controls, then the Post card). Settings is a sheet, History a drawer (`#settings`, `#history`).
 * Fonts load before any text is measured or drawn.
 */
import { effect } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { DEFAULT_FONT_ID, loadFont } from '../../src/raster/fonts.ts';
import { GUARDED, MODE } from '../../src/shared/env.ts';
import { installSafetyCopies, testRun } from '../../src/ui/actions.ts';
import { tabTitle } from '../../src/ui/copy.ts';
import { loadDrafts, scheduleAutosave } from '../../src/ui/drafts.ts';
import { followEditorNotice } from '../../src/ui/editor-notice.ts';
import {
  doc,
  errorNotice,
  fontsReady,
  image,
  imageLayer,
  newStory,
  refitImage,
  setImageScale,
  setNotice,
} from '../../src/ui/editor-state.ts';
import { scheduleExport } from '../../src/ui/export-cache.ts';
import { HistoryDrawer } from '../../src/ui/HistoryDrawer.tsx';
import { refreshHistory } from '../../src/ui/history.ts';
import { ImportSurface } from '../../src/ui/ImportSurface.tsx';
import { lang, t } from '../../src/ui/i18n.ts';
import { Onboarding } from '../../src/ui/Onboarding.tsx';
import { PauseBanner } from '../../src/ui/PauseBanner.tsx';
import { PhotoControls } from '../../src/ui/PhotoControls.tsx';
import { PostCard, pressPrimary } from '../../src/ui/PostCard.tsx';
import { RunView } from '../../src/ui/RunView.tsx';
import { choosePhotoRequest } from '../../src/ui/result-actions.ts';
import {
  connected,
  dismissResult,
  handoffClient,
  onResult,
  runActive,
  shown,
  status,
  stopRun,
} from '../../src/ui/run-state.ts';
import { SettingsSheet } from '../../src/ui/SettingsSheet.tsx';
import { ShortcutSheet } from '../../src/ui/ShortcutSheet.tsx';
import { Stage } from '../../src/ui/Stage.tsx';
import { initSettings, settings } from '../../src/ui/settings-state.ts';
import { handleKey } from '../../src/ui/shortcuts.ts';
import { TextControls } from '../../src/ui/TextControls.tsx';
import { TopBar } from '../../src/ui/TopBar.tsx';
import { now, openOverlay, overlay, startTicking } from '../../src/ui/ui-state.ts';

function setup(): () => void {
  initSettings().catch((err: unknown) => setNotice(errorNotice(err)));
  loadFont(DEFAULT_FONT_ID).then(
    () => {
      fontsReady.value = true;
    },
    (err: unknown) => setNotice(errorNotice(err)),
  );
  try {
    handoffClient();
  } catch (err) {
    console.warn('[instapost] hand-off port unavailable', err);
  }
  void loadDrafts();
  void refreshHistory();
  startTicking();
  const stops = [
    installSafetyCopies(),
    // FX14: "instapost was updated. Reload your Instagram tab…", when the toolbar sent the owner here for it.
    followEditorNotice(),
    onResult(() => void refreshHistory()),
    // The export cache and the draft follow every edit (§4.3, §4.5).
    effect(() => {
      void doc.value;
      void image.value;
      void fontsReady.value;
      scheduleExport();
      scheduleAutosave();
    }),
    // AM44: the page's language follows the setting (screen readers, hyphenation, spell check).
    effect(() => {
      document.documentElement.lang = lang.value;
    }),
    // §4.1: the tab title says what the run does (in the current language).
    effect(() => {
      const s = status.value;
      const r = shown.value;
      if (runActive.value) {
        const started = s?.steps?.opened ?? s?.startedAt ?? now.value;
        document.title = tabTitle({ running: true, elapsedMs: now.value - started });
      } else {
        document.title = tabTitle(r ? { result: r.result } : null);
      }
    }),
  ];
  const onKey = (e: KeyboardEvent) => {
    const handled = handleKey(e, {
      primary: pressPrimary,
      testRun: () => void testRun(),
      escape: () => {
        if (overlay.value !== null) {
          openOverlay(null);
          return true;
        }
        if (runActive.value && status.value?.canStop !== false) {
          stopRun();
          return true;
        }
        const el = document.activeElement as HTMLElement | null;
        if (el && el.tagName.toLowerCase() === 'textarea') {
          el.blur();
          return true;
        }
        return false;
      },
      choosePhoto: () => {
        choosePhotoRequest.value++;
      },
      editText: () => document.getElementById('editor-text')?.focus(),
      reset: refitImage,
      zoom: (f) => {
        const il = imageLayer.value;
        if (il) setImageScale(il.xf.scale * f);
      },
      newStory: () => {
        if (!shown.value || runActive.value) return false;
        dismissResult();
        newStory();
        return true;
      },
      history: () => openOverlay('history'),
      settings: () => openOverlay('settings'),
      help: () => openOverlay('shortcuts'),
    });
    if (handled) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('keydown', onKey);
    for (const stop of stops) stop();
  };
}

export function App() {
  useEffect(setup, []);
  const running = runActive.value;
  const result = shown.value;
  const hasPhoto = image.value !== null;
  const onboarding = settings.value.onboardedAt === null && !running && result === null;
  const o = overlay.value;
  return (
    <div
      class="app"
      data-mode={MODE}
      data-guarded={GUARDED ? 'true' : 'false'}
      data-connected={connected.value ? 'true' : 'false'}
    >
      <div class="app-top">
        <TopBar />
        <PauseBanner />
      </div>
      <main class="main">
        {running || result !== null ? (
          <RunView />
        ) : (
          <section class={`editor-view${onboarding ? ' has-onboarding' : ''}`} aria-label={t('editor.story')}>
            {hasPhoto ? <Stage /> : <ImportSurface />}
            {onboarding && <Onboarding />}
          </section>
        )}
      </main>
      <aside class="rail">
        <PhotoControls />
        <TextControls />
        <PostCard />
      </aside>
      {o === 'settings' && <SettingsSheet />}
      {o === 'history' && <HistoryDrawer />}
      {o === 'shortcuts' && <ShortcutSheet />}
    </div>
  );
}
