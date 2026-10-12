/**
 * U14 (strategy §7.11): classifies stop, kill, composer-left and ok for login, /challenge/,
 * /checkpoint/, accountscenter, undefined, /create/story/ and /, plus the edge cases the kill
 * switch must not get wrong (other schemes, ports, userinfo, look-alike paths). AM17: security
 * paths under /auth_platform and /accounts kill; www paths other than / are unknown-left.
 */
import { describe, expect, it } from 'vitest';
import { classifyComposerUrl, igPath, isComposerUrl, type UrlVerdict } from './urls.ts';

const OK: UrlVerdict = { kind: 'ok' };
const STOP: UrlVerdict = { kind: 'stop', code: 'NOT_LOGGED_IN' };
const CHALLENGE: UrlVerdict = { kind: 'kill', code: 'KILLED_CHALLENGE' };
const OFFHOST: UrlVerdict = { kind: 'kill', code: 'KILLED_OFFHOST' };
const LEFT: UrlVerdict = { kind: 'composer-left' };
const UNKNOWN: UrlVerdict = { kind: 'unknown-left' };

describe('U14 classifyComposerUrl', () => {
  it.each<[string | undefined, UrlVerdict]>([
    // The spec's list.
    ['https://www.instagram.com/accounts/login/', STOP],
    ['https://www.instagram.com/challenge/', CHALLENGE],
    ['https://www.instagram.com/checkpoint/', CHALLENGE],
    ['https://accountscenter.instagram.com/', OFFHOST],
    [undefined, OFFHOST],
    ['https://www.instagram.com/create/story/', OK],
    ['https://www.instagram.com/', LEFT],
    // Login variants.
    ['https://www.instagram.com/accounts/login/?next=%2Fcreate%2Fstory%2F', STOP],
    ['https://www.instagram.com/accounts/login', STOP],
    ['https://www.instagram.com/accounts/login/two_factor?next=/', STOP],
    ['https://www.instagram.com/Accounts/Login/', STOP],
    // AM17: every other /accounts path is an account flow or interstitial: kill, never "composer left".
    ['https://www.instagram.com/accounts/edit/', CHALLENGE],
    ['https://www.instagram.com/accounts/loginx/', CHALLENGE],
    ['https://www.instagram.com/accounts/suspended/?next=%2Fcreate%2Fstory%2F', CHALLENGE],
    ['https://www.instagram.com/accounts/disabled/', CHALLENGE],
    ['https://www.instagram.com/accounts/onetap/', CHALLENGE],
    ['https://www.instagram.com/Accounts/Suspended/', CHALLENGE],
    ['https://www.instagram.com/accounts', CHALLENGE],
    ['https://www.instagram.com/auth_platform/codeentry/?apc=abc', CHALLENGE],
    ['https://www.instagram.com/AUTH_PLATFORM/', CHALLENGE],
    ['https://www.instagram.com/accountsx/', UNKNOWN],
    // Challenge variants.
    ['https://www.instagram.com/challenge/action/AbC123/?next=%2F', CHALLENGE],
    ['https://www.instagram.com/challenge', CHALLENGE],
    ['https://www.instagram.com/checkpoint/1234/', CHALLENGE],
    ['https://www.instagram.com/CHALLENGE/', CHALLENGE],
    ['https://www.instagram.com/challenges/', UNKNOWN],
    // Off-host and other schemes.
    ['https://www.facebook.com/', OFFHOST],
    ['https://i.instagram.com/create/story/', OFFHOST],
    ['https://instagram.com/create/story/', OFFHOST],
    ['http://www.instagram.com/create/story/', OFFHOST],
    ['https://www.instagram.com:8443/create/story/', OFFHOST],
    ['https://user@www.instagram.com/create/story/', OFFHOST],
    ['https://www.instagram.com.evil.example/create/story/', OFFHOST],
    ['about:blank', OFFHOST],
    ['chrome-error://chromewebdata/', OFFHOST],
    ['', OFFHOST],
    ['not a url', OFFHOST],
    // Composer paths.
    ['https://www.instagram.com/create/story', OK],
    ['https://www.instagram.com/create/story/?ref=x#y', OK],
    ['https://www.instagram.com/create/story/edit/', OK],
    ['https://WWW.INSTAGRAM.COM/create/story/', OK],
    ['https://www.instagram.com/create/storyboard/', UNKNOWN],
    ['https://www.instagram.com/create/', UNKNOWN],
    // AM17: only home is "composer left"; every other www page fails closed.
    ['https://www.instagram.com/someone/', UNKNOWN],
    ['https://www.instagram.com/consent/?flow=x', UNKNOWN],
    ['https://www.instagram.com/explore/', UNKNOWN],
    ['https://www.instagram.com', LEFT],
    ['https://www.instagram.com/?variant=following', LEFT],
    ['https://www.instagram.com/#x', LEFT],
  ])('%s', (url, verdict) => {
    expect(classifyComposerUrl(url)).toEqual(verdict);
  });

  it('igPath and isComposerUrl agree with the classifier', () => {
    expect(igPath('https://www.instagram.com')).toBe('/');
    expect(igPath('https://www.instagram.com/a/b?c#d')).toBe('/a/b');
    expect(igPath('https://example.com/')).toBeNull();
    expect(isComposerUrl('https://www.instagram.com/create/story/')).toBe(true);
    expect(isComposerUrl('https://www.instagram.com/')).toBe(false);
    expect(isComposerUrl(undefined)).toBe(false);
  });
});
