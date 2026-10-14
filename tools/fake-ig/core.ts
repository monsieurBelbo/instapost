/**
 * The fake Instagram, transport-free (strategy §6.2, §7.6): `handle(request) → response`.
 * server.ts is a thin node:https adapter; U16 drives this module directly.
 *
 * Routing is on the Host header without its port (AM7). Hosts other than www/i.instagram.com
 * (e.g. 127.0.0.1 or localhost, which the SPKI bypass also covers) get only /__fake__/health.
 * Every request outside /__fake__/ is logged with its UA, client hints, sec-fetch-* and origin
 * headers and the classification. Write paths are matched with the same WRITE_URL_FILTERS the
 * extension's block rules use, so the fake and the rules cannot drift apart.
 *
 * The write paths behave as Instagram's do (ux.md §6.1, C13, IF5): the photo upload on i.instagram.com
 * (`/rupload_igphoto/fb_uploader_<id>`, CORS for www with credentials, the preflight echoing the requested
 * headers) and the publish request on www (`/api/v1/media/configure_to_story/`), each answering as its
 * knob (`rupload`, `configure`) says. A story is stored only when the publish request succeeded for an
 * upload id that has an upload. `slow`, `hang` and `reset` are transport behaviours the server adapter
 * applies (FakeResponse.wire).
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
import { DEFAULT_KNOBS, type Knobs, parseKnobPatch, slowMs } from './knobs.ts';
import {
  FAKE_CONTROLS,
  FAKE_META_HEADER,
  FAKE_PATHS,
  FAKE_VIA_SW_HEADER,
  type FakeComposerView,
  type FakeControl,
  type FakeLogInput,
  type FakeShareMeta,
  I_HOST,
  IG_HOSTS,
  OFFHOST_URL,
  RUPLOAD_PATH_RE,
  UNTRUSTED_ALLOWED,
  WWW_HOST,
  WWW_ORIGIN,
} from './protocol.ts';
import type {
  ComposerViewRecord,
  LogRecord,
  SeenHeaders,
  Store,
  StoryRecord,
  UploadRecord,
  ViolationRecord,
  WriteRecord,
} from './store.ts';
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
  /**
   * Transport behaviour the server adapter applies (knobs `rupload`, `configure`): answer after `delayMs`,
   * or `drop` the connection: `reset` destroys the socket (the page sees status 0), `hang` never answers.
   */
  wire?: { delayMs?: number; drop?: 'reset' | 'hang' };
}

export interface CoreAssets {
  /** esbuild bundle of client/main.tsx. */
  clientJs: string;
  sw: { claimOnRegister: string; desktopShell: string; claimLate: string };
}

export type CoreEvent =
  | { kind: 'write'; write: WriteRecord }
  | { kind: 'upload'; upload: UploadRecord }
  | { kind: 'story'; story: StoryRecord }
  | { kind: 'publish'; status: number; answer: string; uploadId: string | null }
  | { kind: 'violation'; violation: ViolationRecord }
  | { kind: 'composerView'; view: ComposerViewRecord }
  | { kind: 'log'; log: LogRecord };

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

const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const shortStringOrNull = (x: unknown): x is string | null => x === null || (typeof x === 'string' && x.length <= 64);

/** AM37: a composer-view report from the fake's page; null unless well formed (the page is ours, the check cheap). */
export function parseComposerView(v: unknown): FakeComposerView | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const inner = o.inner as Record<string, unknown> | null | undefined;
  const ok =
    typeof o.landscape === 'boolean' &&
    typeof o.share === 'boolean' &&
    (o.via === 'screen' || o.via === 'viewport') &&
    shortStringOrNull(o.screenOrientation) &&
    typeof inner === 'object' &&
    inner !== null &&
    isFiniteNum(inner.w) &&
    isFiniteNum(inner.h) &&
    typeof o.sessionStarted === 'boolean' &&
    typeof o.path === 'string' &&
    o.path.length <= 512;
  if (!ok) return null;
  return {
    landscape: o.landscape as boolean,
    share: o.share as boolean,
    via: o.via as FakeComposerView['via'],
    screenOrientation: o.screenOrientation as string | null,
    inner: { w: inner.w as number, h: inner.h as number },
    sessionStarted: o.sessionStarted as boolean,
    path: o.path as string,
  };
}

const isControl = (x: unknown): x is FakeControl => (FAKE_CONTROLS as readonly unknown[]).includes(x);
const DOC_RE = /^[0-9a-z]{1,32}$/;

/** IF9: a control report from the fake's page; null unless well formed. A missing isTrusted counts as untrusted. */
export function parseControlReport(
  v: unknown,
): { control: FakeControl; isTrusted: boolean; repeat: boolean; doc: string } | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isControl(o.control)) return null;
  const doc = typeof o.doc === 'string' && DOC_RE.test(o.doc) ? o.doc : '-';
  return { control: o.control, isTrusted: o.isTrusted === true, repeat: o.repeat === true, doc };
}

const STEP_RE = /^[a-z][a-z0-9_:]{0,63}$/;
const FIELD_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

/** IF8: a telemetry step from the fake's page: a step name, a doc id and at most 20 primitive fields. */
export function parseLogInput(v: unknown): FakeLogInput | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.step !== 'string' || !STEP_RE.test(o.step)) return null;
  if (typeof o.doc !== 'string' || !DOC_RE.test(o.doc)) return null;
  const raw = o.fields ?? {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > 20) return null;
  const fields: FakeLogInput['fields'] = {};
  for (const [k, val] of entries) {
    if (!FIELD_RE.test(k)) return null;
    if (val === null || typeof val === 'boolean' || (typeof val === 'number' && Number.isFinite(val))) fields[k] = val;
    else if (typeof val === 'string' && val.length <= 200) fields[k] = val;
    else return null;
  }
  return { step: o.step, doc: o.doc, fields };
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
      composerViews: store.composerViews(),
      uploads: store.uploads(),
      log: store.log(),
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

  /**
   * IF5: CORS for the upload host, as Instagram's i.instagram.com answers www: the page's origin with
   * credentials, and the preflight echoing exactly the headers it asks for (`*` does not cover a
   * credentialed request). Only for www.
   */
  function corsFor(req: FakeRequest): Record<string, string> {
    const origin = req.headers.origin;
    if (origin !== WWW_ORIGIN) return {};
    return {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      vary: 'Origin',
    };
  }

  function preflight(req: FakeRequest, cors: Record<string, string>): FakeResponse {
    const asked = req.headers['access-control-request-headers'];
    return {
      status: 204,
      headers: {
        ...NO_STORE,
        ...cors,
        ...(Object.keys(cors).length > 0
          ? {
              'access-control-allow-methods': 'POST, GET, OPTIONS',
              ...(asked ? { 'access-control-allow-headers': asked } : {}),
              'access-control-max-age': '0',
            }
          : {}),
      },
      body: '',
    };
  }

  const wireOf = (knob: string): FakeResponse['wire'] | undefined => {
    if (knob === 'reset' || knob === 'hang') return { drop: knob };
    const ms = slowMs(knob);
    return ms !== null ? { delayMs: ms } : undefined;
  };

  function recordWrite(req: FakeRequest, host: string, url: URL, filter: string): void {
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
  }

  /** C13: the photo upload, `POST i.instagram.com/rupload_igphoto/fb_uploader_<id>`. */
  function ruploadRoute(req: FakeRequest, uploadId: string, knobs: Knobs): FakeResponse {
    const cors = knobs.rupload === 'cors' ? {} : corsFor(req);
    const method = req.method.toUpperCase();
    if (method === 'OPTIONS') return preflight(req, corsFor(req));
    if (method !== 'POST') return text(405, 'method not allowed', { allow: 'POST, OPTIONS', ...cors });
    const { meta, error } = parseMeta(req.headers[FAKE_META_HEADER]);
    const upload = store.addUpload({
      ...seenHeaders(req.headers),
      uploadId,
      body: req.body ?? new Uint8Array(),
      contentType: req.headers['x-entity-type'] ?? req.headers['content-type'] ?? null,
      meta,
      metaError: error,
      answer: knobs.rupload,
    });
    emit({ kind: 'upload', upload });
    if (!meta) {
      const violation = store.addViolation({
        kind: 'SHARE_META_INVALID',
        storyId: uploadId,
        detail: error ?? 'no meta',
      });
      emit({ kind: 'violation', violation });
    }
    if (knobs.rupload === '500') return json(500, { message: 'upload failed', status: 'fail' }, cors);
    const ok = json(200, { upload_id: uploadId, xsharing_nonces: {}, status: 'ok' }, cors);
    const wire = wireOf(knobs.rupload);
    return wire ? { ...ok, wire } : ok;
  }

  /** C13: the publish request, `POST www.instagram.com/api/v1/media/configure_to_story/` (same origin). */
  function configureRoute(req: FakeRequest, knobs: Knobs): FakeResponse {
    const method = req.method.toUpperCase();
    if (method === 'OPTIONS') return preflight(req, corsFor(req));
    if (method !== 'POST') return text(405, 'method not allowed', { allow: 'POST' });
    let form: Record<string, string> = {};
    try {
      form = Object.fromEntries(new URLSearchParams(new TextDecoder().decode(req.body ?? new Uint8Array())));
    } catch {
      form = {};
    }
    const uploadId = /^\d{1,20}$/.test(form.upload_id ?? '') ? (form.upload_id as string) : null;
    const answer = knobs.configure;
    // Server truth: the story exists when the server accepted the request for a known upload, whether or
    // not the page then reads the answer (slow, hang and reset lose only the answer). One story per upload
    // id: a repeated publish of the same upload answers with the same media (idempotent, as Instagram is
    // assumed to be). Chrome itself resends a POST whose reused connection was reset before any answer
    // byte (`configure=reset`, observed 2026-10-13: up to 4 sends of one XHR, which the page and its
    // resource timing see once), so a non-idempotent fake would show stories the page never asked for.
    const accepted = answer === 'ok' || answer === 'reset' || answer === 'hang' || slowMs(answer) !== null;
    let mediaId: string | null = null;
    const published = uploadId !== null ? store.stories().find((s) => s.uploadId === uploadId) : undefined;
    if (accepted && published) mediaId = published.id;
    else if (accepted && uploadId !== null) {
      const up = store.upload(uploadId);
      if (up) {
        const story = store.addStory({
          upload: up.record,
          body: up.body,
          shareToFacebook: form.share_to_facebook === 'true',
          configure: seenHeaders(req.headers),
        });
        mediaId = story.id;
        emit({ kind: 'story', story });
      }
    }
    const status = (r: FakeResponse) => {
      emit({ kind: 'publish', status: r.wire?.drop ? 0 : r.status, answer, uploadId });
      return r;
    };
    const next = encodeURIComponent('/');
    switch (answer) {
      case '400':
        return status(json(400, { message: 'Media not found or unavailable', status: 'fail' }));
      case 'feedback':
        return status(
          json(400, {
            message: 'feedback_required',
            spam: true,
            feedback_title: 'Try again later',
            feedback_message: 'We restrict certain activity to protect our community.',
            status: 'fail',
          }),
        );
      case 'login401':
        return status(
          json(401, {
            message: 'Please wait a few minutes before you try again.',
            require_login: true,
            status: 'fail',
          }),
        );
      case 'checkpoint':
        return status(
          json(400, {
            message: 'checkpoint_required',
            checkpoint_url: `${FAKE_PATHS.challenge}?next=${next}`,
            lock: true,
            status: 'fail',
          }),
        );
      case '500':
        return status(json(500, { message: 'Something went wrong', status: 'fail' }));
      case 'redirectLogin':
        return status(redirect(`${FAKE_PATHS.login}?next=${next}`));
      case 'html200':
        return status(html(200, placeholderHtml('login', knobs)));
      default: {
        if (uploadId === null || mediaId === null) {
          return status(json(400, { message: 'Uploaded image is invalid', status: 'fail' }));
        }
        const ok = json(200, { media: { pk: mediaId, id: `${mediaId}_fake`, code: mediaId }, status: 'ok' });
        const wire = wireOf(answer);
        return status(wire ? { ...ok, wire } : ok);
      }
    }
  }

  /** Every other write-path request (never sent by the fake's own client): recorded, answered 200. */
  function otherWrite(req: FakeRequest): FakeResponse {
    const cors = corsFor(req);
    if (req.method.toUpperCase() === 'OPTIONS') return preflight(req, cors);
    return json(200, { status: 'fake-ok' }, cors);
  }

  function writeRoute(req: FakeRequest, host: string, url: URL, filter: string): FakeResponse {
    recordWrite(req, host, url, filter);
    const knobs = store.knobs();
    const rupload = host === I_HOST ? RUPLOAD_PATH_RE.exec(url.pathname) : null;
    if (rupload) return ruploadRoute(req, rupload[1] as string, knobs);
    if (host === WWW_HOST && url.pathname === FAKE_PATHS.configure) return configureRoute(req, knobs);
    return otherWrite(req);
  }

  /** IF6: Instagram's tray refresh after a published story (`tray=fail` answers 500). */
  function graphqlRoute(req: FakeRequest): FakeResponse {
    if (req.method.toUpperCase() !== 'POST') return text(405, 'method not allowed', { allow: 'POST' });
    if (store.knobs().tray === 'fail') return json(500, { message: 'execution error', status: 'fail' });
    return json(200, { data: { xdt_api__v1__feed__reels_tray: { tray: [] } }, status: 'ok' });
  }

  /** Everything outside /__fake__/ on the Instagram hosts. Logged by the caller. */
  function siteRoute(req: FakeRequest, host: string, url: URL): { res: FakeResponse; write: boolean } {
    const filter = matchWriteFilter(host, url.pathname + url.search);
    if (filter) return { res: writeRoute(req, host, url, filter), write: true };
    const site = (res: FakeResponse) => ({ res, write: false });
    if (host === I_HOST) return site(text(404, 'not found'));
    const method = req.method.toUpperCase();
    const p = url.pathname;
    if (p === FAKE_PATHS.graphql) return site(graphqlRoute(req));
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
      p === FAKE_PATHS.beacon ||
      p === FAKE_PATHS.swClaimOnRegister ||
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
    if (p === FAKE_PATHS.beacon) return site({ status: 204, headers: { ...NO_STORE }, body: '' });
    // Scope `/` from a script under /fake-sw/ needs Service-Worker-Allowed. The query of a
    // claim-on-register URL (enableAddToHomeScreen, zenon_device_id) only makes each load a new worker.
    const swAllowed = { 'service-worker-allowed': '/' };
    if (p === FAKE_PATHS.swClaimOnRegister) return site(js(assets.sw.claimOnRegister, swAllowed));
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
    if (p === FAKE_PATHS.control) {
      if (method !== 'POST') return text(405, 'method not allowed', { allow: 'POST' });
      let body: unknown;
      try {
        body = bodyObject(req);
      } catch {
        body = null;
      }
      const report = parseControlReport(body);
      if (!report) return json(400, { error: 'invalid control report' });
      const { control, isTrusted, repeat } = report;
      store.addLog({ step: `tap:${control}`, doc: report.doc, fields: { isTrusted, repeat: repeat === true } });
      const violate = (kind: ViolationRecord['kind'], detail: string) => {
        const violation = store.addViolation({ kind, storyId: null, detail });
        emit({ kind: 'violation', violation });
      };
      if (control === 'share' && repeat) {
        violate(
          'DOUBLE_SHARE',
          `a second Share in one composer session (isTrusted=${isTrusted}): Instagram would post twice`,
        );
      } else if (control === 'retry' && !isTrusted) {
        violate('RETRY_CLICKED', 'the "Upload failed." Retry was clicked from script: instapost never retries');
      } else if (!isTrusted && !UNTRUSTED_ALLOWED.includes(control)) {
        violate('TAP_OUTSIDE_ALLOWLIST', `${control} clicked with isTrusted=false (ux.md P2: only +, Story and Share)`);
      }
      return json(200, { ok: true });
    }
    if (p === FAKE_PATHS.log) {
      if (method !== 'POST') return text(405, 'method not allowed', { allow: 'POST' });
      let body: unknown;
      try {
        body = bodyObject(req);
      } catch {
        body = null;
      }
      const input = parseLogInput(body);
      if (!input) return json(400, { error: 'invalid log step' });
      emit({ kind: 'log', log: store.addLog(input) });
      return json(200, { ok: true });
    }
    if (p === FAKE_PATHS.composerView) {
      if (method !== 'POST') return text(405, 'method not allowed', { allow: 'POST' });
      let body: unknown;
      try {
        body = bodyObject(req);
      } catch {
        body = null;
      }
      const parsed = parseComposerView(body);
      if (!parsed) return json(400, { error: 'invalid composer view' });
      emit({ kind: 'composerView', view: store.addComposerView(parsed) });
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
    if (p === `${FAKE_PATHS.api}composer-views` && read) return json(200, store.composerViews());
    if (p === `${FAKE_PATHS.api}uploads` && read) return json(200, store.uploads());
    if (p === `${FAKE_PATHS.api}log` && read) {
      return json(200, store.log(Number(url.searchParams.get('since') ?? 0) || 0));
    }
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
