/**
 * U8 (strategy §7.11): the static ruleset and the rehearsal rules both derive from
 * WRITE_URL_FILTERS (equal sets). Static: ids 1..n, priority 100, no tabIds, no resourceTypes.
 * Rehearsal: ids 1002.., tabIds [tab, -1]. Snapshot.
 */
import { describe, expect, it } from 'vitest';
import {
  BLOCK_PRIORITY,
  blockRuleset,
  REHEARSAL_FIRST_ID,
  rehearsalRules,
  SESSION_RULE_IDS,
  SESSION_RULE_LAST_ID,
  TAB_ID_NONE,
  UA_RULE_ID,
} from './rules.ts';
import { WRITE_URL_FILTERS } from './write-endpoints.ts';

const filters = (rules: ReturnType<typeof blockRuleset>) => new Set(rules.map((r) => r.condition.urlFilter));

describe('U8 write-block rules', () => {
  it('static and rehearsal rules carry exactly the WRITE_URL_FILTERS set', () => {
    const expected = new Set<string>(WRITE_URL_FILTERS);
    expect(filters(blockRuleset())).toEqual(expected);
    expect(filters(rehearsalRules(42))).toEqual(expected);
    expect(blockRuleset()).toHaveLength(WRITE_URL_FILTERS.length);
    expect(rehearsalRules(42)).toHaveLength(WRITE_URL_FILTERS.length);
  });

  it('static: ids 1..n, priority 100, block, no tabIds, no resourceTypes, nothing else', () => {
    blockRuleset().forEach((r, i) => {
      expect(r.id).toBe(i + 1);
      expect(r.priority).toBe(BLOCK_PRIORITY);
      expect(BLOCK_PRIORITY).toBe(100);
      expect(r.action).toEqual({ type: 'block' });
      expect(Object.keys(r.condition)).toEqual(['urlFilter']);
    });
  });

  it('rehearsal: ids 1002.., priority 100, block, tabIds [tab, -1], no resourceTypes', () => {
    rehearsalRules(42).forEach((r, i) => {
      expect(r.id).toBe(REHEARSAL_FIRST_ID + i);
      expect(r.priority).toBe(BLOCK_PRIORITY);
      expect(r.action).toEqual({ type: 'block' });
      expect(r.condition.tabIds).toEqual([42, TAB_ID_NONE]);
      expect(r.condition.resourceTypes).toBeUndefined();
    });
  });

  it('rehearsal ids stay inside the reserved session range, which cleanup removes whole', () => {
    const ids = rehearsalRules(7).map((r) => r.id);
    expect(Math.max(...ids)).toBeLessThanOrEqual(SESSION_RULE_LAST_ID);
    expect(SESSION_RULE_IDS).toEqual(Array.from({ length: 19 }, (_, i) => 1001 + i));
    for (const id of [UA_RULE_ID, ...ids]) expect(SESSION_RULE_IDS).toContain(id);
  });

  it('matches the snapshots', () => {
    expect(blockRuleset()).toMatchInlineSnapshot(`
      [
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "urlFilter": "||instagram.com/rupload_igphoto/",
          },
          "id": 1,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "urlFilter": "||instagram.com/rupload_igvideo/",
          },
          "id": 2,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "urlFilter": "||instagram.com/api/v1/media/configure_to_story/",
          },
          "id": 3,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "urlFilter": "/api/v1/web/create/configure_to_story/",
          },
          "id": 4,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "urlFilter": "/create/configure_to_story/",
          },
          "id": 5,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "urlFilter": "/api/v1/media/configure/",
          },
          "id": 6,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "urlFilter": "configure_sidecar/",
          },
          "id": 7,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "urlFilter": "configure_to_clips/",
          },
          "id": 8,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "urlFilter": "configure_to_longform/",
          },
          "id": 9,
          "priority": 100,
        },
      ]
    `);
    expect(rehearsalRules(42)).toMatchInlineSnapshot(`
      [
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "tabIds": [
              42,
              -1,
            ],
            "urlFilter": "||instagram.com/rupload_igphoto/",
          },
          "id": 1002,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "tabIds": [
              42,
              -1,
            ],
            "urlFilter": "||instagram.com/rupload_igvideo/",
          },
          "id": 1003,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "tabIds": [
              42,
              -1,
            ],
            "urlFilter": "||instagram.com/api/v1/media/configure_to_story/",
          },
          "id": 1004,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "tabIds": [
              42,
              -1,
            ],
            "urlFilter": "/api/v1/web/create/configure_to_story/",
          },
          "id": 1005,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "tabIds": [
              42,
              -1,
            ],
            "urlFilter": "/create/configure_to_story/",
          },
          "id": 1006,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "tabIds": [
              42,
              -1,
            ],
            "urlFilter": "/api/v1/media/configure/",
          },
          "id": 1007,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "tabIds": [
              42,
              -1,
            ],
            "urlFilter": "configure_sidecar/",
          },
          "id": 1008,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "tabIds": [
              42,
              -1,
            ],
            "urlFilter": "configure_to_clips/",
          },
          "id": 1009,
          "priority": 100,
        },
        {
          "action": {
            "type": "block",
          },
          "condition": {
            "tabIds": [
              42,
              -1,
            ],
            "urlFilter": "configure_to_longform/",
          },
          "id": 1010,
          "priority": 100,
        },
      ]
    `);
  });
});
