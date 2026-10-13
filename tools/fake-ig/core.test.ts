/**
 * U16 (strategy §7.11): the fake Instagram's transport-free core, its knobs, store and
 * geometry. Never depends on src/core's parseIsMobile (U15 owns that); the UA JSON is read here
 * with JSON.parse.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import baselineJson from '../../src/core/ig-contract/baseline.json' with { type: 'json' };
import type { Baseline } from '../../src/core/ig-contract/contract.ts';
import { androidReducedUa, CH_REMOVE } from '../../src/core/ig-contract/device-profile.ts';
import { WRITE_URL_FILTERS } from '../../src/core/ig-contract/write-endpoints.ts';
import { SW_FILES } from './bundle.ts';
import { computeGeometry, coverCrop, fitAspect } from './client/geometry.ts';
import { claimOnRegisterUrl } from './client/sw.ts';
import {
  ACCEPT_CH,
  createCore,
  type FakeResponse,
  matchWriteFilter,
  normalizeHost,
  parseComposerView,
} from './core.ts';
import {
  BASELINE,
  DEFAULT_KNOBS,
  deriveKnobs,
  KNOB_CHOICES,
  KNOB_NAMES,
  type Knobs,
  parseGeometryModel,
  parseKnobPatch,
  STORY_ACCEPT_LISTS,
} from './knobs.ts';
import type { FakeBoot, FakeShareMeta } from './protocol.ts';
import { createStore, jpegSize, type StoryRecord } from './store.ts';
import { classify, type UaClassification } from './ua.ts';

const ANDROID = androidReducedUa(155);
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
const MAC_HEADLESS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const WWW = 'www.instagram.com';
const I = 'i.instagram.com';
const CERT_VALID_TO = '2026-11-10T00:00:00.000Z';
const SOURCE_HASH = 'a'.repeat(64);

/** A minimal JPEG header: SOI, APP0, SOF0 (w×h), EOI. Enough for jpegSize(). */
function fakeJpeg(w: number, h: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0, 0];
  const sof0 = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    h >> 8,
    h & 0xff,
    w >> 8,
    w & 0xff,
    0x03,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

function meta(isTrusted: boolean): FakeShareMeta {
  const geometry = {
    model: 'viewportDpr' as const,
    insets: [0, 0] as [number, number],
    inner: { w: 511, h: 909 },
    dpr: 2,
    source: { w: 1080, h: 1920 },
    canvas: { w: 1022, h: 1816 },
    css: { x: 0, y: 0, w: 511, h: 908 },
    crop: { sx: 0, sy: 0, sw: 1080, sh: 1920 },
  };
  return {
    isTrusted,
    canvas: geometry.canvas,
    css: { w: 511, h: 908 },
    dpr: 2,
    source: geometry.source,
    inner: geometry.inner,
    lang: 'en',
    knobs: { ...DEFAULT_KNOBS },
    geometry,
    path: '/create/story/',
    navigatorUa: MAC,
    sessionStarted: true,
    sessionId: '0b4f8e1c-2d5a-4c11-9a0e-6f3b7c2d1e90',
    screenOrientation: 'portrait-primary',
  };
}

function setup(dir: string | null = null) {
  const store = createStore({ dir });
  let n = 0;
  const core = createCore({
    store,
    assets: {
      clientJs: '/* client */',
      sw: {
        claimOnRegister: '/* claim-on-register */',
        desktopShell: '/* desktop-shell */',
        claimLate: '/* claim-late */',
      },
    },
    certValidTo: CERT_VALID_TO,
    sourceHash: SOURCE_HASH,
    token: () => `tok${++n}`,
  });
  const send = (method: string, host: string, path: string, headers: Record<string, string> = {}, body?: Uint8Array) =>
    core.handle({ method, host, path, headers, body });
  const get = (path: string, ua = ANDROID, extra: Record<string, string> = {}, host = WWW) =>
    send('GET', host, path, { 'user-agent': ua, ...extra });
  const postJson = (path: string, value: unknown) =>
    send('POST', WWW, path, { 'content-type': 'application/json' }, new TextEncoder().encode(JSON.stringify(value)));
  const api = <T>(name: string): T => JSON.parse(text(get(`/__fake__/api/${name}`))) as T;
  const share = (m: FakeShareMeta | null | string, body = fakeJpeg(1022, 1816), ua = ANDROID) =>
    send(
      'POST',
      WWW,
      '/__fake__/stories',
      {
        'content-type': 'image/jpeg',
        'user-agent': ua,
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        ...(m === null ? {} : { 'x-fake-meta': typeof m === 'string' ? m : JSON.stringify(m) }),
      },
      body,
    );
  return { store, core, send, get, postJson, api, share };
}

const text = (r: FakeResponse) => (typeof r.body === 'string' ? r.body : new TextDecoder().decode(r.body));
const json = <T = unknown>(r: FakeResponse) => JSON.parse(text(r)) as T;

/** The first application/json script, as C1 reads it (here with JSON.parse, not ua-json.ts). */
function firstJsonScript(html: string): { attrs: string; value: unknown } {
  const m = /<script type="application\/json"([^>]*)>(.*?)<\/script>/s.exec(html);
  if (!m) throw new Error('no application/json script');
  return { attrs: m[1] ?? '', value: JSON.parse(m[2] ?? '') };
}
const uaOf = (html: string) =>
  (firstJsonScript(html).value as { InstagramUserAgent: UaClassification }).InstagramUserAgent;
function bootOf(html: string): FakeBoot {
  const m = /<script type="application\/json" data-fake-boot>(.*?)<\/script>/s.exec(html);
  if (!m) throw new Error('no boot script');
  return JSON.parse(m[1] ?? '') as FakeBoot;
}
const FORM_FIELD_RE = /<(input|form|textarea|select|button)\b/i;

describe('U16 fake core: UA classifier', () => {
  it.each([
    ['Android reduced', ANDROID, { is_mobile: true, is_android: true, is_ios: false }],
    ['Mac Chrome', MAC, { is_mobile: false, is_android: false, is_ios: false }],
    ['Mac HeadlessChrome', MAC_HEADLESS, { is_mobile: false, is_android: false, is_ios: false }],
    ['iPhone', IPHONE, { is_mobile: true, is_android: false, is_ios: true }],
    ['iPad', IPAD, { is_mobile: true, is_android: false, is_ios: true }],
    ['empty', '', { is_mobile: false, is_android: false, is_ios: false }],
  ])('%s', (_name, ua, expected) => {
    const c = classify({ 'user-agent': ua }, 'ua');
    expect(c).toEqual({ ...expected, is_ipad: false, is_android_tablet: false, user_agent: ua });
  });

  it('client-hints classifier reads sec-ch-ua-mobile only', () => {
    expect(classify({ 'user-agent': MAC, 'sec-ch-ua-mobile': '?1' }, 'client-hints').is_mobile).toBe(true);
    expect(classify({ 'user-agent': ANDROID, 'sec-ch-ua-mobile': '?0' }, 'client-hints').is_mobile).toBe(false);
    expect(classify({ 'user-agent': ANDROID }, 'client-hints').is_mobile).toBe(false);
    // The ua classifier ignores client hints (research §5.1).
    expect(classify({ 'user-agent': MAC, 'sec-ch-ua-mobile': '?1' }, 'ua').is_mobile).toBe(false);
  });
});

describe('U16 fake core: routes and shells', () => {
  it('GET / serves the msite shell to a mobile UA', () => {
    const { get } = setup();
    const r = get('/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/^text\/html/);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['accept-ch']).toBe(ACCEPT_CH);
    const html = text(r);
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain('<script type="module" src="/fake-static/client.js"></script>');
    expect(firstJsonScript(html).attrs).toBe(' data-fake-ua');
    expect(uaOf(html)).toEqual(classify({ 'user-agent': ANDROID }, 'ua'));
    expect(bootOf(html)).toEqual({ v: 1, shell: 'msite', route: 'home', knobs: DEFAULT_KNOBS, rootId: 'root' });
  });

  it('Accept-CH asks for exactly the high-entropy hints rule 1001 removes', () => {
    expect(ACCEPT_CH.split(', ')).toEqual([...CH_REMOVE]);
  });

  it('GET / serves the desktop shell to a desktop UA', () => {
    const { get } = setup();
    const html = text(get('/', MAC));
    expect(uaOf(html).is_mobile).toBe(false);
    expect(bootOf(html).shell).toBe('desktop');
  });

  it('GET /create/story/ renders the composer route on msite with route=direct', () => {
    const { get, store } = setup();
    store.setKnobs({ route: 'direct' });
    const r = get('/create/story/');
    expect(r.status).toBe(200);
    expect(bootOf(text(r))).toMatchObject({ shell: 'msite', route: 'composer' });
  });

  it('AM35: by default (route=homeOnly, production F3) /create/story/ without media lands on /', () => {
    const { get } = setup();
    const r = get('/create/story/');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/');
    expect(bootOf(text(get('/')))).toMatchObject({ shell: 'msite', route: 'home' });
  });

  it('desktop UA on /create/story/ redirects to /', () => {
    const { get } = setup();
    const r = get('/create/story/', MAC);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/');
  });

  it('route=homeOnly redirects /create/story/ to / even on msite', () => {
    const { get, store } = setup();
    store.setKnobs({ route: 'homeOnly' });
    expect(get('/create/story/').headers.location).toBe('/');
    expect(get('/').status).toBe(200);
  });

  it('desktopComposer=desktopShell renders the desktop shell at /create/story/ instead of a 302', () => {
    const { get, store } = setup();
    store.setKnobs({ desktopComposer: 'desktopShell' });
    const r = get('/create/story/', MAC);
    expect(r.status).toBe(200);
    expect(bootOf(text(r))).toMatchObject({ shell: 'desktop', route: 'composer' });
    expect(uaOf(text(r)).is_mobile).toBe(false);
  });

  it('route=elsewhere sends the composer to an interstitial that is neither home nor a security flow', () => {
    const { get, store } = setup();
    store.setKnobs({ route: 'elsewhere' });
    expect(get('/create/story/').headers.location).toBe('/consent/');
    expect(get('/').status).toBe(200);
  });

  it('offhost=firstLoad sends the composer route itself off Instagram', () => {
    const { get, store } = setup();
    store.setKnobs({ offhost: 'firstLoad' });
    expect(get('/create/story/').headers.location).toBe('https://accountscenter.instagram.com/');
    expect(get('/', MAC).status).toBe(200);
  });

  it('/create/story without the slash redirects to the canonical route, keeping the query', () => {
    const { get } = setup();
    const r = get('/create/story?x=1');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/create/story/?x=1');
  });

  it.each([
    ['out', '/accounts/login/'],
    ['challenge', '/challenge/'],
    ['codeentry', '/auth_platform/codeentry/'],
  ] as const)('auth=%s redirects both shell routes to %s', (auth, target) => {
    const { get, store } = setup();
    store.setKnobs({ auth });
    expect(get('/').headers.location).toBe(`${target}?next=%2F`);
    expect(get('/create/story/').headers.location).toBe(`${target}?next=%2Fcreate%2Fstory%2F`);
  });

  it.each([
    '/accounts/login/',
    '/accounts/login/?next=%2F',
    '/challenge/',
    '/challenge/abc/',
    '/auth_platform/codeentry/?next=%2F',
    '/consent/',
  ])('placeholder %s has no form fields', (path) => {
    const { get, store } = setup();
    for (const locale of ['en', 'es'] as const) {
      store.setKnobs({ locale });
      const r = get(path);
      expect(r.status).toBe(200);
      const html = text(r);
      expect(html).toContain(`<html lang="${locale}">`);
      expect(html).not.toMatch(FORM_FIELD_RE);
    }
  });

  it('serves the client bundle, the beacon and the service workers (scope / allowed)', () => {
    const { get, api } = setup();
    const client = get('/fake-static/client.js');
    expect(client.status).toBe(200);
    expect(client.headers['content-type']).toMatch(/^text\/javascript/);
    expect(text(client)).toBe('/* client */');
    // The request a page sends when a worker takes control of it (the P3 tripwire reads its timing).
    const beacon = get('/fake-static/beacon?controller=1');
    expect(beacon.status).toBe(204);
    expect(api<Array<{ path: string }>>('requests').map((r) => r.path)).toContain('/fake-static/beacon?controller=1');
    for (const [path, body] of [
      ['/fake-sw/claim-on-register.js?enableAddToHomeScreen=true&zenon_device_id=abc', '/* claim-on-register */'],
      ['/fake-sw/desktop-shell.js', '/* desktop-shell */'],
      ['/fake-sw/claim-late.js', '/* claim-late */'],
    ] as const) {
      const r = get(path);
      expect(r.headers['service-worker-allowed']).toBe('/');
      expect(text(r)).toBe(body);
    }
  });

  it('/__fake__/health answers on every host; other hosts get nothing else', () => {
    const { get } = setup();
    for (const host of [WWW, I, '127.0.0.1:8443', 'localhost:8443', '[::1]:8443']) {
      const r = get('/__fake__/health', MAC, {}, host);
      expect(r.status).toBe(200);
      expect(json(r)).toEqual({ ok: true, fake: true, certValidTo: CERT_VALID_TO, sourceHash: SOURCE_HASH });
    }
    expect(get('/', MAC, {}, '127.0.0.1:8443').status).toBe(404);
    expect(get('/__fake__/', MAC, {}, 'localhost').status).toBe(404);
    expect(get('/', MAC, {}, 'example.com').status).toBe(404);
    expect(get('/__fake__/api/stories', MAC, {}, I).status).toBe(404);
  });

  it('routes on Host without port, case-insensitively', () => {
    const { get } = setup();
    expect(normalizeHost('WWW.Instagram.com:8443')).toBe(WWW);
    expect(normalizeHost('[::1]:8443')).toBe('[::1]');
    expect(bootOf(text(get('/', ANDROID, {}, 'WWW.Instagram.com:8443'))).shell).toBe('msite');
  });

  it('unknown paths are 404, shells reject other methods, i.instagram.com serves only write paths', () => {
    const { get, send } = setup();
    expect(get('/explore/').status).toBe(404);
    expect(get('/favicon.ico').status).toBe(404);
    expect(send('POST', WWW, '/', { 'user-agent': ANDROID }).status).toBe(405);
    expect(get('/', ANDROID, {}, I).status).toBe(404);
    expect(get('/create/story/', ANDROID, {}, I).status).toBe(404);
  });

  it('a path starting with // stays a path', () => {
    const { get } = setup();
    expect(get('//evil.example/').status).toBe(404);
  });
});

describe('U16 fake core: knobs in the shell', () => {
  it('marker=on puts the marker meta in the head; marker=off removes it', () => {
    const { get, store } = setup();
    expect(text(get('/'))).toContain('<meta name="instapost-fake-instagram" content="1">');
    store.setKnobs({ marker: 'off' });
    expect(text(get('/'))).not.toContain('instapost-fake-instagram');
  });

  it('locale=es sets html[lang] and passes the locale to the client', () => {
    const { get, store } = setup();
    store.setKnobs({ locale: 'es' });
    const html = text(get('/'));
    expect(html).toContain('<html lang="es">');
    expect(bootOf(html).knobs.locale).toBe('es');
  });

  it('drift=renamed randomises the root id and the UA script attribute; C1 still finds the JSON first', () => {
    const { get, store } = setup();
    store.setKnobs({ drift: 'renamed' });
    const html = text(get('/'));
    const boot = bootOf(html);
    expect(boot.rootId).not.toBe('root');
    expect(html).toContain(`<div id="${boot.rootId}"></div>`);
    expect(html).not.toContain('data-fake-ua');
    expect(firstJsonScript(html).attrs).not.toBe(' data-fake-ua');
    expect(uaOf(html).is_mobile).toBe(true);
  });

  it('classifier=client-hints classifies by sec-ch-ua-mobile', () => {
    const { get, store } = setup();
    store.setKnobs({ classifier: 'client-hints' });
    expect(uaOf(text(get('/', ANDROID, { 'sec-ch-ua-mobile': '?1' }))).is_mobile).toBe(true);
    expect(get('/create/story/', ANDROID, { 'sec-ch-ua-mobile': '?0' }).status).toBe(302);
  });

  it('the UA JSON cannot break out of its script element', () => {
    const { get } = setup();
    const html = text(get('/', `${ANDROID} </script><script>alert(1)</script>`));
    expect(html.match(/<\/script>/g)).toHaveLength(3);
    expect(uaOf(html).user_agent).toContain('</script>');
  });

  it('every knob reaches the client unchanged', () => {
    const { get, store } = setup();
    const knobs = store.setKnobs({
      route: 'direct',
      input: 'afterTap',
      accept: 'changed',
      listen: 'drop',
      geometry: 'cssFixed:360x640',
      hydrateMs: 800,
    });
    expect(bootOf(text(get('/create/story/'))).knobs).toEqual(knobs);
  });
});

describe('U16 fake core: request log', () => {
  it('logs every non-/__fake__ request with its headers and classification', () => {
    const { get, api, store } = setup();
    store.setKnobs({ route: 'direct' });
    get('/create/story/?a=1', ANDROID, {
      'sec-ch-ua': '"Chromium";v="155"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      origin: 'https://www.instagram.com',
      cookie: 'never-logged=1',
    });
    get('/', MAC, { 'x-fake-via-sw': '1' });
    get('/__fake__/api/knobs');
    get('/__fake__/');
    get('/nope', MAC, {}, 'localhost');
    const reqs = api<Array<Record<string, unknown>>>('requests');
    expect(reqs.map((r) => [r.host, r.path, r.status])).toEqual([
      [WWW, '/create/story/?a=1', 200],
      [WWW, '/', 200],
      ['localhost', '/nope', 404],
    ]);
    const [composer, viaSw] = reqs;
    expect(composer).toMatchObject({
      method: 'GET',
      ua: ANDROID,
      ch: { 'sec-ch-ua': '"Chromium";v="155"', 'sec-ch-ua-mobile': '?1', 'sec-ch-ua-platform': '"Android"' },
      fetch: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' },
      origin: 'https://www.instagram.com',
      viaSw: false,
      classification: { is_mobile: true, is_android: true },
      tag: null,
    });
    expect(JSON.stringify(composer)).not.toContain('never-logged');
    expect(viaSw).toMatchObject({ viaSw: true, classification: { is_mobile: false } });
  });

  it('requests?since=<seq> returns only newer records', () => {
    const { get, api } = setup();
    get('/');
    const [first] = api<Array<{ seq: number }>>('requests');
    get('/create/story/');
    const newer = api<Array<{ seq: number; path: string }>>(`requests?since=${first?.seq}`);
    expect(newer.map((r) => r.path)).toEqual(['/create/story/']);
  });

  it('keeps a bounded number of requests', () => {
    const store = createStore({ maxRequests: 3 });
    const c = classify({}, 'ua');
    for (let i = 0; i < 5; i++) {
      store.addRequest({
        host: WWW,
        method: 'GET',
        path: `/${i}`,
        status: 200,
        classification: c,
        tag: null,
        ua: null,
        ch: {},
        fetch: {},
        origin: null,
        viaSw: false,
      });
    }
    expect(store.requests().map((r) => r.path)).toEqual(['/2', '/3', '/4']);
  });
});

describe('U16 fake core: write recording', () => {
  const samples: Array<[string, string, string]> = [
    ['POST', I, '/rupload_igphoto/fb_uploader_1791747574517'],
    ['POST', I, '/rupload_igvideo/story_1791747574517'],
    ['GET', I, '/rupload_igvideo/story_1791747574517'],
    ['POST', WWW, '/rupload_igphoto/fb_uploader_1'],
    ['POST', WWW, '/api/v1/media/configure_to_story/'],
    ['POST', WWW, '/api/v1/web/create/configure_to_story/'],
    ['POST', WWW, '/create/configure_to_story/'],
    ['POST', WWW, '/api/v1/media/configure/'],
    ['POST', WWW, '/api/v1/media/configure_sidecar/'],
    ['POST', WWW, '/api/v1/media/configure_to_clips/'],
    ['POST', WWW, '/api/v1/media/configure_to_longform/'],
  ];

  it.each(samples)('%s %s%s is logged as WRITE_PATH_REACHED and answered 200', (method, host, path) => {
    const { send, api } = setup();
    const body = new Uint8Array([1, 2, 3]);
    const r = send(method, host, path, { 'user-agent': ANDROID, origin: 'https://www.instagram.com' }, body);
    expect(r.status).toBe(200);
    expect(json(r)).toEqual({ status: 'fake-ok' });
    expect(r.headers['access-control-allow-origin']).toBe('https://www.instagram.com');
    const writes = api<Array<Record<string, unknown>>>('writes');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ tag: 'WRITE_PATH_REACHED', host, method, path, ua: ANDROID, bytes: 3 });
    expect(api<Array<{ tag: string | null }>>('requests')[0]?.tag).toBe('WRITE_PATH_REACHED');
  });

  it('every WRITE_URL_FILTERS entry is exercised by a sample', () => {
    const hit = new Set(samples.map(([, host, path]) => matchWriteFilter(host, path)));
    expect([...hit].sort()).toEqual([...WRITE_URL_FILTERS].sort());
  });

  it('non-write paths and look-alike hosts are not writes', () => {
    const { send, api, get } = setup();
    expect(send('POST', WWW, '/api/v1/media/info/', {}).status).toBe(404);
    expect(get('/rupload_igphotos', ANDROID, {}, I).status).toBe(404);
    expect(matchWriteFilter('notinstagram.com', '/rupload_igphoto/x')).toBeNull();
    expect(matchWriteFilter(WWW, '/create/story/')).toBeNull();
    expect(api<unknown[]>('writes')).toEqual([]);
  });

  it('a CORS preflight to a write path is answered and still counted', () => {
    const { send, api } = setup();
    const r = send('OPTIONS', I, '/rupload_igphoto/fb_uploader_1', { origin: 'https://www.instagram.com' });
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-credentials']).toBe('true');
    expect(api<unknown[]>('writes')).toHaveLength(1);
  });
});

describe('U16 fake core: stories and violations', () => {
  it('records a trusted Share with its JPEG size, bytes and headers', () => {
    const { share, api, get } = setup();
    const body = fakeJpeg(1022, 1816);
    const r = share(meta(true), body);
    expect(r.status).toBe(200);
    const { id } = json<{ id: string }>(r);
    const [story] = api<StoryRecord[]>('stories');
    expect(story).toMatchObject({
      id,
      bytes: body.length,
      size: { w: 1022, h: 1816 },
      isTrusted: true,
      contentType: 'image/jpeg',
      ua: ANDROID,
      ch: { 'sec-ch-ua-mobile': '?1', 'sec-ch-ua-platform': '"Android"' },
      metaError: null,
    });
    expect(story?.meta?.geometry.canvas).toEqual({ w: 1022, h: 1816 });
    const img = get(`/__fake__/stories/${id}.jpg`);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect(img.body).toEqual(body);
    expect(api<unknown[]>('violations')).toEqual([]);
    // /__fake__ traffic is not part of the request log.
    expect(api<unknown[]>('requests')).toEqual([]);
  });

  it('an untrusted Share is recorded and is a violation', () => {
    const { share, api } = setup();
    const { id } = json<{ id: string }>(share(meta(false)));
    expect(api<StoryRecord[]>('stories')[0]?.isTrusted).toBe(false);
    expect(api<unknown[]>('violations')).toEqual([expect.objectContaining({ kind: 'UNTRUSTED_SHARE', storyId: id })]);
  });

  it.each([
    ['missing', null],
    ['not JSON', '{nope'],
    ['without isTrusted', JSON.stringify({ canvas: { w: 1, h: 1 } })],
  ] as const)('a Share with %s meta is recorded as SHARE_META_INVALID', (_name, m) => {
    const { share, api } = setup();
    share(m);
    expect(api<StoryRecord[]>('stories')[0]).toMatchObject({ isTrusted: null, meta: null });
    expect(api<Array<{ kind: string }>>('violations').map((v) => v.kind)).toEqual(['SHARE_META_INVALID']);
  });

  it('rejects an empty body and non-POST methods; unknown ids are 404', () => {
    const { share, get, api } = setup();
    expect(share(meta(true), new Uint8Array()).status).toBe(400);
    expect(get('/__fake__/stories').status).toBe(405);
    expect(get('/__fake__/stories/s0-000000.jpg').status).toBe(404);
    expect(get('/__fake__/stories/..%2F..%2Fcert.jpg').status).toBe(404);
    expect(api<unknown[]>('stories')).toEqual([]);
  });

  it('jpegSize reads SOF0/SOF2 and refuses non-JPEG bytes', () => {
    expect(jpegSize(fakeJpeg(1080, 1920))).toEqual({ w: 1080, h: 1920 });
    const progressive = fakeJpeg(720, 1280);
    progressive[21] = 0xc2;
    expect(jpegSize(progressive)).toEqual({ w: 720, h: 1280 });
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegSize(new Uint8Array())).toBeNull();
  });
});

describe('U16 fake core: knobs API and reset', () => {
  it('GET /__fake__/api/knobs returns the baseline defaults', () => {
    const { api } = setup();
    expect(api('knobs')).toEqual(DEFAULT_KNOBS);
  });

  it('POST merges a valid patch (JSON strings or numbers)', () => {
    const { postJson, api } = setup();
    const r = postJson('/__fake__/api/knobs', { route: 'homeOnly', insets: '44,52', slowMs: '250' });
    expect(r.status).toBe(200);
    expect(json(r)).toEqual({ ...DEFAULT_KNOBS, route: 'homeOnly', insets: [44, 52], slowMs: 250 });
    postJson('/__fake__/api/knobs', { geometry: 'fixed:1080x1920', insets: [0, 10], slowMs: 0 });
    expect(api<Knobs>('knobs')).toMatchObject({ route: 'homeOnly', geometry: 'fixed:1080x1920', insets: [0, 10] });
  });

  it('rejects unknown knobs and invalid values atomically', () => {
    const { postJson, api } = setup();
    const r = postJson('/__fake__/api/knobs', { route: 'homeOnly', bogus: 1, geometry: 'fixed:0x10', save: 'maybe' });
    expect(r.status).toBe(400);
    expect(json<{ errors: string[] }>(r).errors).toHaveLength(3);
    expect(api('knobs')).toEqual(DEFAULT_KNOBS);
  });

  it('accepts the dashboard form (urlencoded) and redirects back', () => {
    const { send, api } = setup();
    const r = send(
      'POST',
      WWW,
      '/__fake__/api/knobs',
      { 'content-type': 'application/x-www-form-urlencoded' },
      new TextEncoder().encode('locale=es&sw=claimLate&insets=0%2C0'),
    );
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe('/__fake__/');
    expect(api<Knobs>('knobs')).toMatchObject({ locale: 'es', sw: 'claimLate' });
  });

  it('POST /__fake__/api/reset clears stories, requests, writes, violations and knobs', () => {
    const { send, share, get, postJson, api } = setup();
    postJson('/__fake__/api/knobs', { auth: 'out' });
    share(meta(false));
    get('/');
    send('POST', I, '/rupload_igphoto/fb_uploader_1');
    expect(api<unknown[]>('writes')).toHaveLength(1);
    expect(get('/__fake__/api/reset').status).toBe(405);
    const r = send('POST', WWW, '/__fake__/api/reset');
    expect(json(r)).toEqual({ ok: true, knobs: DEFAULT_KNOBS });
    for (const name of ['stories', 'requests', 'writes', 'violations']) expect(api(name)).toEqual([]);
    expect(api('knobs')).toEqual(DEFAULT_KNOBS);
  });

  it('GET /__fake__/reset sends Clear-Site-Data and unregisters service workers', () => {
    const { get } = setup();
    const r = get('/__fake__/reset');
    expect(r.status).toBe(200);
    expect(r.headers['clear-site-data']).toBe('"cache", "storage"');
    expect(text(r)).toContain('unregister()');
  });
});

describe('U16 fake core: dashboard', () => {
  it('renders stories, the knob form and escaped request data', () => {
    const { get, share } = setup();
    share(meta(true));
    get('/', '<img src=x onerror=alert(1)>');
    const r = get('/__fake__/');
    expect(r.status).toBe(200);
    const html = text(r);
    expect(html).toContain('<form id="knobs"');
    for (const name of KNOB_NAMES) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('1022×1816');
    expect(html).toContain('isTrusted');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('serves the live fragment for polling and redirects /__fake__', () => {
    const { get } = setup();
    const live = text(get('/__fake__/?fragment=live'));
    expect(live).toContain('<h2>Stories</h2>');
    expect(live).not.toContain('<form');
    expect(get('/__fake__').headers.location).toBe('/__fake__/');
  });
});

describe('U16 fake core: story persistence', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('writes stories to disk, reloads them on start, and reset deletes them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-ig-test-'));
    dirs.push(dir);
    const first = setup(dir);
    const { id } = json<{ id: string }>(first.share(meta(true)));
    expect(readdirSync(dir).sort()).toEqual([`${id}.jpg`, `${id}.json`]);

    const second = setup(dir);
    expect(second.api<StoryRecord[]>('stories').map((s) => s.id)).toEqual([id]);
    expect(new Uint8Array(second.get(`/__fake__/stories/${id}.jpg`).body as Uint8Array)).toEqual(fakeJpeg(1022, 1816));

    second.send('POST', WWW, '/__fake__/api/reset');
    expect(existsSync(join(dir, `${id}.jpg`))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('U16 fake core: control clicks report isTrusted (FID-2)', () => {
  it('a trusted control click is fine; an untrusted one is an UNTRUSTED_CONTROL violation', () => {
    const { postJson, api } = setup();
    expect(postJson('/__fake__/control', { control: 'create', isTrusted: true }).status).toBe(200);
    expect(api<unknown[]>('violations')).toEqual([]);
    expect(postJson('/__fake__/control', { control: 'story', isTrusted: false }).status).toBe(200);
    expect(api<unknown[]>('violations')).toEqual([
      expect.objectContaining({ kind: 'UNTRUSTED_CONTROL', storyId: null, detail: expect.stringContaining('story') }),
    ]);
  });

  it('a malformed report is refused; a missing isTrusted counts as untrusted', () => {
    const { postJson, api, get } = setup();
    expect(postJson('/__fake__/control', { isTrusted: true }).status).toBe(400);
    expect(postJson('/__fake__/control', { control: 'x'.repeat(40), isTrusted: true }).status).toBe(400);
    expect(get('/__fake__/control').status).toBe(405);
    postJson('/__fake__/control', { control: 'close' });
    expect(api<{ kind: string }[]>('violations').map((v) => v.kind)).toEqual(['UNTRUSTED_CONTROL']);
  });
});

describe('U16 fake core: composer views and the story session (AM37)', () => {
  const view = (over: Record<string, unknown> = {}) => ({
    landscape: true,
    share: false,
    via: 'screen',
    screenOrientation: 'landscape-primary',
    inner: { w: 511, h: 909 },
    sessionStarted: true,
    path: '/create/story/',
    ...over,
  });

  it('records what the composer page showed, in order; reset clears it; the dashboard lists it', () => {
    const { postJson, api, get, store } = setup();
    expect(postJson('/__fake__/composer-view', view()).status).toBe(200);
    expect(
      postJson('/__fake__/composer-view', view({ landscape: false, share: true, sessionStarted: false })).status,
    ).toBe(200);
    const views = api<(ReturnType<typeof view> & { seq: number; t: number })[]>('composer-views');
    expect(views.map((v) => [v.landscape, v.share, v.sessionStarted])).toEqual([
      [true, false, true],
      [false, true, false],
    ]);
    expect(views[0]).toMatchObject({
      via: 'screen',
      screenOrientation: 'landscape-primary',
      inner: { w: 511, h: 909 },
    });
    expect(views[1]?.seq).toBeGreaterThan(views[0]?.seq ?? Infinity);
    const html = text(get('/__fake__/'));
    expect(html).toContain('Composer views (landscape gate)');
    expect(html).toContain('rotate snackbar, no Share');
    store.reset();
    expect(api<unknown[]>('composer-views')).toEqual([]);
  });

  it('refuses malformed reports and other methods; nothing is recorded', () => {
    const { postJson, api, get } = setup();
    for (const bad of [
      {},
      view({ landscape: 'yes' }),
      view({ via: 'css' }),
      view({ inner: { w: 'x', h: 1 } }),
      view({ screenOrientation: 'x'.repeat(65) }),
      view({ path: 7 }),
    ]) {
      expect(postJson('/__fake__/composer-view', bad).status).toBe(400);
    }
    expect(get('/__fake__/composer-view').status).toBe(405);
    expect(api<unknown[]>('composer-views')).toEqual([]);
    // It is never part of the site request log.
    expect(api<unknown[]>('requests')).toEqual([]);
  });

  it('parseComposerView keeps only the known fields', () => {
    expect(parseComposerView({ ...view({ screenOrientation: null }), extra: 'x' })).toEqual(
      view({ screenOrientation: null }),
    );
    expect(parseComposerView(null)).toBeNull();
  });

  it('a story keeps whether + → Story started the session (the insert never does)', () => {
    const { share, api } = setup();
    share(meta(true));
    share({ ...meta(true), sessionStarted: false, sessionId: null });
    const stories = api<{ meta: FakeShareMeta }[]>('stories');
    expect(stories.map((s) => [s.meta.sessionStarted, s.meta.sessionId === null])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(stories[0]?.meta.screenOrientation).toBe('portrait-primary');
  });
});

describe('U16 knobs: defaults and baseline', () => {
  it('default knobs equal deriveKnobs(baseline.json)', () => {
    expect(deriveKnobs(baselineJson as unknown as Baseline)).toEqual(DEFAULT_KNOBS);
    expect(deriveKnobs(BASELINE)).toEqual(DEFAULT_KNOBS);
  });

  it('AM35: the 2026-10-12 baseline gives the production-shaped knob list', () => {
    expect(DEFAULT_KNOBS).toMatchObject({
      route: 'homeOnly',
      input: 'present',
      accept: 'default',
      listen: 'change',
      trusted: 'ignore',
      geometry: 'viewportDpr',
      insets: [0, 0],
      save: 'on',
      sw: 'claimOnRegister',
      hydrateMs: 0,
    });
    // The facts that make it so, each with where it comes from (the first live run or a code reading).
    expect(BASELINE).toMatchObject({
      route: 'homeOnly',
      storyInputBeforeTap: true,
      swClaimsOnLoad: true,
      swFetchHandler: false,
      firstLoadServedBySw: false,
      swControlledAfterHardReload: true,
      msiteMaxCssWidth: 767,
    });
    for (const fact of ['route', 'storyInputBeforeTap', 'swClaimsOnLoad', 'swFetchHandler', 'msiteMaxCssWidth']) {
      expect(BASELINE.provenance?.[fact], fact).toMatch(/2026-10-12/);
    }
    expect(BASELINE.provenance?.route).toMatch(/live run 2026-10-12/);
    expect(BASELINE.provenance?.swControlledAfterHardReload).toMatch(/live run 2026-10-12/);
  });

  it('AM37: the composer reads the screen orientation (live 2026-10-12), so the fake does too', () => {
    expect(BASELINE.composerLandscapeCheck).toBe('screen');
    expect(BASELINE.provenance?.composerLandscapeCheck).toMatch(/^live 2026-10-12/);
    expect(DEFAULT_KNOBS.landscapeCheck).toBe('screen');
    expect(deriveKnobs({ ...BASELINE, composerLandscapeCheck: 'viewport' }).landscapeCheck).toBe('viewport');
    // Unknown keeps the viewport check research described before the live finding.
    expect(deriveKnobs({ ...BASELINE, composerLandscapeCheck: 'unknown' }).landscapeCheck).toBe('viewport');
    expect(parseKnobPatch({ landscapeCheck: 'viewport' })).toEqual({ ok: true, patch: { landscapeCheck: 'viewport' } });
    expect(parseKnobPatch({ landscapeCheck: 'css' }).ok).toBe(false);
  });

  it('maps every modelled baseline fact', () => {
    const b: Baseline = {
      ...BASELINE,
      route: 'direct',
      storyInputBeforeTap: false,
      accept: STORY_ACCEPT_LISTS.changed.split(','),
      untrustedInsertAccepted: false,
      fileEvent: 'drop',
      swFetchHandler: true,
      geometry: { model: 'fixed:1080x1920', insets: [44, 52], saveExposed: false },
    };
    expect(deriveKnobs(b)).toEqual({
      ...DEFAULT_KNOBS,
      route: 'direct',
      input: 'afterTap',
      accept: 'changed',
      listen: 'drop',
      trusted: 'require',
      sw: 'desktopShell',
      geometry: 'fixed:1080x1920',
      insets: [44, 52],
      save: 'off',
    });
    expect(deriveKnobs({ ...BASELINE, accept: ['image/png', 'image/jpeg', 'image/avif'] }).accept).toBe('default');
  });

  it('F2: the service-worker facts pick the sw knob', () => {
    const noSw: Baseline = {
      ...BASELINE,
      swClaimsOnLoad: false,
      swFetchHandler: false,
      firstLoadServedBySw: false,
      swControlledAfterHardReload: false,
    };
    expect(deriveKnobs(noSw).sw).toBe('none');
    expect(deriveKnobs({ ...noSw, swClaimsOnLoad: true }).sw).toBe('claimOnRegister');
    // A worker with a fetch handler is the hypothetical intercepting one (SW_INTERCEPTS), claiming or not.
    expect(deriveKnobs({ ...noSw, swFetchHandler: true }).sw).toBe('desktopShell');
    expect(deriveKnobs({ ...BASELINE, swFetchHandler: true }).sw).toBe('desktopShell');
    // The pre-F2 hypothesis: a worker served the first load.
    expect(deriveKnobs({ ...noSw, firstLoadServedBySw: true }).sw).toBe('desktopShell');
    expect(deriveKnobs({ ...noSw, swClaimsOnLoad: 'unknown', swFetchHandler: 'unknown' }).sw).toBe('none');
  });

  it('FID-5: L6 reaches the fake; unknown facts keep the research defaults', () => {
    // L6 finds the composer ignores a synthetic insert: the fake's default must then ignore it too.
    expect(deriveKnobs({ ...BASELINE, untrustedInsertAccepted: false }).trusted).toBe('require');
    expect(deriveKnobs({ ...BASELINE, untrustedInsertAccepted: true }).trusted).toBe('ignore');
    expect(deriveKnobs({ ...BASELINE, fileEvent: 'drop' }).listen).toBe('drop');
    expect(deriveKnobs({ ...BASELINE, fileEvent: 'change' }).listen).toBe('change');
    const unknown: Baseline = {
      ...BASELINE,
      isMobileKeyFound: 'unknown',
      route: 'unknown',
      storyInputBeforeTap: 'unknown',
      untrustedInsertAccepted: 'unknown',
      fileEvent: 'unknown',
    };
    expect(deriveKnobs(unknown)).toMatchObject({
      route: 'homeOnly',
      input: 'present',
      trusted: 'ignore',
      listen: 'change',
    });
    // The baseline still marks what L4/L6 have not verified yet.
    expect(BASELINE).toMatchObject({
      untrustedInsertAccepted: 'unknown',
      fileEvent: 'unknown',
    });
  });

  it.each([
    ['isMobileKeyFound=false', { isMobileKeyFound: false }],
    ['an accept list the fake cannot serve', { accept: ['image/webp'] }],
    [
      'swControlledAfterHardReload=true without a worker that claims on load',
      { swControlledAfterHardReload: true, swClaimsOnLoad: false },
    ],
    ['a breakpoint other than the contract’s 767 CSS px', { msiteMaxCssWidth: 800 }],
  ] as Array<[string, Partial<Baseline>]>)('throws for %s, forcing the fake to be extended', (_name, patch) => {
    expect(() => deriveKnobs({ ...BASELINE, ...patch })).toThrow(/not modelled/);
  });

  it('parseKnobPatch accepts every documented value', () => {
    for (const [name, values] of Object.entries(KNOB_CHOICES)) {
      for (const value of values)
        expect(parseKnobPatch({ [name]: value })).toEqual({ ok: true, patch: { [name]: value } });
    }
    for (const g of ['viewportDpr', 'source', 'fixed:1080x1920', 'cssFixed:360x640']) {
      expect(parseKnobPatch({ geometry: g }).ok).toBe(true);
    }
    for (const g of ['fixed:0x1', 'cssFixed:360', 'dpr', 'fixed:99999x1']) {
      expect(parseKnobPatch({ geometry: g }).ok).toBe(false);
    }
    expect(parseKnobPatch({ insets: '1,2,3' }).ok).toBe(false);
    expect(parseKnobPatch({ slowMs: -1 }).ok).toBe(false);
    expect(parseKnobPatch({ hydrateMs: '1500' })).toEqual({ ok: true, patch: { hydrateMs: 1500 } });
    expect(parseKnobPatch({ hydrateMs: 60_001 }).ok).toBe(false);
    expect(parseKnobPatch([]).ok).toBe(false);
  });

  it('parseGeometryModel', () => {
    expect(parseGeometryModel('fixed:1080x1920')).toEqual({ kind: 'fixed', w: 1080, h: 1920 });
    expect(parseGeometryModel('cssFixed:360x640')).toEqual({ kind: 'cssFixed', w: 360, h: 640 });
    expect(parseGeometryModel('viewportDpr')).toEqual({ kind: 'viewportDpr' });
    expect(parseGeometryModel('fixed:1080x')).toBeNull();
  });
});

describe('U16 fake client geometry', () => {
  const owner = { inner: { w: 511, h: 909 }, dpr: 2 }; // headed/emulated owner popup (spike S8)
  const base = { ...owner, insets: [0, 0] as const, source: { w: 1080, h: 1920 } };

  it('viewportDpr: largest 9:16 box, backing = css × dpr', () => {
    expect(computeGeometry({ ...base, model: 'viewportDpr' })).toEqual({
      css: { x: 0, y: 0, w: 511, h: 908 },
      canvas: { w: 1022, h: 1816 },
    });
  });

  it('insets shrink the area and push the box below the top inset', () => {
    const g = computeGeometry({ ...base, model: 'viewportDpr', insets: [44, 52] });
    expect(g.css).toEqual({ x: 27, y: 44, w: 457, h: 813 });
    expect(g.canvas).toEqual({ w: 914, h: 1626 });
  });

  it('source: backing is the largest 9:16 box of the source at native resolution', () => {
    expect(computeGeometry({ ...base, model: 'source' }).canvas).toEqual({ w: 1080, h: 1920 });
    expect(computeGeometry({ ...base, model: 'source', source: { w: 4000, h: 3000 } }).canvas).toEqual({
      w: 1688,
      h: 3000,
    });
  });

  it('fixed:WxH and cssFixed:WxH', () => {
    expect(computeGeometry({ ...base, model: 'fixed:1080x1920' })).toEqual({
      css: { x: 0, y: 0, w: 511, h: 908 },
      canvas: { w: 1080, h: 1920 },
    });
    expect(computeGeometry({ ...base, model: 'cssFixed:360x640' })).toEqual({
      css: { x: 75, y: 134, w: 360, h: 640 },
      canvas: { w: 720, h: 1280 },
    });
  });

  it('landscape viewports fit by height', () => {
    expect(fitAspect({ w: 1280, h: 800 }, 9, 16)).toEqual({ w: 450, h: 800 });
    expect(computeGeometry({ ...base, inner: { w: 915, h: 412 }, dpr: 1, model: 'viewportDpr' }).css).toEqual({
      x: 341,
      y: 0,
      w: 232,
      h: 412,
    });
  });

  it('coverCrop centres the crop on the long axis', () => {
    expect(coverCrop({ w: 4000, h: 3000 }, { w: 1080, h: 1920 })).toEqual({ sx: 1156.25, sy: 0, sw: 1687.5, sh: 3000 });
    expect(coverCrop({ w: 1000, h: 4000 }, { w: 1080, h: 1920 })).toEqual({
      sx: 0,
      sy: (4000 - (1000 * 1920) / 1080) / 2,
      sw: 1000,
      sh: (1000 * 1920) / 1080,
    });
    expect(coverCrop({ w: 1080, h: 1920 }, { w: 1080, h: 1920 })).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1920 });
  });
});

describe('U16 fake service workers (F2, AM30)', () => {
  it('claim-on-register.js, the default: skipWaiting and clients.claim, and NO fetch handler', () => {
    const src = readFileSync(SW_FILES.claimOnRegister, 'utf8');
    expect(src).toContain('self.skipWaiting()');
    expect(src).toContain('self.clients.claim()');
    expect(src).toContain('navigationPreload.disable()');
    expect(src).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
  });

  it('desktop-shell.js, hypothetical: a fetch handler that answers navigations and passes requests through', () => {
    const src = readFileSync(SW_FILES.desktopShell, 'utf8');
    expect(src).toMatch(/addEventListener\(\s*['"]fetch['"]/);
    expect(src).toContain('event.respondWith(fetch(event.request))');
    expect(src).toContain("'x-fake-via-sw': '1'");
    expect(src).toContain('self.clients.claim()');
  });

  it('claim-late.js: claims, no fetch handler', () => {
    const src = readFileSync(SW_FILES.claimLate, 'utf8');
    expect(src).toContain('self.clients.claim()');
    expect(src).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
  });

  it('every load registers a new claim-on-register URL (enableAddToHomeScreen from is_mobile, per-load id)', () => {
    expect(claimOnRegisterUrl(true, 'x1')).toBe(
      '/fake-sw/claim-on-register.js?enableAddToHomeScreen=true&zenon_device_id=x1',
    );
    expect(claimOnRegisterUrl(false, 'x2')).toContain('enableAddToHomeScreen=false');
    expect(claimOnRegisterUrl(true)).not.toBe(claimOnRegisterUrl(true));
  });
});

describe('U16 fake source hash (FID-7)', () => {
  it('changes when any fake or contract source changes, and only then', async () => {
    const { fakeSourceHash, FAKE_SOURCES } = await import('./source-hash.ts');
    const { cpSync, writeFileSync } = await import('node:fs');
    const root = mkdtempSync(join(tmpdir(), 'fake-hash-'));
    try {
      const repo = join(import.meta.dirname, '../..');
      for (const src of FAKE_SOURCES) cpSync(join(repo, src), join(root, src), { recursive: true });
      const before = fakeSourceHash(root);
      expect(before).toMatch(/^[0-9a-f]{64}$/);
      expect(fakeSourceHash(root)).toBe(before);
      // A test file is not part of the fake.
      writeFileSync(join(root, 'tools/fake-ig/extra.test.ts'), '// x');
      expect(fakeSourceHash(root)).toBe(before);
      writeFileSync(join(root, 'tools/fake-ig/client/StoryComposer.tsx'), '// edited');
      const edited = fakeSourceHash(root);
      expect(edited).not.toBe(before);
      writeFileSync(join(root, 'src/core/ig-contract/baseline.json'), '{}');
      expect(fakeSourceHash(root)).not.toBe(edited);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
