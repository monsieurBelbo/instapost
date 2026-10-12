/**
 * U7 (strategy §7.11): rule 1001 snapshot for (tab 42, major 155); resourceTypes include
 * main_frame; the exact UA; set and remove ops as in §3.7; no op on sec-ch-ua; the uaOnly
 * variant has only the UA op. Plus chromeMajorFromUa, which must parse HeadlessChrome (S5).
 */
import { describe, expect, it } from 'vitest';
import {
  ALL_RESOURCE_TYPES,
  CH_REMOVE,
  chromeMajorFromUa,
  isBrandedBrowser,
  isChromeMajor,
  UA_RULE_DOMAINS,
  uaRule,
} from './device-profile.ts';
import type { HeaderOperation } from './rules.ts';

const ANDROID_155 =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';

function ops(chMode: 'full' | 'uaOnly'): HeaderOperation[] {
  const rule = uaRule(42, 155, chMode);
  if (rule.action.type !== 'modifyHeaders') throw new Error('expected modifyHeaders');
  return rule.action.requestHeaders;
}

describe('U7 device profile: rule 1001', () => {
  it('matches the snapshot for (tab 42, major 155, full)', () => {
    expect(uaRule(42, 155, 'full')).toMatchInlineSnapshot(`
      {
        "action": {
          "requestHeaders": [
            {
              "header": "user-agent",
              "operation": "set",
              "value": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36",
            },
            {
              "header": "sec-ch-ua-mobile",
              "operation": "set",
              "value": "?1",
            },
            {
              "header": "sec-ch-ua-platform",
              "operation": "set",
              "value": ""Android"",
            },
            {
              "header": "sec-ch-ua-platform-version",
              "operation": "remove",
            },
            {
              "header": "sec-ch-ua-arch",
              "operation": "remove",
            },
            {
              "header": "sec-ch-ua-bitness",
              "operation": "remove",
            },
            {
              "header": "sec-ch-ua-model",
              "operation": "remove",
            },
            {
              "header": "sec-ch-ua-full-version",
              "operation": "remove",
            },
            {
              "header": "sec-ch-ua-full-version-list",
              "operation": "remove",
            },
            {
              "header": "sec-ch-ua-wow64",
              "operation": "remove",
            },
            {
              "header": "sec-ch-ua-form-factors",
              "operation": "remove",
            },
          ],
          "type": "modifyHeaders",
        },
        "condition": {
          "requestDomains": [
            "www.instagram.com",
            "i.instagram.com",
          ],
          "resourceTypes": [
            "main_frame",
            "sub_frame",
            "stylesheet",
            "script",
            "image",
            "font",
            "object",
            "xmlhttprequest",
            "ping",
            "csp_report",
            "media",
            "websocket",
            "webtransport",
            "webbundle",
            "other",
          ],
          "tabIds": [
            42,
          ],
        },
        "id": 1001,
        "priority": 1,
      }
    `);
  });

  it('is rule 1001, priority 1, scoped to the tab and the two www/i domains', () => {
    const rule = uaRule(42, 155, 'full');
    expect(rule.id).toBe(1001);
    expect(rule.priority).toBe(1);
    expect(rule.condition.tabIds).toEqual([42]);
    expect(rule.condition.requestDomains).toEqual(['www.instagram.com', 'i.instagram.com']);
    expect(rule.condition.urlFilter).toBeUndefined();
  });

  it('lists every resource type, main_frame included (unset would skip main_frame)', () => {
    const types = uaRule(42, 155, 'full').condition.resourceTypes ?? [];
    expect(types).toContain('main_frame');
    expect(types).toEqual([...ALL_RESOURCE_TYPES]);
    expect(new Set(types).size).toBe(15);
  });

  it('sets the exact Android reduced UA, never with an app version', () => {
    expect(ops('full')[0]).toEqual({ header: 'user-agent', operation: 'set', value: ANDROID_155 });
    expect(ANDROID_155).not.toMatch(/Instagram/);
  });

  it('full: sets sec-ch-ua-mobile and -platform (quoted), removes the 8 high-entropy hints', () => {
    const full = ops('full');
    expect(full).toContainEqual({ header: 'sec-ch-ua-mobile', operation: 'set', value: '?1' });
    expect(full).toContainEqual({ header: 'sec-ch-ua-platform', operation: 'set', value: '"Android"' });
    const removed = full.filter((o) => o.operation === 'remove').map((o) => o.header);
    expect(removed).toEqual([...CH_REMOVE]);
    expect(removed).toHaveLength(8);
    expect(full).toHaveLength(1 + 2 + 8);
    expect(full.some((o) => o.operation === 'append')).toBe(false);
  });

  it('leaves sec-ch-ua (the brands) untouched', () => {
    for (const mode of ['full', 'uaOnly'] as const) {
      expect(ops(mode).some((o) => o.header === 'sec-ch-ua')).toBe(false);
    }
  });

  it('uaOnly has only the UA op', () => {
    expect(ops('uaOnly')).toEqual([{ header: 'user-agent', operation: 'set', value: ANDROID_155 }]);
  });

  it('never targets TAB_ID_NONE and refuses implausible majors', () => {
    expect(() => uaRule(-1, 155, 'full')).toThrow(RangeError);
    expect(() => uaRule(1.5, 155, 'full')).toThrow(RangeError);
    expect(() => uaRule(42, Number.NaN, 'full')).toThrow(RangeError);
    expect(() => uaRule(42, 0, 'full')).toThrow(RangeError);
  });

  it('returns fresh arrays (mutating one rule never changes the next)', () => {
    const a = uaRule(42, 155, 'full');
    a.condition.requestDomains?.push('evil.example');
    expect(uaRule(42, 155, 'full').condition.requestDomains).toEqual([...UA_RULE_DOMAINS]);
  });
});

describe('U7 isBrandedBrowser (AM23)', () => {
  it('names Google Chrome and Microsoft Edge, never the sealed browsers', () => {
    expect(isBrandedBrowser(['Not:A-Brand', 'Chromium'])).toBe(false); // Playwright's Chromium 156 (E4)
    expect(isBrandedBrowser(['Chromium', 'Not(A:Brand'])).toBe(false); // CfT 155 (S5)
    expect(isBrandedBrowser([])).toBe(false);
    expect(isBrandedBrowser(['Google Chrome', 'Chromium', 'Not A(Brand'])).toBe(true);
    expect(isBrandedBrowser(['Chromium', 'Microsoft Edge'])).toBe(true);
  });
});

describe('U7 chromeMajorFromUa', () => {
  it.each([
    [
      'branded Chrome on macOS',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
      155,
    ],
    [
      'headless E2E (S5)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36',
      156,
    ],
    ['the Android reduced UA itself', ANDROID_155, 155],
    ['full version string', 'Mozilla/5.0 (X11; Linux x86_64) Chrome/155.0.8059.39 Safari/537.36', 155],
    [
      'Edge (still carries Chrome/)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0',
      155,
    ],
  ])('%s', (_name, ua, major) => {
    expect(chromeMajorFromUa(ua)).toBe(major);
  });

  it.each([
    ['Firefox', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0'],
    ['Safari', 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'],
    ['iOS Chrome (CriOS is not Chrome/)', 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/155.0.0.0 Mobile/15E148'],
    ['no dot after the major', 'Mozilla/5.0 Chrome/155'],
    ['a prefixed token', 'Mozilla/5.0 XChrome/155.0.0.0'],
    ['major 0', 'Mozilla/5.0 Chrome/0.0.0.0'],
    ['empty', ''],
  ])('%s → null', (_name, ua) => {
    expect(chromeMajorFromUa(ua)).toBeNull();
  });

  it('isChromeMajor accepts only positive integers', () => {
    expect(isChromeMajor(155)).toBe(true);
    expect([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY].some(isChromeMajor)).toBe(false);
  });
});
