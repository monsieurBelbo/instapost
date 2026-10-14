/**
 * T3 self-test (§11 AM26, FID-2/FID-3): every forbidden pattern check-bundle.ts relies on fires on
 * the code it is meant to catch, and stays silent on what the built bundles legitimately contain.
 */
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { portraitShim } from '../../src/agent/portrait-shim.ts';
import {
  AGENT_ONLY,
  agentClickProblems,
  BACKGROUND_ONLY,
  backgroundMainWorldProblems,
  E2E_HOOK_MARKERS,
  E2E_HOOKS,
  EDITOR_ONLY,
  EVERY_BUNDLE,
  EXECUTION_WORLD,
  EXECUTION_WORLD_MAIN,
  FAKE_TESTID,
  forbiddenDispatches,
  forbiddenEditorFetches,
  hits,
  MAIN_WORLD,
  PORTRAIT_SHIM_MARKER,
  portraitShimRunProblems,
  portraitShimSource,
  sameBlock,
  TAP_MARKER,
  WRITE_STRINGS,
} from './patterns.ts';

describe('T3 patterns: composer-agent.js', () => {
  it.each([
    // ux.md IT1: clicks other than the audited helper's own `.click()` (agentClickProblems checks that one).
    ['HTMLElement.prototype.click.call(el)', '.click.call/apply/bind'],
    ['HTMLElement.prototype.click.call(el)', 'prototype.click'],
    ['el.click.apply(el)', '.click.call/apply/bind'],
    ['e["click"]()', '["click"]'],
    ['e[`click`]()', '["click"]'],
    // No file chooser, no focus, no navigation of Instagram's page.
    ['input.showPicker()', 'showPicker'],
    ['el.focus()', '.focus('],
    ['location.assign(u)', 'location.assign/replace'],
    ['window.location.replace(u)', 'location.assign/replace'],
    ['location.href="/create/story/"', 'location.href='],
    ['history.pushState({},"",u)', 'history.pushState/replaceState'],
    ['history.replaceState(null,"")', 'history.pushState/replaceState'],
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
    // SH-4: a script element is the agent's way into the page's MAIN world.
    ['document.createElement("script")', 'createElement("script")'],
    ['e.createElement(`SCRIPT`)', 'createElement("script")'],
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
      // Reading where the page is (never changing it).
      'e.location.pathname===`/`',
      'n.location.href===r',
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

/** The audited helper as the agent bundle ships it: tap.ts, minified by esbuild. */
const shippedTap = (): string =>
  transformSync(readFileSync(new URL('../../src/agent/tap.ts', import.meta.url), 'utf8'), {
    loader: 'ts',
    minify: true,
  }).code;

/** A minified stand-in for the bundle around the helper. */
const HELPER =
  'function tp(e,t,n){if(n.b[e]>=3)return{ok:!1};n.b[e]++;t.click();return{ok:!0,kind:e,via:`instapost:tap`}}';
const LISTENER =
  'function oc(e,t,n){let r=new e.AbortController;t.addEventListener(`click`,i=>{r.abort()},{capture:!0,once:!0,signal:r.signal})}';

describe('T3 the one audited click (ux.md IT1, agentClickProblems)', () => {
  it('passes the shipped tap.ts: one .click() returning the marker, one capture-phase click listener', () => {
    const code = shippedTap();
    expect(code).toContain(TAP_MARKER);
    expect(agentClickProblems(code)).toEqual([]);
    expect(hits(code, AGENT_ONLY)).toEqual([]);
  });

  it('passes the minified helper and listener in a larger bundle', () => {
    expect(agentClickProblems(`var a=1;${HELPER};x();${LISTENER};y()`)).toEqual([]);
  });

  it('a second click site fails, wherever it is', () => {
    expect(agentClickProblems(`${HELPER};${LISTENER};function z(e){e.click()}`)).toEqual([
      expect.stringContaining('exactly one .click() call'),
    ]);
  });

  it('the one .click() outside the helper’s block fails', () => {
    const moved = 'function z(e){e.click()}function tp(e){return{ok:!0,kind:e,via:`instapost:tap`}}';
    expect(agentClickProblems(`${moved};${LISTENER}`)).toEqual([expect.stringContaining('not in the tap helper')]);
    // The marker before the click does not count either.
    const before = 'function tp(e,t){let v=`instapost:tap`;t.click();return v}';
    expect(agentClickProblems(`${before};${LISTENER}`)).toEqual([expect.stringContaining('not in the tap helper')]);
  });

  it('the marker missing or repeated fails', () => {
    expect(agentClickProblems(`${HELPER.replace('instapost:tap', 'x')};${LISTENER}`)).toEqual([
      expect.stringContaining('marker'),
    ]);
    expect(agentClickProblems(`${HELPER};${LISTENER};let m=\`instapost:tap\``)).toEqual([
      expect.stringContaining('marker'),
    ]);
  });

  it('a click listener without capture, or a second click listener, fails', () => {
    const bubbling = LISTENER.replace('capture:!0,', '');
    expect(agentClickProblems(`${HELPER};${bubbling}`)).toEqual([expect.stringContaining('does not set capture')]);
    expect(agentClickProblems(`${HELPER};${LISTENER};${LISTENER}`)).toEqual([
      expect.stringContaining('exactly one "click" string'),
    ]);
  });

  it('a string-keyed click, a click event, or .click read as a value fails', () => {
    expect(agentClickProblems(`${HELPER};${LISTENER};e["click"]()`).join(' ')).toContain('"click" string');
    expect(agentClickProblems(`${HELPER};el.dispatchEvent(new Event(\`click\`))`)).toEqual([
      expect.stringContaining('not addEventListener'),
    ]);
    expect(agentClickProblems(`${HELPER};${LISTENER};let f=el.click;f()`)).toEqual([
      expect.stringContaining('other than as a call'),
    ]);
  });

  it('sameBlock: a closing brace between the two positions ends the block; strings and comments do not', () => {
    const t = '{a();b("}");/* } */c()}d()';
    expect(sameBlock(t, 1, t.indexOf('c()'))).toBe(true);
    expect(sameBlock(t, 1, t.indexOf('d()'))).toBe(false);
  });
});

describe('T3 patterns: every bundle, background.js, editor chunks', () => {
  it.each([
    ['signed_body=x', 'signed_body'],
    ['ig_sig_key_version', 'ig_sig_key_version'],
    ['"X-IG-App-ID"', 'x-ig-'],
    ['x-csrftoken', 'x-csrftoken'],
    ['chrome.debugger.attach', 'chrome.debugger'],
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
    // ux.md IT2: the background never clicks anything.
    ['t.click()', '.click('],
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

describe('T3 patterns: one MAIN-world injection, the portrait shim, in background.js only (AM37)', () => {
  /** The built background.js as of 2026-10-12 (both modes): the shim's call and the shim's body. */
  const SHIM_BODY =
    'function r(e,t=screen){let n=t.orientation;if(!n)return{type:null,shim:`absent`};let r=Symbol.for(`portrait-shim`),i=Object.getOwnPropertyDescriptor(n,`type`);return{type:String(n.type),shim:`installed`}}';
  const AGENT_CALL =
    'async injectComposerAgent(e){return{fresh:(await t.scripting.executeScript({target:{tabId:e,frameIds:[0]},files:[`/composer-agent.js`]}))?.[0]?.result!==!1}}';
  const SHIM_CALL =
    'async injectPortraitShim(e,n){return Ne((await t.scripting.executeScript({target:{tabId:e,frameIds:[0]},world:`MAIN`,injectImmediately:!0,func:r,args:[n]}))?.[0]?.result)}';
  const BACKGROUND = `${SHIM_BODY};var He={${AGENT_CALL},${SHIM_CALL}};`;

  const WORLD_KEY = 'world: not "ISOLATED"';

  it('MAIN_WORLD fires on every world key but a quoted ISOLATED: literals, the enum, variables (SH-4)', () => {
    for (const code of [
      '{world:"MAIN"}',
      '{world:`MAIN`}',
      "{'world': 'MAIN'}",
      '{ world : "MAIN" }',
      // SH-4: `world: browser.scripting.ExecutionWorld.MAIN`, minified, and other non-literal values.
      '{target:{tabId:e},world:t.scripting.ExecutionWorld.MAIN,func:()=>1}',
      '{world:t.scripting.ExecutionWorld["MAIN"]}',
      '{world:n.MAIN}',
      '{world:w}',
      '{world:a?`MAIN`:`ISOLATED`}',
      '{"world":x.replace(`ISOLATED`,`MAIN`)}',
    ]) {
      expect(hits(code, [MAIN_WORLD]), code).toEqual([WORLD_KEY]);
    }
    expect(hits('{world:`ISOLATED`}', [MAIN_WORLD])).toEqual([]);
    expect(hits('{"world":"ISOLATED"}', [MAIN_WORLD])).toEqual([]);
    // Not a world key: an identifier that merely ends in "world".
    expect(hits('{helloworld:1,newWorld:2}', [MAIN_WORLD])).toEqual([]);
  });

  it('the ExecutionWorld enum: MAIN dotted or bracketed, and any mention outside background.js (SH-4)', () => {
    for (const code of [
      't.scripting.ExecutionWorld.MAIN',
      't.scripting.ExecutionWorld . MAIN',
      't.scripting.ExecutionWorld["MAIN"]',
      't.scripting.ExecutionWorld[`MAIN`]',
    ]) {
      expect(hits(code, [EXECUTION_WORLD_MAIN]), code).toEqual(['ExecutionWorld.MAIN']);
    }
    expect(hits('t.scripting.ExecutionWorld.ISOLATED', [EXECUTION_WORLD_MAIN])).toEqual([]);
    expect(hits('t.scripting.ExecutionWorld.ISOLATED', [EXECUTION_WORLD])).toEqual(['ExecutionWorld']);
    // registerContentScripts with the enum, as an editor chunk might write it: three hits.
    const registered =
      't.scripting.registerContentScripts([{id:"x",world:t.scripting.ExecutionWorld.MAIN,js:["a.js"],matches:["*://*/*"]}])';
    expect(hits(registered, [MAIN_WORLD, EXECUTION_WORLD, ...EVERY_BUNDLE])).toEqual([
      WORLD_KEY,
      'ExecutionWorld',
      'registerContentScripts',
    ]);
  });

  it('the built background.js passes: one MAIN-world call, shaped as the shim’s, and the shim’s body once', () => {
    expect(backgroundMainWorldProblems(BACKGROUND)).toEqual([]);
    // The same with quoted keys and `true` (another minifier).
    const spelled =
      'executeScript({"target":{"tabId":e,"frameIds":[0]},"world":"MAIN","injectImmediately":true,"func":r,"args":[n]})';
    expect(backgroundMainWorldProblems(`${SHIM_BODY};${spelled}`)).toEqual([]);
  });

  it.each([
    ['no MAIN-world call at all', `${SHIM_BODY};${AGENT_CALL}`, /exactly one non-ISOLATED world key.*found 0/],
    ['a second MAIN-world call', `${BACKGROUND}${SHIM_CALL}`, /exactly one non-ISOLATED world key.*found 2/],
    // SH-4: a second, broader call spelled with the enum (every frame, a file).
    [
      'a second MAIN-world call spelled with the ExecutionWorld enum',
      `${BACKGROUND};async function x(e){await t.scripting.executeScript({target:{tabId:e,allFrames:!0},world:t.scripting.ExecutionWorld.MAIN,files:["evil.js"]})}`,
      /found 2[\s\S]*ExecutionWorld\.MAIN found 1[\s\S]*not the literal "MAIN"/,
    ],
    [
      'the shim’s own call spelled with the enum',
      `${SHIM_BODY};${SHIM_CALL.replace('world:`MAIN`', 'world:t.scripting.ExecutionWorld.MAIN')}`,
      /ExecutionWorld\.MAIN found 1[\s\S]*not the literal "MAIN"/,
    ],
    [
      'a MAIN world from a variable',
      `${BACKGROUND};var w=\`MAIN\`;t.scripting.executeScript({target:{tabId:e,frameIds:[0]},world:w,injectImmediately:!0,func:r})`,
      /found 2[\s\S]*not the literal "MAIN"/,
    ],
    [
      'MAIN world outside an executeScript call',
      `${SHIM_BODY};registerContentScripts([{id:"x",world:"MAIN",js:["a.js"]}])`,
      /outside an executeScript call/,
    ],
    [
      'without the known marker injectImmediately',
      `${SHIM_BODY};${SHIM_CALL.replace('injectImmediately:!0,', '')}`,
      /lacks injectImmediately:true/,
    ],
    [
      'a file instead of the func',
      `${SHIM_BODY};${SHIM_CALL.replace('func:r,args:[n]', 'files:[`/x.js`]')}`,
      /lacks func:.*|has files:/,
    ],
    ['every frame', `${SHIM_BODY};${SHIM_CALL.replace('frameIds:[0]', 'allFrames:!0')}`, /lacks frameIds:\[0\]/],
    [
      'frames other than the top one',
      `${SHIM_BODY};${SHIM_CALL.replace('frameIds:[0]', 'frameIds:[0,3]')}`,
      /lacks frameIds:\[0\]/,
    ],
    [
      'documents instead of a tab',
      `${SHIM_BODY};${SHIM_CALL.replace('{tabId:e,frameIds:[0]}', '{documentIds:[d]}')}`,
      /lacks target:\{tabId|has documentIds/,
    ],
    [
      'the shim’s body missing',
      `var He={${AGENT_CALL},${SHIM_CALL}};`,
      /portrait shim's body \(portrait-shim\) once, found 0/,
    ],
    ['the shim’s body twice', `${SHIM_BODY};${BACKGROUND}`, /portrait shim's body \(portrait-shim\) once, found 2/],
  ])('fails: %s', (_name, text, expected) => {
    const problems = backgroundMainWorldProblems(text);
    expect(problems.join('\n')).toMatch(expected);
  });

  it('elsewhere (composer-agent.js, editor chunks) any MAIN-world call is a hit, the shim’s call included', () => {
    expect(hits(SHIM_CALL, [MAIN_WORLD])).toEqual([WORLD_KEY]);
    expect(hits(AGENT_CALL, [MAIN_WORLD])).toEqual([]);
    expect(SHIM_BODY.includes(PORTRAIT_SHIM_MARKER)).toBe(true);
    // The rest of EVERY_BUNDLE never mentions it: background.js gets its own check instead.
    expect(hits(SHIM_CALL, EVERY_BUNDLE)).toEqual([]);
  });
});

describe('T3 the shipped portrait shim runs on its own, as executeScript serialises it (SH-2)', () => {
  /** The 2026-10-12 build's shim (before SH-2: no try around the reads). */
  const SHIM_2026_10_12 =
    'function r(e,t=screen){let n=t.orientation;if(!n)return{type:null,shim:`absent`};let r=Symbol.for(`portrait-shim`),i=Object.getOwnPropertyDescriptor(n,`type`);if(i){let e=typeof i.get==`function`&&i.get[r]===!0?`present`:`failed`;return{type:String(n.type),shim:e}}let a=String(n.type);if(a.startsWith(`portrait`))return{type:a,shim:`portrait`};if(!e)return{type:a,shim:`off`};try{let e=()=>`portrait-primary`;Object.defineProperty(e,r,{value:!0}),Object.defineProperty(n,"angle",{get:()=>0,enumerable:!0,configurable:!0}),Object.defineProperty(n,"type",{get:e,enumerable:!0,configurable:!0})}catch{return{type:String(n.type),shim:`failed`}}return{type:String(n.type),shim:`installed`}}';
  /** A background.js around a shim function named `name`, with the shim's call passing it. */
  const background = (fn: string, name: string): string =>
    `var background=(function(){function e(e){return e}${fn};var r=1;function q(e){function ${name}(t){return t}return ${name}}var He={async injectPortraitShim(e,n){return Ne((await t.scripting.executeScript({target:{tabId:e,frameIds:[0]},world:\`MAIN\`,injectImmediately:!0,func:${name},args:[n]}))?.[0]?.result)}};})();`;
  /** The current source of the shim, as a transpiler emits it. */
  const current = portraitShim.toString();

  it('cuts the shim’s function out of background.js by the call’s `func` and the marker', () => {
    const found = portraitShimSource(background(SHIM_2026_10_12, 'r'));
    expect(found).toEqual({ source: SHIM_2026_10_12 });
    // Another function of the same minified name, without the marker, is not it.
    expect(portraitShimSource(background(current, 'portraitShim'))).toEqual({ source: current });
  });

  it('the current shim gives every expected reading in a bare realm', () => {
    expect(portraitShimRunProblems(current)).toEqual([]);
  });

  it('fails closed: a throw before the try (the 2026-10-12 shim on a tampered getter)', () => {
    expect(portraitShimRunProblems(SHIM_2026_10_12)).toEqual(['a getter that throws: threw page tampered']);
  });

  it('a bundler helper outside or inside the try is caught (keepNames’ `__name`)', () => {
    const outside = current.replace('{', '{ __name(portraitShim, "portraitShim");');
    expect(portraitShimRunProblems(outside).join('\n')).toMatch(/threw __name is not defined/);
    const inside = current.replace('try {', 'try { __name(scr, "scr");');
    expect(inside).not.toBe(current);
    const problems = portraitShimRunProblems(inside);
    // Inside the try the throw is swallowed into a `failed` reading, which no expected reading has.
    expect(problems.join('\n')).toMatch(/landscape screen: got \{"type":null,"shim":"failed"\}/);
  });

  it('a page global other than `screen` is a free identifier there too', () => {
    const windowed = current.replace('try {', 'try { void window.innerWidth;');
    expect(portraitShimRunProblems(windowed)).not.toEqual([]);
  });

  it.each([
    ['no func identifier (an inline function)', background(SHIM_2026_10_12, 'r').replace('func:r', 'func:()=>1')],
    ['the func’s declaration without the marker', background('function z(){}', 'r')],
    ['no MAIN-world call', SHIM_2026_10_12],
  ])('reports a bundle it cannot read: %s', (_name, text) => {
    expect('problem' in portraitShimSource(text)).toBe(true);
  });
});

describe('T3 patterns: the guarded-only E2E hooks never reach the live build (F2)', () => {
  it.each([
    ['(await t.storage.local.get(`__e2eWindowQuirk`)).__e2eWindowQuirk', '__e2e flag'],
    ['e.get(`__e2eResizeTimeoutMs`)', '__e2e flag'],
    ['(await t.storage.local.get(`__e2ePortraitShimOff`)).__e2ePortraitShimOff===!0', '__e2e flag'],
    ['[`none`,`arc`,`arcLate`,`ignoreAll`]', 'quirk arcLate'],
    ['n===`ignoreAll`', 'quirk ignoreAll'],
    ['e.get(`__e2eDwellScale`)', '__e2e flag'],
    ['e.get(`__e2eBudgetScale`)', '__e2e flag'],
  ])('%s → %s', (code, label) => {
    expect(hits(code, E2E_HOOKS)).toContain(label);
  });

  it('the markers the mock background must carry are what E2E_HOOKS catches', () => {
    for (const m of E2E_HOOK_MARKERS) expect(hits(m, E2E_HOOKS)).toContain('__e2e flag');
  });

  it('stays silent on the live background’s own window code (state normal, bounds changes)', () => {
    const live =
      'await e.windows.create({type:`popup`,url:`about:blank`,focused:!0,state:`normal`,...t});e.windows.onBoundsChanged.addListener(n)';
    expect(hits(live, E2E_HOOKS)).toEqual([]);
  });
});
