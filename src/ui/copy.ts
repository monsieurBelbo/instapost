/**
 * Every user-facing text of the editor's runs (docs/ux.md §4, §5; IU7), in the current language (i18n.ts,
 * strategy §11 AM44). Pure apart from reading the language: the texts themselves live in the catalogs.
 *
 * Conventions (ux.md): copy never quotes Instagram's own UI strings beyond the names of its controls (+,
 * Story, Share); "Nothing was posted" is said only when the Share command was never sent (or the agent did
 * not tap it), the owner's own Share was not seen and no upload or publish request was seen (`nothingPosted`
 * in the context); codes appear only in Details; every failure names one primary action and at most one
 * secondary.
 */
import type { ErrorCode, HandoffMode, MsiteLockReason, RunResult, RunStep, UnknownWhy } from '../core/handoff/state.ts';
import { MSITE_MAX_CSS_WIDTH } from '../core/ig-contract/contract.ts';
import { intlLocale, type Lang, lang, liveTexts, type MsgKey, t, tk } from './i18n.ts';

/** What a result or error button does (ResultCard maps them to actions). */
export type ActionId =
  | 'sendToPhone'
  | 'saveCopy'
  | 'tryAgain'
  | 'finishByHand'
  | 'shareItMyself'
  | 'openInstagram'
  | 'checkStory'
  | 'copyDiagnostics'
  | 'showRun'
  | 'resume'
  | 'settings'
  | 'choosePhoto'
  | 'reload'
  | 'markPosted'
  | 'markNotPosted';

const ACTION_IDS: readonly ActionId[] = [
  'sendToPhone',
  'saveCopy',
  'tryAgain',
  'finishByHand',
  'shareItMyself',
  'openInstagram',
  'checkStory',
  'copyDiagnostics',
  'showRun',
  'resume',
  'settings',
  'choosePhoto',
  'reload',
  'markPosted',
  'markNotPosted',
];

export const ACTION_LABEL: Readonly<Record<ActionId, string>> = liveTexts(ACTION_IDS, (id) =>
  tk(`action.${id}` as MsgKey),
);

/** AP-3: the owner marked a Couldn't confirm; Instagram never confirmed it. */
export const markedPosted = (): string => t('marked.posted');
export const markedNotPosted = (): string => t('marked.notPosted');

export interface CopyCtx {
  /** The §5 rule (outcome.ts nothingPosted, from the status). */
  nothingPosted: boolean;
  detail?: string;
  freeAt?: number;
  /** The detected handle (no @), or null. */
  handle?: string | null;
  expected?: string | null;
  why?: UnknownWhy;
  /** The result was Posted before a kill (KILLED_*). */
  postedBeforeKill?: boolean;
  now?: number;
}

export interface ErrorCopy {
  readonly title: string;
  body: (c: CopyCtx) => string;
  primary: ActionId | null;
  secondary: ActionId | null;
}

/** Local time like `14:05`, in the chosen language. */
export function clock(time: number): string {
  return new Date(time).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
}

/** Local time with seconds, like `14:05:09`. */
export function clockSeconds(time: number): string {
  return new Date(time).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** A short date like `20 Oct` / `20 oct`. */
export function shortDate(time: number): string {
  return new Date(time).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
}

/**
 * How a language names the day inside "until …" / "detected …" (every caller of `dateTime` is such a
 * sentence): English `Tue 20 Oct`; Spanish `martes 20 de octubre` (after "hasta el" / "detectada el", an
 * abbreviated weekday is ungrammatical and `el mar` reads "the sea", ES-1).
 */
const DAY_STYLE: Readonly<Record<Lang, 'short' | 'long'>> = { en: 'short', es: 'long' };

/** The day for `dateTime`: Intl's own words and order, without the comma Intl puts after a long weekday. */
function dayText(time: number): string {
  const d = new Date(time);
  if (DAY_STYLE[lang.value] === 'short') {
    return d.toLocaleDateString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  }
  const parts = new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).formatToParts(
    d,
  );
  return parts
    .map((p, i) => (p.type === 'literal' && parts[i - 1]?.type === 'weekday' ? ' ' : p.value))
    .join('')
    .trim();
}

/** A date and time inside a sentence: `Tue 20 Oct, 14:05` / `martes 20 de octubre a las 14:05`. */
export function dateTime(time: number): string {
  return t('date.dayTime', { day: dayText(time), time: clock(time) });
}

/** `0:42` */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const at = (h: string | null | undefined): string => (h ? `@${h}` : '');

/** The folder safety copies go to, as the owner sees it (`Downloads/instapost`). */
export const folder = (): string => t('copy.folder');

const nothing = (c: CopyCtx): string => (c.nothingPosted ? ` ${t('copy.nothingPosted')}` : '');

/** TIMEOUT's detail is `<step> <n> s` (the reducer's), e.g. `story 30 s`. */
function timeoutParts(detail: string | undefined): { step: string; seconds: string } | null {
  const m = /^(instagram|account|story|share|confirm|manual)\s+(\d+)\s*s/.exec(detail ?? '');
  if (!m) return null;
  return { step: m[1] ?? '', seconds: m[2] ?? '' };
}

const STEPS: readonly RunStep[] = ['instagram', 'account', 'story', 'share', 'confirm'];
/** A step's name in the run view (Instagram, Account, Story, Share, Confirm). */
export const stepName = (step: RunStep): string => tk(`step.name.${step}` as MsgKey);
const isStep = (s: string): s is RunStep => (STEPS as readonly string[]).includes(s);

/** The reducer's entry details (`entryDetail`), in words. */
const ENTRY_DETAIL: Readonly<Record<string, MsgKey>> = {
  'no + entry beside the story input': 'detail.entryMissing',
  'no menu after +': 'detail.menuMissing',
  'neither menu item started a story': 'detail.wrongItem',
  'story input not armed': 'detail.notArmed',
  'story session refused': 'detail.sessionRefused',
  'window in use': 'detail.windowInUse',
  'window hidden': 'detail.windowHidden',
  'tap refused': 'detail.tapRefused',
  // A new document right after the + tap (reducer `newDocument`; also INJECTION_IGNORED's detail).
  'page reloaded': 'detail.pageReloaded',
};

/**
 * A reducer detail as copy shows it in parentheses: the entry details and `upload <status>` /
 * `publish <status> …` in the current language; anything else (a technical fragment) as it is.
 */
export function detailText(detail: string): string {
  const known = ENTRY_DETAIL[detail];
  if (known) return tk(known);
  const menu = /^menu (\S+) items$/.exec(detail);
  if (menu) return menu[1] === '1' ? t('detail.menuItem') : t('detail.menuItems', { n: menu[1] ?? '?' });
  const write = /^(upload|publish) (\d{1,3})(.*)$/.exec(detail);
  if (write) {
    const status = `${write[2] ?? ''}${write[3] ?? ''}`;
    return write[1] === 'upload' ? t('detail.upload', { status }) : t('detail.publish', { status });
  }
  return detail;
}

const paren = (detail: string | undefined): string => (detail ? ` (${detailText(detail)})` : '');

/** ux.md §5 `{why}` for Couldn't confirm. */
export function whyText(why: UnknownWhy | undefined, detail?: string): string {
  switch (why) {
    case 'no-upload-seen':
      return t('why.noUploadSeen');
    case 'no-finalize-after-upload':
      return t('why.noFinalize');
    case 'configure-5xx': {
      const status = /\b(5\d\d)\b/.exec(detail ?? '')?.[1];
      return t('why.configure5xx', { status: status ? ` (${status})` : '' });
    }
    case 'configure-0':
      return t('why.configure0');
    case 'configure-html':
    case 'redirected':
      return t('why.configureHtml');
    case 'window-closed':
      return t('why.windowClosed');
    case 'agent-lost':
      return t('why.agentLost');
    case 'unexpected-page': {
      const page = /page (\S+)/.exec(detail ?? '')?.[1];
      return t('why.unexpectedPage', { page: page ? ` (${page})` : '' });
    }
    case 'share-not-acknowledged':
      return t('why.shareNotAck');
    case 'not-blocked': {
      const status = /\b(\d{3})\b/.exec(detail ?? '')?.[1];
      return status ? t('why.notBlocked', { status }) : t('why.notBlockedNoStatus');
    }
    default:
      return t('why.default');
  }
}

/** An error's copy whose title is read in the current language at access time. */
function copy(
  code: ErrorCode,
  body: ErrorCopy['body'],
  primary: ActionId | null,
  secondary: ActionId | null,
): ErrorCopy {
  return {
    get title() {
      return tk(`err.${code}.title` as MsgKey);
    },
    body,
    primary,
    secondary,
  };
}

/** ux.md §5: the copy for every code (title, body, primary, secondary). */
export const ERROR_COPY: Readonly<Record<ErrorCode, ErrorCopy>> = {
  // `detail` is the rate guard's rule (spacing, hour, day), when the refusal names it.
  RATE_LIMITED: copy(
    'RATE_LIMITED',
    (c) => {
      const time = c.freeAt ? clock(c.freeAt) : null;
      if (c.detail === 'spacing') {
        return time ? t('err.RATE_LIMITED.spacing', { time }) : t('err.RATE_LIMITED.spacingLater');
      }
      if (c.detail === 'day') return t('err.RATE_LIMITED.day');
      return time ? t('err.RATE_LIMITED.hour', { time }) : t('err.RATE_LIMITED.hourLater');
    },
    'sendToPhone',
    'saveCopy',
  ),
  HANDOFF_BUSY: copy('HANDOFF_BUSY', () => t('err.HANDOFF_BUSY.body'), 'showRun', null),
  MSITE_LOCKED: copy(
    'MSITE_LOCKED',
    (c) => (c.freeAt ? t('err.MSITE_LOCKED.body', { until: dateTime(c.freeAt) }) : t('err.MSITE_LOCKED.bodyLater')),
    'sendToPhone',
    'resume',
  ),
  GUARD_NOT_FAKE: copy(
    'GUARD_NOT_FAKE',
    (c) => t('err.GUARD_NOT_FAKE.body', { nothing: nothing(c) }),
    'copyDiagnostics',
    null,
  ),
  BRANDED_BROWSER: copy('BRANDED_BROWSER', () => t('err.BRANDED_BROWSER.body'), null, null),
  DESKTOP_SHELL: copy(
    'DESKTOP_SHELL',
    (c) => t('err.DESKTOP_SHELL.body', { nothing: nothing(c) }),
    'sendToPhone',
    'tryAgain',
  ),
  NOT_LOGGED_IN: copy(
    'NOT_LOGGED_IN',
    (c) => t('err.NOT_LOGGED_IN.body', { nothing: nothing(c) }),
    'openInstagram',
    'tryAgain',
  ),
  LANDSCAPE: copy(
    'LANDSCAPE',
    (c) =>
      c.detail === 'story session refused'
        ? t('err.LANDSCAPE.session', { nothing: nothing(c) })
        : t('err.LANDSCAPE.body', { nothing: nothing(c) }),
    'tryAgain',
    'sendToPhone',
  ),
  SCREEN_TOO_SMALL: copy(
    'SCREEN_TOO_SMALL',
    (c) => t('err.SCREEN_TOO_SMALL.body', { nothing: nothing(c) }),
    'sendToPhone',
    null,
  ),
  INPUT_MISSING: copy(
    'INPUT_MISSING',
    (c) => t('err.INPUT_MISSING.body', { nothing: nothing(c) }),
    'sendToPhone',
    'finishByHand',
  ),
  ACCEPT_DRIFT: copy(
    'ACCEPT_DRIFT',
    (c) => t('err.ACCEPT_DRIFT.body', { nothing: nothing(c) }),
    'sendToPhone',
    'finishByHand',
  ),
  INJECTION_IGNORED: copy(
    'INJECTION_IGNORED',
    (c) => t('err.INJECTION_IGNORED.body', { nothing: nothing(c) }),
    'finishByHand',
    'sendToPhone',
  ),
  SW_TOOK_CONTROL: copy('SW_TOOK_CONTROL', () => t('err.SW_TOOK_CONTROL.body'), null, null),
  KILLED_CHALLENGE: copy(
    'KILLED_CHALLENGE',
    (c) =>
      t('err.KILLED_CHALLENGE.body', {
        after: c.postedBeforeKill ? ` ${t('err.KILLED_CHALLENGE.posted')}` : nothing(c),
      }),
    'sendToPhone',
    null,
  ),
  KILLED_OFFHOST: copy(
    'KILLED_OFFHOST',
    (c) =>
      t('err.KILLED_OFFHOST.body', { after: c.postedBeforeKill ? ` ${t('err.KILLED_OFFHOST.posted')}` : nothing(c) }),
    'sendToPhone',
    null,
  ),
  AGENT_UNREACHABLE: copy(
    'AGENT_UNREACHABLE',
    (c) => t('err.AGENT_UNREACHABLE.body', { nothing: nothing(c) }),
    'tryAgain',
    'sendToPhone',
  ),
  TIMEOUT: copy(
    'TIMEOUT',
    (c) => {
      if (c.detail?.startsWith('manual')) return t('err.TIMEOUT.manual', { nothing: nothing(c) });
      const p = timeoutParts(c.detail);
      if (!p) return t('err.TIMEOUT.any', { nothing: nothing(c) });
      const step = isStep(p.step) ? stepName(p.step) : p.step;
      return t('err.TIMEOUT.step', { step, seconds: p.seconds, nothing: nothing(c) });
    },
    'tryAgain',
    'sendToPhone',
  ),
  EXPORT_TOO_LARGE: copy('EXPORT_TOO_LARGE', () => t('err.EXPORT_TOO_LARGE.body'), null, 'sendToPhone'),
  DECODE_FAILED: copy('DECODE_FAILED', () => t('err.DECODE_FAILED.body'), 'choosePhoto', null),
  FONT_NOT_LOADED: copy('FONT_NOT_LOADED', () => t('err.FONT_NOT_LOADED.body'), 'reload', null),
  UNEXPECTED_PAGE: copy(
    'UNEXPECTED_PAGE',
    (c) => {
      const page = /page (\S+)/.exec(c.detail ?? '')?.[1];
      return t('err.UNEXPECTED_PAGE.body', { page: page ?? t('err.UNEXPECTED_PAGE.another'), nothing: nothing(c) });
    },
    'tryAgain',
    'sendToPhone',
  ),
  NAVIGATION_TIMEOUT: copy(
    'NAVIGATION_TIMEOUT',
    (c) => t('err.NAVIGATION_TIMEOUT.body', { nothing: nothing(c) }),
    'tryAgain',
    'sendToPhone',
  ),
  SW_INTERCEPTS: copy(
    'SW_INTERCEPTS',
    (c) => t('err.SW_INTERCEPTS.body', { nothing: nothing(c) }),
    'sendToPhone',
    'copyDiagnostics',
  ),
  WINDOW_NOT_FITTED: copy(
    'WINDOW_NOT_FITTED',
    (c) => t('err.WINDOW_NOT_FITTED.body', { nothing: nothing(c) }),
    'tryAgain',
    'sendToPhone',
  ),
  LAYOUT_TOO_WIDE: copy(
    'LAYOUT_TOO_WIDE',
    (c) => t('err.LAYOUT_TOO_WIDE.body', { max: MSITE_MAX_CSS_WIDTH, nothing: nothing(c) }),
    'tryAgain',
    'sendToPhone',
  ),
  SCREEN_LANDSCAPE: copy(
    'SCREEN_LANDSCAPE',
    (c) => t('err.SCREEN_LANDSCAPE.body', { nothing: nothing(c) }),
    'sendToPhone',
    'copyDiagnostics',
  ),
  STORY_ENTRY_MISSING: copy(
    'STORY_ENTRY_MISSING',
    (c) => t('err.STORY_ENTRY_MISSING.body', { detail: paren(c.detail), nothing: nothing(c) }),
    'finishByHand',
    'sendToPhone',
  ),
  SHARE_MISSING: copy(
    'SHARE_MISSING',
    (c) => t('err.SHARE_MISSING.body', { nothing: nothing(c) }),
    'shareItMyself',
    'sendToPhone',
  ),
  WINDOW_IN_USE: copy(
    'WINDOW_IN_USE',
    (c) => t('err.WINDOW_IN_USE.body', { nothing: nothing(c) }),
    'finishByHand',
    'tryAgain',
  ),
  WINDOW_HIDDEN: copy(
    'WINDOW_HIDDEN',
    (c) => t('err.WINDOW_HIDDEN.body', { nothing: nothing(c) }),
    'tryAgain',
    'sendToPhone',
  ),
  ACCOUNT_UNCONFIRMED: copy(
    'ACCOUNT_UNCONFIRMED',
    (c) =>
      c.detail === 'unreadable' || !c.handle
        ? t('err.ACCOUNT_UNCONFIRMED.unreadable', { nothing: nothing(c) })
        : t('err.ACCOUNT_UNCONFIRMED.body', {
            handle: at(c.handle),
            notExpected: c.expected ? t('err.ACCOUNT_UNCONFIRMED.not', { expected: at(c.expected) }) : '',
            nothing: nothing(c),
          }),
    'tryAgain',
    'settings',
  ),
  UPLOAD_FAILED: copy(
    'UPLOAD_FAILED',
    (c) => t('err.UPLOAD_FAILED.body', { detail: paren(c.detail) }),
    'tryAgain',
    'sendToPhone',
  ),
  OUTCOME_UNKNOWN: copy(
    'OUTCOME_UNKNOWN',
    (c) => t('err.OUTCOME_UNKNOWN.body', { why: whyText(c.why, c.detail) }),
    'checkStory',
    'markPosted',
  ),
  TEST_LEAK: copy('TEST_LEAK', (c) => t('err.TEST_LEAK.body', { detail: paren(c.detail) }), 'checkStory', 'resume'),
};

// ---- the run view (§4.6) -------------------------------------------------------------------

export const STEP_ORDER: readonly RunStep[] = STEPS;

export interface StepCopy {
  readonly active: string;
  done: (facts: StepFacts) => string;
  /** By mode, when the step does not run or ends differently. */
  readonly test?: string;
  readonly shareTest?: string;
}

export interface StepFacts {
  window?: { w: number; h: number } | null;
  handle?: string | null;
  facebook?: boolean;
}

/** A step that has not run yet, as the mode will run it. */
export function pendingStepText(step: RunStep, mode: HandoffMode | undefined): string {
  if (mode === 'test' && step === 'share') return t('step.pending.testShare');
  if (mode === 'test' && step === 'confirm') return t('step.pending.testConfirm');
  if (mode === 'shareTest' && step === 'share') return t('step.pending.shareTestShare');
  if (mode === 'shareTest' && step === 'confirm') return t('step.pending.shareTestConfirm');
  return STEP_COPY[step].active;
}

export const STEP_COPY: Readonly<Record<RunStep, StepCopy>> = {
  instagram: {
    get active() {
      return t('step.instagram.active');
    },
    done: (f) =>
      f.window
        ? t('step.instagram.doneSize', { w: Math.round(f.window.w), h: Math.round(f.window.h) })
        : t('step.instagram.done'),
  },
  account: {
    get active() {
      return t('step.account.active');
    },
    done: (f) => (f.handle ? t('step.account.done', { handle: at(f.handle) }) : t('step.account.doneByYou')),
  },
  story: {
    get active() {
      return t('step.story.active');
    },
    done: () => t('step.story.done'),
  },
  share: {
    get active() {
      return t('step.share.active');
    },
    done: (f) => (f.facebook ? t('step.share.doneFacebook') : t('step.share.done')),
    get test() {
      return t('step.share.test');
    },
    get shareTest() {
      return t('step.share.shareTest');
    },
  },
  confirm: {
    get active() {
      return t('step.confirm.active');
    },
    done: () => t('step.confirm.done'),
    get test() {
      return t('step.confirm.test');
    },
    get shareTest() {
      return t('step.confirm.shareTest');
    },
  },
};

/** While confirming: Instagram's own "uploading" (the active text after the Share click). */
export const uploadingText = (): string => t('run.uploading');
export const slow20Text = (): string => t('run.slow20');
export const slow60Text = (): string => t('run.slow60');
export const cantStopText = (): string => t('run.cantStop');
export const reconnectingText = (): string => t('run.reconnecting');
export const runHint = (): string => t('run.hint');
export const fakeBarText = (): string => t('run.fakeBar');

export function runHeader(mode: HandoffMode | undefined, handle: string | null | undefined): string {
  if (mode === 'check') return t('run.header.check');
  if (mode === 'test') return handle ? t('run.header.testAs', { handle: at(handle) }) : t('run.header.test');
  if (mode === 'shareTest') return t('run.header.shareTest');
  return handle ? t('run.header.postAs', { handle: at(handle) }) : t('run.header.post');
}

export function modeChip(mode: HandoffMode | undefined): string | null {
  if (mode === 'test') return t('run.chip.test');
  if (mode === 'shareTest') return t('run.chip.shareTest');
  return null;
}

/** §4.6: Arc refused to size the window. */
export function resizeText(size: { w: number; h: number } | null, ok: boolean, left: number): string {
  const now = size ? t('run.resizeNow', { w: Math.round(size.w), h: Math.round(size.h), mark: ok ? '✓' : '✗' }) : '';
  const rest = ok ? '' : ` · ${t('run.resizeLeft', { left: mmss(left) })}`;
  return `${t('run.resize')} ${now}${rest}`.trim();
}

// ---- results (§4.7) -------------------------------------------------------------------------

export interface ResultText {
  icon: '✓' | '✕' | '?' | '■' | '!';
  title: string;
  body: string;
}

const postedTitle = (handle: string | null | undefined): string =>
  handle ? t('result.postedTo', { handle: at(handle) }) : t('result.postedToYours');

/** The result card's title and body for a result (failures use ERROR_COPY). */
export function resultText(r: RunResult, c: CopyCtx & { durationMs?: number; mode?: HandoffMode }): ResultText {
  switch (r.kind) {
    case 'posted': {
      if (r.markedBy === 'owner') {
        // AP-3: the owner's word, not Instagram's answer (P4: "Posted" only from the publish answer).
        return { icon: '✓', title: markedPosted(), body: t('result.markedPosted', { time: clock(r.at) }) };
      }
      if (r.killed) {
        return {
          icon: '✓',
          title: postedTitle(r.account),
          body: ERROR_COPY[r.killed].body({ ...c, postedBeforeKill: true }),
        };
      }
      if (r.alarms.includes('DUPLICATE_UPLOAD')) {
        return { icon: '✓', title: t('result.duplicate.title'), body: t('result.duplicate.body') };
      }
      const took = c.durationMs ? t('result.took', { s: Math.round(c.durationMs / 1000) }) : '';
      const late = r.late ? `${t('result.lateConfirmed', { time: clock(r.at) })} ` : '';
      const fb = r.facebook ? ` ${t('result.facebook')}` : '';
      return {
        icon: '✓',
        title: postedTitle(r.account),
        body: `${late}${t('result.posted.body', { time: clock(r.at), took })}${fb}`,
      };
    }
    case 'tested':
      return {
        icon: '✓',
        title: t('result.tested.title'),
        body: r.account ? t('result.tested.bodyAs', { handle: at(r.account) }) : t('result.tested.body'),
      };
    case 'shareTested':
      return { icon: '✓', title: t('result.shareTested.title'), body: t('result.shareTested.body') };
    case 'checked':
      if (r.account && r.lockedTo) {
        // AP-4: never "Posts go to this account" when Post story would stop and ask.
        const names = { account: at(r.account), locked: at(r.lockedTo) };
        return {
          icon: '!',
          title: t('result.checked.locked.title', names),
          body: t('result.checked.locked.body', names),
        };
      }
      return {
        icon: '✓',
        title: r.account ? t('result.checked.title', { account: at(r.account) }) : t('result.checked.titleNoAccount'),
        body: r.account ? t('result.checked.body') : t('result.checked.bodyNoAccount'),
      };
    case 'stopped':
      return {
        icon: '■',
        title: r.stoppedBy === 'window' ? t('result.stopped.window') : t('result.stopped.title'),
        body: c.nothingPosted ? t('copy.nothingPosted') : t('result.stopped.check'),
      };
    case 'unknown': {
      if (r.code === 'TEST_LEAK') {
        const leak = ERROR_COPY.TEST_LEAK;
        return { icon: '?', title: leak.title, body: leak.body(c) };
      }
      const unknown = ERROR_COPY.OUTCOME_UNKNOWN;
      const killed = r.killed ? ` ${t('result.unknown.killed', { title: ERROR_COPY[r.killed].title })}` : '';
      return { icon: '?', title: unknown.title, body: `${unknown.body({ ...c, why: r.why })}${killed}` };
    }
    case 'notPosted': {
      if (r.markedBy === 'owner') {
        return { icon: '✕', title: markedNotPosted(), body: t('result.markedNotPosted', { time: clock(r.at) }) };
      }
      const failed = ERROR_COPY[r.code ?? 'UPLOAD_FAILED'];
      const late = r.late ? `${t('result.lateFailed')} ` : '';
      return {
        icon: '✕',
        title: t('result.notPosted.title', { title: failed.title }),
        body: `${late}${failed.body(c)}`,
      };
    }
  }
}

/** The actions a result offers: one primary, at most one secondary (§5, §4.7). */
export function resultActions(r: RunResult): { primary: ActionId | null; secondary: ActionId | null } {
  switch (r.kind) {
    case 'posted':
      return { primary: null, secondary: null };
    case 'unknown':
      return r.code === 'TEST_LEAK'
        ? { primary: 'checkStory', secondary: 'resume' }
        : { primary: 'checkStory', secondary: null };
    case 'notPosted': {
      const c = ERROR_COPY[r.code ?? 'UPLOAD_FAILED'];
      return { primary: c.primary, secondary: c.secondary };
    }
    default:
      return { primary: null, secondary: null };
  }
}

export const heldText = (): string => t('result.held');

/** §4.9 Finish by hand. */
export function finishByHandText(needs: 'pick' | 'share', file: string | null): string {
  if (needs === 'share') return t('manual.share');
  const pick = file ? t('manual.pickFile', { file, folder: folder() }) : t('manual.pickNewest', { folder: folder() });
  return t('manual.pick', { pick });
}

// ---- the account prompt (§4.8) ------------------------------------------------------------------

export function accountPromptText(
  kind: 'mismatch' | 'unreadable' | 'first',
  detected: string | null,
  expected: string | null,
  mode: HandoffMode = 'post',
): { lines: string[]; proceed: string } {
  // A test or a Share test never publishes: its button says what it does.
  const post = mode === 'post';
  if (kind === 'unreadable') {
    return { lines: [t('prompt.unreadable')], proceed: post ? t('prompt.postAnyway') : t('prompt.continueAnyway') };
  }
  const handle = at(detected);
  const proceed = post ? t('prompt.proceed.post', { handle }) : t('prompt.proceed.test', { handle });
  if (kind === 'first' || !expected) {
    return { lines: [post ? t('prompt.first.post', { handle }) : t('prompt.first.test', { handle })], proceed };
  }
  return { lines: [t('prompt.mismatch', { handle }), t('prompt.usually', { expected: at(expected) })], proceed };
}

export const accountPromptFoot = (): string => t('prompt.foot');

// ---- the Post card (§4.5) -------------------------------------------------------------------

export const POST_NOTES = {
  get K1() {
    return t('post.K1');
  },
  get K2() {
    return t('post.K2');
  },
  K5: (browser: string): string => t('post.K5', { browser }),
  get K6() {
    return t('post.K6');
  },
  get K7() {
    return t('post.K7');
  },
  get K7test() {
    return t('post.K7test');
  },
  get K7check() {
    return t('post.K7check');
  },
  /** A finished run's window kept for Finish by hand, or closing in a moment: Done on its result closes it. */
  get K7held() {
    return t('post.K7held');
  },
  /** AP-10: held while Instagram may still be uploading: Done does not close it (§6.4, R21). `null`: no time known. */
  K7upload: (time: string | null): string => (time ? t('post.K7upload', { time }) : t('post.K7uploadLater')),
  K8: (time: string): string => t('post.K8', { time }),
  get K9hour() {
    return t('post.K9hour');
  },
  get K9day() {
    return t('post.K9day');
  },
  get K10() {
    return t('post.K10');
  },
  K11: (left: string): string => t('post.K11', { left }),
  K12: (time: string): string => t('post.K12', { time }),
  get K13() {
    return t('post.K13');
  },
  get stale() {
    return t('post.stale');
  },
};

// ---- onboarding (§4.2) ------------------------------------------------------------------------

export const howItWorks = (): string => t('onboarding.howItWorks');

// ---- the tab title (§4.1) ---------------------------------------------------------------------

export function tabTitle(view: { running: boolean; elapsedMs: number } | { result: RunResult } | null): string {
  if (view === null) return 'instapost';
  if ('running' in view) return view.running ? t('tab.posting', { elapsed: mmss(view.elapsedMs) }) : 'instapost';
  switch (view.result.kind) {
    case 'posted':
      return view.result.markedBy === 'owner' ? t('tab.markedPosted') : t('tab.posted');
    case 'notPosted':
      return t('tab.notPosted');
    case 'unknown':
      return t('tab.unknown');
    default:
      return 'instapost';
  }
}

// ---- the pause banner (§4.10) -----------------------------------------------------------------

/**
 * AP-12: why desktop posting is paused, per stored reason (several when more than one lock fired before a
 * Resume). A lock of an earlier build has no reason: the general text.
 */
export function pauseReasonText(reasons: readonly MsiteLockReason[]): string {
  const parts = reasons.map((r) => tk(`pause.${r}` as MsgKey));
  return parts.length > 0 ? parts.join(' ') : t('pause.general');
}

// ---- lane reasons (K3) ------------------------------------------------------------------------

/** Why a frame can only be posted from the phone (publish/lane.ts reasons). */
export const laneReasonText = (reason: 'video' | 'music' | 'stickers' | 'closeFriends'): string =>
  tk(`lane.${reason}` as MsgKey);
