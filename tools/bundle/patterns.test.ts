/**
 * T3 self-test (§11 AM26, FID-2/FID-3): every forbidden pattern check-bundle.ts relies on fires on
 * the code it is meant to catch, and stays silent on what the built bundles legitimately contain.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_ONLY,
  BACKGROUND_ONLY,
  EDITOR_ONLY,
  EVERY_BUNDLE,
  FAKE_TESTID,
  forbiddenDispatches,
  forbiddenEditorFetches,
  hits,
  WRITE_STRINGS,
} from './patterns.ts';

describe('T3 patterns: composer-agent.js', () => {
  it.each([
    ['el.click()', '.click'],
    ['HTMLElement.prototype.click.call(el)', '.click'],
    ['e["click"]()', '"click"'],
    ["el.dispatchEvent(new Event('click',{bubbles:true}))", '"click"'],
    ['form.requestSubmit()', 'requestSubmit/submit()'],
    ['form.submit()', 'requestSubmit/submit()'],
    ['new MouseEvent("mousedown")', 'MouseEvent'],
    ['new PointerEvent("pointerdown")', 'PointerEvent'],
    ['new KeyboardEvent("keydown")', 'KeyboardEvent'],
    ['new DragEvent("drop")', 'DragEvent'],
    ['new TouchEvent("touchstart")', 'TouchEvent'],
    ['DOM.setFileInputFiles', 'setFileInputFiles'],
    ['fetch(url)', 'fetch('],
    ['new XMLHttpRequest()', 'XMLHttpRequest'],
    ['navigator.sendBeacon(u)', 'sendBeacon'],
    ['new WebSocket(u)', 'WebSocket'],
    ['new EventSource(u)', 'EventSource'],
    ['localStorage.setItem("a","b")', 'storage'],
    ['sessionStorage.setItem("a","b")', 'storage'],
    ['chrome.storage.local.get("x")', 'storage'],
    ['indexedDB.open("x")', 'indexedDB'],
    ['document.cookie="a=b"', 'document.cookie'],
    ['caches.open("x")', 'caches.'],
    ['document.documentElement.dataset.fakeReady', 'fake hooks'],
    ['el.getAttribute("data-fake-ua")', 'fake hooks'],
    ['fetch("/__fake__/api/knobs")', 'fake hooks'],
  ])('%s → %s', (code, label) => {
    expect(hits(code, AGENT_ONLY)).toContain(label);
  });

  it('stays silent on the agent’s own code (minified insert, marker, probes)', () => {
    const allowed = [
      't.files=r.files,t.dispatchEvent(new e.Event(`input`,{bubbles:!0,composed:!0})),t.dispatchEvent(new e.Event(`change`,{bubbles:!0,composed:!0}))',
      'n.querySelector(`meta[name="instapost-fake-instagram"]`)!==null',
      'e.runtime.sendMessage(t)',
      'e.navigator.serviceWorker?.addEventListener(`controllerchange`,()=>n.controllerChanged())',
      'el.checkVisibility({opacityProperty:!0,visibilityProperty:!0})',
    ].join(';');
    expect(hits(allowed, AGENT_ONLY)).toEqual([]);
    expect(forbiddenDispatches(allowed)).toEqual([]);
  });

  it('allows only input and change events to be dispatched', () => {
    expect(forbiddenDispatches("el.dispatchEvent(new win.Event('change',{bubbles:true}))")).toEqual([]);
    expect(forbiddenDispatches("el.dispatchEvent(new Event('submit'))")).toHaveLength(1);
    expect(forbiddenDispatches('el.dispatchEvent(new e.CustomEvent(`input`))')).toHaveLength(1);
    expect(forbiddenDispatches('el.dispatchEvent(ev)')).toHaveLength(1);
    expect(forbiddenDispatches("el.dispatchEvent(new FocusEvent('focus'))")).toHaveLength(1);
  });
});

describe('T3 patterns: every bundle, background.js, editor chunks', () => {
  it.each([
    ['signed_body=x', 'signed_body'],
    ['ig_sig_key_version', 'ig_sig_key_version'],
    ['"X-IG-App-ID"', 'x-ig-'],
    ['x-csrftoken', 'x-csrftoken'],
    ['chrome.debugger.attach', 'chrome.debugger'],
    ['{world:"MAIN"}', 'world:"MAIN"'],
    ['dataset.fakeGeometry', 'fakeGeometry'],
    ['dataset.fakeReady', 'fakeReady'],
    ['dataset.fakeInput', 'fakeInput'],
    ['data-testid="fake-share"', 'data-testid="fake-'],
  ])('every bundle: %s → %s', (code, label) => {
    expect(hits(code, EVERY_BUNDLE)).toContain(label);
  });

  it.each([
    ['fetch("https://graph.instagram.com/")', 'fetch('],
    ['new XMLHttpRequest', 'XMLHttpRequest'],
    ['navigator.sendBeacon(u,b)', 'sendBeacon'],
    ['new WebSocket(u)', 'WebSocket'],
    ['new EventSource(u)', 'EventSource'],
  ])('background.js: %s → %s', (code, label) => {
    expect(hits(code, BACKGROUND_ONLY)).toContain(label);
  });

  it('background.js may name the composer URL and use storage', () => {
    const allowed = '`https://www.instagram.com/create/story/`;await t.storage[e].get(r)';
    expect(hits(allowed, BACKGROUND_ONLY)).toEqual([]);
  });

  it('editor chunks: no Meta URLs and no fetch beyond Vite’s modulepreload polyfill', () => {
    expect(hits('img.src="https://static.cdninstagram.com/x.png"', EDITOR_ONLY)).toContain('Meta host URL');
    expect(hits('fetch(`https://www.facebook.com/tr`)', EDITOR_ONLY)).toContain('Meta host URL');
    expect(hits('new XMLHttpRequest()', EDITOR_ONLY)).toContain('XMLHttpRequest');
    expect(forbiddenEditorFetches('fetch(`https://graph.instagram.com/`)')).toHaveLength(1);
    expect(forbiddenEditorFetches('fetch(url,{mode:"no-cors"})')).toHaveLength(1);
    // What the built chunk contains today.
    const chunk = ';e.ep=!0;let n=t(e);fetch(e.href,n)}})();createElementNS(`http://www.w3.org/2000/svg`,e)';
    expect(hits(chunk, EDITOR_ONLY)).toEqual([]);
    expect(forbiddenEditorFetches(chunk)).toEqual([]);
  });

  it('write strings and fake test ids', () => {
    expect(hits('`||instagram.com/rupload_igphoto/`', WRITE_STRINGS)).toEqual(['rupload_ig']);
    expect(hits('/api/v1/media/configure_to_story/', WRITE_STRINGS)).toEqual(['configure_to']);
    expect(FAKE_TESTID.test('[data-testid="fake-share"]')).toBe(true);
    expect(FAKE_TESTID.test('getByTestId("editor-post-desktop")')).toBe(false);
  });
});
