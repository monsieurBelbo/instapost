/**
 * Results (ux.md §4.7, IU5): replace the run view's footer in place; the step list stays above. One primary
 * action, at most one secondary; codes only in Details. Links to Instagram go through the background
 * (`ui/open-instagram`). Every failure after the export names its safety copy with a Show link.
 */
import { useEffect } from 'preact/hooks';
import { showDownload } from './actions.ts';
import { ACTION_LABEL, type ActionId, at, HELD_TEXT, mmss, resultActions, resultText } from './copy.ts';
import { newStory } from './editor-state.ts';
import { runAction } from './result-actions.ts';
import { adoptCheckedAccount, dismissResult, lane, openInstagram, resultSeen, type ShownResult } from './run-state.ts';
import { now } from './ui-state.ts';

function ActionButton({
  id,
  primary,
  shown,
  diagnostics,
}: {
  id: ActionId;
  primary: boolean;
  shown: ShownResult;
  diagnostics: () => string;
}) {
  let label = ACTION_LABEL[id];
  const l = lane.value;
  // §5: Try again is a new click, paced by the rate guard (`Try again · 0:41`).
  if (id === 'tryAgain' && l?.kind === 'spacing' && l.freeAt !== undefined && l.freeAt > now.value) {
    label = `${label} · ${mmss(l.freeAt - now.value)}`;
  }
  return (
    <button
      type="button"
      class={primary ? 'button primary' : 'button ghost'}
      data-testid={primary ? 'result-primary' : 'result-secondary'}
      data-action={id}
      onClick={() =>
        runAction(id, {
          mode: shown.mode,
          handoffId: shown.handoffId,
          handle: shown.result.account ?? shown.account?.detected ?? null,
          diagnostics,
        })
      }
    >
      {label}
    </button>
  );
}

export function ResultCard({ shown, diagnostics }: { shown: ShownResult; diagnostics: () => string }) {
  const r = shown.result;
  const durationMs = shown.steps?.confirmed !== undefined ? shown.steps.confirmed - shown.startedAt : undefined;
  const nothingPosted = !shown.evidence?.sharedAt && (shown.evidence?.net.length ?? 0) === 0;
  const text = resultText(r, {
    nothingPosted,
    detail: r.detail,
    handle: r.account ?? shown.account?.detected ?? null,
    expected: shown.account?.expected ?? null,
    why: r.why,
    ...(durationMs !== undefined ? { durationMs } : {}),
    mode: shown.mode,
  });
  // Finish by hand needs the window, which is kept only for a while (offer-manual): without it, the other action leads.
  const raw = resultActions(r);
  const manualOk = shown.held === 'offerManual';
  const usable = (a: ActionId | null): ActionId | null =>
    a !== null && (a === 'finishByHand' || a === 'shareItMyself') && !manualOk ? null : a;
  const first = usable(raw.primary);
  const second = usable(raw.secondary);
  const actions = { primary: first ?? second, secondary: first ? second : null };
  const handle = r.account ?? shown.account?.detected ?? null;
  const code = r.kind === 'notPosted' || r.kind === 'unknown' ? (r.code ?? null) : null;

  // The editor showed this result: the toolbar badge may clear.
  useEffect(() => {
    resultSeen(shown.handoffId);
  }, [shown.handoffId]);

  const done = (
    <button type="button" class="link" data-testid="result-done" onClick={dismissResult}>
      Done
    </button>
  );

  return (
    <section
      class={`result result-${r.kind}`}
      data-testid="result"
      data-kind={r.kind}
      data-code={code ?? ''}
      data-held={shown.held ?? ''}
      aria-live="polite"
    >
      <div class="result-head">
        <span class="result-icon" aria-hidden="true">
          {text.icon}
        </span>
        <h2 class="result-title">{text.title}</h2>
      </div>
      <p class="result-body">{text.body}</p>
      {shown.copy && (
        <p class="result-copy" data-testid="result-copy">
          Saved a copy: Downloads/instapost/{shown.copy.file}{' '}
          <button
            type="button"
            class="link"
            data-testid="result-show"
            onClick={() => showDownload(shown.copy?.downloadId ?? 0)}
          >
            Show
          </button>
        </p>
      )}
      {shown.held === 'upload' && (
        <p class="hint" data-testid="result-held">
          {HELD_TEXT}
        </p>
      )}
      {shown.held === 'offerManual' && shown.closeAt !== null && (
        <p class="hint" data-testid="result-offer-manual">
          The Instagram window stays open {mmss(shown.closeAt - now.value)} in case you want to finish by hand.
        </p>
      )}
      <div class="row-actions">
        {r.kind === 'posted' && (
          <>
            <button
              type="button"
              class="button primary"
              data-testid="result-new"
              onClick={() => {
                dismissResult();
                newStory();
              }}
            >
              New story <kbd>N</kbd>
            </button>
            <button
              type="button"
              class="button ghost"
              data-testid="result-view-story"
              onClick={() => openInstagram(handle ? 'story' : 'home', handle)}
            >
              View story ↗
            </button>
            {done}
          </>
        )}
        {r.kind === 'tested' && (
          <>
            <button
              type="button"
              class="button primary"
              data-testid="result-post"
              onClick={() => runAction('tryAgain', { mode: 'post', handoffId: null, handle })}
            >
              Post story <kbd>⌘↵</kbd>
            </button>
            {done}
          </>
        )}
        {r.kind === 'checked' && r.account && r.lockedTo && (
          <button
            type="button"
            class="button primary"
            data-testid="result-use-account"
            onClick={() => {
              adoptCheckedAccount(shown.handoffId);
              dismissResult();
            }}
          >
            Use {at(r.account)}
          </button>
        )}
        {(r.kind === 'shareTested' || r.kind === 'checked') && done}
        {r.kind === 'stopped' && (
          <>
            <button
              type="button"
              class="button primary"
              data-testid="result-post"
              onClick={() => runAction('tryAgain', { mode: shown.mode, handoffId: null, handle })}
            >
              {shown.mode === 'post' ? 'Post story' : 'Run again'}
            </button>
            {done}
          </>
        )}
        {r.kind === 'unknown' && (
          <>
            <button
              type="button"
              class="button primary"
              data-testid="result-check-story"
              onClick={() => runAction('checkStory', { mode: shown.mode, handoffId: shown.handoffId, handle })}
            >
              Check my story ↗
            </button>
            {r.code === 'TEST_LEAK' ? (
              <ActionButton id="resume" primary={false} shown={shown} diagnostics={diagnostics} />
            ) : (
              <span class="marks">
                <button
                  type="button"
                  class="link"
                  data-testid="result-mark-posted"
                  onClick={() => runAction('markPosted', { mode: shown.mode, handoffId: shown.handoffId, handle })}
                >
                  It posted
                </button>
                {' · '}
                <button
                  type="button"
                  class="link"
                  data-testid="result-mark-not-posted"
                  onClick={() => runAction('markNotPosted', { mode: shown.mode, handoffId: shown.handoffId, handle })}
                >
                  It didn’t post
                </button>
              </span>
            )}
            {done}
          </>
        )}
        {r.kind === 'notPosted' && (
          <>
            {actions.primary && <ActionButton id={actions.primary} primary shown={shown} diagnostics={diagnostics} />}
            {actions.secondary && (
              <ActionButton id={actions.secondary} primary={false} shown={shown} diagnostics={diagnostics} />
            )}
            {done}
          </>
        )}
      </div>
    </section>
  );
}
