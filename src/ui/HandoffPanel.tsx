/**
 * Hand-off panel (strategy §7.10): the account it posts as, the safety switches at a glance, the
 * phase timeline, the instructions for the owner's part, and the error with its fallback. Shown
 * on both routes so a running hand-off stays visible from Settings.
 *
 * AM21: while a hand-off runs, the switch chips show that session's own switches (fixed at start,
 * reported by the background), never the stored settings, which only apply to the next hand-off.
 */
import { useSignalEffect } from '@preact/signals';
import { useRef } from 'preact/hooks';
import type { ErrorCode, HandoffPhase } from '../core/handoff/state.ts';
import {
  answerPosted,
  cancelHandoff,
  fakeBanner,
  finishedInfo,
  handoffFile,
  isActive,
  lastError,
  postedAnswer,
  probeReport,
  sessionSwitches,
  starting,
  status,
  timeline,
} from './handoff-state.ts';
import {
  DEGRADES_TO_H0,
  errorDetail,
  errorText,
  fallbackText,
  HOLD_OPEN_TEXT,
  HOLD_OPEN_UNKNOWN_TEXT,
  PHASE_LABEL,
  PHASE_ORDER,
  pickText,
  postedPrompt,
  SHARE_TEXT,
} from './messages.ts';
import { isMsiteLocked, settings } from './settings-state.ts';

const CANCELLABLE: readonly HandoffPhase[] = [
  'opening',
  'scoping',
  'fitting',
  'navigating',
  'reloading',
  'probing',
  'injecting',
  'awaitingPick',
  'awaitingShare',
];

function Instructions({ phase }: { phase: HandoffPhase }) {
  const s = status.value;
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
  const extra = errorDetail(code, detail);
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
  if (!p) return null;
  const yes = (b: boolean | 'unknown') => (b === 'unknown' ? 'unknown' : b ? 'yes' : 'no');
  return (
    <dl class="probe" data-testid="handoff-probe">
      <dt>Mobile page</dt>
      <dd>{yes(p.isMobile)}</dd>
      <dt>Viewport</dt>
      <dd>
        {p.inner.w}×{p.inner.h} @{p.dpr}x {p.portrait ? 'portrait' : 'landscape'}
      </dd>
      <dt>Story input</dt>
      <dd>
        {p.storyInput}
        {p.acceptOk ? '' : ' (accept list changed)'}
      </dd>
      <dt>Service worker</dt>
      <dd>{yes(p.swControlled)}</dd>
      {p.canvas && (
        <>
          <dt>Canvas</dt>
          <dd>
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
