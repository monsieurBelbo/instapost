/**
 * The run view's five steps (ux.md §4.6, IU4, U20): `stepsFrom(source, now)` turns a status (or a shown
 * result) into one line per step. Pure.
 *
 * While a run is active the status's `step` is the active one, earlier steps are done and later ones
 * pending. Once the result is known, the step times say what was established: a step with its time is
 * done, the first one without is where the run ended (failed, unknown, stopped or skipped by the mode),
 * and the rest stay pending.
 */
import type {
  AccountFacts,
  ComposeFacts,
  HandoffMode,
  RunResult,
  RunStep,
  SessionPhase,
  StepTimes,
  WindowDiagnostics,
} from '../core/handoff/state.ts';
import {
  ERROR_COPY,
  markedNotPosted,
  markedPosted,
  pendingStepText,
  STEP_COPY,
  STEP_ORDER,
  type StepFacts,
  slow20Text,
  slow60Text,
  uploadingText,
} from './copy.ts';
import { t } from './i18n.ts';

export type StepStatus = 'pending' | 'active' | 'waiting' | 'done' | 'failed' | 'unknown' | 'skipped';

export interface StepView {
  step: RunStep;
  status: StepStatus;
  text: string;
  /** Active: when the step began (epoch ms), for its seconds counter. */
  since?: number;
  /** A second line (slow upload). */
  note?: string;
}

export interface StepSource {
  phase: SessionPhase;
  mode?: HandoffMode;
  step?: RunStep;
  steps?: StepTimes;
  startedAt?: number;
  result?: RunResult | null;
  account?: AccountFacts | null;
  compose?: ComposeFacts | null;
  window?: WindowDiagnostics | null;
  shareSent?: boolean;
}

/** The step time that establishes each step. */
const DONE_AT: Readonly<Record<RunStep, keyof StepTimes>> = {
  instagram: 'instagram',
  account: 'account',
  story: 'composer',
  share: 'share',
  confirm: 'confirmed',
};

export function stepOrder(mode: HandoffMode | undefined): readonly RunStep[] {
  return mode === 'check' ? ['instagram', 'account'] : STEP_ORDER;
}

function facts(src: StepSource): StepFacts {
  return {
    window: src.window?.finalTab ?? null,
    handle: src.account?.detected ?? null,
    facebook: src.compose?.fbAuto === true,
  };
}

function doneText(step: RunStep, src: StepSource): string {
  const copy = STEP_COPY[step];
  // AP-9: a run that ended as a Share test (a guarded build's post too) reads as one.
  const mode = src.result?.kind === 'shareTested' ? 'shareTest' : src.mode;
  // AP-3: the owner's mark is not Instagram's confirmation.
  if (step === 'confirm' && src.result?.markedBy === 'owner' && src.result.kind === 'posted') return markedPosted();
  if (mode === 'test' && copy.test) return copy.test;
  if (mode === 'shareTest' && copy.shareTest) return copy.shareTest;
  return copy.done(facts(src));
}

/** When the step became active: the previous step's time, or the start. */
function sinceOf(step: RunStep, src: StepSource, order: readonly RunStep[]): number | undefined {
  const steps = src.steps;
  const i = order.indexOf(step);
  const prev = i > 0 ? order[i - 1] : undefined;
  const t = prev ? steps?.[DONE_AT[prev]] : undefined;
  return (typeof t === 'number' ? t : undefined) ?? steps?.opened ?? src.startedAt;
}

function activeView(step: RunStep, src: StepSource, order: readonly RunStep[], now: number): StepView {
  const since = sinceOf(step, src, order);
  // The owner's turn: the account prompt in the editor, or Finish by hand in the Instagram window.
  const waiting = src.phase === 'awaitingAccount' || src.phase === 'manual';
  let text = STEP_COPY[step].active;
  let note: string | undefined;
  if (step === 'share' && src.phase === 'sharing') text = STEP_COPY.share.active;
  if (step === 'confirm') {
    text = src.mode === 'shareTest' ? t('step.waitingUpload') : uploadingText();
    const shared = src.steps?.share;
    const elapsed = shared !== undefined ? now - shared : 0;
    if (elapsed >= 60_000) note = slow60Text();
    else if (elapsed >= 20_000) note = slow20Text();
  }
  if (waiting) text = src.phase === 'manual' ? t('step.yourTurn') : t('step.waitingAnswer');
  return {
    step,
    status: waiting ? 'waiting' : 'active',
    text,
    ...(since !== undefined ? { since } : {}),
    ...(note ? { note } : {}),
  };
}

/** The failing step's line for a result. */
function endView(step: RunStep, r: RunResult, src: StepSource): StepView {
  switch (r.kind) {
    case 'notPosted':
      return {
        step,
        status: 'failed',
        text: r.markedBy === 'owner' ? markedNotPosted() : ERROR_COPY[r.code ?? 'UPLOAD_FAILED'].title,
      };
    case 'unknown':
      return {
        step,
        status: 'unknown',
        text: r.code === 'TEST_LEAK' ? ERROR_COPY.TEST_LEAK.title : t('step.couldntConfirm'),
      };
    case 'stopped':
      return { step, status: 'skipped', text: t('step.stopped') };
    case 'tested':
      return { step, status: step === 'share' ? 'done' : 'skipped', text: doneText(step, src) };
    default:
      return { step, status: 'done', text: doneText(step, src) };
  }
}

export function stepsFrom(src: StepSource, now: number): StepView[] {
  const order = stepOrder(src.mode);
  const pending = (step: RunStep): StepView => ({ step, status: 'pending', text: pendingStepText(step, src.mode) });
  if (src.phase === 'queued') return order.map(pending);
  const r = src.result ?? null;
  const running = r === null && src.phase !== 'idle';
  if (running) {
    const current = src.step ?? 'instagram';
    const ci = Math.max(0, order.indexOf(current));
    return order.map((step, i) => {
      if (i < ci) return { step, status: 'done', text: doneText(step, src) };
      if (i === ci) return activeView(step, src, order, now);
      return pending(step);
    });
  }
  if (r === null) return order.map(pending);
  const steps = src.steps ?? { opened: src.startedAt ?? now };
  // A test passes at the composer: Share is "found, not pressed", Confirm is skipped.
  if (r.kind === 'tested') {
    return order.map((step) => {
      if (step === 'share') return { step, status: 'done', text: doneText('share', src) };
      if (step === 'confirm') return { step, status: 'skipped', text: doneText('confirm', src) };
      return { step, status: 'done', text: doneText(step, src) };
    });
  }
  if (r.kind === 'posted' || r.kind === 'shareTested' || r.kind === 'checked') {
    return order.map((step) => ({ step, status: 'done', text: doneText(step, src) }));
  }
  let ended = false;
  return order.map((step) => {
    // Never reached: the step's name only.
    if (ended) return { step, status: 'pending', text: '' };
    const t = steps[DONE_AT[step]];
    // Share was pressed (its time) but nothing confirmed: Share is done, Confirm is where it ended.
    if (typeof t === 'number') return { step, status: 'done', text: doneText(step, src) };
    ended = true;
    return endView(step, r, src);
  });
}
