/**
 * Hand-off panel texts (strategy §3.10, §11 AM28): what the owner is told, and what is not pre-answered.
 * U1/U2 (2026-10-12): the diagnostics rows and the guided resize.
 */
import { describe, expect, test } from 'vitest';
import { ERROR_CODES } from '../core/handoff/state.ts';
import type { ProbeReport } from '../core/ig-contract/contract.ts';
import {
  browserText,
  errorDetail,
  errorText,
  fallbackText,
  PHASE_LABEL,
  pageText,
  pickText,
  postedPrompt,
  RESIZE_TEXT,
  resizeSizeText,
  resizeText,
  screenText,
  secondsLeft,
  serviceWorkerText,
  storyInputText,
  windowText,
} from './messages.ts';

describe('AM28 hand-off panel texts', () => {
  test('"Posted?" has a primary answer only when detection gave one', () => {
    expect(postedPrompt({ detected: true, unknown: false, answer: null })).toEqual({
      hint: 'It looks like you tapped Share.',
      primary: true,
    });
    expect(postedPrompt({ detected: false, unknown: false, answer: null })).toEqual({
      hint: 'No Share was detected.',
      primary: false,
    });
    // An unknown page after Share, or an unconfirmed insert: neither button primary, no "not detected".
    const unknown = postedPrompt({ detected: false, unknown: true, answer: null });
    expect(unknown.primary).toBeNull();
    expect(unknown.hint).not.toMatch(/No Share was detected/);
    expect(unknown.hint).toMatch(/Share may have been tapped/);
    // The owner's answer always wins.
    expect(postedPrompt({ detected: false, unknown: true, answer: true })).toEqual({
      hint: 'Recorded as posted.',
      primary: true,
    });
  });

  test('after a possible Share the fallback never invites a second post from the phone blindly', () => {
    expect(fallbackText('UNEXPECTED_PAGE', 'a.png')).toMatch(/post it from the phone/);
    const after = fallbackText('UNEXPECTED_PAGE', 'a.png', true);
    expect(after).toMatch(/^Check the story on the phone before posting it again/);
    expect(after).not.toMatch(/post it from the phone/);
  });

  test('an unexpected page is named', () => {
    expect(errorDetail('UNEXPECTED_PAGE', 'page /consent/')).toBe('It went to /consent/.');
    expect(errorDetail('UNEXPECTED_PAGE', undefined)).toBeNull();
    expect(errorDetail('AGENT_UNREACHABLE', 'installRules: quota')).toBeNull();
  });

  test('the branded-browser refusal says what happened, not that a page was opened', () => {
    const text = errorText('BRANDED_BROWSER');
    expect(text).toMatch(/Google Chrome, Microsoft Edge or Arc/);
    expect(text).toMatch(/no composer window was opened/);
    expect(text).not.toMatch(/not the fake/);
    expect(errorText('GUARD_NOT_FAKE')).toMatch(/not the fake/);
  });

  test('the 30 s navigation deadline is not reported as 15 minutes of inactivity', () => {
    expect(errorText('NAVIGATION_TIMEOUT')).toMatch(/30 seconds/);
    expect(errorText('NAVIGATION_TIMEOUT')).not.toMatch(/15 minutes/);
    expect(errorText('TIMEOUT')).toMatch(/15 minutes/);
  });

  test('every error code has a text, and finished does not claim the window closed', () => {
    for (const code of ERROR_CODES) expect(errorText(code).length).toBeGreaterThan(10);
    expect(PHASE_LABEL.finished).toBe('Composer left');
  });
});

describe('U1 diagnostics rows (2026-10-12)', () => {
  const probe = (over: Partial<ProbeReport> = {}): ProbeReport => ({
    marker: false,
    isMobile: true,
    inner: { w: 524, h: 932 },
    dpr: 2,
    portrait: true,
    swControlled: true,
    swIntercepted: false,
    navType: 'reload',
    storyInput: 'present',
    acceptOk: true,
    acceptSeen: ['image/avif,image/jpeg,image/png'],
    lang: 'en',
    ...over,
  });

  test('storyInputText: none, none image-only, present, differs; "changed" only for a decided drift', () => {
    expect(storyInputText(probe({ storyInput: 'absent', acceptOk: false, acceptSeen: [] }), 'fail', false)).toBe(
      'none (no file input on the page)',
    );
    expect(
      storyInputText(
        probe({ storyInput: 'absent', acceptOk: false, acceptSeen: ['image/jpeg,image/png,video/mp4'] }),
        'fail',
        false,
      ),
    ).toBe('none image-only (file inputs: image/jpeg,image/png,video/mp4)');
    expect(storyInputText(probe(), 'pass', false)).toBe('present');
    const differs = probe({ acceptOk: false, acceptSeen: ['image/jpeg,image/png,video/mp4', 'image/jpeg,image/heic'] });
    expect(storyInputText(differs, 'fail', false)).toBe('present, accept list differs: image/jpeg,image/heic');
    expect(storyInputText(differs, 'fail', true)).toBe('present, accept list changed: image/jpeg,image/heic');
    expect(storyInputText(probe({ acceptSeen: [''], storyInput: 'absent', acceptOk: false }), 'fail', false)).toBe(
      'none image-only (file inputs: (no accept list))',
    );
  });

  test('the failed live run: no input at 1512 px wide, decided by DESKTOP_SHELL → "not checked", never "changed"', () => {
    const live = probe({
      inner: { w: 1512, h: 902 },
      portrait: false,
      storyInput: 'absent',
      acceptOk: false,
      acceptSeen: [],
    });
    const text = storyInputText(live, 'unknown', false);
    expect(text).toBe('none (no file input on the page) (not checked: stopped before this step)');
    expect(text).not.toMatch(/accept list changed/);
  });

  test('pageText names the route and the path', () => {
    expect(pageText('homeOnly', '/')).toMatch(/^\/ \(home: Instagram's usual landing/);
    expect(pageText('direct', '/create/story/')).toBe('/create/story/ (the story composer directly)');
    expect(pageText(undefined, undefined)).toBe('unknown');
    expect(pageText('homeOnly', undefined)).toMatch(/^\/ /);
  });

  test('AF-9: the note follows the path probed, not C5’s route (a later page re-probed strictly)', () => {
    // The reload landed home (C5 homeOnly), then a later document on the composer decided.
    const composer = pageText('homeOnly', '/create/story/');
    expect(composer).toBe('/create/story/ (the story composer, opened from home)');
    expect(composer).not.toMatch(/home: Instagram's usual landing/);
    // The reload landed on the composer (C5 direct), then a later document on home decided.
    expect(pageText('direct', '/')).toBe("/ (home: Instagram's usual landing, tap + → Story there)");
    expect(pageText('direct', '/')).not.toMatch(/composer directly/);
    expect(pageText(undefined, '/create/story/x/')).toBe('/create/story/x/ (the story composer)');
    expect(pageText('homeOnly', '/consent/')).toBe('/consent/');
  });

  test('windowText: requested against actual, attempts, a resize by hand, a create that ignored its bounds', () => {
    const base = {
      screen: { availLeft: 1512, availTop: -428, availWidth: 3440, availHeight: 1410 },
      requested: { left: 2970, top: -229, width: 524, height: 1012 },
      created: { left: 1831, top: 13, width: 1512, height: 949 },
      createdTab: { w: 1512, h: 902 },
      frameDelta: { w: 0, h: 47 },
      updates: [
        {
          step: 'fit' as const,
          box: { left: 2970, top: -212, width: 524, height: 979 },
          target: { w: 524, h: 932 },
          outer: { left: 1831, top: 13, width: 1512, height: 949 },
          tab: { w: 1512, h: 902 },
          fitted: false,
        },
      ],
      attempts: 2,
      manualResize: true,
      finalTab: { w: 493, h: 820 },
      zoom: 1,
    };
    expect(windowText(base)).toBe(
      'asked 524×932, got 493×820 (2 attempts; resized by you; opened at 1512×949 instead of 524×1012)',
    );
    expect(
      windowText({ ...base, created: base.requested, attempts: 1, manualResize: false, finalTab: { w: 524, h: 932 } }),
    ).toBe('asked 524×932, got 524×932 (1 attempt)');
    // W2 hardening: Arc dropped the first updates; the re-applies within the one attempt are shown.
    const reapplied = { ...base.updates[0], fitted: true, applied: 3 } as (typeof base.updates)[number];
    expect(
      windowText({
        ...base,
        updates: [reapplied],
        attempts: 1,
        manualResize: false,
        finalTab: { w: 524, h: 932 },
      }),
    ).toBe(
      'asked 524×932, got 524×932 (1 attempt, size re-applied: 3 updates; opened at 1512×949 instead of 524×1012)',
    );
  });

  test('AF-7: the Window row says "refitted once" only when the refit was honoured', () => {
    const fit = {
      step: 'fit' as const,
      box: { left: 2970, top: -212, width: 524, height: 979 },
      target: { w: 524, h: 932 },
      outer: { left: 2970, top: -212, width: 524, height: 979 },
      tab: { w: 524, h: 932 },
      fitted: true,
    };
    const refit = { ...fit, step: 'refit' as const, target: { w: 524, h: 932 } };
    const w = {
      screen: { availLeft: 1512, availTop: -428, availWidth: 3440, availHeight: 1410 },
      requested: { left: 2970, top: -229, width: 524, height: 1012 },
      created: { left: 2970, top: -229, width: 524, height: 1012 },
      createdTab: { w: 524, h: 965 },
      frameDelta: { w: 0, h: 47 },
      updates: [fit, refit],
      attempts: 1,
      manualResize: false,
      finalTab: { w: 524, h: 932 },
      zoom: 1,
    };
    expect(windowText(w)).toBe('asked 524×932, got 524×932 (1 attempt; refitted once)');
    // E24's second case: the refit was dropped too, and the session ended LAYOUT_TOO_WIDE.
    const refused = {
      ...w,
      updates: [
        { ...fit, fitted: false },
        { ...refit, fitted: false, tab: { w: 900, h: 1332 } },
      ],
      manualResize: true,
      finalTab: { w: 900, h: 1332 },
    };
    const text = windowText(refused);
    expect(text).toBe('asked 524×932, got 900×1332 (1 attempt; resized by you; refit not honoured)');
    expect(text).not.toMatch(/refitted once/);
  });

  test('AF-10: DESKTOP_SHELL names the is_mobile it read; "unknown" on a later page is not "false"', () => {
    expect(errorText('DESKTOP_SHELL')).not.toMatch(/is_mobile/);
    expect(errorText('DESKTOP_SHELL')).toMatch(/desktop site/);
    expect(errorDetail('DESKTOP_SHELL', undefined, false)).toBe('The page said is_mobile false.');
    const unknown = errorDetail('DESKTOP_SHELL', undefined, 'unknown');
    expect(unknown).toMatch(/no is_mobile flag at all/);
    expect(unknown).not.toMatch(/is_mobile false/);
    expect(errorDetail('DESKTOP_SHELL', undefined, true)).toBeNull();
    expect(errorDetail('DESKTOP_SHELL', undefined)).toBeNull();
  });

  test('AF-2: the Service worker row says "intercepts requests" whenever SW_INTERCEPTS ended the session', () => {
    // The deciding probe saw no interception; the watch's tripwire did later.
    expect(serviceWorkerText(probe(), true)).toBe('intercepts requests');
    expect(serviceWorkerText(probe({ swControlled: false }), true)).toBe('intercepts requests');
    expect(serviceWorkerText(probe(), false)).toBe('controls the page — normal on Instagram');
  });

  test('AF-8: the resize instruction names the width its ✓ uses at the window’s zoom', () => {
    expect(resizeText()).toBe(RESIZE_TEXT);
    expect(resizeText(767)).toMatch(/at most 767 px wide, taller/);
    // 110%: the ✓ allows up to floor(767 × 1.1) = 843 window px; 90%: 690.
    expect(resizeText(843)).toMatch(/at most 843 px wide at this window's zoom/);
    expect(resizeText(690)).toMatch(/at most 690 px wide at this window's zoom/);
    expect(resizeText(843)).not.toMatch(/767/);
  });

  test('browserText and serviceWorkerText', () => {
    expect(browserText('arc')).toMatch(/^Arc/);
    expect(browserText('chromium')).toBe('Chromium');
    expect(serviceWorkerText(probe())).toBe('controls the page — normal on Instagram');
    expect(serviceWorkerText(probe({ swIntercepted: true }))).toBe('intercepts requests');
    expect(serviceWorkerText(probe({ swControlled: false }))).toBe('not in control');
    expect(serviceWorkerText(probe({ swIntercepted: 'unknown' }))).toMatch(/interception unknown/);
  });

  test('U2: the guided-resize indicator and its countdown', () => {
    expect(resizeSizeText({ w: 524, h: 965 }, true)).toBe('524×965 ✓');
    expect(resizeSizeText({ w: 1512, h: 902 }, false)).toBe('1512×902 ✗');
    expect(RESIZE_TEXT).toMatch(/767 px wide/);
    expect(secondsLeft(10_500, 0)).toBe(11);
    expect(secondsLeft(0, 5)).toBe(0);
    expect(PHASE_LABEL.resizing).toMatch(/narrow and tall/);
  });

  test('H0 on home says Instagram usually lands there, and how to start the story', () => {
    expect(pickText('a.png', true)).toBe(
      'Instagram opened its home page, as it usually does. In the Instagram window tap + → Story, then pick instapost/a.png.',
    );
  });

  test('the new codes have their own words', () => {
    expect(errorText('SW_INTERCEPTS')).toMatch(/handled the composer’s own requests/);
    expect(errorText('WINDOW_NOT_FITTED')).toMatch(/narrow and tall/);
    expect(errorText('LAYOUT_TOO_WIDE')).toMatch(/767/);
    expect(errorText('SW_TOOK_CONTROL')).toMatch(/only records it/);
  });
});

describe('AM37 the Screen row and SCREEN_LANDSCAPE', () => {
  test('the Screen row says what the composer reads and what the portrait shim did', () => {
    expect(screenText({ type: 'portrait-primary', shim: 'installed' })).toBe(
      'portrait-primary (portrait shim installed; the screen itself is landscape)',
    );
    expect(screenText({ type: 'portrait-primary', shim: 'present' })).toBe('portrait-primary (portrait shim in place)');
    expect(screenText({ type: 'portrait-primary', shim: 'portrait' })).toBe(
      'portrait-primary (the screen is portrait; no shim needed)',
    );
    expect(screenText({ type: null, shim: 'absent' })).toBe('unknown (the page reports no screen orientation)');
    expect(screenText({ type: 'landscape-primary', shim: 'failed' })).toBe(
      'landscape-primary (the portrait shim could not be installed)',
    );
    expect(screenText({ type: 'landscape-primary', shim: 'off' })).toBe(
      'landscape-primary (portrait shim switched off by a test flag)',
    );
  });

  test('SCREEN_LANDSCAPE says the composer hid Share, and names the reading when there is one', () => {
    expect(errorText('SCREEN_LANDSCAPE')).toMatch(/rotate the device and hid Share/);
    expect(errorText('SCREEN_LANDSCAPE')).toMatch(/portrait shim/);
    expect(
      errorDetail('SCREEN_LANDSCAPE', 'screen landscape-primary, portrait shim off', undefined, {
        type: 'landscape-primary',
        shim: 'off',
      }),
    ).toBe('The composer read landscape-primary (portrait shim switched off by a test flag).');
    expect(errorDetail('SCREEN_LANDSCAPE', undefined)).toBeNull();
    // Only SCREEN_LANDSCAPE shows the reading.
    expect(errorDetail('LANDSCAPE', undefined, undefined, { type: 'landscape-primary', shim: 'off' })).toBeNull();
  });

  test('SH-1: a shim that came after the composer mounted is named as such, not as a portrait reading', () => {
    const late = { type: 'portrait-primary', shim: 'installed', afterComposerMount: true } as const;
    expect(screenText(late)).toBe(
      'portrait-primary (portrait shim installed only after the composer had read the landscape screen)',
    );
    const extra = errorDetail(
      'SCREEN_LANDSCAPE',
      'screen portrait-primary, portrait shim installed after the composer mounted',
      undefined,
      late,
    );
    expect(extra).toMatch(
      /^The portrait shim went in only after the composer had opened and read the landscape screen/,
    );
    expect(extra).not.toMatch(/The composer read portrait/);
  });

  test('SH-2: an unreadable reading says the orientation could not be read', () => {
    expect(screenText({ type: null, shim: 'failed' })).toBe('unknown (the portrait shim could not be installed)');
    expect(
      errorDetail('SCREEN_LANDSCAPE', 'screen unknown, portrait shim failed', undefined, {
        type: null,
        shim: 'failed',
      }),
    ).toBe('The page’s screen orientation could not be read (the portrait shim could not be installed).');
  });

  test('a SCREEN_LANDSCAPE closes the window: the fallback is the phone or export, never H0 in that window', () => {
    expect(fallbackText('SCREEN_LANDSCAPE', 'a.png')).not.toMatch(/tap \+ → Story/);
  });
});
