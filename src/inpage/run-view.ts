/**
 * The run as the in-page UI shows it (inpage-ui-spec.md FS5, FS6, FS8, FS11). Pure: maps the driver's run
 * record (its raw steps and outcome) to the five owner-facing steps, the progress, and the result kind.
 * The raw step names stay in Details (FR8).
 *
 * `runProgress` has no copy (the background uses it for `inpage/state`); `runSteps` adds the step texts.
 */

import type { InpageRecord } from './driver.ts';
import { accountFailureBody, composerStrings, failureCopy } from './strings.ts';

export type StepState = 'pending' | 'active' | 'done' | 'fail' | 'unk' | 'skip';
export type ResultKind = 'posted' | 'tested' | 'shareTested' | 'checked' | 'stopped' | 'failed' | 'unknown';

export const STEP_COUNT = 5;

/** The driver's raw step → the owner's step it belongs to, and whether it ends it. */
const RAW: Readonly<Record<string, readonly [number, 'active' | 'done']>> = {
  start: [0, 'active'],
  rules: [0, 'active'],
  frame: [0, 'active'],
  'frame loaded': [0, 'done'],
  agent: [1, 'active'],
  probe: [1, 'active'],
  account: [1, 'done'],
  'story entry': [2, 'active'],
  inserted: [2, 'active'],
  composer: [2, 'done'],
  'write block verified': [3, 'active'],
  'writes open': [3, 'active'],
  'share sent': [3, 'active'],
  shared: [3, 'done'],
  decided: [4, 'active'],
  holding: [4, 'active'],
  'decided late': [4, 'active'],
};

export interface RunProgress {
  /** The step in progress (or where the run ended), 0..4. */
  current: number;
  /** The frame loaded (the live phone can show). */
  frameLoaded: boolean;
  /** A post's Share went out: it can no longer be stopped. */
  shared: boolean;
  /**
   * After Share, Instagram has not answered in the first budget: the frame is held for a late answer. Only
   * while the run is still going (RL-17): once it has a result, the frame is gone.
   */
  holding: boolean;
  /** 0..1 for the chip's bar and the entry's ring. */
  progress: number;
  /** null while running. */
  result: ResultKind | null;
}

/**
 * A post whose Share went out and was not refused may be live: no failure kind for it but Instagram's own
 * refusal (UPLOAD_FAILED). The driver already reports anything else after Share as Couldn't confirm (RS-2);
 * this also covers records stored before that.
 */
function mayBeLive(rec: Partial<Pick<InpageRecord, 'mode' | 'share' | 'code'>>): boolean {
  return rec.mode === 'post' && rec.share?.sent === true && rec.share.refused === null && rec.code !== 'UPLOAD_FAILED';
}

/** The result kind of a finished record. */
export function resultKind(
  rec: Pick<InpageRecord, 'outcome' | 'code'> & Partial<Pick<InpageRecord, 'mode' | 'share'>>,
): ResultKind | null {
  if ((rec.outcome === 'killed' || rec.outcome === 'stopped' || rec.outcome === 'notPosted') && mayBeLive(rec)) {
    return 'unknown';
  }
  switch (rec.outcome) {
    case null:
      return null;
    case 'posted':
      return 'posted';
    case 'tested':
      return 'tested';
    case 'shareTested':
      return 'shareTested';
    case 'checked':
      return 'checked';
    case 'unknown':
      return 'unknown';
    case 'stopped':
      return rec.code === 'STOPPED' ? 'stopped' : 'failed';
    default:
      return 'failed';
  }
}

export function runProgress(rec: InpageRecord): RunProgress {
  let reached = 0;
  let doneUpTo = -1;
  let frameLoaded = false;
  let holding = false;
  for (const s of rec.steps) {
    const m = RAW[s.step];
    if (s.step === 'frame loaded') frameLoaded = true;
    if (s.step === 'holding') holding = true;
    if (s.step === 'decided late') holding = false;
    if (!m) continue;
    reached = Math.max(reached, m[0]);
    if (m[1] === 'done') doneUpTo = Math.max(doneUpTo, m[0]);
  }
  const current = Math.min(STEP_COUNT - 1, doneUpTo >= reached ? doneUpTo + 1 : reached);
  const shared = rec.mode === 'post' && rec.share?.sent === true && rec.share.refused === null;
  const result = resultKind(rec);
  return {
    current,
    frameLoaded,
    shared,
    holding: holding && result === null,
    progress: result !== null ? 1 : (current + 0.5) / STEP_COUNT,
    result,
  };
}

export interface StepView {
  state: StepState;
  text: string;
}

/** The failure copy's title for a code (the failed step takes it, FS6). */
export function failureTitle(code: string | null): string {
  return failureCopy(code).title;
}

/** FS6: the five steps with their state and text. */
export function runSteps(rec: InpageRecord): StepView[] {
  const s = composerStrings.steps;
  const p = runProgress(rec);
  const test = rec.mode === 'test';
  const check = rec.mode === 'check';
  const pendingText = (i: number): string => {
    if (test && i === 3) return s.testPending3;
    if (test && i === 4) return s.testPending4;
    if (check && i >= 2) return s.checkSkip;
    return s.pending(i);
  };
  const doneText = (i: number): string => {
    if (i === 1 && rec.account.detected) return s.loggedInAs(rec.account.detected);
    if (i === 4 && rec.share?.late) return s.confirmedLate;
    return s.done(i);
  };
  const activeText = (i: number): string => {
    if (i === 3 && rec.share?.sent) return s.uploading;
    return s.active(i);
  };
  const steps: StepView[] = [];
  for (let i = 0; i < STEP_COUNT; i++) {
    const state: StepState = i < p.current ? 'done' : i === p.current && p.result === null ? 'active' : 'pending';
    steps.push({ state, text: state === 'done' ? doneText(i) : state === 'active' ? activeText(i) : pendingText(i) });
  }
  const set = (i: number, state: StepState, text: string) => {
    steps[i] = { state, text };
  };
  switch (p.result) {
    case null:
      break;
    case 'posted':
      for (let i = 0; i < STEP_COUNT; i++) set(i, 'done', doneText(i));
      break;
    case 'checked':
      set(0, 'done', doneText(0));
      set(1, 'done', doneText(1));
      for (let i = 2; i < STEP_COUNT; i++) set(i, 'skip', s.checkSkip);
      break;
    case 'tested':
      for (let i = 0; i < 3; i++) set(i, 'done', doneText(i));
      set(3, 'done', s.testDone3);
      set(4, 'skip', s.testSkip4);
      break;
    case 'shareTested':
      for (let i = 0; i < 3; i++) set(i, 'done', doneText(i));
      set(3, 'done', s.shareTestDone3);
      set(4, 'done', s.shareTestDone4);
      break;
    case 'stopped':
      set(p.current, 'skip', s.stopped);
      break;
    case 'unknown':
      set(p.current, 'unk', s.unconfirmed);
      break;
    case 'failed':
      set(p.current, 'fail', failureTitle(rec.code));
      break;
  }
  return steps;
}

export type ResultAction =
  | 'viewStory'
  | 'newStory'
  | 'post'
  | 'done'
  | 'tryAgain'
  | 'sendToPhone'
  | 'checkStory'
  | 'settings'
  | 'marks';

export interface ResultView {
  kind: ResultKind;
  /** The dialog's title (FS10). */
  head: string;
  icon: 'ok' | 'bad' | 'unk' | 'neutral';
  /** The red `Not posted` kicker (failures). */
  kicker: boolean;
  title: string;
  body: string;
  sub: string | null;
  primary: ResultAction;
  secondary: ResultAction | null;
  /** The chip's two lines (FS8). */
  chip: [string, string];
}

const FAILURE_ACTIONS: Readonly<Record<string, [ResultAction, ResultAction | null]>> = {
  PAGE_IN_USE: ['tryAgain', 'sendToPhone'],
  UPLOAD_FAILED: ['tryAgain', 'sendToPhone'],
  ACCOUNT_UNCONFIRMED: ['tryAgain', 'settings'],
  FRAME_REFUSED: ['tryAgain', 'sendToPhone'],
  PAGE_LEFT: ['post', null],
  TAB_HIDDEN: ['tryAgain', 'sendToPhone'],
  NOT_LOGGED_IN: ['done', 'tryAgain'],
  KILLED_CHALLENGE: ['sendToPhone', null],
  KILLED_OFFHOST: ['sendToPhone', null],
  TEST_LEAK: ['checkStory', null],
  // RL-19: Instagram changed its page; trying again repeats it.
  SW_INTERCEPTS: ['sendToPhone', null],
  ACCEPT_DRIFT: ['sendToPhone', null],
};

/** The `{why}` of a Couldn't confirm, from the driver's detail (its reason, or `CODE: detail`). */
export function unknownWhy(detail: string | null): string {
  const r = composerStrings.result;
  const d = detail ?? '';
  const code = /^([A-Z_]+):/.exec(d)?.[1];
  return (code ? r.unknownWhy(code) : null) ?? r.unknownWhy(d.split(/\s/)[0] ?? '') ?? r.unknownWhyDefault();
}

/** FS11: the result's copy and its actions. `setup`: the first-post setup test (K6). */
export function resultView(
  rec: InpageRecord,
  opts: { handle: string | null; setup: boolean; time: string; seconds: number | null },
): ResultView | null {
  const kind = resultKind(rec);
  if (kind === null) return null;
  const r = composerStrings.result;
  const c = composerStrings.chip;
  const handle = rec.account.detected ?? opts.handle;
  const post = rec.mode === 'post';
  switch (kind) {
    case 'posted':
      return {
        kind,
        head: r.headPosted,
        icon: 'ok',
        kicker: false,
        title: r.posted(handle),
        body: r.postedBody(opts.time, opts.seconds),
        // RL-1: the page showed a security check after Share; the story posted, and desktop posting paused.
        sub:
          [rec.share?.late ? r.postedLate : null, rec.locked ? r.postedPaused : null].filter(Boolean).join(' ') || null,
        primary: 'viewStory',
        secondary: 'newStory',
        chip: [c.posted, c.postedNote(opts.time)],
      };
    case 'tested':
      return opts.setup
        ? {
            kind,
            head: r.headSetup,
            icon: 'ok',
            kicker: false,
            title: r.setupTitle(handle),
            body: r.setupBody,
            sub: null,
            primary: 'post',
            secondary: 'done',
            chip: [c.testPassed, c.nothing],
          }
        : {
            kind,
            head: r.headTest,
            icon: 'ok',
            kicker: false,
            title: r.testTitle,
            body: r.testBody(handle),
            sub: null,
            primary: 'post',
            secondary: 'done',
            chip: [c.testPassed, c.nothing],
          };
    case 'shareTested':
      return {
        kind,
        head: r.headTest,
        icon: 'ok',
        kicker: false,
        title: r.shareTestTitle,
        body: r.shareTestBody,
        sub: null,
        primary: 'post',
        secondary: 'done',
        chip: [c.testPassed, c.nothing],
      };
    case 'checked':
      return {
        kind,
        head: r.headChecked,
        icon: 'ok',
        kicker: false,
        title: r.checkedTitle(handle),
        body: r.checkedBody,
        sub: null,
        primary: 'post',
        secondary: 'done',
        chip: [c.checked, c.nothing],
      };
    case 'stopped':
      return {
        kind,
        head: r.headStopped,
        icon: 'neutral',
        kicker: false,
        title: post ? r.stoppedTitle : r.stoppedTestTitle,
        body: post ? '' : r.nothingPosted,
        sub: null,
        primary: 'post',
        secondary: 'done',
        chip: [c.stopped, c.nothing],
      };
    case 'unknown':
      return {
        kind,
        head: r.headCheck,
        icon: 'unk',
        kicker: false,
        title: r.unknownTitle,
        body:
          r.unknownBody(
            unknownWhy(rec.code === null || rec.code === 'OUTCOME_UNKNOWN' ? rec.detail : `${rec.code}: ${rec.detail}`),
          ) + (rec.locked ? r.paused : ''),
        sub: null,
        primary: 'checkStory',
        secondary: 'marks',
        chip: [c.unknown, c.checkStory],
      };
    case 'failed': {
      const code = rec.code ?? '';
      const fc = failureCopy(code);
      const copy = code === 'ACCOUNT_UNCONFIRMED' ? { ...fc, body: accountFailureBody(rec.account.decision) } : fc;
      const [primary, secondary] = FAILURE_ACTIONS[code] ?? ['tryAgain', 'sendToPhone'];
      // The copy of these says so already (or must not: a leaked test may be live).
      const nothing = code === 'TEST_LEAK' || code === 'UPLOAD_FAILED' ? '' : ` ${r.nothingPosted}`;
      return {
        kind,
        head: r.headNotPosted,
        icon: 'bad',
        kicker: post,
        title: copy.title,
        body: `${copy.body}${nothing}${rec.locked && code !== 'TEST_LEAK' && !code.startsWith('KILLED') ? r.paused : ''}`,
        sub: null,
        primary,
        secondary,
        chip: [c.notPosted, c.seeWhy],
      };
    }
  }
}

/** FS11 Details: structural facts only, as key–value rows. */
export function detailRows(rec: InpageRecord): [string, string][] {
  const k = composerStrings.result.detailRows;
  const rows: [string, string][] = [[k.result, rec.outcome ?? 'running']];
  if (rec.code) rows.push([k.code, rec.code]);
  if (rec.detail) rows.push([k.detail, rec.detail]);
  if (rec.account.detected || rec.account.expected) {
    rows.push([
      k.account,
      `${rec.account.detected ? `@${rec.account.detected}` : '?'}${rec.account.expected ? composerStrings.result.expected(rec.account.expected) : ''}${rec.account.decision ? ` (${rec.account.decision})` : ''}`,
    ]);
  }
  const f = rec.frame;
  if (f.box) {
    rows.push([k.frame, composerStrings.result.frameRow(f.box.w, f.box.h, f.dpr ?? 1, rec.rules.installed)]);
  }
  if (rec.endedAt) rows.push([k.took, `${((rec.endedAt - rec.startedAt) / 1000).toFixed(1)} s`]);
  rows.push([k.steps, rec.steps.map((s) => s.step).join(' → ')]);
  rows.push([k.run, rec.runId]);
  return rows;
}
