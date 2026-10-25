/**
 * Server-rendered HTML of the fake (strategy §7.6): the msite/desktop shells, the login and
 * challenge placeholders (no form fields, ever), the /__fake__/ dashboard and the site-reset page.
 *
 * Shell head, in this order: viewport meta, the marker meta (unless `marker=off`), the
 * `InstagramUserAgent` JSON (always the first application/json script, C1), then the fake's
 * boot JSON for its own client. Neutral markup: nothing is copied from Instagram.
 */
import { strings } from './client/i18n.ts';
import {
  CONFIGURE_CHOICES,
  KNOB_CHOICES,
  KNOB_NAMES,
  type KnobName,
  type Knobs,
  MS_KNOBS,
  RUPLOAD_CHOICES,
  STRING_KNOBS,
} from './knobs.ts';
import { FAKE_PATHS, type FakeBoot } from './protocol.ts';
import type {
  ComposerViewRecord,
  LogRecord,
  RequestRecord,
  StoryRecord,
  UploadRecord,
  ViolationRecord,
  WriteRecord,
} from './store.ts';
import type { UaClassification } from './ua.ts';

export const MARKER_META = '<meta name="instapost-fake-instagram" content="1">';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ESC[c] ?? c);

/** JSON safe inside `<script>`: `<`, `>`, `&` and line separators are \u-escaped. */
export const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

const BASE_CSS =
  'html,body{margin:0;height:100%}body{font:15px/1.4 system-ui,-apple-system,sans-serif;background:#fff;color:#111}';

export interface ShellInput {
  shell: FakeBoot['shell'];
  route: FakeBoot['route'];
  knobs: Knobs;
  classification: UaClassification;
  /** Random token source for `drift=renamed` (ids and the UA script's data attribute). */
  token: () => string;
  /** C15 (`framed=unavailable`): the shell renders "Sorry, this page isn't available" only. */
  unavailable?: boolean;
}

export function shellHtml(i: ShellInput): string {
  const renamed = i.knobs.drift === 'renamed';
  const rootId = renamed ? `r${i.token()}` : 'root';
  const uaAttr = renamed ? `data-${i.token()}` : 'data-fake-ua';
  const boot: FakeBoot = {
    v: 1,
    shell: i.shell,
    route: i.route,
    ...(i.unavailable ? { unavailable: true as const } : {}),
    knobs: i.knobs,
    rootId,
  };
  return [
    `<!doctype html><html lang="${i.knobs.locale}"><head>`,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    i.knobs.marker === 'on' ? MARKER_META : '',
    `<script type="application/json" ${uaAttr}>${jsonForScript({ InstagramUserAgent: i.classification })}</script>`,
    `<script type="application/json" data-fake-boot>${jsonForScript(boot)}</script>`,
    `<title>${esc(strings(i.knobs.locale).brand)}</title>`,
    `<style>${BASE_CSS}</style>`,
    `</head><body><div id="${rootId}"></div>`,
    `<script type="module" src="${FAKE_PATHS.clientJs}"></script>`,
    '</body></html>',
  ].join('');
}

/** /accounts/login/, /challenge/, /auth_platform/… and /consent/: text only. Never inputs, forms or buttons. */
export function placeholderHtml(kind: 'login' | 'challenge' | 'notice', knobs: Knobs): string {
  const t = strings(knobs.locale);
  const [title, body] =
    kind === 'login'
      ? [t.loginTitle, t.loginBody]
      : kind === 'challenge'
        ? [t.challengeTitle, t.challengeBody]
        : [t.noticeTitle, t.noticeBody];
  return [
    `<!doctype html><html lang="${knobs.locale}"><head><meta charset="utf-8">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    knobs.marker === 'on' ? MARKER_META : '',
    `<title>${esc(title)}</title><style>${BASE_CSS}main{padding:32px 20px;max-width:420px;margin:auto}</style>`,
    `</head><body><main><h1>${esc(title)}</h1><p>${esc(body)}</p></main></body></html>`,
  ].join('');
}

/** GET /__fake__/reset: sent with `Clear-Site-Data: "cache", "storage"`; also unregisters service workers. */
export function siteResetHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>fake instagram: site reset</title>
<style>${BASE_CSS}main{padding:24px}</style></head><body><main>
<h1>Site data cleared</h1><p id="status">Unregistering service workers…</p>
<p><a href="${FAKE_PATHS.dashboard}">Back to the dashboard</a></p></main>
<script>
(async () => {
  const el = document.getElementById('status');
  try {
    const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
    await Promise.all(regs.map((r) => r.unregister()));
    el.textContent = 'Clear-Site-Data sent; unregistered ' + regs.length + ' service worker(s).';
  } catch (e) {
    el.textContent = 'Clear-Site-Data sent; unregistering failed: ' + e;
  }
})();
</script></body></html>`;
}

// ---- Dashboard ------------------------------------------------------------------------

export interface DashboardState {
  knobs: Knobs;
  defaults: Readonly<Knobs>;
  stories: StoryRecord[];
  writes: WriteRecord[];
  violations: ViolationRecord[];
  /** Oldest first; the dashboard shows the last 200, newest first. */
  requests: RequestRecord[];
  /** AM37: what the composer page showed (landscape gate), oldest first. */
  composerViews: ComposerViewRecord[];
  /** IF5: the photo uploads the server received, oldest first. */
  uploads: UploadRecord[];
  /** IF8: the page's story-creation telemetry and the control taps, oldest first. */
  log: LogRecord[];
  certValidTo: string | null;
}

/** IF8: log steps the dashboard shows, newest first. */
export const DASHBOARD_LOG = 80;

/** AM37: composer views the dashboard shows, newest first. */
export const DASHBOARD_COMPOSER_VIEWS = 20;

export const DASHBOARD_REQUESTS = 200;

const time = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour12: false });
const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10_240 ? 1 : 0)} KB`);
const knobText = (v: Knobs[KnobName]) => (Array.isArray(v) ? v.join(',') : String(v));

/** A short device label for a UA string, for the tables. */
function uaLabel(ua: string | null): string {
  if (!ua) return '—';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Macintosh/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'other';
  const m = /(HeadlessChrome|Chrome)\/(\d+)/.exec(ua);
  return m ? `${os} ${m[1]}/${m[2]}` : os;
}

function storyCard(s: StoryRecord): string {
  const dims = s.size ? `${s.size.w}×${s.size.h}` : 'not a JPEG';
  // ux.md P2: the autopilot's Share is an untrusted click by design; the owner's (Finish by hand) is trusted.
  const trust =
    s.isTrusted === true
      ? '<span class="ok">Share by hand</span>'
      : s.isTrusted === false
        ? '<span class="ok">Share by instapost</span>'
        : '<span class="bad">no meta</span>';
  const fb = s.shareToFacebook ? ' · <b>also to Facebook</b>' : '';
  const variant = s.meta?.variant ? ` · footer ${esc(s.meta.variant)}${s.meta.fbAuto ? ' (Facebook badge)' : ''}` : '';
  const g = s.meta?.geometry;
  return `<figure class="story">
<a class="phone" href="${FAKE_PATHS.stories}/${esc(s.id)}.jpg" target="_blank"><img src="${FAKE_PATHS.stories}/${esc(s.id)}.jpg" alt="story ${esc(s.id)}" loading="lazy"></a>
<figcaption><b>${esc(dims)}</b> · ${esc(kb(s.bytes))} · ${trust}${fb}${variant}<br>
${esc(time(s.t))} · ${esc(uaLabel(s.ua))}<br>
<span class="mono">mobile ${esc(s.ch['sec-ch-ua-mobile'] ?? '—')} · platform ${esc(s.ch['sec-ch-ua-platform'] ?? '—')}</span><br>
${g ? `<span class="mono">${esc(g.model)} · css ${g.css.w}×${g.css.h} @${g.dpr} · src ${g.source.w}×${g.source.h}</span><br>` : ''}
${s.meta ? `<span class="mono">${s.meta.sessionStarted ? `story session ${esc(s.meta.sessionId ?? '')}` : 'no story session'} · screen ${esc(s.meta.screenOrientation ?? '—')}</span><br>` : ''}
<span class="ua" title="${esc(s.ua ?? '')}">${esc(s.ua ?? '')}</span></figcaption></figure>`;
}

function table(head: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<p class="muted">${esc(empty)}</p>`;
  return `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

const td = (v: unknown, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${esc(v)}</td>`;

/** The polled part of the dashboard (`GET /__fake__/?fragment=live`). */
export function dashboardLiveHtml(s: DashboardState): string {
  const changed = KNOB_NAMES.filter((k) => knobText(s.knobs[k]) !== knobText(s.defaults[k]));
  const reqs = s.requests.slice(-DASHBOARD_REQUESTS).reverse();
  return `<p class="summary">${s.stories.length} stories · ${s.uploads.length} uploads · ${s.writes.length} writes · <span class="${s.violations.length ? 'bad' : ''}">${s.violations.length} violations</span> · ${s.requests.length} requests logged · knobs: ${
    changed.length
      ? changed.map((k) => `<b>${esc(k)}=${esc(knobText(s.knobs[k]))}</b>`).join(', ')
      : 'baseline defaults'
  }</p>
<h2>Stories</h2>
${s.stories.length ? `<div class="stories">${[...s.stories].reverse().map(storyCard).join('')}</div>` : '<p class="muted">No story published yet.</p>'}
<h2>Composer views (landscape gate)</h2>
${table(
  ['time', 'shown', 'via', 'screen', 'viewport', 'session', 'path'],
  s.composerViews
    .slice(-DASHBOARD_COMPOSER_VIEWS)
    .reverse()
    .map((v) => [
      td(time(v.t)),
      td(v.landscape ? 'rotate snackbar, no Share' : 'Share', v.landscape ? 'bad' : 'ok'),
      td(v.via),
      td(v.screenOrientation ?? '—', 'mono'),
      td(`${v.inner.w}×${v.inner.h}`),
      td(v.sessionStarted ? 'started by + → Story' : 'none (inserted)'),
      td(v.path, 'mono'),
    ]),
  'The composer has not shown a photo yet.',
)}
<h2>Autopilot evidence: uploads and telemetry</h2>
${table(
  ['time', 'upload id', 'bytes', 'answered', 'share click', 'session'],
  s.uploads
    .slice(-20)
    .reverse()
    .map((u) => [
      td(time(u.t)),
      td(u.uploadId, 'mono'),
      td(kb(u.bytes)),
      td(u.answer, u.answer === 'ok' ? 'ok' : 'bad'),
      td(u.meta ? (u.meta.isTrusted ? 'by hand (trusted)' : 'by instapost (untrusted)') : 'no meta'),
      td(u.meta?.sessionId ?? '—', 'mono'),
    ]),
  'No upload yet.',
)}
${table(
  ['time', 'step', 'doc', 'fields'],
  s.log
    .slice(-DASHBOARD_LOG)
    .reverse()
    .map((l) => [
      td(time(l.t)),
      td(l.step, l.step.startsWith('tap:') && l.fields.isTrusted === false ? 'mono' : ''),
      td(l.doc, 'mono'),
      td(JSON.stringify(l.fields), 'mono'),
    ]),
  'Nothing logged yet.',
)}
<h2>Violations</h2>
${table(
  ['time', 'kind', 'story', 'detail'],
  s.violations.map((v) => [td(time(v.t)), td(v.kind, 'bad'), td(v.storyId ?? '—', 'mono'), td(v.detail)]),
  'None.',
)}
<h2>Writes (WRITE_PATH_REACHED)</h2>
${table(
  ['time', 'method', 'host', 'path', 'filter', 'bytes', 'device', 'dest/mode', 'origin'],
  s.writes.map((w) => [
    td(time(w.t)),
    td(w.method),
    td(w.host),
    td(w.path, 'mono'),
    td(w.filter, 'mono'),
    td(w.bytes),
    td(uaLabel(w.ua)),
    td(`${w.fetch['sec-fetch-dest'] ?? '—'}/${w.fetch['sec-fetch-mode'] ?? '—'}`),
    td(w.origin ?? '—'),
  ]),
  'None.',
)}
<h2>Last ${DASHBOARD_REQUESTS} requests</h2>
${table(
  [
    '#',
    'time',
    'method',
    'host',
    'path',
    'status',
    'is_mobile',
    'device',
    'ch mobile',
    'ch platform',
    'dest/mode',
    'origin',
    'sw',
    'tag',
  ],
  reqs.map((r) => [
    td(r.seq),
    td(time(r.t)),
    td(r.method),
    td(r.host),
    td(r.path, 'mono'),
    td(r.status),
    td(r.classification.is_mobile, r.classification.is_mobile ? 'ok' : ''),
    `<td title="${esc(r.ua ?? '')}">${esc(uaLabel(r.ua))}</td>`,
    td(r.ch['sec-ch-ua-mobile'] ?? '—'),
    td(r.ch['sec-ch-ua-platform'] ?? '—'),
    td(`${r.fetch['sec-fetch-dest'] ?? '—'}/${r.fetch['sec-fetch-mode'] ?? '—'}`),
    td(r.origin ?? '—'),
    td(r.viaSw ? 'sw' : ''),
    td(r.tag ?? '', r.tag ? 'bad' : ''),
  ]),
  'No requests yet.',
)}`;
}

function knobField(name: KnobName, knobs: Knobs, defaults: Readonly<Knobs>): string {
  const value = knobText(knobs[name]);
  const cls = value !== knobText(defaults[name]) ? ' class="changed"' : '';
  const hint = `default ${knobText(defaults[name])}`;
  const free =
    name === 'geometry' ||
    name === 'insets' ||
    (MS_KNOBS as readonly string[]).includes(name) ||
    (STRING_KNOBS as readonly string[]).includes(name);
  if (free) {
    const ph =
      name === 'geometry'
        ? 'viewportDpr | source | fixed:WxH | cssFixed:WxH'
        : name === 'insets'
          ? 'top,bottom'
          : name === 'account'
            ? '<handle> | none | ambiguous'
            : name === 'rupload'
              ? `${RUPLOAD_CHOICES.join(' | ')} | slow:<ms>`
              : name === 'configure'
                ? `${CONFIGURE_CHOICES.join(' | ')} | slow:<ms>`
                : 'ms';
    return `<label${cls}><span>${name}</span><input name="${name}" value="${esc(value)}" placeholder="${esc(ph)}" title="${esc(hint)}"></label>`;
  }
  const options = (KNOB_CHOICES[name as keyof typeof KNOB_CHOICES] as readonly string[])
    .map((o) => `<option${o === value ? ' selected' : ''}>${esc(o)}</option>`)
    .join('');
  return `<label${cls}><span>${name}</span><select name="${name}" title="${esc(hint)}">${options}</select></label>`;
}

export function dashboardHtml(s: DashboardState): string {
  const api = ['stories', 'uploads', 'log', 'requests', 'writes', 'violations', 'composer-views', 'knobs']
    .map((n) => `<a href="${FAKE_PATHS.api}${n}">${n}</a>`)
    .join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>fake instagram: dashboard</title>
<style>
:root{--bg:#fafafa;--fg:#161616;--muted:#6b6b6b;--line:#ddd;--card:#fff;--ok:#1b7f3a;--bad:#c62828;--hl:#fff4d6}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#9a9a9a;--line:#333;--card:#1d1d1d;--ok:#5fd28a;--bad:#ff7b7b;--hl:#3a3018}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1400px;margin:auto;padding:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}
a{color:inherit}.muted{color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad);font-weight:600}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
form{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}
label{display:flex;flex-direction:column;gap:2px;font-size:12px;padding:4px;border-radius:6px}
label.changed{background:var(--hl)}label span{font-weight:600}
select,input{font:inherit;padding:4px 6px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
.actions{grid-column:1/-1;display:flex;gap:8px;align-items:center}
button{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid var(--line);background:var(--fg);color:var(--bg);cursor:pointer}
button.secondary{background:transparent;color:var(--fg)}
.stories{display:flex;flex-wrap:wrap;gap:16px}
.story{margin:0;width:200px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px;font-size:12px}
.phone{display:block;aspect-ratio:9/16;background:#000;border-radius:18px;border:3px solid #222;overflow:hidden}
.phone img{width:100%;height:100%;object-fit:contain;display:block}
.ua{display:block;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--card)}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:4px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{position:sticky;top:0;background:var(--card)}
</style></head><body><main>
<h1>fake instagram · dashboard</h1>
<p class="muted">Certificate valid to ${esc(s.certValidTo ?? 'unknown')} · API: ${api} · <a href="${FAKE_PATHS.siteReset}">clear this browser's site data</a></p>
<h2>Knobs</h2>
<form id="knobs" method="post" action="${FAKE_PATHS.api}knobs">
${KNOB_NAMES.map((k) => knobField(k, s.knobs, s.defaults)).join('\n')}
<div class="actions"><button type="submit">Apply knobs</button>
<button type="button" class="secondary" id="reset">Reset everything</button>
<span id="status" class="muted"></span></div>
</form>
<div id="live">${dashboardLiveHtml(s)}</div>
</main>
<script>
(() => {
  const live = document.getElementById('live');
  const status = document.getElementById('status');
  let last = live.innerHTML;
  async function poll() {
    try {
      const r = await fetch('${FAKE_PATHS.dashboard}?fragment=live', { cache: 'no-store' });
      const html = await r.text();
      if (r.ok && html !== last) { live.innerHTML = html; last = html; }
    } catch {}
    setTimeout(poll, 1500);
  }
  setTimeout(poll, 1500);
  document.getElementById('knobs').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    const r = await fetch('${FAKE_PATHS.api}knobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await r.json();
    status.textContent = r.ok ? 'Applied; reload the composer tab.' : (json.errors || []).join('; ');
    if (r.ok) setTimeout(() => location.reload(), 400);
  });
  document.getElementById('reset').addEventListener('click', async () => {
    await fetch('${FAKE_PATHS.api}reset', { method: 'POST' });
    location.reload();
  });
})();
</script></body></html>`;
}
