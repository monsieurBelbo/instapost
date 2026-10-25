/**
 * U37 (was U30 in docs/inpage.md §9.2; strategy §11 AM47, AM52): the in-page lane's rules: ids, scopes, no
 * `main_frame` in either variant of 1001, the shapes of 1020 and 1021, and cleanup of 1001–1029.
 */
import { describe, expect, it } from 'vitest';
import { ALL_RESOURCE_TYPES, androidReducedUa, uaRule } from './device-profile.ts';
import {
  FETCH_DEST_RULE_ID,
  FRAME_TABWIDE_TYPES,
  fetchDestRule,
  frameUaRule,
  XFO_RULE_ID,
  xfoRule,
} from './frame-rules.ts';
import { rehearsalRules, SESSION_RULE_IDS, SESSION_RULE_LAST_ID, UA_RULE_ID } from './rules.ts';

describe('U37 frame rules', () => {
  it('1001 tabwide (U3): the window lane rule minus main_frame, same headers, same tab and hosts', () => {
    const r = frameUaRule(42, 155, 'full', 'tabwide');
    const w = uaRule(42, 155, 'full');
    expect(r.id).toBe(UA_RULE_ID);
    expect(r.priority).toBe(w.priority);
    expect(r.action).toEqual(w.action);
    expect(r.condition.tabIds).toEqual([42]);
    expect(r.condition.requestDomains).toEqual(['www.instagram.com', 'i.instagram.com']);
    expect(r.condition.resourceTypes).not.toContain('main_frame');
    expect(r.condition.resourceTypes).toEqual(ALL_RESOURCE_TYPES.filter((t) => t !== 'main_frame'));
    expect(FRAME_TABWIDE_TYPES).toContain('sub_frame');
    expect(FRAME_TABWIDE_TYPES).toContain('xmlhttprequest');
  });

  it('1001 document (U1): sub_frame only', () => {
    const r = frameUaRule(7, 155, 'full', 'document');
    expect(r.condition.resourceTypes).toEqual(['sub_frame']);
    if (r.action.type !== 'modifyHeaders') throw new Error('expected modifyHeaders');
    expect(r.action.requestHeaders?.[0]).toEqual({
      header: 'user-agent',
      operation: 'set',
      value: androidReducedUa(155),
    });
  });

  it('1001 refuses tab -1 and implausible majors, like uaRule', () => {
    expect(() => frameUaRule(-1, 155, 'full', 'tabwide')).toThrow(RangeError);
    expect(() => frameUaRule(3, 0, 'full', 'tabwide')).toThrow(RangeError);
  });

  it('1020 removes x-frame-options from www sub_frame responses of one tab, and nothing else', () => {
    expect(xfoRule(42)).toEqual({
      id: 1020,
      priority: 1,
      action: { type: 'modifyHeaders', responseHeaders: [{ header: 'x-frame-options', operation: 'remove' }] },
      condition: { tabIds: [42], requestDomains: ['www.instagram.com'], resourceTypes: ['sub_frame'] },
    });
    expect(() => xfoRule(-1)).toThrow(RangeError);
    const action = xfoRule(1).action;
    expect(JSON.stringify(action)).not.toMatch(/content-security-policy|sec-fetch|origin/i);
  });

  it('1021 (owner-approved forge, AM47): sets only sec-fetch-dest: document on www sub_frame requests of one tab', () => {
    expect(fetchDestRule(42)).toEqual({
      id: 1021,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'sec-fetch-dest', operation: 'set', value: 'document' }],
      },
      condition: { tabIds: [42], requestDomains: ['www.instagram.com'], resourceTypes: ['sub_frame'] },
    });
    expect(() => fetchDestRule(-1)).toThrow(RangeError);
    expect(() => fetchDestRule(1.5)).toThrow(RangeError);
    // Nothing else is forged: not Sec-Fetch-Site/Mode, Origin or Referer, and no response header.
    expect(JSON.stringify(fetchDestRule(1).action)).not.toMatch(
      /sec-fetch-(?:site|mode|user)|origin|referer|responseHeaders/i,
    );
  });

  it('every id is inside the cleanup range 1001–1029, and no two rules of a run share one', () => {
    const run = [frameUaRule(5, 155, 'full', 'tabwide'), xfoRule(5), fetchDestRule(5), ...rehearsalRules(5)];
    const ids = run.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(SESSION_RULE_IDS).toContain(id);
    expect(XFO_RULE_ID).toBe(1020);
    expect(FETCH_DEST_RULE_ID).toBe(1021);
    expect(SESSION_RULE_LAST_ID).toBe(1029);
    expect(SESSION_RULE_IDS).toHaveLength(29);
  });
});
