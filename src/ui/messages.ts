/**
 * User-facing texts for the hand-off panel (strategy §3.6, §3.10). Errors never retry; every
 * error leaves the image in Downloads and offers the phone lane, so each one gets that fallback.
 * Texts never quote Instagram's own UI strings beyond the "+ → Story" path the owner taps.
 */
import type { ErrorCode, HandoffPhase } from '../core/handoff/state.ts';

/** Phases in timeline order. `injecting` (H1) and `awaitingPick` (H0) are alternatives. */
export const PHASE_ORDER: readonly HandoffPhase[] = [
  'opening',
  'scoping',
  'fitting',
  'navigating',
  'reloading',
  'probing',
  'injecting',
  'awaitingPick',
  'awaitingShare',
  'finished',
  'closing',
  'idle',
];

export const PHASE_LABEL: Readonly<Record<HandoffPhase, string>> = {
  idle: 'Idle',
  opening: 'Opening the composer window',
  scoping: 'Scoping the mobile profile to that window',
  fitting: 'Sizing the window',
  navigating: 'Loading the story composer',
  reloading: 'Reloading past the service worker',
  probing: 'Checking the composer',
  injecting: 'Inserting the image',
  awaitingPick: 'Waiting for you to pick the file',
  awaitingShare: 'Waiting for you to review and tap Share',
  // C9: the composer was left; the window itself may still be open (AM19, AM28).
  finished: 'Composer left',
  closing: 'Closing the window',
};

const time = (t: number | undefined): string =>
  t === undefined ? 'later' : new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** What happened, in plain words. `freeAt` is when a guard frees the lane. */
export function errorText(code: ErrorCode, freeAt?: number): string {
  switch (code) {
    case 'RATE_LIMITED':
      return `Composer opens are paced to a human rhythm. The next one is possible at ${time(freeAt)}.`;
    case 'HANDOFF_BUSY':
      return 'A hand-off is already running. Finish or cancel it first.';
    case 'MSITE_LOCKED':
      return `The desktop lane is locked until ${time(freeAt)} after a safety stop. Type ENABLE in Settings to lift the lock earlier.`;
    case 'GUARD_NOT_FAKE':
      return 'This test build only hands off to the fake Instagram, and the composer page was not the fake. Nothing was inserted.';
    case 'DESKTOP_SHELL':
      return 'Instagram served its desktop site, which has no story composer. The window was closed; the mobile route needs a re-check.';
    case 'NOT_LOGGED_IN':
      return 'Instagram asked to log in. Log in on normal desktop instagram.com in this browser profile, then try again. Never log in inside the composer window.';
    case 'LANDSCAPE':
      return 'The composer window stayed landscape after one refit, so it was closed.';
    case 'SCREEN_TOO_SMALL':
      return 'This screen is too small for a portrait composer window.';
    case 'INPUT_MISSING':
      return 'The composer had no story file input, so the image could not be inserted for you.';
    case 'ACCEPT_DRIFT':
      return 'The composer’s file input changed, so the image was not inserted for you.';
    case 'INJECTION_IGNORED':
      return 'The composer ignored the inserted image.';
    case 'SW_TOOK_CONTROL':
      return 'Instagram’s service worker took over the window, so it was closed.';
    case 'KILLED_CHALLENGE':
      return 'Instagram asked for a security check. The window was closed and the desktop lane is locked for 7 days. Stop and check the account from the phone.';
    case 'KILLED_OFFHOST':
      return 'The composer window left Instagram. It was closed and the desktop lane is locked for 7 days.';
    case 'AGENT_UNREACHABLE':
      return 'The composer helper could not be reached, so the window was closed.';
    case 'TIMEOUT':
      return 'Nothing happened for 15 minutes, so the window was closed.';
    case 'EXPORT_TOO_LARGE':
      return 'The image stays over 8 MB even at the lowest JPEG quality.';
    case 'DECODE_FAILED':
      return 'This file could not be read as a JPEG, PNG, WebP or AVIF image.';
    case 'FONT_NOT_LOADED':
      return 'The text font is not loaded yet.';
    case 'UNEXPECTED_PAGE':
      return 'The composer window went to an Instagram page instapost does not expect, so the hand-off stopped there. Nothing was locked; if Share was tapped, check the story on the phone.';
    case 'BRANDED_BROWSER':
      return 'This test build is running in Google Chrome or Microsoft Edge, so no composer window was opened. Use the live build in this browser, or the sealed browser that pnpm run dev opens.';
    case 'NAVIGATION_TIMEOUT':
      return 'Instagram did not start loading within 30 seconds, so the window was closed.';
  }
}

/** Extra facts about an error worth showing (and recording by hand), or null. */
export function errorDetail(code: ErrorCode, detail: string | undefined): string | null {
  // AM28: the page an UNEXPECTED_PAGE went to is a contract fact (live checklist L4, L8).
  if (code === 'UNEXPECTED_PAGE' && detail?.startsWith('page ')) return `It went to ${detail.slice(5)}.`;
  return null;
}

/** Errors that keep the same window open and fall back to picking the file by hand (H0). */
export const DEGRADES_TO_H0: readonly ErrorCode[] = ['INPUT_MISSING', 'ACCEPT_DRIFT', 'INJECTION_IGNORED'];

/**
 * The fallback that follows every error. `file` is the downloaded export's name, if known.
 * `postedUnknown` (AM28): Share may have been tapped, so never invite a second post blindly.
 */
export function fallbackText(code: ErrorCode, file: string | null, postedUnknown = false): string {
  const where = file ? `Downloads/instapost/${file}` : 'Downloads/instapost/';
  if (postedUnknown) return `Check the story on the phone before posting it again. Your image is in ${where}.`;
  if (DEGRADES_TO_H0.includes(code)) return `Pick it by hand in the Instagram window: ${where}.`;
  return `Your image is in ${where}. Use Share… or AirDrop to post it from the phone.`;
}

/**
 * The "Posted?" question once the composer was left: the hint, and which answer is the primary
 * button (null: neither, AM28, when whether Share was tapped cannot be told).
 */
export function postedPrompt(p: { detected: boolean; unknown: boolean; answer: boolean | null }): {
  hint: string;
  primary: boolean | null;
} {
  if (p.answer !== null) return { hint: `Recorded as ${p.answer ? 'posted' : 'not posted'}.`, primary: p.answer };
  if (p.unknown) {
    return {
      hint: 'Share may have been tapped; instapost cannot tell whether the story was posted. Check on the phone.',
      primary: null,
    };
  }
  return p.detected
    ? { hint: 'It looks like you tapped Share.', primary: true }
    : { hint: 'No Share was detected.', primary: false };
}

/** H0 instructions; `homeOnly` means the composer could not be opened directly. */
export function pickText(file: string | null, homeOnly: boolean): string {
  const name = file ? `instapost/${file}` : 'the newest file in instapost/';
  return homeOnly
    ? `The composer did not open directly. In the Instagram window tap + → Story, then pick ${name}.`
    : `In the Instagram window tap + → Story and pick ${name}.`;
}

export const SHARE_TEXT = 'Review in the Instagram window, then tap Share.';

/** AM19: the popup stays open after Share (rehearsal off) so the upload can finish. */
export const HOLD_OPEN_TEXT =
  'The Instagram window stays open so the upload can finish. Answer once the story shows as posted (or failed); the window then closes.';
/** AM28: held open with no pre-answer, so an upload or a pick by hand in progress is not cut off. */
export const HOLD_OPEN_UNKNOWN_TEXT =
  'The Instagram window stays open in case a post is still on its way there. Answer once you know; the window then closes.';
