/**
 * U18 (ux.md §6): the outcome rules O1–O10, fed with the entry shapes the autopilot spike measured in CfT
 * 155 and Chromium 156 (2026-10-13): a 200 JSON publish, 400, 500, a 302 to a login page (200 text/html,
 * redirect timestamps set), a reset (status 0, no content type), a 200 upload through CORS, a blocked or
 * cut-off upload (status 0). "Posted" is never returned for a redirect, HTML, status 0 or a 5xx.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyEntry,
  DEFAULT_BUDGETS,
  decide,
  decideLate,
  normalizePath,
  nothingPosted,
  sawWrite,
  scaledBudgets,
} from './outcome.ts';
import type { NetEntry, WindowedSession } from './state.ts';

const UPLOAD = '/rupload_igphoto/fb_uploader_1760352000000';
const PUBLISH = '/api/v1/media/configure_to_story/';

/** The spike's shapes (offsets in ms after the Share click). */
const upload = (status: number, end = 1500, over: Partial<NetEntry> = {}): NetEntry => ({
  host: 'i',
  path: UPLOAD,
  status,
  type: status === 0 ? '' : 'application/json',
  redirected: false,
  start: 100,
  end,
  ...over,
});
const publish = (status: number, end = 2500, over: Partial<NetEntry> = {}): NetEntry => ({
  host: 'www',
  path: PUBLISH,
  status,
  type: status === 0 ? '' : 'application/json; charset=utf-8',
  redirected: false,
  start: 1600,
  end,
  ...over,
});
const other = (path = '/graphql/query', status = 200): NetEntry => ({
  host: 'www',
  path,
  status,
  type: 'application/json',
  redirected: false,
  start: 10,
  end: 50,
});

describe('U18 classifyEntry and normalizePath', () => {
  it('knows Instagram’s two write requests by host and path', () => {
    expect(classifyEntry(upload(200))).toBe('upload');
    expect(classifyEntry(publish(200))).toBe('publish');
    expect(classifyEntry({ host: 'www', path: '/api/v1/media/configure_to_story' })).toBe('publish');
    // The same paths on another host are not Instagram's requests.
    expect(classifyEntry({ host: 'other', path: PUBLISH })).toBe('other');
    expect(classifyEntry({ host: 'www', path: UPLOAD })).toBe('other');
    expect(classifyEntry({ host: 'i', path: '/rupload_igvideo/fb_uploader_1' })).toBe('other');
    expect(classifyEntry({ host: 'i', path: '/rupload_igphoto/fb_uploader_x1' })).toBe('other');
    expect(classifyEntry(other())).toBe('other');
  });

  it('records paths with every digit run as <n>', () => {
    expect(normalizePath(UPLOAD)).toBe('/rupload_igphoto/fb_uploader_<n>');
    expect(normalizePath('/api/v1/users/12345/info/')).toBe('/api/v<n>/users/<n>/info/');
    expect(normalizePath('x'.repeat(300))).toHaveLength(200);
  });
});

describe('U18 decide: a post (writes not blocked)', () => {
  it('O1: publish 2xx JSON, not redirected → posted (whatever went home)', () => {
    expect(decide([upload(200), publish(200)], 3000, false)).toMatchObject({ kind: 'posted' });
    expect(decide([upload(200), publish(201)], 3000, false).kind).toBe('posted');
    // The upload's status may be unreadable (no CORS headers exposed): the publish decides.
    expect(decide([upload(0), publish(200)], 3000, false).kind).toBe('posted');
    expect(decide([publish(200, 100, { type: 'application/x-javascript+json' })], 200, false).kind).toBe('posted');
  });

  it('O2: publish 4xx, not redirected → not posted', () => {
    expect(decide([upload(200), publish(400)], 3000, false)).toMatchObject({
      kind: 'notPosted',
      detail: expect.stringContaining('publish 400'),
    });
    expect(decide([upload(200), publish(403)], 3000, false).kind).toBe('notPosted');
  });

  it('O3: 5xx, status 0, HTML or redirected → couldn’t confirm, never posted', () => {
    expect(decide([upload(200), publish(500)], 3000, false)).toMatchObject({
      kind: 'unknown',
      why: 'configure-5xx',
      mayRun: false,
    });
    expect(decide([upload(200), publish(0)], 3000, false)).toMatchObject({ kind: 'unknown', why: 'configure-0' });
    // The spike's 302 to a login page: 200 text/html with the redirect timestamps set.
    const login = publish(200, 2600, { type: 'text/html', redirected: true });
    expect(decide([upload(200), login], 3000, false)).toMatchObject({ kind: 'unknown', why: 'redirected' });
    expect(decide([upload(200), publish(200, 2600, { type: 'text/html' })], 3000, false)).toMatchObject({
      kind: 'unknown',
      why: 'configure-html',
    });
    expect(decide([upload(200), publish(200, 2600, { type: '' })], 3000, false).kind).toBe('unknown');
    expect(decide([upload(200), publish(304)], 3000, false).kind).toBe('unknown');
  });

  it('O4: no publish; the last upload ended non-2xx more than 3 s ago → not posted', () => {
    expect(decide([upload(500, 1000)], 3500, false).kind).toBe('pending');
    expect(decide([upload(500, 1000)], 4100, false)).toMatchObject({ kind: 'notPosted', detail: 'upload 500' });
    // A blocked or CORS-failed upload is status 0: Instagram's client never publishes after it.
    expect(decide([upload(0, 1000)], 4100, false).kind).toBe('notPosted');
  });

  it('O5: no publish 75 s after a 2xx upload → couldn’t confirm, an upload may run (held)', () => {
    expect(decide([upload(200, 1000)], 75_000, false).kind).toBe('pending');
    expect(decide([upload(200, 1000)], 76_000, false)).toMatchObject({
      kind: 'unknown',
      why: 'no-finalize-after-upload',
      mayRun: true,
    });
  });

  it('O6: no upload 120 s after Share → couldn’t confirm (an upload may still run: it has no timeout)', () => {
    expect(decide([other()], 119_999, false).kind).toBe('pending');
    expect(decide([other()], 120_000, false)).toMatchObject({ kind: 'unknown', why: 'no-upload-seen', mayRun: true });
    expect(decide([], 120_000, false).kind).toBe('unknown');
  });

  it('O7: two uploads or two publishes raise DUPLICATE_UPLOAD and the first publish decides', () => {
    const d = decide([upload(200), upload(200, 1800), publish(200, 2500), publish(400, 2900)], 3000, false);
    expect(d).toMatchObject({ kind: 'posted', alarms: ['DUPLICATE_UPLOAD'] });
    expect(decide([upload(200), publish(400, 2500), publish(200, 2900)], 3000, false).kind).toBe('notPosted');
  });

  it('never returns posted for a redirect, HTML, status 0 or a 5xx, whatever else was seen', () => {
    const bad: NetEntry[] = [
      publish(200, 2500, { redirected: true }),
      publish(200, 2500, { type: 'text/html; charset=utf-8' }),
      publish(0),
      publish(500),
      publish(502),
      publish(503, 2500, { type: 'application/json' }),
    ];
    for (const p of bad) {
      for (const elapsed of [2600, 80_000, 200_000]) {
        expect(decide([upload(200), p, other()], elapsed, false).kind, JSON.stringify(p)).not.toBe('posted');
      }
    }
  });

  it('other requests never decide anything', () => {
    expect(decide([other(), other('/ajax/bz', 500)], 5000, false).kind).toBe('pending');
  });
});

describe('U18 decide: a test with writes blocked (O9, O10)', () => {
  it('O9: a blocked upload (status 0) and no publish within the settle → share test passed', () => {
    expect(decide([upload(0, 1000)], 3500, true).kind).toBe('pending');
    expect(decide([upload(0, 1000)], 4000, true)).toMatchObject({ kind: 'shareTested', detail: 'upload 0' });
  });

  it('O10: any publish request, or a 2xx upload → TEST_LEAK', () => {
    expect(decide([upload(0), publish(0)], 4000, true).kind).toBe('testLeak');
    expect(decide([upload(200)], 4000, true)).toMatchObject({ kind: 'testLeak', detail: 'upload 200' });
    expect(decide([publish(200)], 100, true).kind).toBe('testLeak');
  });

  it('no upload at all within the budget: couldn’t confirm, nothing held', () => {
    expect(decide([], 120_000, true)).toMatchObject({ kind: 'unknown', why: 'no-upload-seen', mayRun: false });
  });

  it('AP-8: O9 passes only on status 0; an upload that reached a server (4xx, 5xx) is not blocked', () => {
    for (const status of [403, 400, 500, 503]) {
      expect(decide([upload(status, 1000)], 3500, true).kind).toBe('pending');
      expect(decide([upload(status, 1000)], 4000, true)).toMatchObject({
        kind: 'unknown',
        why: 'not-blocked',
        detail: `upload ${status}`,
        mayRun: false,
      });
    }
    expect(decide([upload(0, 1000)], 4000, true)).toMatchObject({ kind: 'shareTested', detail: 'upload 0' });
    // A blocked first attempt does not hide a later one that got through to a server.
    expect(decide([upload(0, 900), upload(403, 1000)], 4000, true)).toMatchObject({ why: 'not-blocked' });
  });
});

describe('U18 late answers, budgets, and the "Nothing was posted" rule', () => {
  it('a held Couldn’t confirm upgrades only on a deciding answer (O1, O2, O4)', () => {
    expect(decideLate([upload(200), publish(200)])?.kind).toBe('posted');
    expect(decideLate([upload(200), publish(400)])?.kind).toBe('notPosted');
    expect(decideLate([upload(500)])?.kind).toBe('notPosted');
    expect(decideLate([upload(200)])).toBeNull();
    expect(decideLate([upload(200), publish(500)])).toBeNull();
  });

  it('a guarded E2E scale shrinks the 75/120 s budgets; anything else keeps them', () => {
    expect(scaledBudgets(undefined)).toEqual(DEFAULT_BUDGETS);
    expect(scaledBudgets(1)).toEqual(DEFAULT_BUDGETS);
    expect(scaledBudgets(0)).toEqual(DEFAULT_BUDGETS);
    expect(scaledBudgets(0.01)).toMatchObject({ uploadEntryMs: 1200, publishAfterUploadMs: 750 });
    expect(decide([], 1300, false, scaledBudgets(0.01)).kind).toBe('unknown');
  });

  it('nothingPosted: only without a Share, or with one the agent refused, and no write seen', () => {
    const base: Pick<WindowedSession, 'shareSent' | 'shareRefused' | 'sharedBy' | 'net'> = {
      shareSent: false,
      shareRefused: null,
      sharedBy: null,
      net: [],
    };
    expect(nothingPosted(base)).toBe(true);
    expect(nothingPosted({ ...base, shareSent: true })).toBe(false);
    expect(nothingPosted({ ...base, shareSent: true, shareRefused: 'controls' as const })).toBe(true);
    expect(nothingPosted({ ...base, sharedBy: 'owner' as const })).toBe(false);
    expect(nothingPosted({ ...base, net: [upload(0)] })).toBe(false);
    expect(nothingPosted({ ...base, net: [other()] })).toBe(true);
    expect(sawWrite([other(), publish(200)])).toBe(true);
  });
});
