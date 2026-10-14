/**
 * Every user-facing text of the editor (docs/ux.md §4, §5; IU7). Pure. Replaces messages.ts.
 *
 * Conventions (ux.md): copy never quotes Instagram's own UI strings beyond the names of its controls (+,
 * Story, Share); "Nothing was posted" is said only when the Share command was never sent (or the agent did
 * not tap it), the owner's own Share was not seen and no upload or publish request was seen (`nothingPosted`
 * in the context); codes appear only in Details; every failure names one primary action and at most one
 * secondary.
 */
import type { ErrorCode, HandoffMode, MsiteLockReason, RunResult, RunStep, UnknownWhy } from '../core/handoff/state.ts';
import { MSITE_MAX_CSS_WIDTH } from '../core/ig-contract/contract.ts';

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

export const ACTION_LABEL: Readonly<Record<ActionId, string>> = {
  sendToPhone: 'Send to phone…',
  saveCopy: 'Save copy',
  tryAgain: 'Try again',
  finishByHand: 'Finish by hand',
  shareItMyself: 'Share it myself',
  openInstagram: 'Open instagram.com ↗',
  checkStory: 'Check my story ↗',
  copyDiagnostics: 'Copy diagnostics',
  showRun: 'Show it',
  resume: 'Resume…',
  settings: 'Settings',
  choosePhoto: 'Choose photo…',
  reload: 'Reload',
  markPosted: 'It posted',
  markNotPosted: 'It didn’t post',
};

/** AP-3: the owner marked a Couldn't confirm; Instagram never confirmed it. */
export const MARKED_POSTED = 'Marked as posted by you';
export const MARKED_NOT_POSTED = 'Marked as not posted by you';

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
  title: string;
  body: (c: CopyCtx) => string;
  primary: ActionId | null;
  secondary: ActionId | null;
}

/** Local time like `14:05`. */
export function clock(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** A date like `Tue 20 Oct, 14:05`. */
export function dateTime(t: number): string {
  const d = new Date(t);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${clock(t)}`;
}

/** `0:42` */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const at = (h: string | null | undefined): string => (h ? `@${h}` : '');

const nothing = (c: CopyCtx): string => (c.nothingPosted ? ' Nothing was posted.' : '');

/** TIMEOUT's detail is `<step> <n> s` (the reducer's), e.g. `story 30 s`. */
function timeoutParts(detail: string | undefined): { step: string; seconds: string } | null {
  const m = /^(instagram|account|story|share|confirm|manual)\s+(\d+)\s*s/.exec(detail ?? '');
  if (!m) return null;
  return { step: m[1] ?? '', seconds: m[2] ?? '' };
}

const STEP_NAME: Readonly<Record<string, string>> = {
  instagram: 'Instagram',
  account: 'Account',
  story: 'Story',
  share: 'Share',
  confirm: 'Confirm',
};

/** ux.md §5 `{why}` for Couldn't confirm. */
export function whyText(why: UnknownWhy | undefined, detail?: string): string {
  switch (why) {
    case 'no-upload-seen':
      return 'Instagram’s upload didn’t finish within 2 minutes';
    case 'no-finalize-after-upload':
      return 'Instagram uploaded the photo but didn’t finish publishing it within 75 seconds';
    case 'configure-5xx': {
      const status = /\b(5\d\d)\b/.exec(detail ?? '')?.[1];
      return `Instagram’s server answered with an error${status ? ` (${status})` : ''} while publishing`;
    }
    case 'configure-0':
      return 'the publish request was cut off before Instagram answered';
    case 'configure-html':
    case 'redirected':
      return 'Instagram answered the publish request with a web page instead of a confirmation';
    case 'window-closed':
      return 'the Instagram window was closed before Instagram answered';
    case 'agent-lost':
      return 'instapost lost touch with the Instagram window';
    case 'unexpected-page': {
      const page = /page (\S+)/.exec(detail ?? '')?.[1];
      return `Instagram went to an unexpected page${page ? ` (${page})` : ''}`;
    }
    case 'share-not-acknowledged':
      return 'instapost couldn’t tell whether Share was pressed';
    case 'not-blocked': {
      const status = /\b(\d{3})\b/.exec(detail ?? '')?.[1];
      return `the test’s write block didn’t stop the upload: it reached Instagram, which answered${status ? ` ${status}` : ' with an error'}`;
    }
    default:
      return 'instapost couldn’t read Instagram’s answer';
  }
}

/** ux.md §5: the copy for every code (title, body, primary, secondary). */
export const ERROR_COPY: Readonly<Record<ErrorCode, ErrorCopy>> = {
  RATE_LIMITED: {
    title: 'Pace limit reached',
    // `detail` is the rate guard's rule (spacing, hour, day), when the refusal names it.
    body: (c) => {
      const at = c.freeAt ? clock(c.freeAt) : 'a later time';
      if (c.detail === 'spacing') {
        return `Runs are at least a minute apart, tests and checks included. You can start this one at ${at}.`;
      }
      if (c.detail === 'day')
        return 'instapost allows 15 posts a day. You can post again tomorrow; your story is kept.';
      return `6 posts in the past hour. instapost keeps a human pace so your account looks like normal use. You can post again at ${at}; your story is kept.`;
    },
    primary: 'sendToPhone',
    secondary: 'saveCopy',
  },
  HANDOFF_BUSY: {
    title: 'A post is already running',
    body: () => 'One post at a time. This one can go when it’s done.',
    primary: 'showRun',
    secondary: null,
  },
  MSITE_LOCKED: {
    title: 'Desktop posting is paused',
    body: (c) =>
      `Desktop posting is paused until ${c.freeAt ? dateTime(c.freeAt) : 'later'} to protect your account. Open Instagram on your phone and complete any check it shows.`,
    primary: 'sendToPhone',
    secondary: 'resume',
  },
  GUARD_NOT_FAKE: {
    title: 'Stopped: not the fake Instagram',
    body: (c) =>
      `This test build only works with the fake Instagram, and the window loaded something else. It was closed.${nothing(c)}`,
    primary: 'copyDiagnostics',
    secondary: null,
  },
  BRANDED_BROWSER: {
    title: 'This is a test build',
    body: () =>
      'Test builds refuse to run in Chrome, Edge or Arc so they can never reach the real Instagram. Load the live build here, or use the sealed browser from pnpm run dev.',
    primary: null,
    secondary: null,
  },
  DESKTOP_SHELL: {
    title: 'Instagram sent its desktop site',
    body: (c) =>
      `instapost needs Instagram’s mobile site and got the desktop one this time, so it closed the window.${nothing(c)}`,
    primary: 'sendToPhone',
    secondary: 'tryAgain',
  },
  NOT_LOGGED_IN: {
    title: 'Log in to Instagram first',
    body: (c) =>
      `Instagram asked to log in. Log in at instagram.com in a normal tab of this browser profile, then post again. instapost never logs in for you, and never in its own window.${nothing(c)}`,
    primary: 'openInstagram',
    secondary: 'tryAgain',
  },
  LANDSCAPE: {
    title: 'Couldn’t make the Instagram window portrait',
    body: (c) =>
      c.detail === 'story session refused'
        ? `Instagram refused to start a story because the window read as landscape.${nothing(c)}`
        : `Instagram only starts a story in a tall, narrow window, and this one read as landscape.${nothing(c)}`,
    primary: 'tryAgain',
    secondary: 'sendToPhone',
  },
  SCREEN_TOO_SMALL: {
    title: 'This display is too small',
    body: (c) =>
      `The Instagram window needs at least 640 points of height. Move this window to a larger display, or choose More Space in System Settings → Displays.${nothing(c)}`,
    primary: 'sendToPhone',
    secondary: null,
  },
  INPUT_MISSING: {
    title: 'Instagram didn’t offer a story upload',
    body: (c) =>
      `Instagram’s page had no place to add a story photo this time. Instagram may have changed its page.${nothing(c)}`,
    primary: 'sendToPhone',
    secondary: 'finishByHand',
  },
  ACCEPT_DRIFT: {
    title: 'Instagram changed its story upload',
    body: (c) =>
      `It no longer takes the image types instapost expects, so instapost stopped instead of guessing.${nothing(c)}`,
    primary: 'sendToPhone',
    secondary: 'finishByHand',
  },
  INJECTION_IGNORED: {
    title: 'Instagram didn’t take the photo',
    body: (c) => `instapost added your photo, but Instagram’s story editor didn’t open with it.${nothing(c)}`,
    primary: 'finishByHand',
    secondary: 'sendToPhone',
  },
  SW_TOOK_CONTROL: {
    title: 'Stopped by an older version',
    body: () =>
      'An earlier instapost closed the window when Instagram’s background worker took over. Current versions only note it.',
    primary: null,
    secondary: null,
  },
  KILLED_CHALLENGE: {
    title: 'Instagram wants a security check',
    body: (c) =>
      `instapost closed the window and paused desktop posting for 7 days to protect your account. Open Instagram on your phone and complete any check it shows.${c.postedBeforeKill ? ' Your story was posted before the check.' : nothing(c)}`,
    primary: 'sendToPhone',
    secondary: null,
  },
  KILLED_OFFHOST: {
    title: 'The Instagram window left Instagram',
    body: (c) =>
      `It went to another website, so instapost closed it and paused desktop posting for 7 days as a precaution. If you didn’t expect this, check your login activity on your phone.${c.postedBeforeKill ? ' Your story was posted before that.' : nothing(c)}`,
    primary: 'sendToPhone',
    secondary: null,
  },
  AGENT_UNREACHABLE: {
    title: 'Lost touch with the Instagram window',
    body: (c) => `instapost’s helper in that window stopped answering, so the window was closed.${nothing(c)}`,
    primary: 'tryAgain',
    secondary: 'sendToPhone',
  },
  TIMEOUT: {
    title: 'Instagram stopped responding',
    body: (c) => {
      if (c.detail?.startsWith('manual')) {
        return `Nothing happened in the Instagram window for 5 minutes, so it was closed.${nothing(c)}`;
      }
      const t = timeoutParts(c.detail);
      const what = t
        ? `The step “${STEP_NAME[t.step] ?? t.step}” didn’t finish within ${t.seconds} seconds`
        : 'A step didn’t finish in time';
      return `${what}, so the window was closed.${nothing(c)}`;
    },
    primary: 'tryAgain',
    secondary: 'sendToPhone',
  },
  EXPORT_TOO_LARGE: {
    title: 'This story is too big to export',
    body: () => 'Even at the lowest quality it’s over 8 MB. Zoom in a little or use a simpler photo.',
    primary: null,
    secondary: 'sendToPhone',
  },
  DECODE_FAILED: {
    title: 'Can’t open this file',
    body: () =>
      'instapost opens JPEG, PNG, WebP and AVIF. For iPhone HEIC photos, export a JPEG from Photos (File → Export) and drop that.',
    primary: 'choosePhoto',
    secondary: null,
  },
  FONT_NOT_LOADED: {
    title: 'The text font didn’t load',
    body: () => 'The text can’t be drawn without it. Reload this tab; your draft is saved.',
    primary: 'reload',
    secondary: null,
  },
  UNEXPECTED_PAGE: {
    title: 'Instagram opened an unexpected page',
    body: (c) => {
      const page = /page (\S+)/.exec(c.detail ?? '')?.[1];
      return `The Instagram window went to ${page ?? 'another page'}, so instapost stopped there.${nothing(c)}`;
    },
    primary: 'tryAgain',
    secondary: 'sendToPhone',
  },
  NAVIGATION_TIMEOUT: {
    title: 'Instagram didn’t load',
    body: (c) => `Instagram didn’t start loading within 30 seconds. Check your connection.${nothing(c)}`,
    primary: 'tryAgain',
    secondary: 'sendToPhone',
  },
  SW_INTERCEPTS: {
    title: 'Instagram’s page behaved differently',
    body: (c) =>
      `Instagram’s background worker handled the window’s own requests, so they could leave without the mobile profile. instapost closed the window to be safe.${nothing(c)}`,
    primary: 'sendToPhone',
    secondary: 'copyDiagnostics',
  },
  WINDOW_NOT_FITTED: {
    title: 'Couldn’t make the window phone-sized',
    body: (c) =>
      `Arc didn’t let instapost resize the Instagram window, and it wasn’t resized by hand within 2 minutes. Instagram never loaded.${nothing(c)}`,
    primary: 'tryAgain',
    secondary: 'sendToPhone',
  },
  LAYOUT_TOO_WIDE: {
    title: 'The Instagram window stayed too wide',
    body: (c) =>
      `Instagram only shows its story button when the window is at most ${MSITE_MAX_CSS_WIDTH} points wide, and it stayed wider.${nothing(c)}`,
    primary: 'tryAgain',
    secondary: 'sendToPhone',
  },
  SCREEN_LANDSCAPE: {
    title: 'Instagram thought the screen was sideways',
    body: (c) =>
      `Its story editor asked to rotate the device and hid Share; instapost’s portrait fix didn’t take effect in that window.${nothing(c)}`,
    primary: 'sendToPhone',
    secondary: 'copyDiagnostics',
  },
  STORY_ENTRY_MISSING: {
    title: 'Couldn’t start a story',
    body: (c) =>
      `instapost couldn’t open Instagram’s + → Story menu the way it expects${c.detail ? ` (${c.detail})` : ''}. Instagram may have changed its page.${nothing(c)}`,
    primary: 'finishByHand',
    secondary: 'sendToPhone',
  },
  SHARE_MISSING: {
    title: 'Couldn’t find Share',
    body: (c) =>
      `Your photo is in Instagram’s story editor, but instapost couldn’t find exactly one Share button, so it pressed nothing.${nothing(c)}`,
    primary: 'shareItMyself',
    secondary: 'sendToPhone',
  },
  WINDOW_IN_USE: {
    title: 'You were using the Instagram window',
    body: (c) => `instapost doesn’t tap while you click or type in that window, so it stepped back.${nothing(c)}`,
    primary: 'finishByHand',
    secondary: 'tryAgain',
  },
  WINDOW_HIDDEN: {
    title: 'The Instagram window was hidden',
    body: (c) =>
      `Another window covered it, and Instagram pauses hidden pages. Keep it in view while instapost works; you don’t need to click it.${nothing(c)}`,
    primary: 'tryAgain',
    secondary: 'sendToPhone',
  },
  ACCOUNT_UNCONFIRMED: {
    title: 'Posting cancelled',
    body: (c) =>
      c.detail === 'unreadable' || !c.handle
        ? `instapost couldn’t tell which account was logged in, and nobody confirmed within a minute.${nothing(c)}`
        : `Instagram was logged in as ${at(c.handle)}${c.expected ? `, not ${at(c.expected)}` : ''}, and nobody confirmed within a minute.${nothing(c)}`,
    primary: 'tryAgain',
    secondary: 'settings',
  },
  UPLOAD_FAILED: {
    title: 'Instagram didn’t accept the story',
    body: (c) =>
      `Instagram answered that the upload failed${c.detail ? ` (${c.detail})` : ''}, so your story wasn’t posted. instapost never retries on its own.`,
    primary: 'tryAgain',
    secondary: 'sendToPhone',
  },
  OUTCOME_UNKNOWN: {
    title: 'Couldn’t confirm the post',
    body: (c) =>
      `instapost pressed Share, but ${whyText(c.why, c.detail)}. Check your story before you post this photo again.`,
    primary: 'checkStory',
    secondary: 'markPosted',
  },
  TEST_LEAK: {
    title: 'The test didn’t block publishing',
    body: (c) =>
      `During a test, Instagram’s publish request went through${c.detail ? ` (${c.detail})` : ''}. The test story may be live: check your story now and delete it if it is. Desktop posting is paused.`,
    primary: 'checkStory',
    secondary: 'resume',
  },
};

// ---- the run view (§4.6) -------------------------------------------------------------------

export const STEP_ORDER: readonly RunStep[] = ['instagram', 'account', 'story', 'share', 'confirm'];

export interface StepCopy {
  active: string;
  done: (facts: StepFacts) => string;
  /** By mode, when the step does not run or ends differently. */
  test?: string;
  shareTest?: string;
}

export interface StepFacts {
  window?: { w: number; h: number } | null;
  handle?: string | null;
  facebook?: boolean;
}

/** A step that has not run yet, as the mode will run it. */
export function pendingStepText(step: RunStep, mode: HandoffMode | undefined): string {
  if (mode === 'test' && step === 'share') return 'Finds Share, doesn’t press it';
  if (mode === 'test' && step === 'confirm') return 'Skipped in a test run';
  if (mode === 'shareTest' && step === 'share') return 'Presses Share with publishing blocked';
  if (mode === 'shareTest' && step === 'confirm') return 'Checks that the upload is blocked';
  return STEP_COPY[step].active;
}

export const STEP_COPY: Readonly<Record<RunStep, StepCopy>> = {
  instagram: {
    active: 'Opening Instagram in a phone-sized window…',
    done: (f) =>
      `Instagram open — mobile site${f.window ? `, ${Math.round(f.window.w)} × ${Math.round(f.window.h)}` : ''}`,
  },
  account: {
    active: 'Checking who’s logged in…',
    done: (f) => (f.handle ? `Logged in as ${at(f.handle)}` : 'Account confirmed by you'),
  },
  story: {
    active: 'Starting a story and adding your photo…',
    done: () => 'Photo is in Instagram’s story editor',
  },
  share: {
    active: 'Pressing Share…',
    done: (f) => `Shared${f.facebook ? ' · also to Facebook' : ''}`,
    test: 'Share button found — not pressed (test run)',
    shareTest: 'Pressed Share (publishing blocked)',
  },
  confirm: {
    active: 'Waiting for Instagram to confirm…',
    done: () => 'Instagram confirmed the story',
    test: 'Skipped (test run)',
    shareTest: 'Instagram’s upload was blocked, as expected',
  },
};

/** While confirming: Instagram's own "uploading" (the active text after the Share click). */
export const UPLOADING_TEXT = 'Instagram is uploading…';
export const SLOW_20_TEXT = 'Still uploading. Keep the Instagram window open.';
export const SLOW_60_TEXT = 'Instagram is slow. instapost keeps waiting and won’t post twice.';
export const CANT_STOP_TEXT = 'Instagram is uploading — this can’t be stopped now.';
export const RECONNECTING_TEXT = 'Reconnecting to instapost…';
export const RUN_HINT = 'Usually 15–25 seconds. Keep the Instagram window in view; you don’t need to click it.';
export const FAKE_BAR_TEXT = 'FAKE INSTAGRAM — this window is the test server, not Instagram.';

export function runHeader(mode: HandoffMode | undefined, handle: string | null | undefined): string {
  if (mode === 'check') return 'Checking the connection';
  if (mode === 'test') return handle ? `Test run as ${at(handle)}` : 'Test run';
  if (mode === 'shareTest') return 'Share test';
  return handle ? `Posting to ${at(handle)}’s story` : 'Posting to your story';
}

export function modeChip(mode: HandoffMode | undefined): string | null {
  if (mode === 'test') return 'Test run — nothing will be posted';
  if (mode === 'shareTest') return 'Share test — publishing is blocked';
  return null;
}

/** §4.6: Arc refused to size the window. */
export function resizeText(size: { w: number; h: number } | null, ok: boolean, left: number): string {
  const now = size ? `Now ${Math.round(size.w)} × ${Math.round(size.h)} ${ok ? '✓' : '✗'}` : '';
  return `Arc didn’t let instapost resize the Instagram window. Drag its edge until it’s narrow and tall — instapost carries on by itself. ${now}${ok ? '' : ` · ${mmss(left)} left`}`.trim();
}

// ---- results (§4.7) -------------------------------------------------------------------------

export interface ResultText {
  icon: '✓' | '✕' | '?' | '■' | '!';
  title: string;
  body: string;
}

/** The result card's title and body for a result (failures use ERROR_COPY). */
export function resultText(r: RunResult, c: CopyCtx & { durationMs?: number; mode?: HandoffMode }): ResultText {
  switch (r.kind) {
    case 'posted': {
      if (r.markedBy === 'owner') {
        // AP-3: the owner's word, not Instagram's answer (P4: "Posted" only from the publish answer).
        return {
          icon: '✓',
          title: MARKED_POSTED,
          body: `You marked this run as posted at ${clock(r.at)}. instapost couldn’t confirm it with Instagram.`,
        };
      }
      if (r.killed) {
        const copy = ERROR_COPY[r.killed];
        return {
          icon: '✓',
          title: `Posted to ${at(r.account) || 'your'}${r.account ? '’s' : ''} story`,
          body: copy.body({ ...c, postedBeforeKill: true }),
        };
      }
      const dup = r.alarms.includes('DUPLICATE_UPLOAD');
      const took = c.durationMs ? ` · took ${Math.round(c.durationMs / 1000)} s` : '';
      const fb = r.facebook ? ' Also shared to Facebook, as set in your Instagram account.' : '';
      if (dup) {
        return {
          icon: '✓',
          title: 'Posted — check for a duplicate',
          body: 'Instagram sent its publish request twice. Check your story and delete a duplicate if there is one.',
        };
      }
      const late = r.late ? `Update: Instagram confirmed it at ${clock(r.at)}. ` : '';
      return {
        icon: '✓',
        title: r.account ? `Posted to ${at(r.account)}’s story` : 'Posted to your story',
        body: `${late}${clock(r.at)}${took} · Instagram confirmed it.${fb}`,
      };
    }
    case 'tested':
      return {
        icon: '✓',
        title: 'Test passed',
        body: `Everything up to Share works${r.account ? `, and you’re posting as ${at(r.account)}` : ''}. Nothing was posted.`,
      };
    case 'shareTested':
      return {
        icon: '✓',
        title: 'Share test passed',
        body: 'Instagram tried to upload and the upload was blocked, as it should be. Nothing was posted.',
      };
    case 'checked':
      if (r.account && r.lockedTo) {
        // AP-4: never "Posts go to this account" when Post story would stop and ask.
        return {
          icon: '!',
          title: `Connected as ${at(r.account)} — posts are locked to ${at(r.lockedTo)}`,
          body: `Post story will stop and ask before posting as ${at(r.account)}. Choose Use ${at(r.account)} to post as ${at(r.account)} from now on, or log in to Instagram as ${at(r.lockedTo)} in a normal tab.`,
        };
      }
      return {
        icon: '✓',
        title: r.account ? `Connected as ${at(r.account)}` : 'Connected',
        body: r.account
          ? 'Posts go to this account.'
          : 'instapost couldn’t read the account name; the Instagram window showed it.',
      };
    case 'stopped':
      return {
        icon: '■',
        title: r.stoppedBy === 'window' ? 'Stopped — you closed the Instagram window' : 'Stopped',
        body: c.nothingPosted ? 'Nothing was posted.' : 'Check your story before you post this photo again.',
      };
    case 'unknown': {
      if (r.code === 'TEST_LEAK') {
        const copy = ERROR_COPY.TEST_LEAK;
        return { icon: '?', title: copy.title, body: copy.body(c) };
      }
      const copy = ERROR_COPY.OUTCOME_UNKNOWN;
      const killed = r.killed ? ` ${ERROR_COPY[r.killed].title}: desktop posting is paused.` : '';
      return { icon: '?', title: copy.title, body: `${copy.body({ ...c, why: r.why })}${killed}` };
    }
    case 'notPosted': {
      if (r.markedBy === 'owner') {
        return {
          icon: '✕',
          title: MARKED_NOT_POSTED,
          body: `You marked this run as not posted at ${clock(r.at)}. instapost couldn’t confirm it with Instagram.`,
        };
      }
      const code = r.code ?? 'UPLOAD_FAILED';
      const copy = ERROR_COPY[code];
      const late = r.late ? 'Update: Instagram said the upload failed. ' : '';
      return { icon: '✕', title: `Not posted — ${copy.title}`, body: `${late}${copy.body(c)}` };
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
      const copy = ERROR_COPY[r.code ?? 'UPLOAD_FAILED'];
      return { primary: copy.primary, secondary: copy.secondary };
    }
    default:
      return { primary: null, secondary: null };
  }
}

export const HELD_TEXT = 'The Instagram window stays open while Instagram may still be uploading.';

/** §4.9 Finish by hand. */
export function finishByHandText(needs: 'pick' | 'share', file: string | null): string {
  if (needs === 'share') return 'Check the photo in the Instagram window and tap Share. instapost confirms the post.';
  const pick = file ? `${file} from Downloads/instapost` : 'the newest story in Downloads/instapost';
  return `In the Instagram window tap +, then Story, and pick ${pick}. Then tap Share. instapost watches and confirms the post.`;
}

// ---- the account prompt (§4.8) ------------------------------------------------------------------

export function accountPromptText(
  kind: 'mismatch' | 'unreadable' | 'first',
  detected: string | null,
  expected: string | null,
  mode: HandoffMode = 'post',
): { lines: string[]; proceed: string } {
  // A test or a Share test never publishes: its button says what it does.
  const verb = mode === 'post' ? 'Post' : 'Test';
  if (kind === 'unreadable') {
    return {
      lines: ['instapost couldn’t tell which account is logged in. The Instagram window shows it.'],
      proceed: mode === 'post' ? 'Post anyway' : 'Continue anyway',
    };
  }
  if (kind === 'first' || !expected) {
    return {
      lines: [`Instagram is logged in as ${at(detected)}. ${verb} as ${at(detected)}?`],
      proceed: `${verb} as ${at(detected)}`,
    };
  }
  return {
    lines: [`Instagram in this browser is logged in as ${at(detected)}.`, `You usually post as ${at(expected)}.`],
    proceed: `${verb} as ${at(detected)}`,
  };
}

export const ACCOUNT_PROMPT_FOOT = 'Nothing is posted until you choose.';

// ---- the Post card (§4.5) -------------------------------------------------------------------

export const POST_NOTES = {
  K1: 'Add a photo to post.',
  K2: 'Loading the text font…',
  K5: (browser: string) => `This test build can’t post from ${browser}.`,
  K6: 'One test run before your first post: about 20 seconds, nothing is posted. It also checks which account is logged in.',
  K7: 'A post is in progress.',
  K7test: 'A test run is in progress.',
  K7check: 'Checking the connection.',
  /** A finished run's window kept for Finish by hand, or closing in a moment: Done on its result closes it. */
  K7held: 'The last run’s Instagram window is still open. Press Done on its result, or close that window.',
  /** AP-10: held while Instagram may still be uploading: Done does not close it (§6.4, R21). */
  K7upload: (time: string) =>
    `Instagram may still be uploading the last story. Its window closes by itself at ${time}; close it yourself once you’ve checked your story.`,
  K8: (time: string) => `This story may already be posted (${time}, not confirmed).`,
  K9hour: '6 posts in the past hour.',
  K9day: '15 posts today, the daily limit. Resets at midnight.',
  K10: 'Posts are at least a minute apart.',
  K11: (left: string) => `Starting in ${left}…`,
  K12: (time: string) => `You posted this story at ${time}.`,
  K13: 'Ready to post',
  stale: 'Instagram may have changed since your last post. A test run takes 20 seconds.',
} as const;

// ---- onboarding (§4.2) ------------------------------------------------------------------------

export const HOW_IT_WORKS =
  'When you press Post story, instapost: (1) opens Instagram’s mobile site in a narrow window next to this one; (2) checks which account is logged in; (3) taps + → Story and adds your photo; (4) presses Share once; (5) waits for Instagram’s answer. You can watch every step in that window. instapost only uses Instagram’s own page, the same controls you would tap on a phone. It never sees your password, never posts more than 6 times an hour, never retries a failed post on its own, and only says “Posted” when Instagram confirms it.';

// ---- the tab title (§4.1) ---------------------------------------------------------------------

export function tabTitle(view: { running: boolean; elapsedMs: number } | { result: RunResult } | null): string {
  if (view === null) return 'instapost';
  if ('running' in view) return view.running ? `Posting… ${mmss(view.elapsedMs)} · instapost` : 'instapost';
  switch (view.result.kind) {
    case 'posted':
      return view.result.markedBy === 'owner' ? '✓ Marked as posted · instapost' : '✓ Posted · instapost';
    case 'notPosted':
      return 'Not posted · instapost';
    case 'unknown':
      return '? Check your story · instapost';
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
  const parts = reasons.map((r) => PAUSE_REASON[r]);
  return parts.length > 0 ? parts.join(' ') : PAUSE_GENERAL;
}

const PAUSE_REASON: Readonly<Record<MsiteLockReason, string>> = {
  KILLED_CHALLENGE:
    'Instagram asked for a security check, so instapost paused desktop posting for 7 days to protect your account. Open Instagram on your phone and complete any check it shows.',
  KILLED_OFFHOST:
    'The Instagram window went to another website, so instapost paused desktop posting for 7 days as a precaution. If you didn’t expect this, check your login activity on your phone.',
  TEST_LEAK:
    'A test went through to Instagram: its upload or publish request wasn’t blocked, so the test story may be live. Check your story and delete the test story if it’s there. Desktop posting stays paused until you resume.',
};

const PAUSE_GENERAL =
  'Instagram asked for a security check (or the window left Instagram), so instapost paused desktop posting for 7 days to protect your account. Open Instagram on your phone and complete any check it shows.';
