/**
 * Hand-off panel (strategy §7.10): the account it posts as, the safety switches at a glance, the
 * phase timeline, the instructions for the owner's part, and the error with its fallback. Shown
 * on both routes so a running hand-off stays visible from Settings.
 *
 * AM21: while a hand-off runs, the switch chips show that session's own switches (fixed at start,
 * reported by the background), never the stored settings, which only apply to the next hand-off.
 *
 * U1/U2 (2026-10-12): the diagnostics list names the page, the window sizing, the browser, the story
 * input as the deciding probe saw it (with "not checked" when the decision stopped earlier) and the
 * service worker (control is normal on Instagram; interception is not). While `resizing`, the owner
 * is guided to drag the window narrow and tall, with the tab size live (test ids `handoff-resize`,
 * `handoff-resize-size` with `data-ok`, `data-w`, `data-h`; rows `data-row` on each `dd`).
 * AM37: the Screen row (`data-row="screen"`, `data-type`, `data-shim`) is the screen orientation the
 * composer page reads after the portrait shim, and what the shim did (C3b).
 */
import { useSignal, useSignalEffect } from '@preact/signals';
import { useRef } from 'preact/hooks';
import type { ErrorCode, HandoffPhase } from '../core/handoff/state.ts';
import {
  answerPosted,
  browserFlavour,
  cancelHandoff,
  decision,
  fakeBanner,
  finishedInfo,
  handoffFile,
  isActive,
  lastError,
  postedAnswer,
  probeReport,
  resizeInfo,
  sessionSwitches,
  starting,
  status,
  timeline,
  windowInfo,
} from './handoff-state.ts';
import {
  browserText,
  DEGRADES_TO_H0,
  errorDetail,
  errorText,
  fallbackText,
  HOLD_OPEN_TEXT,
  HOLD_OPEN_UNKNOWN_TEXT,
  PHASE_LABEL,
  PHASE_ORDER,
  pageText,
  pickText,
  postedPrompt,
  resizeSizeText,
  resizeText,
  SHARE_TEXT,
  screenText,
  secondsLeft,
  serviceWorkerText,
  storyInputText,
  windowText,
} from './messages.ts';
import { isMsiteLocked, settings } from './settings-state.ts';

const CANCELLABLE: readonly HandoffPhase[] = [
  'opening',
  'scoping',
  'fitting',
  'resizing',
  'navigating',
  'reloading',
  'probing',
  'injecting',
  'awaitingPick',
  'awaitingShare',
];

/** W3: the guided resize, with the tab size live and the time left. */
function ResizeGuide() {
  const r = resizeInfo.value;
  const now = useSignal(Date.now());
  useSignalEffect(() => {
    const id = setInterval(() => {
      now.value = Date.now();
    }, 1000);
    return () => clearInterval(id);
  });
  return (
    <div class="instruction resize" data-testid="handoff-resize">
      <p>{resizeText(r?.maxW)}</p>
      {r && (
        <p>
          The window now:{' '}
          <strong
            data-testid="handoff-resize-size"
            data-ok={r.ok ? 'true' : 'false'}
            data-w={String(Math.round(r.tab.w))}
            data-h={String(Math.round(r.tab.h))}
          >
            {resizeSizeText(r.tab, r.ok)}
          </strong>{' '}
          <span class="hint">({secondsLeft(r.until, now.value)} s left)</span>
        </p>
      )}
    </div>
  );
}

function Instructions({ phase }: { phase: HandoffPhase }) {
  const s = status.value;
  if (phase === 'resizing') return <ResizeGuide />;
  if (phase === 'awaitingPick') {
    return <p class="instruction">{pickText(handoffFile.value, s?.route === 'homeOnly')}</p>;
  }
  if (phase === 'awaitingShare') return <p class="instruction">{SHARE_TEXT}</p>;
  const done = finishedInfo.value;
  if (done && (phase === 'finished' || phase === 'closing' || phase === 'idle')) {
    const answer = postedAnswer.value;
    // AM28: no pre-answer when whether Share was tapped cannot be told (neither button is primary).
    const prompt = postedPrompt({ detected: done.detectedPosted, unknown: done.postedUnknown, answer });
    const holdOpen = phase === 'finished' && s?.holdOpen === true && answer === null;
    return (
      <div class="instruction posted" data-testid="handoff-posted" data-pre-answer={String(prompt.primary)}>
        <p>
          Posted? <span class="hint">{prompt.hint}</span>
        </p>
        {holdOpen && (
          <p class="hint" data-testid="handoff-hold-open">
            {done.postedUnknown ? HOLD_OPEN_UNKNOWN_TEXT : HOLD_OPEN_TEXT}
          </p>
        )}
        <div class="buttons">
          <button
            type="button"
            class={`button${prompt.primary === true ? ' primary' : ''}`}
            aria-pressed={answer === true}
            onClick={() => answerPosted(true)}
          >
            Yes, posted
          </button>
          <button
            type="button"
            class={`button${prompt.primary === false ? ' primary' : ''}`}
            aria-pressed={answer === false}
            onClick={() => answerPosted(false)}
          >
            Not posted
          </button>
        </div>
      </div>
    );
  }
  return null;
}

function ErrorBox({ code, freeAt, detail }: { code: ErrorCode; freeAt: number | undefined; detail?: string }) {
  const degraded = DEGRADES_TO_H0.includes(code);
  // AF-10: DESKTOP_SHELL says which is_mobile the deciding probe read (false, or none on a later page).
  // AM37: SCREEN_LANDSCAPE says what the composer read (the last probe shown carries that reading).
  const extra = errorDetail(code, detail, decision.value?.probe.isMobile, probeReport.value?.orientation);
  // AM28: Share may have been tapped (an unknown page after Share): never point at the phone lane blindly.
  const unknown = finishedInfo.value?.postedUnknown === true;
  return (
    <div class={`handoff-error${degraded ? ' warn' : ''}`} data-testid="handoff-error" data-error={code} role="alert">
      <p>
        <code>{code}</code> {errorText(code, freeAt)}
        {extra && (
          <>
            {' '}
            <span data-testid="handoff-error-detail">{extra}</span>
          </>
        )}
      </p>
      <p class="fallback">{fallbackText(code, handoffFile.value, unknown)}</p>
    </div>
  );
}

function ProbeSummary() {
  const p = probeReport.value;
  const d = decision.value;
  const w = windowInfo.value;
  const flavour = browserFlavour.value;
  if (!p && !w) return null;
  const yes = (b: boolean | 'unknown') => (b === 'unknown' ? 'unknown' : b ? 'yes' : 'no');
  // The story input as the deciding probe saw it; "accept list changed" only for a decided drift.
  const drift = lastError.value?.code === 'ACCEPT_DRIFT';
  // AF-2: a session the watch's tripwire ended says so even if the last probe shown saw nothing.
  const intercepted = lastError.value?.code === 'SW_INTERCEPTS';
  return (
    <dl class="probe" data-testid="handoff-probe">
      {d && (
        <>
          <dt>Page</dt>
          <dd data-row="page">{pageText(d.route, d.path)}</dd>
        </>
      )}
      {w && (
        <>
          <dt>Window</dt>
          <dd data-row="window">{windowText(w)}</dd>
        </>
      )}
      {flavour && (
        <>
          <dt>Browser</dt>
          <dd data-row="browser">{browserText(flavour)}</dd>
        </>
      )}
      {p && (
        <>
          <dt>Mobile page</dt>
          <dd data-row="mobile">{yes(p.isMobile)}</dd>
          <dt>Viewport</dt>
          <dd data-row="viewport">
            {p.inner.w}×{p.inner.h} @{p.dpr}x {p.portrait ? 'portrait' : 'landscape'}
          </dd>
        </>
      )}
      {p?.orientation && (
        <>
          <dt>Screen</dt>
          <dd data-row="screen" data-type={p.orientation.type ?? ''} data-shim={p.orientation.shim}>
            {screenText(p.orientation)}
          </dd>
        </>
      )}
      {d && (
        <>
          <dt>Story input</dt>
          <dd data-row="story-input">{storyInputText(d.probe, d.c4, drift)}</dd>
        </>
      )}
      {p && (
        <>
          <dt>Service worker</dt>
          <dd data-row="service-worker">{serviceWorkerText(p, intercepted)}</dd>
        </>
      )}
      {p?.canvas && (
        <>
          <dt>Canvas</dt>
          <dd data-row="canvas">
            {p.canvas.w}×{p.canvas.h} px in {Math.round(p.canvas.css.w)}×{Math.round(p.canvas.css.h)} CSS px
          </dd>
        </>
      )}
    </dl>
  );
}

export function HandoffPanel() {
  const ref = useRef<HTMLElement>(null);
  // The panel sits below the editor controls: bring it into view when a hand-off starts.
  useSignalEffect(() => {
    if (starting.value) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  const s = status.value;
  const st = settings.value;
  // The running session's switches; the stored settings only when none runs.
  const switches = sessionSwitches.value ?? { rehearsal: st.rehearsal, assistedInsert: st.assistedInsert };
  const phase: HandoffPhase = s?.phase ?? 'idle';
  const locked = isMsiteLocked(st, Date.now());
  const seen = new Set(timeline.value.map((e) => e.phase));
  // The live error while one is reported; after the session ends, the last one that ended it
  // (an H0 fallback that was followed by a normal finish does not count).
  const sticky = lastError.value;
  const shownError = s?.error
    ? { code: s.error, freeAt: s.freeAt, detail: s.detail ?? (sticky?.code === s.error ? sticky.detail : undefined) }
    : (phase === 'closing' || phase === 'idle') && sticky && !DEGRADES_TO_H0.includes(sticky.code)
      ? sticky
      : null;
  const shown = PHASE_ORDER.filter((p) => seen.has(p));

  return (
    <section class="handoff" aria-labelledby="sec-handoff" ref={ref}>
      <h2 id="sec-handoff">Post from desktop</h2>
      {fakeBanner.value && (
        <p class="banner" data-testid="handoff-banner" role="alert">
          FAKE INSTAGRAM
        </p>
      )}
      <p class="posts-as">
        Posts as <strong>{st.accountLabel.trim() || 'an unnamed account'}</strong>
        <span class="chips" data-session={sessionSwitches.value ? 'true' : 'false'}>
          <span
            class={`chip${switches.rehearsal ? ' on' : ' off'}`}
            data-testid="handoff-chip-rehearsal"
            data-on={switches.rehearsal ? 'true' : 'false'}
          >
            Rehearsal {switches.rehearsal ? 'on' : 'off'}
          </span>
          <span
            class={`chip${switches.assistedInsert ? ' on' : ''}`}
            data-testid="handoff-chip-assisted"
            data-on={switches.assistedInsert ? 'true' : 'false'}
          >
            Assisted insert {switches.assistedInsert ? 'on' : 'off'}
          </span>
        </span>
        <a class="settings-link" href="#/settings">
          Settings
        </a>
      </p>
      {locked && st.msiteLockedUntil !== null && (
        <p class="lock-note">
          Desktop lane locked until {new Date(st.msiteLockedUntil).toLocaleString()}. Type ENABLE in Settings to lift
          it.
        </p>
      )}

      <p class="phase" data-testid="handoff-phase" data-phase={phase} data-level={s?.level ?? ''} aria-live="polite">
        {starting.value ? 'Starting…' : PHASE_LABEL[phase]}
        {s?.level ? <span class="chip">{s.level === 'H1' ? 'assisted insert' : 'manual pick'}</span> : null}
      </p>
      {shown.length > 0 && (
        <ol class="timeline">
          {shown.map((p) => (
            <li key={p} data-phase={p} class={p === phase ? 'current' : 'done'}>
              {PHASE_LABEL[p]}
            </li>
          ))}
        </ol>
      )}
      <Instructions phase={phase} />
      {shownError && <ErrorBox code={shownError.code} freeAt={shownError.freeAt} detail={shownError.detail} />}
      <ProbeSummary />
      {isActive.value && CANCELLABLE.includes(phase) && (
        <button type="button" class="button ghost" onClick={cancelHandoff}>
          Cancel hand-off
        </button>
      )}
    </section>
  );
}
