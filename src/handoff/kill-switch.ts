/**
 * Kill switch, background side (strategy §3.6): no DOM. Turns tabs.onUpdated into reducer
 * events for the composer tab only, and classifies the URL with the core's urls.ts once the
 * switch is armed (from the hard reload until the session closes).
 *
 * The decision itself (stop, kill and lock, composer left) is the reducer's, from the same
 * classifyComposerUrl(); `killSwitchVerdict` only names it for the log. Updates for the
 * composer tab are never filtered further: every one of them must reach the reducer.
 */
import { type HandoffEvent, type HandoffState, isArmed } from '../core/handoff/state.ts';
import { classifyComposerUrl, igPath, type UrlVerdict } from '../core/ig-contract/urls.ts';
import type { TabUpdate } from '../platform/tabs.ts';

/** The composer tab of the session, or null (idle, opening, or closing before the window existed). */
export function composerTabId(state: HandoffState): number | null {
  if (state.phase === 'idle' || state.phase === 'queued' || state.phase === 'opening') return null;
  return state.tabId;
}

/** The reducer event for a tabs.onUpdated, or null when the update is not for the composer tab. */
export function composerTabEvent(state: HandoffState, tabId: number, update: TabUpdate): HandoffEvent | null {
  if (composerTabId(state) !== tabId) return null;
  return { type: 'tabUpdated', tabId, status: update.status, url: update.url };
}

/**
 * What the kill switch makes of `url`, for the log; null while it has nothing to say. Armed: every
 * URL (`undefined` = a host without permission). AM20: in `navigating` the first navigation is
 * classified too, once its URL is visible (about:blank and hidden URLs are the reducer's to judge).
 */
export function killSwitchVerdict(state: HandoffState, url: string | undefined): UrlVerdict | null {
  if (isArmed(state)) return classifyComposerUrl(url);
  if (state.phase === 'navigating' && url !== undefined && url !== 'about:blank') return classifyComposerUrl(url);
  return null;
}

/**
 * A log line for verdicts that end or change the session; null for `ok` and `composer-left`. An
 * unexpected page names its path (query and fragment dropped): a contract fact to record (AM28).
 */
export function describeVerdict(verdict: UrlVerdict | null, url?: string): string | null {
  if (verdict === null) return null;
  if (verdict.kind === 'stop') return `kill switch: stop (${verdict.code}), no lock`;
  if (verdict.kind === 'kill') return `kill switch: kill (${verdict.code}), msite lane locked`;
  if (verdict.kind === 'unknown-left') {
    const path = (url !== undefined ? igPath(url) : null) ?? '?';
    return `kill switch: unexpected Instagram page ${path} (UNEXPECTED_PAGE), no lock`;
  }
  return null;
}
