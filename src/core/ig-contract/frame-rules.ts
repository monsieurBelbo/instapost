/**
 * The in-page lane's session rules (docs/inpage.md §3.5, §3.6; spike S12). Pure.
 *
 * - **Rule 1001, frame variants.** The engine frame lives inside the owner's desktop Instagram tab, and dNR
 *   cannot tell the frame's requests from the page's own except for the two document requests (the frame's
 *   is `sub_frame`, the page's `main_frame`). So:
 *   - `tabwide` (U3, the recommendation): today's rule 1001 for the tab, every resource type except
 *     `main_frame`: the frame's document and all its XHRs are Android, and so are the desktop page's own
 *     requests for the run's duration; a reload of the page stays desktop.
 *   - `document` (U1, measured by L27): `sub_frame` only: the frame's document is Android, every XHR (the
 *     frame's and the page's) keeps the browser's own desktop profile.
 * - **Rule 1020** removes `X-Frame-Options` from www `sub_frame` responses in that one tab, so Chromium
 *   renders Instagram's mobile document in the engine frame. CSP is never touched (§3.5).
 *
 * Both exist only while a run is in progress, for the run's tab only; cleanup removes 1001..1029 whole
 * (SESSION_RULE_IDS).
 */

import { FRAME_UA_VARIANTS, type FrameUaVariant } from '../inpage/variants.ts';
import { ALL_RESOURCE_TYPES, type ChMode, uaRule } from './device-profile.ts';
import { type DnrRule, FRAME_RULE_FIRST_ID, type ResourceType, SESSION_RULE_LAST_ID } from './rules.ts';
import { IG_HOST } from './urls.ts';

export { FRAME_UA_VARIANTS, type FrameUaVariant };

/** Rule 1020: X-Frame-Options removed from the engine frame's document. */
export const XFO_RULE_ID = FRAME_RULE_FIRST_ID;
export const XFO_RULE_PRIORITY = 1;

/** Every resource type but the page's own document (U3). */
export const FRAME_TABWIDE_TYPES: readonly ResourceType[] = ALL_RESOURCE_TYPES.filter((t) => t !== 'main_frame');

if (XFO_RULE_ID > SESSION_RULE_LAST_ID) throw new Error('frame-rules: 1020 outside the session range');

/**
 * Rule 1001 for the in-page lane: uaRule()'s request headers (the Android reduced UA and, in `full`, the
 * client hints), scoped to the tab and to `FRAME_TABWIDE_TYPES` (U3) or `sub_frame` (U1). Never
 * `main_frame`. Throws RangeError like uaRule() for a tab that is not a real tab or an implausible major.
 */
export function frameUaRule(tabId: number, chromeMajor: number, chMode: ChMode, variant: FrameUaVariant): DnrRule {
  const base = uaRule(tabId, chromeMajor, chMode);
  const resourceTypes: ResourceType[] = variant === 'tabwide' ? [...FRAME_TABWIDE_TYPES] : ['sub_frame'];
  return { ...base, condition: { ...base.condition, resourceTypes } };
}

/**
 * Rule 1020: `remove x-frame-options` on www `sub_frame` responses of one tab. Throws RangeError for a tab
 * that is not a real tab (-1 would cover every service worker's requests).
 */
export function xfoRule(tabId: number): DnrRule {
  if (!Number.isInteger(tabId) || tabId < 0) throw new RangeError(`xfoRule: invalid tabId ${tabId}`);
  return {
    id: XFO_RULE_ID,
    priority: XFO_RULE_PRIORITY,
    action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }] },
    condition: { tabIds: [tabId], requestDomains: [IG_HOST], resourceTypes: ['sub_frame'] },
  };
}

/** Rule 1021 (owner, 2026-10-14): Instagram answers `Sec-Fetch-Dest: iframe` with "page isn't available". */
export const FETCH_DEST_RULE_ID = FRAME_RULE_FIRST_ID + 1;

/**
 * Rule 1021: `set sec-fetch-dest: document` on www `sub_frame` requests of one tab, so the engine frame's
 * document request reads like a normal page load. A deliberate forgery (docs/inpage.md §3.7).
 */
export function fetchDestRule(tabId: number): DnrRule {
  if (!Number.isInteger(tabId) || tabId < 0) throw new RangeError(`fetchDestRule: invalid tabId ${tabId}`);
  return {
    id: FETCH_DEST_RULE_ID,
    priority: XFO_RULE_PRIORITY,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'sec-fetch-dest', operation: 'set', value: 'document' }],
    },
    condition: { tabIds: [tabId], requestDomains: [IG_HOST], resourceTypes: ['sub_frame'] },
  };
}
