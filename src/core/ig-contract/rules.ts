/**
 * dNR rule shapes and the write-block rules (strategy §3.7, §5 SG3/SG5).
 *
 * The types mirror the dNR API's Rule JSON without depending on any extension typings
 * (src/core has none). src/platform/dnr.ts casts them at the API boundary.
 *
 * Session rule ids: 1001 is the UA rule (device-profile.ts); 1002..1019 are reserved for
 * rehearsal rules; 1020..1029 for the in-page lane (docs/inpage.md §3.5, frame-rules.ts: 1020 removes
 * X-Frame-Options from the engine frame's document). Cleanup always removes the whole range 1001..1029.
 */
import { WRITE_URL_FILTERS } from './write-endpoints.ts';

export type ResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'csp_report'
  | 'media'
  | 'websocket'
  | 'webtransport'
  | 'webbundle'
  | 'other';

export type HeaderOperation =
  | { header: string; operation: 'set'; value: string }
  | { header: string; operation: 'append'; value: string }
  | { header: string; operation: 'remove' };

export interface DnrCondition {
  urlFilter?: string;
  requestDomains?: string[];
  /** Unset means every type except main_frame. */
  resourceTypes?: ResourceType[];
  /** Session rules only. -1 (TAB_ID_NONE) matches requests not made by a tab, e.g. service workers. */
  tabIds?: number[];
}

export type DnrAction =
  | { type: 'block' }
  /** At least one of the two lists; rule 1020 (docs/inpage.md §3.5) has response headers only. */
  | { type: 'modifyHeaders'; requestHeaders?: HeaderOperation[]; responseHeaders?: HeaderOperation[] };

export interface DnrRule {
  id: number;
  priority: number;
  action: DnrAction;
  condition: DnrCondition;
}

export const TAB_ID_NONE = -1;
export const BLOCK_PRIORITY = 100;

export const STATIC_RULESET_ID = 'block_ig_writes';
export const STATIC_RULESET_PATH = 'rules/block_ig_writes.json';

export const UA_RULE_ID = 1001;
export const REHEARSAL_FIRST_ID = 1002;
/** The last id the rehearsal (test write-block) rules may use. */
export const REHEARSAL_LAST_ID = 1019;
/** docs/inpage.md §3.5: 1020..1029 belong to the in-page lane (frame-rules.ts). */
export const FRAME_RULE_FIRST_ID = 1020;
export const SESSION_RULE_LAST_ID = 1029;
/** Every session rule id this extension may own: 1001..1029. Cleanup removes all of them. */
export const SESSION_RULE_IDS: readonly number[] = Array.from(
  { length: SESSION_RULE_LAST_ID - UA_RULE_ID + 1 },
  (_, i) => UA_RULE_ID + i,
);

if (REHEARSAL_FIRST_ID + WRITE_URL_FILTERS.length - 1 > REHEARSAL_LAST_ID) {
  throw new Error('rules: too many write filters for the reserved rehearsal id range 1002..1019');
}

/**
 * The static ruleset written to rules/block_ig_writes.json in guarded builds by the
 * `build:publicAssets` hook: ids 1..n, priority 100, block, no tabIds, no resourceTypes
 * (so every type except main_frame; writes are never navigations).
 */
export function blockRuleset(): DnrRule[] {
  return WRITE_URL_FILTERS.map((urlFilter, i) => ({
    id: i + 1,
    priority: BLOCK_PRIORITY,
    action: { type: 'block' },
    condition: { urlFilter },
  }));
}

/**
 * Rehearsal session rules for one composer tab: ids 1002.., priority 100, block, scoped to
 * `[tabId, -1]` so service-worker-initiated uploads are caught too. Same filters as blockRuleset().
 */
export function rehearsalRules(tabId: number): DnrRule[] {
  return WRITE_URL_FILTERS.map((urlFilter, i) => ({
    id: REHEARSAL_FIRST_ID + i,
    priority: BLOCK_PRIORITY,
    action: { type: 'block' },
    condition: { urlFilter, tabIds: [tabId, TAB_ID_NONE] },
  }));
}
