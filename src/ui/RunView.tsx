/**
 * The run view (ux.md §4.6, IU4): the main area while the autopilot works, and the result in place once it
 * is known (§4.7). It mirrors what the Instagram window does, step by step, with the fact each step
 * established; it lays itself out left of the docked window when the two overlap.
 *
 * Test ids: `run-view` (`data-phase`, `data-mode`), `run-step` (`data-step`, `data-status`), `run-stop`,
 * `run-cant-stop`, `run-resize` (`data-ok`, `data-w`, `data-h`), `run-fake-bar`, `account-prompt`,
 * `finish-by-hand` (`data-needs`), `result`.
 */
import type { HandoffStatus } from '../core/handoff/state.ts';
import { AccountPrompt } from './AccountPrompt.tsx';
import {
  CANT_STOP_TEXT,
  FAKE_BAR_TEXT,
  finishByHandText,
  mmss,
  modeChip,
  RECONNECTING_TEXT,
  RUN_HINT,
  resizeText,
  runHeader,
} from './copy.ts';
import { Details } from './Details.tsx';
import { type DetailInput, diagnosticsJson } from './details.ts';
import { ResultCard } from './ResultCard.tsx';
import { connected, diag, ownRun, safetyCopy, shown, starting, status, stopRun } from './run-state.ts';
import { type StepSource, stepsFrom } from './run-steps.ts';
import { now } from './ui-state.ts';

const STEP_LABEL = { instagram: 'Instagram', account: 'Account', story: 'Story', share: 'Share', confirm: 'Confirm' };
const MARK = { pending: '○', active: '◐', waiting: '◐', done: '●', failed: '✕', unknown: '?', skipped: '–' } as const;

/** The overlap of the docked Instagram window with this editor window, in CSS px (0 when apart). */
function overlapPx(s: HandoffStatus | null): number {
  const w = s?.window;
  if (!w || typeof window === 'undefined') return 0;
  const box = w.updates.at(-1)?.outer ?? w.requested;
  const editorRight = window.screenX + window.outerWidth;
  const overlap = editorRight - box.left;
  return overlap > 0 && overlap < window.innerWidth ? Math.min(overlap, window.innerWidth * 0.6) : 0;
}

export function RunView() {
  const s = status.value;
  const r = shown.value;
  const st = starting.value;
  const d = diag.value;
  const t = now.value;
  const mode = r?.mode ?? s?.mode ?? st?.mode ?? 'post';
  const account = r?.account ?? s?.account ?? null;
  const handle = account?.detected ?? null;

  const src: StepSource = r
    ? {
        phase: s?.phase ?? 'idle',
        mode,
        steps: r.steps ?? undefined,
        startedAt: r.startedAt,
        result: r.result,
        account,
        compose: r.compose,
        window: d.window,
      }
    : s && s.handoffId !== null && s.phase !== 'idle'
      ? {
          phase: s.phase,
          mode,
          step: s.step,
          steps: s.steps,
          startedAt: s.startedAt,
          result: null,
          account,
          compose: s.compose ?? null,
          window: d.window,
          shareSent: s.shareSent,
        }
      : { phase: 'opening', mode, startedAt: st?.at ?? t, result: null };
  const steps = stepsFrom(src, t);
  const running = r === null;
  const started = src.steps?.opened ?? src.startedAt ?? t;
  const queued = s?.phase === 'queued' ? (s.queuedUntil ?? t) : null;
  const chip = modeChip(mode);

  const details: DetailInput = {
    handoffId: r?.handoffId ?? s?.handoffId ?? null,
    mode,
    result: r?.result ?? null,
    evidence: r?.evidence ?? s?.evidence ?? null,
    account,
    entry: r?.entry ?? s?.entry ?? null,
    compose: r?.compose ?? s?.compose ?? null,
    steps: r?.steps ?? s?.steps ?? null,
    window: d.window,
    raised: d.raised,
    browser: d.browser,
    probe: d.probe,
    decision: d.decision,
    code: r?.result.code ?? s?.error ?? null,
  };
  const diagnostics = () => diagnosticsJson(details);
  const resize = s?.phase === 'resizing' ? s.resize : undefined;
  const pad = running ? overlapPx(s) : 0;

  return (
    <section
      class="run-view"
      data-testid="run-view"
      data-phase={s?.phase ?? (st ? 'starting' : 'idle')}
      data-mode={mode}
      style={pad > 0 ? { paddingRight: `${Math.round(pad) + 16}px` } : undefined}
      aria-live="polite"
    >
      {d.fake && (
        <p class="fake-bar" data-testid="run-fake-bar" role="alert">
          {FAKE_BAR_TEXT}
        </p>
      )}
      <header class="run-header">
        <h1>{runHeader(mode, handle)}</h1>
        {chip && <span class="chip amber">{chip}</span>}
        {running && queued === null && <span class="run-clock">{mmss(t - started)}</span>}
      </header>
      <div class="run-body">
        {ownRun.value?.thumb && <RunThumb url={ownRun.value.thumb} />}
        <ol class="run-steps">
          {steps.map((v) => (
            <li
              key={v.step}
              class={`run-step is-${v.status}`}
              data-testid="run-step"
              data-step={v.step}
              data-status={v.status}
            >
              <span class="run-mark" aria-hidden="true">
                {v.status === 'active' ? <span class="spinner" /> : MARK[v.status]}
              </span>
              <span class="run-text">
                <span class="run-label">{STEP_LABEL[v.step]}</span> {v.text}
                {v.status === 'active' && v.since !== undefined && (
                  <span class="run-seconds">{Math.max(0, Math.floor((t - v.since) / 1000))} s</span>
                )}
                {v.note && <span class="run-note">{v.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {queued !== null && (
        <p class="instruction" data-testid="run-queued">
          Posts are at least a minute apart. Starting in {mmss(queued - t)}…
        </p>
      )}
      {resize && (
        <p
          class="instruction"
          data-testid="run-resize"
          data-ok={resize.ok ? 'true' : 'false'}
          data-w={String(Math.round(resize.tab.w))}
          data-h={String(Math.round(resize.tab.h))}
        >
          {resizeText(resize.tab, resize.ok, resize.until - t)}
        </p>
      )}
      {s?.phase === 'awaitingAccount' && s.accountPrompt && (
        <AccountPrompt
          kind={s.accountPrompt.kind}
          detected={s.accountPrompt.detected}
          expected={s.accountPrompt.expected}
          until={s.accountPrompt.until}
          {...(s.mode ? { mode: s.mode } : {})}
        />
      )}
      {s?.phase === 'manual' && s.manual && (
        <p class="instruction" data-testid="finish-by-hand" data-needs={s.manual.needs}>
          {finishByHandText(
            s.manual.needs,
            safetyCopy.value?.handoffId === s.handoffId ? (safetyCopy.value?.file ?? null) : null,
          )}
        </p>
      )}

      {running ? (
        <footer class="run-footer">
          {!connected.value && s !== null && <p class="hint">{RECONNECTING_TEXT}</p>}
          {s?.phase !== 'manual' && queued === null && <p class="hint">{RUN_HINT}</p>}
          <div class="row-actions">
            {(s?.canStop ?? true) && (
              <button type="button" class="button" data-testid="run-stop" onClick={stopRun}>
                {queued !== null ? 'Cancel' : 'Stop'} <kbd>Esc</kbd>
              </button>
            )}
            {s?.shareSent && s.canStop === false && (
              <p class="hint" data-testid="run-cant-stop">
                {CANT_STOP_TEXT}
              </p>
            )}
          </div>
          <Details input={details} />
        </footer>
      ) : (
        r && (
          <>
            <ResultCard shown={r} diagnostics={diagnostics} />
            <Details input={details} />
          </>
        )
      )}
    </section>
  );
}

/** What gets posted: the export this run uploads. */
function RunThumb({ url }: { url: string }) {
  return <img class="run-thumb" src={url} alt="The story being posted" width={108} height={192} />;
}
