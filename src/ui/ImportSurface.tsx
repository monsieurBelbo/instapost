/**
 * The empty editor (ux.md §4.3, IU2): drop, paste (⌘V) or choose a photo; Recent photos; Continue draft.
 * Dropping works anywhere in the window (App wires the window-wide drop); this is the visible target.
 *
 * Test ids: `import-surface`, `import-choose`, `recent-photo` (`data-asset-id`), `continue-draft`.
 */
import { ACCEPT_ATTR } from '../raster/decode.ts';
import { clock, ERROR_COPY } from './copy.ts';
import { continueDraft, pickRecent, recentPhotos, savedDraft } from './drafts.ts';
import { busy, loadImageFile, notice } from './editor-state.ts';
import { dropping } from './ui-state.ts';

export function ImportSurface() {
  const draft = savedDraft.value;
  const n = notice.value;
  const decodeFailed = n?.code === 'DECODE_FAILED';
  return (
    <div class={`import-surface${dropping.value ? ' is-drop-target' : ''}`} data-testid="import-surface">
      <div class="drop-zone">
        <p class="drop-title">Drop a photo here</p>
        <p class="hint">
          or paste it <kbd>⌘V</kbd>
        </p>
        <label class="button primary file-button" data-testid="import-choose">
          Choose photo… <kbd>⌘O</kbd>
          <input
            type="file"
            accept={ACCEPT_ATTR}
            class="visually-hidden"
            disabled={busy.value !== null}
            onChange={(e) => {
              const el = e.currentTarget as HTMLInputElement;
              const file = el.files?.[0];
              if (file) void loadImageFile(file);
              el.value = '';
            }}
          />
        </label>
        <p class="hint">JPEG · PNG · WebP · AVIF</p>
        {decodeFailed && (
          <p class="notice error" data-testid="import-error" data-code="DECODE_FAILED" role="alert">
            {ERROR_COPY.DECODE_FAILED.title}. {ERROR_COPY.DECODE_FAILED.body({ nothingPosted: true })}
          </p>
        )}
      </div>
      {(recentPhotos.value.length > 0 || draft) && (
        <div class="recent">
          {recentPhotos.value.length > 0 && (
            <>
              <h2>Recent photos</h2>
              <div class="recent-grid">
                {recentPhotos.value.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    class="recent-photo"
                    data-testid="recent-photo"
                    data-asset-id={p.id}
                    onClick={() => void pickRecent(p.id)}
                  >
                    <img class="recent-img" src={p.url} alt="" />
                  </button>
                ))}
              </div>
            </>
          )}
          {draft && (
            <button type="button" class="link" data-testid="continue-draft" onClick={() => void continueDraft()}>
              Continue draft · edited {clock(draft.savedAt)} ▸
            </button>
          )}
        </div>
      )}
    </div>
  );
}
