/**
 * U32 (docs/inpage.md §9.2): the frame's URL classification and the order that tells FRAME_REFUSED from an
 * off-host kill; the page's own URL during a run (F8).
 */
import { describe, expect, it } from 'vitest';
import { type FrameLoadFacts, frameLoadVerdict, frameUrlVerdict, pageUrlVerdict } from './frame-verdict.ts';

const HOME = 'https://www.instagram.com/';
const loaded = (over: Partial<FrameLoadFacts> = {}): FrameLoadFacts => ({
  loaded: true,
  readable: true,
  path: '/',
  status: 200,
  error: null,
  urls: [HOME],
  timedOut: false,
  ...over,
});

describe('U32 the engine frame opens', () => {
  it('a readable www home is open', () => {
    expect(frameLoadVerdict(loaded())).toEqual({ kind: 'ok' });
  });

  it('XFO refused (no rule 1020): the error page is FRAME_REFUSED, never an off-host kill', () => {
    const v = frameLoadVerdict(loaded({ readable: false, path: null, error: 'net::ERR_BLOCKED_BY_RESPONSE' }));
    expect(v).toMatchObject({ kind: 'stop', code: 'FRAME_REFUSED' });
    expect(frameLoadVerdict(loaded({ readable: false, path: null, error: null }))).toMatchObject({
      kind: 'stop',
      code: 'FRAME_REFUSED',
    });
  });

  it('a 403 framed document, or no load within the budget, is FRAME_REFUSED', () => {
    expect(frameLoadVerdict(loaded({ status: 403 }))).toMatchObject({ code: 'FRAME_REFUSED', detail: 'HTTP 403' });
    expect(
      frameLoadVerdict(loaded({ loaded: false, readable: false, path: null, status: null, timedOut: true })),
    ).toMatchObject({ code: 'FRAME_REFUSED' });
  });

  it('what Instagram sent wins: an off-host redirect kills even though the frame then shows an error page', () => {
    const v = frameLoadVerdict(
      loaded({
        readable: false,
        path: null,
        urls: [HOME, 'https://accountscenter.instagram.com/'],
        error: 'net::ERR_NAME_NOT_RESOLVED',
      }),
    );
    expect(v).toMatchObject({ kind: 'kill', code: 'KILLED_OFFHOST' });
  });

  it('a challenge redirect kills, a login redirect stops', () => {
    expect(
      frameLoadVerdict(loaded({ urls: [HOME, 'https://www.instagram.com/challenge/?next=%2F'], path: '/challenge/' })),
    ).toMatchObject({
      kind: 'kill',
      code: 'KILLED_CHALLENGE',
    });
    expect(
      frameLoadVerdict(
        loaded({ urls: [HOME, 'https://www.instagram.com/accounts/login/?next=%2F'], path: '/accounts/login/' }),
      ),
    ).toMatchObject({
      kind: 'stop',
      code: 'NOT_LOGGED_IN',
    });
  });

  it('an unexpected www page stops without a lock', () => {
    expect(frameLoadVerdict(loaded({ path: '/consent/' }))).toMatchObject({ kind: 'stop', code: 'UNEXPECTED_PAGE' });
  });
});

describe('U32 later frame URLs (classifyComposerUrl, unchanged)', () => {
  it.each([
    [HOME, 'ok'],
    ['https://www.instagram.com/create/story/', 'ok'],
    ['https://www.instagram.com/challenge/', 'kill'],
    ['https://www.instagram.com/accounts/edit/', 'kill'],
    ['https://www.instagram.com/accounts/login/', 'stop'],
    ['https://accountscenter.instagram.com/', 'kill'],
    [undefined, 'kill'],
    ['https://www.instagram.com/explore/', 'stop'],
  ])('%s → %s', (url, kind) => {
    expect(frameUrlVerdict(url).kind).toBe(kind);
  });
});

describe('U32 the page itself during a run (F8, §3.14 source 4)', () => {
  it('a security page kills and locks whoever navigated; login stops; another host is PAGE_LEFT', () => {
    expect(pageUrlVerdict('https://www.instagram.com/challenge/?next=%2F')).toMatchObject({
      kind: 'kill',
      code: 'KILLED_CHALLENGE',
    });
    for (const path of [
      'checkpoint/',
      'auth_platform/codeentry/',
      'accounts/suspended/?next=%2F',
      'accounts/disabled/',
    ]) {
      expect(pageUrlVerdict(`https://www.instagram.com/${path}`), path).toMatchObject({
        kind: 'kill',
        code: 'KILLED_CHALLENGE',
      });
    }
    expect(pageUrlVerdict('https://www.instagram.com/accounts/login/')).toMatchObject({
      kind: 'stop',
      code: 'NOT_LOGGED_IN',
    });
    expect(pageUrlVerdict('https://example.com/')).toMatchObject({ kind: 'stop', code: 'PAGE_LEFT' });
    expect(pageUrlVerdict(undefined)).toMatchObject({ kind: 'stop', code: 'PAGE_LEFT' });
  });

  it('same-document route changes of the desktop page change nothing', () => {
    for (const url of [HOME, 'https://www.instagram.com/fake_owner/', 'https://www.instagram.com/explore/']) {
      expect(pageUrlVerdict(url)).toBeNull();
    }
  });

  it('RL-1: Settings, Edit profile and the other settings routes under /accounts are ordinary pages, no kill', () => {
    for (const path of [
      'accounts/edit/',
      'accounts/notifications/',
      'accounts/privacy_and_security/',
      'accounts/password/change/',
      'accounts/close_friends/',
      'accounts/settings/v2/',
    ]) {
      expect(pageUrlVerdict(`https://www.instagram.com/${path}`), path).toBeNull();
    }
    // The frame (msite, driven by instapost) still fails closed on every /accounts path.
    expect(frameUrlVerdict('https://www.instagram.com/accounts/edit/').kind).toBe('kill');
    // Signing up is the logged-out page, not a security check.
    expect(pageUrlVerdict('https://www.instagram.com/accounts/emailsignup/')).toMatchObject({
      kind: 'stop',
      code: 'NOT_LOGGED_IN',
    });
  });
});
