/**
 * docs/inpage.md §10.4: the content script ⇄ background ⇄ panel messages are shape-checked, and a content
 * script message counts only from frame 0 of the run's tab on www; the panel port only from our own framed
 * page. Also the frame watch (webRequest → the engine frame's id, URLs, XFO, errors; N9).
 */
import { describe, expect, it } from 'vitest';
import { createFrameWatch } from './frame-watch.ts';
import {
  acceptPageMessage,
  acceptPageUiMessage,
  isAttachReply,
  isBackgroundToPage,
  isOpenFrameReply,
  isOwnFramedPage,
  isPanelToBackground,
  toToggles,
  toUiPrefs,
} from './messages.ts';

const RID = 'jehchapoghccaofddgdkakdkjijmknhk';
const page = { id: RID, tab: { id: 3 }, frameId: 0, url: 'https://www.instagram.com/explore/' };
const loaded = { v: 1, type: 'inpage/frame-loaded', runId: 'inp_1', readable: true, path: '/' };

describe('in-page messages', () => {
  it('a frame report is the run’s only from frame 0 of its tab on www, with its runId', () => {
    const run = { tabId: 3, runId: 'inp_1' };
    expect(acceptPageMessage(loaded, page, RID, run)).toMatchObject({ ok: true, tabId: 3 });
    expect(acceptPageMessage(loaded, { ...page, frameId: 4 }, RID, run)).toMatchObject({ ok: false, reason: 'frame' });
    expect(acceptPageMessage(loaded, { ...page, tab: { id: 9 } }, RID, run)).toMatchObject({
      ok: false,
      reason: 'no-run',
    });
    expect(acceptPageMessage(loaded, { ...page, url: 'https://evil.example/' }, RID, run)).toMatchObject({
      ok: false,
      reason: 'origin',
    });
    expect(acceptPageMessage(loaded, { ...page, id: 'other' }, RID, run)).toMatchObject({
      ok: false,
      reason: 'sender-id',
    });
    expect(acceptPageMessage({ ...loaded, runId: 'inp_2' }, page, RID, run)).toMatchObject({
      ok: false,
      reason: 'run',
    });
    expect(acceptPageMessage({ ...loaded, path: 'no-slash' }, page, RID, run)).toMatchObject({
      ok: false,
      reason: 'shape',
    });
    expect(acceptPageMessage(loaded, page, RID, null)).toMatchObject({ ok: false, reason: 'no-run' });
  });

  it('commands to the page and the panel are shape-checked', () => {
    expect(isBackgroundToPage({ v: 1, type: 'inpage/open-frame', runId: 'inp_1', frame: 'auto', view: 'phone' })).toBe(
      true,
    );
    expect(
      isBackgroundToPage({ v: 1, type: 'inpage/open-frame', runId: 'inp_1', frame: '9999x1', view: 'phone' }),
    ).toBe(false);
    expect(isBackgroundToPage({ v: 1, type: 'inpage/unload-guard', runId: 'inp_1', on: true })).toBe(true);
    expect(isBackgroundToPage({ v: 1, type: 'inpage/navigate', url: 'https://x' })).toBe(false);
    expect(isPanelToBackground({ v: 1, type: 'run/start', mode: 'test', confirmShare: false })).toBe(true);
    // A post carries the export: PNG or JPEG base64; anything else is refused at the port.
    const photo = { mime: 'image/png', b64: 'AAECAwQF', sample: null };
    expect(isPanelToBackground({ v: 1, type: 'run/start', mode: 'post', confirmShare: false, photo })).toBe(true);
    expect(
      isPanelToBackground({
        v: 1,
        type: 'run/start',
        mode: 'post',
        confirmShare: false,
        photo: { ...photo, mime: 'text/html' },
      }),
    ).toBe(false);
    expect(
      isPanelToBackground({
        v: 1,
        type: 'run/start',
        mode: 'post',
        confirmShare: false,
        photo: { ...photo, b64: 'abc' },
      }),
    ).toBe(false);
    expect(isPanelToBackground({ v: 1, type: 'run/start', mode: 'publish', confirmShare: false })).toBe(false);
    // RL-13: the export's hashes (hex SHA-256) ride along for the duplicate guard; anything else is refused.
    const hashed = { ...photo, sha256: 'a'.repeat(64), docHash: 'b'.repeat(64) };
    expect(isPanelToBackground({ v: 1, type: 'run/start', mode: 'post', confirmShare: false, photo: hashed })).toBe(
      true,
    );
    expect(
      isPanelToBackground({
        v: 1,
        type: 'run/start',
        mode: 'post',
        confirmShare: false,
        photo: { ...hashed, sha256: 'x' },
      }),
    ).toBe(false);
    expect(isPanelToBackground({ v: 1, type: 'ui/mark', runId: 'inp_1a-2', mark: 'posted' })).toBe(true);
    expect(isPanelToBackground({ v: 1, type: 'ui/mark', runId: 'inp_1', mark: 'maybe' })).toBe(false);
    expect(isPanelToBackground({ v: 1, type: 'ui/mark', runId: '../x', mark: 'notPosted' })).toBe(false);
    expect(isOpenFrameReply({ ok: true, box: { w: 540, h: 960 }, dpr: 2, scale: 0.8 })).toBe(true);
    expect(isOpenFrameReply({ ok: false, why: 'x' })).toBe(true);
    expect(isOpenFrameReply({ ok: true })).toBe(false);
  });

  it('the panel port: our id, a chrome-extension: URL (dynamic host allowed), inside a tab', () => {
    const dyn = 'chrome-extension://09fb8aff-c7fb-41a8-a826-dc75676359b1/composer.html';
    expect(isOwnFramedPage({ id: RID, tab: { id: 3 }, url: dyn }, RID)).toBe(true);
    expect(isOwnFramedPage({ id: RID, tab: { id: 3 }, url: 'https://www.instagram.com/' }, RID)).toBe(false);
    expect(isOwnFramedPage({ id: RID, url: dyn }, RID)).toBe(false);
    expect(isOwnFramedPage({ id: 'other', tab: { id: 3 }, url: dyn }, RID)).toBe(false);
  });

  it('toggles fall back to the defaults value by value', () => {
    expect(toToggles(undefined)).toEqual({
      ua: 'tabwide',
      frame: 'auto',
      view: 'phone',
      xfoRule: 'on',
      fetchDest: 'document',
    });
    expect(toToggles({ ua: 'document', frame: '412x732', view: 'covered', xfoRule: 'off' })).toEqual({
      ua: 'document',
      frame: '412x732',
      view: 'covered',
      xfoRule: 'off',
      fetchDest: 'document',
    });
    expect(toToggles({ ua: 'all', frame: 1, view: 'hidden' })).toMatchObject({
      ua: 'tabwide',
      frame: 'auto',
      view: 'phone',
    });
  });
});

describe('frame watch (webRequest, §3.14 source 1)', () => {
  const base = { tabId: 3, parentFrameId: 0 };
  it('the first www sub_frame of the top frame in the run tab is the engine frame; others are counted (N9)', () => {
    const w = createFrameWatch();
    expect(w.onEvent({ kind: 'before', ...base, frameId: 9, url: 'https://www.instagram.com/' })).toBeNull();
    w.arm(3);
    expect(
      w.onEvent({ kind: 'before', tabId: 4, parentFrameId: 0, frameId: 1, url: 'https://www.instagram.com/' }),
    ).toBeNull();
    expect(
      w.onEvent({ kind: 'before', tabId: 3, parentFrameId: 2, frameId: 1, url: 'https://www.instagram.com/' }),
    ).toBeNull();
    expect(w.onEvent({ kind: 'before', ...base, frameId: 9, url: 'https://www.instagram.com/' })).toEqual({
      kind: 'frame-id',
      frameId: 9,
    });
    expect(w.onEvent({ kind: 'before', ...base, frameId: 11, url: 'https://www.instagram.com/x' })).toBeNull();
    expect(
      w.onEvent({ kind: 'headers', ...base, frameId: 9, url: 'https://www.instagram.com/', status: 200, xfo: 'DENY' }),
    ).toBeNull();
    expect(
      w.onEvent({ kind: 'completed', ...base, frameId: 9, url: 'https://www.instagram.com/', status: 200 }),
    ).toEqual({
      kind: 'settled',
    });
    expect(w.onEvent({ kind: 'before', ...base, frameId: 9, url: 'https://www.instagram.com/challenge/' })).toEqual({
      kind: 'navigated',
      url: 'https://www.instagram.com/challenge/',
    });
    const s = w.snapshot();
    expect(s).toMatchObject({ frameId: 9, status: 200, xfoSeen: 'DENY', otherSubFrames: 1, settled: true });
    expect(s.urls).toEqual(['https://www.instagram.com/', 'https://www.instagram.com/challenge/']);
  });

  it('a redirect off host is reported with its target; an error settles the first load', () => {
    const w = createFrameWatch();
    w.arm(3);
    w.onEvent({ kind: 'before', ...base, frameId: 9, url: 'https://www.instagram.com/' });
    expect(
      w.onEvent({
        kind: 'redirect',
        ...base,
        frameId: 9,
        url: 'https://www.instagram.com/',
        redirectUrl: 'https://accountscenter.instagram.com/',
        status: 302,
      }),
    ).toEqual({ kind: 'redirect', url: 'https://accountscenter.instagram.com/' });
    expect(
      w.onEvent({
        kind: 'error',
        ...base,
        frameId: 9,
        url: 'https://accountscenter.instagram.com/',
        error: 'net::ERR_NAME_NOT_RESOLVED',
      }),
    ).toEqual({
      kind: 'settled',
    });
    expect(w.snapshot().urls).toEqual(['https://www.instagram.com/', 'https://accountscenter.instagram.com/']);
  });

  it('the in-page UI messages (FI4) are shape-checked; the page’s count only from frame 0 on www', () => {
    const composer = { v: 1, type: 'inpage/composer', mode: 'chip', compact: false, closing: false };
    expect(acceptPageUiMessage(composer, page, RID)).toMatchObject({ ok: true, tabId: 3 });
    expect(acceptPageUiMessage(composer, { ...page, frameId: 2 }, RID)).toMatchObject({ ok: false, reason: 'frame' });
    expect(acceptPageUiMessage({ ...composer, mode: 'huge' }, page, RID)).toMatchObject({ ok: false, reason: 'shape' });
    expect(
      acceptPageUiMessage({ v: 1, type: 'inpage/page', scheme: 'dark', loggedIn: true, handle: 'a b' }, page, RID),
    ).toMatchObject({ ok: false, reason: 'shape' });
    expect(isBackgroundToPage({ v: 1, type: 'inpage/ui', action: 'hide' })).toBe(true);
    expect(isBackgroundToPage({ v: 1, type: 'inpage/ui', action: 'navigate' })).toBe(false);
    expect(isBackgroundToPage({ v: 1, type: 'inpage/preview', preview: 'large' })).toBe(true);
    expect(isPanelToBackground({ v: 1, type: 'ui/view-story', handle: 'owner.name' })).toBe(true);
    expect(isPanelToBackground({ v: 1, type: 'ui/view-story', handle: '../evil' })).toBe(false);
    expect(isPanelToBackground({ v: 1, type: 'ui/request', action: 'close', auto: true })).toBe(true);
    expect(toUiPrefs({ entry: 'none', preview: 'bogus', coachSeen: true })).toEqual({
      entry: 'none',
      preview: 'small',
      coachSeen: true,
      repost: true,
    });
    expect(toUiPrefs({ repost: false }).repost).toBe(false);
  });

  it('inpage/attach: the content script asks before touching the page; the answer is a boolean', () => {
    expect(acceptPageUiMessage({ v: 1, type: 'inpage/attach' }, page, RID)).toMatchObject({ ok: true, tabId: 3 });
    expect(acceptPageUiMessage({ v: 1, type: 'inpage/attach' }, { ...page, frameId: 1 }, RID)).toMatchObject({
      ok: false,
      reason: 'frame',
    });
    expect(
      acceptPageUiMessage({ v: 1, type: 'inpage/attach' }, { ...page, url: 'https://i.instagram.com/' }, RID),
    ).toMatchObject({ ok: false, reason: 'origin' });
    expect(isAttachReply({ attach: false })).toBe(true);
    expect(isAttachReply({ attach: 'no' })).toBe(false);
    expect(isAttachReply(null)).toBe(false);
  });
});
