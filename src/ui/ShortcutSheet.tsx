/**
 * Keyboard shortcuts (ux.md §4.14, IU11): the `?` sheet. Single-key shortcuts are inactive while a text
 * field has focus; browser-reserved keys (⌘N, ⌘W, ⌘Y, ⌘,) and Arc's ⌘S are not used.
 */
import { SHORTCUTS } from './shortcuts.ts';
import { openOverlay } from './ui-state.ts';

export function ShortcutSheet() {
  return (
    <div class="overlay">
      <button type="button" class="sheet-backdrop" aria-label="Close" tabIndex={-1} onClick={() => openOverlay(null)} />
      <aside class="sheet small" data-testid="shortcut-sheet" role="dialog" aria-labelledby="shortcuts-title">
        <header class="sheet-head">
          <h1 id="shortcuts-title">Keyboard</h1>
          <button type="button" class="link" aria-label="Close" onClick={() => openOverlay(null)}>
            ✕
          </button>
        </header>
        <table class="shortcuts">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td>
                  <kbd>{s.keys}</kbd>
                </td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="hint">
          ⌥⇧S opens instapost from anywhere; change it at chrome://extensions/shortcuts (in Arc:
          arc://extensions/shortcuts).
        </p>
      </aside>
    </div>
  );
}
