/**
 * The fake Instagram, transport-free (strategy §6.2, §7.6): `handle(request) → response`.
 * server.ts is a thin node:https adapter; U16 drives this module directly.
 *
 * Routing is on the Host header without its port (AM7). Hosts other than www/i.instagram.com
 * (e.g. 127.0.0.1 or localhost, which the SPKI bypass also covers) get only /__fake__/health.
 * Every request outside /__fake__/ is logged with its UA, client hints, sec-fetch-* and origin
 * headers and the classification. Write paths are matched with the same WRITE_URL_FILTERS the
 * extension's block rules use, so the fake and the rules cannot drift apart.
 */
import { randomBytes } from 'node:crypto';
import { CH_REMOVE } from '../../src/core/ig-contract/device-profile.ts';
import { WRITE_URL_FILTERS } from '../../src/core/ig-contract/write-endpoints.ts';
import {
  type DashboardState,
  dashboardHtml,
  dashboardLiveHtml,
  placeholderHtml,
  shellHtml,
  siteResetHtml,
} from './html.ts';
import { DEFAULT_KNOBS, parseKnobPatch } from './knobs.ts';
import {
  FAKE_META_HEADER,
  FAKE_PATHS,
  FAKE_VIA_SW_HEADER,
  type FakeShareMeta,
  I_HOST,
  IG_HOSTS,
  OFFHOST_URL,
  WWW_HOST,
} from './protocol.ts';
import type { SeenHeaders, Store, StoryRecord, ViolationRecord, WriteRecord } from './store.ts';
import { classify, type HeaderBag } from './ua.ts';

export interface FakeRequest {
  method: string;
  /** Raw Host header (a port, if any, is ignored). */
  host: string;
  /** Path and query, as on the request line. */
  path: string;
  /** Lower-case header names. */
  headers: HeaderBag;
  body?: Uint8Array;
}

export interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

export interface CoreAssets {
  /** esbuild bundle of client/main.tsx. */
  clientJs: string;
  sw: { desktopShell: string; claimLate: string };
}

export type CoreEvent =
  | { kind: 'write'; write: WriteRecord }
  | { kind: 'story'; story: StoryRecord }
  | { kind: 'violation'; violation: ViolationRecord };

export interface CoreOptions {
  store: Store;
  assets: CoreAssets;
  /** ISO date reported by /__fake__/health. */
  certValidTo: string | null;
  /** fakeSourceHash() at server start, reported by /__fake__/health (FID-7); null when unknown. */
  sourceHash?: string | null;
  /** Random tokens for `drift=renamed`. */
  token?: () => string;
  onEvent?: (e: CoreEvent) => void;
}

export interface FakeCore {
  handle(req: FakeRequest): FakeResponse;
  readonly store: Store;
}

/** Hints the shells ask for, so E5 can prove the composer tab does not send them (they are removed by rule 1001). */
export const ACCEPT_CH = CH_REMOVE.join(', ');

const NO_STORE = { 'cache-control': 'no-store' } as const;

const respond = (status: number, type: string, body: string | Uint8Array, extra: Record<string, string> = {}) => ({
  status,
  headers: { 'content-type': type, ...NO_STORE, ...extra },
  body,
});
const text = (status: number, body: string, extra?: Record<string, string>) =>
  respond(status, 'text/plain; charset=utf-8', body, extra);
const json = (status: number, value: unknown, extra?: Record<string, string>) =>
  respond(status, 'application/json; charset=utf-8', JSON.stringify(value), extra);
const html = (status: number, body: string, extra?: Record<string, string>) =>
  respond(status, 'text/html; charset=utf-8', body, extra);
const js = (body: string, extra?: Record<string, string>) =>
  respond(200, 'text/javascript; charset=utf-8', body, extra);
const redirect = (location: string, status = 302): FakeResponse => ({
  status,
  headers: { location, ...NO_STORE },
  body: '',
});

/** Host header without port, lower case. `[::1]:8443` → `[::1]`. */
export function normalizeHost(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0] ?? '';
}

/**
 * The WRITE_URL_FILTERS entry matching this request, with dNR urlFilter semantics as far as the
 * list needs them: `||domain/path` anchors on the host (or a subdomain) and a path prefix; any
 * other filter is a case-insensitive substring of the URL.
 */
export function matchWriteFilter(host: string, pathAndQuery: string): string | null {
  const path = pathAndQuery.toLowerCase();
  const url = `https://${host}${path}`;
  for (const f of WRITE_URL_FILTERS) {
    if (f.startsWith('||')) {
      const rest = f.slice(2);
      const slash = rest.indexOf('/');
      const domain = rest.slice(0, slash);
      if ((host === domain || host.endsWith(`.${domain}`)) && path.startsWith(rest.slice(slash))) return f;
    } else if (url.includes(f)) {
      return f;
    }
  }
  return null;
}

export function seenHeaders(h: HeaderBag): SeenHeaders {
  const pick = (prefix: string) =>
    Object.fromEntries(
      Object.entries(h).filter((e): e is [string, string] => e[0].startsWith(prefix) && e[1] !== undefined),
    );
  return {
    ua: h['user-agent'] ?? null,
    ch: pick('sec-ch-ua'),
    fetch: pick('sec-fetch-'),
    origin: h.origin ?? null,
    viaSw: h[FAKE_VIA_SW_HEADER] === '1',
  };
}

function parseMeta(raw: string | undefined): { meta: FakeShareMeta | null; error: string | null } {
  if (raw === undefined) return { meta: null, error: `${FAKE_META_HEADER} header missing` };
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || typeof (v as { isTrusted?: unknown }).isTrusted !== 'boolean') {
      return { meta: null, error: `${FAKE_META_HEADER}: isTrusted missing` };
    }
    return { meta: v as FakeShareMeta, error: null };
  } catch (err) {
    return { meta: null, error: `${FAKE_META_HEADER}: ${String(err)}` };
  }
}

function bodyObject(req: FakeRequest): unknown {
  const raw = new TextDecoder().decode(req.body ?? new Uint8Array());
  if (raw.trim() === '') return {};
  if ((req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return JSON.parse(raw);
}

const STORY_JPG_RE = /^\/__fake__\/stories\/([^/]+)\.jpg$/;

export function createCore(opts: CoreOptions): FakeCore {
  const { store, assets } = opts;
  const token = opts.token ?? (() => randomBytes(4).toString('hex'));
  const emit = (e: CoreEvent) => opts.onEvent?.(e);

  function dashboardState(): DashboardState {
    return {
      knobs: store.knobs(),
      defaults: DEFAULT_KNOBS,
      stories: store.stories(),
      writes: store.writes(),
      violations: store.violations(),
      requests: store.requests(),
      certValidTo: opts.certValidTo,
    };
  }

  /** GET / and GET /create/story/ on www. */
  function shellRoute(req: FakeRequest, url: URL, route: 'home' | 'composer'): FakeResponse {
    const knobs = store.knobs();
    const next = encodeURIComponent(url.pathname);
    if (knobs.auth === 'out') return redirect(`${FAKE_PATHS.login}?next=${next}`);
    if (knobs.auth === 'challenge') return redirect(`${FAKE_PATHS.challenge}?next=${next}`);
    if (knobs.auth === 'codeentry') return redirect(`${FAKE_PATHS.codeEntry}?next=${next}`);
    // offhost=firstLoad: the composer route itself leaves Instagram, before the kill switch is armed.
    if (route === 'composer' && knobs.offhost === 'firstLoad') return redirect(OFFHOST_URL);
    const classification = classify(req.headers, knobs.classifier);
    if (route === 'composer') {
      // Desktop has no story entry (research §1 item 1): a 302 home, or (desktopComposer) the desktop shell.
      if (!classification.is_mobile && knobs.desktopComposer === '302') return redirect(FAKE_PATHS.home);
      // homeOnly models a composer reachable only from `/`; elsewhere an interstitial in between.
      if (classification.is_mobile && knobs.route === 'homeOnly') return redirect(FAKE_PATHS.home);
      if (classification.is_mobile && knobs.route === 'elsewhere') return redirect(FAKE_PATHS.elsewhere);
    }
    const shell = classification.is_mobile ? 'msite' : 'desktop';
    return html(200, shellHtml({ shell, route, knobs, classification, token }), {
      'accept-ch': ACCEPT_CH,
      vary: 'User-Agent, Sec-CH-UA-Mobile',
    });
  }

  function writeRoute(req: FakeRequest, host: string, url: URL, filter: string): FakeResponse {
    const write = store.addWrite({
      ...seenHeaders(req.headers),
      host,
      method: req.method.toUpperCase(),
      path: url.pathname + url.search,
      filter,
      bytes: req.body?.length ?? 0,
      contentType: req.headers['content-type'] ?? null,
    });
    emit({ kind: 'write', write });
    const origin = req.headers.origin;
    const cors: Record<string, string> = origin
      ? {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        }
      : {};
    if (req.method.toUpperCase() === 'OPTIONS') return { status: 204, headers: { ...NO_STORE, ...cors }, body: '' };
    return json(200, { status: 'fake-ok' }, cors);
  }

  /** Everything outside /__fake__/ on the Instagram hosts. Logged by the caller. */
  function siteRoute(req: FakeRequest, host: string, url: URL): { res: FakeResponse; write: boolean } {
    const filter = matchWriteFilter(host, url.pathname + url.search);
    if (filter) return { res: writeRoute(req, host, url, filter), write: true };
    const site = (res: FakeResponse) => ({ res, write: false });
    if (host === I_HOST) return site(text(404, 'not found'));
    const method = req.method.toUpperCase();
    const p = url.pathname;
    const read = method === 'GET' || method === 'HEAD';
    const known =
      p === FAKE_PATHS.home ||
      p === FAKE_PATHS.composer ||
      p === '/create/story' ||
      p.startsWith(FAKE_PATHS.login) ||
      p.startsWith(FAKE_PATHS.challenge) ||
      p.startsWith('/auth_platform/') ||
      p.startsWith(FAKE_PATHS.elsewhere) ||
      p === FAKE_PATHS.clientJs ||
      p === FAKE_PATHS.swDesktopShell ||
      p === FAKE_PATHS.swClaimLate;
    if (!known) return site(text(404, 'not found'));
    if (!read) return site(text(405, 'method not allowed', { allow: 'GET, HEAD' }));
    if (p === FAKE_PATHS.home) return site(shellRoute(req, url, 'home'));
    if (p === FAKE_PATHS.composer) return site(shellRoute(req, url, 'composer'));
    if (p === '/create/story') return site(redirect(`${FAKE_PATHS.composer}${url.search}`));
    if (p.startsWith(FAKE_PATHS.login)) return site(html(200, placeholderHtml('login', store.knobs())));
    if (p.startsWith(FAKE_PATHS.challenge) || p.startsWith('/auth_platform/')) {
      return site(html(200, placeholderHtml('challenge', store.knobs())));
    }
    if (p.startsWith(FAKE_PATHS.elsewhere)) return site(html(200, placeholderHtml('notice', store.knobs())));
    if (p === FAKE_PATHS.clientJs) return site(js(assets.clientJs));
    // Scope `/` from a script under /fake-sw/ needs Service-Worker-Allowed.
    const swAllowed = { 'service-worker-allowed': '/' };
    if (p === FAKE_PATHS.swDesktopShell) return site(js(assets.sw.desktopShell, swAllowed));
    return site(js(assets.sw.claimLate, swAllowed));
  }

  /** /__fake__/* on www: dashboard, recordings, knobs. Never logged as site requests. */
  function fakeRoute(req: FakeRequest, url: URL): FakeResponse {
    const method = req.method.toUpperCase();
    const p = url.pathname;
    const read = method === 'GET' || method === 'HEAD';
    if (p === '/__fake__') return redirect(FAKE_PATHS.dashboard);
    if (p === FAKE_PATHS.dashboard && read) {
      const state = dashboardState();
      return url.searchParams.get('fragment') === 'live'
        ? html(200, dashboardLiveHtml(state))
        : html(200, dashboardHtml(state));
    }
    if (p === FAKE_PATHS.stories) {
      if (method !== 'POST') return text(405, 'method not allowed', { allow: 'POST' });
      const body = req.body ?? new Uint8Array();
      if (body.length === 0) return json(400, { error: 'empty body' });
      const { meta, error } = parseMeta(req.headers[FAKE_META_HEADER]);
      const story = store.addStory({
        ...seenHeaders(req.headers),
        body,
        contentType: req.headers['content-type'] ?? null,
        meta,
        metaError: error,
      });
      emit({ kind: 'story', story });
      if (story.isTrusted !== true) {
        const violation = store.addViolation({
          kind: meta ? 'UNTRUSTED_SHARE' : 'SHARE_META_INVALID',
          storyId: story.id,
          detail: meta ? 'Share click had isTrusted=false (SG6)' : (error ?? 'invalid meta'),
        });
        emit({ kind: 'violation', violation });
      }
      return json(200, { id: story.id });
    }
    if (p === FAKE_PATHS.control) {
      if (method !== 'POST') return text(405, 'method not allowed', { allow: 'POST' });
      let body: unknown;
      try {
        body = bodyObject(req);
      } catch {
        body = null;
      }
      const control = (body as { control?: unknown } | null)?.control;
      const isTrusted = (body as { isTrusted?: unknown } | null)?.isTrusted;
      if (typeof control !== 'string' || control.length > 32) return json(400, { error: 'invalid control report' });
      if (isTrusted !== true) {
        const violation = store.addViolation({
          kind: 'UNTRUSTED_CONTROL',
          storyId: null,
          detail: `${control} click had isTrusted=${String(isTrusted)} (§1: nothing clicks in Instagram's page)`,
        });
        emit({ kind: 'violation', violation });
      }
      return json(200, { ok: true });
    }
    const jpg = STORY_JPG_RE.exec(p);
    if (jpg && read) {
      const bytes = store.storyBytes(jpg[1] ?? '');
      return bytes ? respond(200, 'image/jpeg', bytes) : text(404, 'no such story');
    }
    if (p === `${FAKE_PATHS.api}stories` && read) return json(200, store.stories());
    if (p === `${FAKE_PATHS.api}requests` && read) {
      return json(200, store.requests(Number(url.searchParams.get('since') ?? 0) || 0));
    }
    if (p === `${FAKE_PATHS.api}writes` && read) return json(200, store.writes());
    if (p === `${FAKE_PATHS.api}violations` && read) return json(200, store.violations());
    if (p === `${FAKE_PATHS.api}knobs`) {
      if (read) return json(200, store.knobs());
      if (method !== 'POST') return text(405, 'method not allowed', { allow: 'GET, POST' });
      const form = (req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded');
      let input: unknown;
      try {
        input = bodyObject(req);
      } catch (err) {
        return json(400, { error: 'invalid body', errors: [String(err)] });
      }
      const parsed = parseKnobPatch(input);
      if (!parsed.ok) return json(400, { error: 'invalid knobs', errors: parsed.errors });
      const knobs = store.setKnobs(parsed.patch);
      return form ? redirect(FAKE_PATHS.dashboard, 303) : json(200, knobs);
    }
    if (p === `${FAKE_PATHS.api}reset`) {
      if (method !== 'POST') return text(405, 'method not allowed', { allow: 'POST' });
      store.reset();
      return json(200, { ok: true, knobs: store.knobs() });
    }
    if (p === FAKE_PATHS.siteReset && read) {
      return html(200, siteResetHtml(), { 'clear-site-data': '"cache", "storage"' });
    }
    return text(404, 'not found');
  }

  function route(req: FakeRequest): FakeResponse {
    const host = normalizeHost(req.host);
    const method = req.method.toUpperCase();
    let url: URL;
    try {
      // Concatenated, not resolved: a path like `//x/y` must stay a path, never become a host.
      url = new URL(`https://fake.invalid${req.path.startsWith('/') ? '' : '/'}${req.path}`);
    } catch {
      return text(400, 'bad request');
    }
    if (url.pathname === FAKE_PATHS.health && (method === 'GET' || method === 'HEAD')) {
      return json(200, { ok: true, fake: true, certValidTo: opts.certValidTo, sourceHash: opts.sourceHash ?? null });
    }
    const isFake = url.pathname === '/__fake__' || url.pathname.startsWith('/__fake__/');
    if (isFake) return host === WWW_HOST ? fakeRoute(req, url) : text(404, 'not found');
    const { res, write } = IG_HOSTS.includes(host)
      ? siteRoute(req, host, url)
      : { res: text(404, 'not found'), write: false };
    store.addRequest({
      ...seenHeaders(req.headers),
      host,
      method,
      path: url.pathname + url.search,
      status: res.status,
      classification: classify(req.headers, store.knobs().classifier),
      tag: write ? 'WRITE_PATH_REACHED' : null,
    });
    return res;
  }

  return {
    store,
    handle(req) {
      try {
        return route(req);
      } catch (err) {
        return text(500, `fake-ig: internal error: ${String(err)}`);
      }
    },
  };
}
