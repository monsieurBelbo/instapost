/**
 * Probe → decision (strategy §3.6 step 7, §11 AM2; P1, P3, P4 of 2026-10-12; AM37). Pure. The rows are
 * evaluated in the table's order and no row retries; the single refit is granted by the caller
 * through `refitUsed`. The hand-off reducer adds what depends on session history (the one wait for a
 * late story input or account link, the account decision, the autopilot's one open-entry and one Share).
 *
 * | Row | Condition                                                | Decision                          |
 * |-----|----------------------------------------------------------|-----------------------------------|
 * | 1   | guarded build and !marker                                | fail GUARD_NOT_FAKE               |
 * | 2   | live build and marker                                    | banner, continue                  |
 * | 3   | URL matches login                                        | fail NOT_LOGGED_IN                |
 * | 4   | isMobile === false (re-probe: !== true)                  | fail DESKTOP_SHELL                |
 * | 4b  | swIntercepted === true (a worker handled requests)       | fail SW_INTERCEPTS                |
 * | 5   | inner.w > MSITE_MAX_CSS_WIDTH or not portrait            | refit once, else LAYOUT_TOO_WIDE  |
 * |     |                                                          | (still too wide) or LANDSCAPE     |
 * | 5b  | on /create/story and the page may read a landscape screen| fail SCREEN_LANDSCAPE             |
 * | 6   | mode 'check'                                             | check-done (taps nothing)         |
 * | 7   | story input absent / accept drift                        | fail INPUT_MISSING / ACCEPT_DRIFT |
 * |     |                                                          | (offer-manual: Finish by hand)    |
 * | 8   | otherwise                                                | proceed (account, then + → Story) |
 *
 * P1: `swControlled` decides nothing any more. Instagram's worker claims every logged-in page within
 * about 1 s and has no fetch handler (F2), so being controlled is normal; row 4b's tripwire is what
 * shows that page requests left without the tab-scoped UA rule. C4 is "reached" (and so recorded)
 * only by rows 6–8: before them the page was not in the layout that has the story input.
 *
 * AM37: row 5b is C3b. The composer page hides Share while it reads a landscape screen orientation
 * (`orientation`, which the background adds from the portrait shim's result); it applies once the
 * composer is reached, i.e. on /create/story. On home the composer is not mounted yet, so the
 * reading is only recorded there; the reducer re-checks it whenever a later load reaches the composer.
 * "May read landscape" (composerMayReadLandscape) is a landscape type, an unreadable reading (SH-2: the
 * shim failed before it read a type, so the page's real, landscape-or-not type is unknown), or a shim
 * that installed itself only after the composer had mounted and read the screen (SH-1,
 * `afterComposerMount`, which the reducer sets). Only the page's own `screen.orientation.type` is
 * observed: if Instagram read the screen another way (SH-3), the snackbar would come back with C3b
 * recorded as pass, and only the owner's eyes and the live checks would show it.
 */
import {
  isLandscapeType,
  isUnreadableOrientation,
  MSITE_MAX_CSS_WIDTH,
  type PageOrientation,
  type ProbeReport,
} from './contract.ts';
import { classifyComposerUrl, isComposerUrl } from './urls.ts';

export type ProbeFailCode =
  | 'GUARD_NOT_FAKE'
  | 'NOT_LOGGED_IN'
  | 'DESKTOP_SHELL'
  | 'SW_INTERCEPTS'
  | 'LAYOUT_TOO_WIDE'
  | 'LANDSCAPE'
  | 'SCREEN_LANDSCAPE'
  | 'INPUT_MISSING'
  | 'ACCEPT_DRIFT';

export type ProbeDecision =
  | { kind: 'fail'; code: ProbeFailCode }
  /** Not portrait and the refit is still unused: refit the window once and probe again. */
  | { kind: 'refit' }
  /** mode 'check': read the account, store the report, close. Never taps. */
  | { kind: 'check-done' }
  /** The page has the story input (C4): carry on to the account decision, then + → Story. */
  | { kind: 'proceed' };

export interface ProbeEvalInput {
  probe: ProbeReport;
  /** MODE !== 'live'. */
  guarded: boolean;
  mode: 'post' | 'test' | 'shareTest' | 'check';
  /** The composer tab's current URL (tab.url); undefined skips row 3. */
  url: string | undefined;
  /** The single landscape refit was already used. */
  refitUsed: boolean;
  /** AM2: a re-probe after a later document load. isMobile must then be exactly true. */
  strict: boolean;
}

export interface ProbeEvaluation {
  decision: ProbeDecision;
  /** Row 2: live build on the fake. Show "FAKE INSTAGRAM" and carry on. */
  banner: boolean;
  /** The decision got as far as C4 (rows 6–8), so the probe's story-input facts count (preflight C4). */
  c4Reached: boolean;
}

/**
 * Row 4. The first probe after the hard reload fails only on an explicit `is_mobile:false`
 * (§3.6); a re-probe after any later document load (AM2) also fails on 'unknown'. P1: the
 * service-worker control state is diagnostics only.
 */
export function isDesktopShell(probe: ProbeReport, strict: boolean): boolean {
  return strict ? probe.isMobile !== true : probe.isMobile === false;
}

/** Row 4b (P3): the tripwire saw a service worker handle the page's requests. `unknown` never fails. */
export function swIntercepts(probe: ProbeReport): boolean {
  return probe.swIntercepted === true;
}

/** Row 5 (P4): the viewport is in msite's mobile layout, the one with the + → Story entry, and portrait. */
export function isMobileLayout(probe: ProbeReport): boolean {
  return probe.portrait && probe.inner.w <= MSITE_MAX_CSS_WIDTH;
}

/**
 * Row 5b (AM37, C3b): the tab is on the composer and the composer page may read a landscape screen
 * there, so it shows its rotate snackbar and no Share:
 * - the page still reads a landscape type (the portrait shim off, or failed after reading the type);
 * - SH-2: the reading is unreadable (`{type: null, shim: 'failed'}`: the shim threw in the page, or its
 *   result was malformed), so the page's real type is unknown; it fails closed;
 * - SH-1: the shim installed itself only after the composer had mounted (`afterComposerMount`):
 *   Instagram read the landscape screen at mount and re-reads only on `resize`.
 * No orientation reading, `absent` (no `screen.orientation`: Instagram falls back to the portrait
 * viewport), or a page off the composer, never fails.
 */
export function composerMayReadLandscape(
  orientation: PageOrientation | null | undefined,
  url: string | undefined,
): boolean {
  if (!isComposerUrl(url) || orientation == null) return false;
  return (
    isLandscapeType(orientation.type) || isUnreadableOrientation(orientation) || orientation.afterComposerMount === true
  );
}

export function evaluateProbe(input: ProbeEvalInput): ProbeEvaluation {
  const { probe } = input;
  if (input.guarded && !probe.marker) {
    return { decision: { kind: 'fail', code: 'GUARD_NOT_FAKE' }, banner: false, c4Reached: false };
  }
  const banner = !input.guarded && probe.marker;
  const out = (decision: ProbeDecision): ProbeEvaluation => ({
    decision,
    banner,
    c4Reached:
      decision.kind === 'check-done' ||
      decision.kind === 'proceed' ||
      (decision.kind === 'fail' && (decision.code === 'INPUT_MISSING' || decision.code === 'ACCEPT_DRIFT')),
  });

  if (input.url !== undefined && classifyComposerUrl(input.url).kind === 'stop') {
    return out({ kind: 'fail', code: 'NOT_LOGGED_IN' });
  }
  if (isDesktopShell(probe, input.strict)) return out({ kind: 'fail', code: 'DESKTOP_SHELL' });
  if (swIntercepts(probe)) return out({ kind: 'fail', code: 'SW_INTERCEPTS' });
  if (!isMobileLayout(probe)) {
    if (!input.refitUsed) return out({ kind: 'refit' });
    return out({ kind: 'fail', code: probe.inner.w > MSITE_MAX_CSS_WIDTH ? 'LAYOUT_TOO_WIDE' : 'LANDSCAPE' });
  }
  if (composerMayReadLandscape(probe.orientation, input.url)) return out({ kind: 'fail', code: 'SCREEN_LANDSCAPE' });
  if (input.mode === 'check') return out({ kind: 'check-done' });
  if (probe.storyInput === 'absent') return out({ kind: 'fail', code: 'INPUT_MISSING' });
  if (!probe.acceptOk) return out({ kind: 'fail', code: 'ACCEPT_DRIFT' });
  return out({ kind: 'proceed' });
}
