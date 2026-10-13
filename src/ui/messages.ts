/**
 * User-facing texts for the hand-off panel (strategy §3.6, §3.10). Errors never retry; every
 * error leaves the image in Downloads and offers the phone lane, so each one gets that fallback.
 * Texts never quote Instagram's own UI strings beyond the "+ → Story" path the owner taps.
 */
import type { Size } from '../core/geometry/fit.ts';
import { MIN_INNER_H } from '../core/geometry/window-fit.ts';
import type { ErrorCode, HandoffPhase, WindowDiagnostics } from '../core/handoff/state.ts';
import type { BrowserFlavour } from '../core/ig-contract/browser-flavour.ts';
import {
  type CheckResult,
  isImageOnlyAccept,
  MSITE_MAX_CSS_WIDTH,
  type OrientationShimState,
  type PageOrientation,
  type ProbeReport,
} from '../core/ig-contract/contract.ts';
import { type ComposerRoute, isComposerPath } from '../core/ig-contract/urls.ts';

/** Phases in timeline order. `injecting` (H1) and `awaitingPick` (H0) are alternatives. */
export const PHASE_ORDER: readonly HandoffPhase[] = [
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
  'finished',
  'closing',
  'idle',
];

export const PHASE_LABEL: Readonly<Record<HandoffPhase, string>> = {
  idle: 'Idle',
  opening: 'Opening the composer window',
  scoping: 'Scoping the mobile profile to that window',
  fitting: 'Sizing the window',
  resizing: 'Waiting for you to make the window narrow and tall',
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
      return 'Instagram’s service worker took over the window, so an earlier version of instapost closed it. This version only records it.';
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
      return 'This test build is running in Google Chrome, Microsoft Edge or Arc, so no composer window was opened. Use the live build in this browser, or the sealed browser that pnpm run dev opens.';
    case 'NAVIGATION_TIMEOUT':
      return 'Instagram did not start loading within 30 seconds, so the window was closed.';
    case 'SW_INTERCEPTS':
      return 'Instagram’s service worker handled the composer’s own requests, so they could leave without the mobile profile. The window was closed; the mobile route needs a re-check.';
    case 'WINDOW_NOT_FITTED':
      return `The Instagram window could not be made narrow and tall (at most ${MSITE_MAX_CSS_WIDTH} px wide, taller than wide), by instapost or by hand within 3 minutes, so it was closed.`;
    case 'LAYOUT_TOO_WIDE':
      return `The composer stayed wider than ${MSITE_MAX_CSS_WIDTH} px after one resize, and Instagram shows no + → Story there, so the window was closed.`;
    case 'SCREEN_LANDSCAPE':
      return 'Instagram’s story composer still read your screen as landscape, so it asked to rotate the device and hid Share. instapost’s portrait shim did not take effect in that window, so it was closed.';
  }
}

/** AM37: what the portrait shim did, in words. */
function shimWords(shim: OrientationShimState): string {
  switch (shim) {
    case 'installed':
      return 'portrait shim installed; the screen itself is landscape';
    case 'present':
      return 'portrait shim in place';
    case 'portrait':
      return 'the screen is portrait; no shim needed';
    case 'absent':
      return 'the page reports no screen orientation';
    case 'failed':
      return 'the portrait shim could not be installed';
    case 'off':
      return 'portrait shim switched off by a test flag';
  }
}

/**
 * AM37: the Screen row, the screen orientation Instagram's composer reads (C3b) and what the portrait
 * shim did, e.g. "portrait-primary (portrait shim installed; the screen itself is landscape)". SH-1: a
 * shim that came after the composer mounted says so.
 */
export function screenText(o: PageOrientation): string {
  const words = o.afterComposerMount
    ? 'portrait shim installed only after the composer had read the landscape screen'
    : shimWords(o.shim);
  return `${o.type ?? 'unknown'} (${words})`;
}

/** AM37: SCREEN_LANDSCAPE's extra sentence: what the composer read, and why the shim did not help. */
function screenLandscapeDetail(o: PageOrientation): string {
  // SH-1: the page reads portrait now, but the composer read the landscape screen when it opened.
  if (o.afterComposerMount) {
    return 'The portrait shim went in only after the composer had opened and read the landscape screen; Instagram reads it again only when the window is resized.';
  }
  // SH-2: nothing could be read: the page's own, possibly landscape, orientation stayed as it was.
  if (o.type === null) return `The page’s screen orientation could not be read (${shimWords(o.shim)}).`;
  return `The composer read ${screenText(o)}.`;
}

/**
 * Extra facts about an error worth showing (and recording by hand), or null. `isMobile`: what the
 * deciding probe read for DESKTOP_SHELL (AF-10): an explicit `false`, or, on a strict re-probe of a
 * later page (AM2), no flag at all, which is not the same contract fact.
 */
export function errorDetail(
  code: ErrorCode,
  detail: string | undefined,
  isMobile?: ProbeReport['isMobile'],
  orientation?: PageOrientation,
): string | null {
  // AM28: the page an UNEXPECTED_PAGE went to is a contract fact (live checklist L4, L8).
  if (code === 'UNEXPECTED_PAGE' && detail?.startsWith('page ')) return `It went to ${detail.slice(5)}.`;
  // AM37: what the composer read, and what the shim did (a contract fact to record, L15/L16).
  if (code === 'SCREEN_LANDSCAPE' && orientation) return screenLandscapeDetail(orientation);
  if (code === 'DESKTOP_SHELL' && isMobile === false) return 'The page said is_mobile false.';
  if (code === 'DESKTOP_SHELL' && isMobile === 'unknown') {
    return 'A later page of the session carried no is_mobile flag at all, so it was treated as desktop.';
  }
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

/**
 * H0 instructions. `homeOnly`: Instagram opened its home page, which is what it does for
 * /create/story/ without a file (F3), so the owner starts the story from the + button there.
 */
export function pickText(file: string | null, homeOnly: boolean): string {
  const name = file ? `instapost/${file}` : 'the newest file in instapost/';
  return homeOnly
    ? `Instagram opened its home page, as it usually does. In the Instagram window tap + → Story, then pick ${name}.`
    : `In the Instagram window tap + → Story and pick ${name}.`;
}

// ---- W3: guided resize ---------------------------------------------------------------------

/**
 * What the owner is asked to do while `resizing`. `maxW` is the widest usable tab in window px, the
 * limit the ✓ uses (767 CSS px × the tab zoom, AF-8): at another zoom the text names that width.
 */
export function resizeText(maxW: number = MSITE_MAX_CSS_WIDTH): string {
  const w = Math.round(maxW);
  const width = w === MSITE_MAX_CSS_WIDTH ? `at most ${w} px wide` : `at most ${w} px wide at this window's zoom`;
  return `Drag the Instagram window's edges until it is narrow and tall, like a phone: ${width}, taller than wide and at least ${MIN_INNER_H} px tall. instapost carries on by itself as soon as it is.`;
}

/** The instruction at 100% zoom. */
export const RESIZE_TEXT = resizeText();

/** The live size indicator, e.g. "524×965 ✓" or "1512×902 ✗". */
export function resizeSizeText(tab: Size, ok: boolean): string {
  return `${Math.round(tab.w)}×${Math.round(tab.h)} ${ok ? '✓' : '✗'}`;
}

/** Whole seconds left until `until` (never negative). */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

// ---- U1: the diagnostics rows ----------------------------------------------------------------

const size = (x: Size): string => `${Math.round(x.w)}×${Math.round(x.h)}`;

/**
 * The Story input row. What the deciding probe saw, structurally:
 * - `none (no file input on the page)`;
 * - `none image-only (file inputs: …)`: file inputs, but none accepts only images;
 * - `present`: an image-only input whose accept list is the story set;
 * - `present, accept list differs: …`: image-only inputs, none with the story set (the words
 *   "accept list changed" only when that decided ACCEPT_DRIFT);
 * and ` (not checked: stopped before this step)` when the decision never reached C4 (`c4` unknown).
 */
export function storyInputText(probe: ProbeReport, c4: CheckResult | undefined, drift: boolean): string {
  const seen = probe.acceptSeen ?? [];
  const lists = (xs: string[]): string => xs.map((a) => a || '(no accept list)').join('; ');
  let text: string;
  if (probe.storyInput === 'absent') {
    text = seen.length === 0 ? 'none (no file input on the page)' : `none image-only (file inputs: ${lists(seen)})`;
  } else if (probe.acceptOk) {
    text = 'present';
  } else {
    const candidates = seen.filter(isImageOnlyAccept);
    text = `present, ${drift ? 'accept list changed' : 'accept list differs'}: ${lists(candidates.length ? candidates : seen)}`;
  }
  return c4 === 'unknown' ? `${text} (not checked: stopped before this step)` : text;
}

const HOME_NOTE = "(home: Instagram's usual landing, tap + → Story there)";

/**
 * The Page row: where the composer tab was when the deciding probe ran. The note comes from that
 * path (AF-9); C5's route (where the hard reload landed, fixed for the session) only says how the
 * composer was reached, and stands in for the path when none is known.
 */
export function pageText(route: ComposerRoute | undefined, path: string | undefined): string {
  if (path === undefined) {
    if (route === 'homeOnly') return `/ ${HOME_NOTE}`;
    if (route === 'direct') return '/create/story/ (the story composer directly)';
    return 'unknown';
  }
  if (path === '/') return `/ ${HOME_NOTE}`;
  if (isComposerPath(path)) {
    if (route === 'direct') return `${path} (the story composer directly)`;
    if (route === 'homeOnly') return `${path} (the story composer, opened from home)`;
    return `${path} (the story composer)`;
  }
  return path;
}

/**
 * The Window row: the inner size asked for against the one reached, the attempts (and the
 * windows.update calls when the size had to be re-applied), a resize by hand, a refit.
 */
export function windowText(w: WindowDiagnostics): string {
  const fit = w.updates.find((u) => u.step === 'fit');
  const asked = fit ? size(fit.target) : `${w.requested.width}×${w.requested.height} outer`;
  const got = w.finalTab ? size(w.finalTab) : w.createdTab ? size(w.createdTab) : 'unknown';
  const attempts = `${w.attempts} ${w.attempts === 1 ? 'attempt' : 'attempts'}`;
  // W2 hardening: windows.update calls before the navigation, when the size had to be re-applied.
  const calls = w.updates.filter((u) => u.step !== 'refit').reduce((n, u) => n + (u.applied ?? 1), 0);
  const reapplied = calls > w.attempts ? `, size re-applied: ${calls} updates` : '';
  const created =
    w.created && (w.created.width !== w.requested.width || w.created.height !== w.requested.height)
      ? `; opened at ${w.created.width}×${w.created.height} instead of ${w.requested.width}×${w.requested.height}`
      : '';
  const manual = w.manualResize ? '; resized by you' : '';
  // AF-7: the refit's own verification says whether the browser took it.
  const r = w.updates.find((u) => u.step === 'refit');
  const refit = r ? (r.fitted ? '; refitted once' : '; refit not honoured') : '';
  return `asked ${asked}, got ${got} (${attempts}${reapplied}${manual}${refit}${created})`;
}

/** The Browser row (P6). */
export function browserText(f: BrowserFlavour): string {
  switch (f) {
    case 'arc':
      return 'Arc (recognised by its page colours)';
    case 'chrome':
      return 'Google Chrome';
    case 'edge':
      return 'Microsoft Edge';
    case 'chromium':
      return 'Chromium';
    case 'unknown':
      return 'unknown';
  }
}

/**
 * The Service worker row (P1, P3): control is normal on Instagram; interception is the problem.
 * `intercepted`: the session ended with SW_INTERCEPTS (AF-2: the watch may have seen it after the probe).
 */
export function serviceWorkerText(probe: ProbeReport, intercepted = false): string {
  if (intercepted || probe.swIntercepted === true) return 'intercepts requests';
  const control =
    probe.swControlled === true
      ? 'controls the page — normal on Instagram'
      : probe.swControlled === false
        ? 'not in control'
        : 'unknown';
  return probe.swIntercepted === 'unknown' ? `${control}; interception unknown` : control;
}

export const SHARE_TEXT = 'Review in the Instagram window, then tap Share.';

/** AM19: the popup stays open after Share (rehearsal off) so the upload can finish. */
export const HOLD_OPEN_TEXT =
  'The Instagram window stays open so the upload can finish. Answer once the story shows as posted (or failed); the window then closes.';
/** AM28: held open with no pre-answer, so an upload or a pick by hand in progress is not cut off. */
export const HOLD_OPEN_UNKNOWN_TEXT =
  'The Instagram window stays open in case a post is still on its way there. Answer once you know; the window then closes.';
