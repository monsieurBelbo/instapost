/**
 * The Post card (ux.md §4.5, IU3): the single primary action. The thumbnail is the upload (the export
 * cache's PNG, dimmed while an edit is pending); the button and the note follow K1–K13 (post-card.ts); the
 * secondary actions are links. A refused start shows its copy here (RATE_LIMITED, HANDOFF_BUSY,
 * MSITE_LOCKED, BRANDED_BROWSER, EXPORT_TOO_LARGE).
 *
 * Test ids: `post-card` (`data-state` K1…K13), `post-primary` (`data-action`), `post-link`, `post-test` (not
 * in K6, whose primary is the test), `post-phone`, `post-save`, `post-thumb` (`data-stale`), `post-refusal` (`data-error`), `editor-notice`.
 */
import { useSignal } from '@preact/signals';
import { isBrandedFlavour } from '../core/ig-contract/browser-flavour.ts';
import { GUARDED } from '../shared/env.ts';
import { desktopLaneBlock, postStory, saveCopy, sendToPhone, shareSupported, testRun } from './actions.ts';
import { detectBrowserFlavour } from './browser-flavour.ts';
import { ACTION_LABEL, at, ERROR_COPY, POST_NOTES } from './copy.ts';
import { busy, fontsReady, image, notice } from './editor-state.ts';
import { exportCache, exportStale } from './export-cache.ts';
import { historyRows, storyStatus } from './history.ts';
import { type PostAction, postCardState } from './post-card.ts';
import { runAction } from './result-actions.ts';
import { lane, openInstagram, refusal, status, stopRun } from './run-state.ts';
import { settings } from './settings-state.ts';
import { now } from './ui-state.ts';

const size = (bytes: number): string =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;

const BRANDED: Record<string, string> = { chrome: 'Google Chrome', edge: 'Microsoft Edge', arc: 'Arc' };

/** The last post is old enough that Instagram may have changed (§7: a test is suggested, never a gate). */
const STALE_POST_MS = 14 * 24 * 60 * 60 * 1000;

let primary: (() => void) | null = null;

/** ⌘↵: whatever the Post card's primary button does now (nothing when it is disabled). */
export function pressPrimary(): void {
  primary?.();
}

export function PostCard() {
  const st = settings.value;
  const c = exportCache.value;
  const t = now.value;
  const flavour = useSignal(GUARDED ? detectBrowserFlavour() : 'unknown');
  const story = storyStatus(c?.sha256 ?? null, c?.docHash ?? null, t, historyRows.value);
  const state = postCardState({
    hasPhoto: image.value !== null,
    fontsReady: fontsReady.value,
    phoneOnly: image.value ? desktopLaneBlock() : null,
    pausedUntil: st.msiteLockedUntil,
    brandedTestBuild: GUARDED && isBrandedFlavour(flavour.value) ? (BRANDED[flavour.value] ?? flavour.value) : null,
    testPassed: st.lastTestPassAt !== null,
    lane: lane.value,
    story,
    busy: (() => {
      const s = status.value;
      const l = lane.value;
      if (!s?.mode || l?.kind !== 'busy' || (l.handoffId && s.handoffId !== l.handoffId)) return null;
      if (s.phase !== 'finished') return { mode: s.mode, held: false };
      return { mode: s.mode, held: s.held ?? 'close', closeAt: s.closeAt ?? null };
    })(),
    now: t,
  });
  const handle = st.expectedAccount?.handle ?? null;
  const working = busy.value !== null;
  const lastPost = historyRows.value.find((r) => r.mode === 'post' && r.kind === 'posted');
  const suggestTest = state.id === 'K13' && lastPost !== undefined && t - lastPost.at > STALE_POST_MS;
  const refused = refusal.value;
  const n = notice.value;

  const act = (a: PostAction | null) => {
    switch (a) {
      case 'post':
      case 'queuePost':
        void postStory();
        return;
      case 'setupTest':
        void testRun();
        return;
      case 'sendToPhone':
        void sendToPhone();
        return;
      case 'checkStory':
        openInstagram(handle ? 'story' : 'home', handle);
        return;
      case 'cancelQueue':
        stopRun();
        return;
      case 'showRun':
        runAction('showRun', { mode: 'post', handoffId: null, handle });
        return;
      default:
        return;
    }
  };

  primary = state.disabled || working ? null : () => act(state.action);

  return (
    <section class="post-card" data-testid="post-card" data-state={state.id} aria-labelledby="post-title">
      <div class="post-top">
        <div
          class={`post-thumb${exportStale.value ? ' is-stale' : ''}`}
          data-testid="post-thumb"
          data-stale={exportStale.value ? 'true' : 'false'}
        >
          {c ? (
            <img
              src={c.url}
              alt="Your story, exactly as instapost will upload it"
              title="This is the exact image instapost will upload."
            />
          ) : (
            <span class="thumb-empty" aria-hidden="true" />
          )}
          {c && exportStale.value && image.value && <span class="thumb-note">Updating preview…</span>}
        </div>
        <div class="post-meta">
          <h2 id="post-title" class="post-title">
            Your story{handle ? ` · ${at(handle)}` : ''}
          </h2>
          {c && (
            <p class="hint">
              {c.w} × {c.h} PNG · {size(c.bytes)}
            </p>
          )}
          <p class={`post-note${state.id === 'K13' ? ' ok' : ''}`} data-testid="post-note">
            {state.id === 'K13' ? `✓ ${state.note}` : state.note}
          </p>
          {state.link && (
            <button type="button" class="link" data-testid="post-link" onClick={() => act(state.link?.action ?? null)}>
              {state.link.label}
            </button>
          )}
          {suggestTest && <p class="hint">{POST_NOTES.stale}</p>}
        </div>
      </div>
      <button
        type="button"
        class={`button ${state.quiet ? '' : 'primary '}wide post-primary`}
        data-testid="post-primary"
        data-action={state.action ?? ''}
        disabled={state.disabled || working}
        onClick={() => act(state.action)}
      >
        {busy.value === 'post' ? 'Preparing…' : state.label}
        {state.id === 'K13' && <kbd>⌘↵</kbd>}
      </button>
      <p class="post-links">
        {state.action !== 'setupTest' && (
          <>
            <button
              type="button"
              class="link"
              data-testid="post-test"
              disabled={working || !fontsReady.value}
              onClick={() => void testRun()}
            >
              Test run
            </button>
            {' · '}
          </>
        )}
        <button
          type="button"
          class="link"
          data-testid="post-phone"
          disabled={working || image.value === null}
          title={shareSupported.value ? 'The share sheet (AirDrop)' : 'Saves the JPEG; AirDrop it from Finder'}
          onClick={() => void sendToPhone()}
        >
          Send to phone…
        </button>
        {' · '}
        <button
          type="button"
          class="link"
          data-testid="post-save"
          disabled={working || image.value === null}
          onClick={() => void saveCopy()}
        >
          Save copy
        </button>
      </p>
      {refused && (
        <div class="post-refusal" data-testid="post-refusal" data-error={refused.error} role="alert">
          <p>
            <strong>{ERROR_COPY[refused.error].title}</strong>{' '}
            {ERROR_COPY[refused.error].body({ nothingPosted: true, freeAt: refused.freeAt, detail: refused.detail })}
          </p>
          <p class="row-actions">
            {ERROR_COPY[refused.error].primary && (
              <button
                type="button"
                class="link"
                onClick={() =>
                  runAction(ERROR_COPY[refused.error].primary ?? 'saveCopy', {
                    mode: refused.mode,
                    handoffId: null,
                    handle,
                  })
                }
              >
                {ACTION_LABEL[ERROR_COPY[refused.error].primary ?? 'saveCopy']}
              </button>
            )}
          </p>
        </div>
      )}
      {n && (
        <p
          class={`notice ${n.kind}`}
          role={n.kind === 'error' ? 'alert' : 'status'}
          data-testid="editor-notice"
          data-code={n.code ?? ''}
        >
          {n.text}
        </p>
      )}
    </section>
  );
}
