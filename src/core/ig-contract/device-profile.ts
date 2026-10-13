/**
 * The composer tab's device profile: header-only, Android Chrome reduced UA (strategy §3.7).
 * Rule 1001 is a tab-scoped session rule installed while the popup is still at about:blank.
 */
import { type DnrRule, type HeaderOperation, type ResourceType, UA_RULE_ID } from './rules.ts';
import { UA_RULE_HOSTS } from './urls.ts';

/** `full` rewrites UA plus client hints; `uaOnly` is the fallback if S5 shows CH ops do not apply. */
export type ChMode = 'full' | 'uaOnly';

/** Rule 1001's priority (§3.7); the rehearsal block rules use BLOCK_PRIORITY (100). */
export const UA_RULE_PRIORITY = 1;

/** CDN hosts are deliberately out of scope (OD6). Kept in urls.ts so the agent can read it without the rules. */
export const UA_RULE_DOMAINS = UA_RULE_HOSTS;

/** Every resource type, main_frame included: with resourceTypes unset dNR skips main_frame. */
export const ALL_RESOURCE_TYPES: readonly ResourceType[] = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
];

/** Client hints set in `full` mode. The platform value includes its quotes. `sec-ch-ua` (brands) is untouched. */
export const CH_SET = { 'sec-ch-ua-mobile': '?1', 'sec-ch-ua-platform': '"Android"' } as const;

/** High-entropy client hints removed in `full` mode. */
export const CH_REMOVE = [
  'sec-ch-ua-platform-version',
  'sec-ch-ua-arch',
  'sec-ch-ua-bitness',
  'sec-ch-ua-model',
  'sec-ch-ua-full-version',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-wow64',
  'sec-ch-ua-form-factors',
] as const;

/**
 * `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Mobile Safari/537.36`.
 * Never append an Instagram app version (research §5.4).
 */
export function androidReducedUa(chromeMajor: number): string {
  return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36`;
}

/** `Chrome/<n>.` or `HeadlessChrome/<n>.` as a whole token (not `CriOS/`, not `XChrome/`). */
const CHROME_TOKEN = /(?:^|[\s(;])(?:Headless)?Chrome\/(\d{1,4})\./;

/** A plausible Chrome major for the reduced UA: a positive integer. */
export function isChromeMajor(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n < 10_000;
}

/**
 * `<major>` from the background's navigator.userAgent (`Chrome/155.…`), or null. Headless E2E
 * browsers report `HeadlessChrome/156.0.0.0` (spike S5); both forms must parse. The reduced UA
 * always has `.0.0.0`, so only the major is meaningful.
 */
export function chromeMajorFromUa(userAgent: string): number | null {
  const m = CHROME_TOKEN.exec(userAgent);
  if (!m) return null;
  const major = Number(m[1]);
  return isChromeMajor(major) ? major : null;
}

/**
 * Brands of branded browsers in `navigator.userAgentData.brands` (§11 AM23). Chrome for Testing and
 * Playwright's Chromium report only "Chromium" and a GREASE brand (spike S5), so a guarded build that
 * sees one of these is in a branded profile, where it must never open a spoofed composer (SG2, G6).
 */
export const BRANDED_BROWSER_BRANDS: readonly string[] = ['Google Chrome', 'Microsoft Edge'];

/** True when `brands` (userAgentData.brands[].brand) names a branded browser. */
export function isBrandedBrowser(brands: readonly string[]): boolean {
  return brands.some((b) => BRANDED_BROWSER_BRANDS.includes(b.trim()));
}

/**
 * Rule 1001 for the composer tab: modifyHeaders, priority 1, condition
 * `{tabIds:[tabId], requestDomains: UA_RULE_DOMAINS, resourceTypes: ALL_RESOURCE_TYPES}`.
 * Request headers: `set user-agent` to androidReducedUa(chromeMajor); in `full` mode also
 * `set` each CH_SET header and `remove` each CH_REMOVE header. `uaOnly` has only the UA op.
 * Throws RangeError for a tabId that is not a real tab (e.g. -1) or an implausible major.
 * Tested by U7.
 */
export function uaRule(tabId: number, chromeMajor: number, chMode: ChMode): DnrRule {
  // A rule for tab -1 (TAB_ID_NONE) would spoof service-worker requests too: refuse it.
  if (!Number.isInteger(tabId) || tabId < 0) throw new RangeError(`uaRule: invalid tabId ${tabId}`);
  if (!isChromeMajor(chromeMajor)) throw new RangeError(`uaRule: invalid chromeMajor ${chromeMajor}`);
  const requestHeaders: HeaderOperation[] = [
    { header: 'user-agent', operation: 'set', value: androidReducedUa(chromeMajor) },
  ];
  if (chMode === 'full') {
    for (const [header, value] of Object.entries(CH_SET)) requestHeaders.push({ header, operation: 'set', value });
    for (const header of CH_REMOVE) requestHeaders.push({ header, operation: 'remove' });
  }
  return {
    id: UA_RULE_ID,
    priority: UA_RULE_PRIORITY,
    action: { type: 'modifyHeaders', requestHeaders },
    condition: { tabIds: [tabId], requestDomains: [...UA_RULE_DOMAINS], resourceTypes: [...ALL_RESOURCE_TYPES] },
  };
}
