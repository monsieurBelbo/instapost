/**
 * Full-tab editor (strategy §3.1, §7.10): the editor at `#/`, settings at `#/settings`, and the
 * hand-off panel beside both. Fonts load before any text is measured or drawn.
 */
import { useEffect } from 'preact/hooks';
import { DEFAULT_FONT_ID, loadFont } from '../../src/raster/fonts.ts';
import { GUARDED, MODE } from '../../src/shared/env.ts';
import { EditorPanel } from '../../src/ui/EditorPanel.tsx';
import { EditorView } from '../../src/ui/EditorView.tsx';
import { errorNotice, fontsReady, setNotice } from '../../src/ui/editor-state.ts';
import { HandoffPanel } from '../../src/ui/HandoffPanel.tsx';
import { connected, handoffClient } from '../../src/ui/handoff-state.ts';
import { route } from '../../src/ui/route.ts';
import { SettingsView } from '../../src/ui/SettingsView.tsx';
import { initSettings } from '../../src/ui/settings-state.ts';

export function App() {
  useEffect(() => {
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
  }, []);

  const r = route.value;
  return (
    <div class="app" data-mode={MODE} data-guarded={GUARDED ? 'true' : 'false'} data-route={r}>
      <header class="topbar">
        <span class="brand">instapost</span>
        {MODE !== 'live' && <span class={`mode-badge mode-${MODE}`}>{MODE}</span>}
        <nav aria-label="Views">
          <a href="#/" aria-current={r === 'editor' ? 'page' : undefined}>
            Editor
          </a>
          <a href="#/settings" aria-current={r === 'settings' ? 'page' : undefined}>
            Settings
          </a>
        </nav>
        <span class={`conn${connected.value ? ' on' : ''}`} title="Connection to the background">
          {connected.value ? 'connected' : 'not connected'}
        </span>
      </header>
      <main class={r === 'settings' ? 'main settings-main' : 'main editor-main'}>
        {r === 'settings' ? <SettingsView /> : <EditorView />}
      </main>
      <aside class="side">
        {r === 'editor' && <EditorPanel />}
        <HandoffPanel />
      </aside>
    </div>
  );
}
