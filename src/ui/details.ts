/**
 * Details (ux.md §4.13, IU6): the structural facts of a run, as rows. Pure. The diagnostics rows of the
 * hand-off era (Page, Window, Browser, Mobile page, Viewport, Screen, Story input, Service worker, Canvas)
 * moved here from messages.ts; the autopilot adds Result, Evidence, Account, Story entry, Share control,
 * Image check, Steps, Quality, Requests, Alarms, Code and Run.
 *
 * Never a Meta-host URL and never a write-endpoint string in this module (check-bundle T3): request paths
 * arrive as data from the background, already normalised. Labels and values are in the current language
 * (AM44); Copy diagnostics stays structural JSON.
 */
import type { Size } from '../core/geometry/fit.ts';
import type {
  AccountFacts,
  ComposeFacts,
  EntryFacts,
  Evidence,
  HandoffMode,
  NetEntry,
  RunResult,
  StepTimes,
  WindowDiagnostics,
} from '../core/handoff/state.ts';
import type { BrowserFlavour } from '../core/ig-contract/browser-flavour.ts';
import {
  type CheckResult,
  isStoryCandidateAccept,
  type OrientationShimState,
  type PageOrientation,
  type ProbeReport,
} from '../core/ig-contract/contract.ts';
import { type ComposerRoute, isComposerPath } from '../core/ig-contract/urls.ts';
import { at, clock, clockSeconds, whyText } from './copy.ts';
import { t } from './i18n.ts';

const size = (x: Size): string => `${Math.round(x.w)}×${Math.round(x.h)}`;

// ---- the hand-off era rows (U1, AM37) ----------------------------------------------------------

function shimWords(shim: OrientationShimState): string {
  switch (shim) {
    case 'installed':
      return t('details.shim.installed');
    case 'present':
      return t('details.shim.present');
    case 'portrait':
      return t('details.shim.portrait');
    case 'absent':
      return t('details.shim.absent');
    case 'failed':
      return t('details.shim.failed');
    case 'off':
      return t('details.shim.off');
  }
}

/** AM37: the Screen row. */
export function screenText(o: PageOrientation): string {
  const words = o.afterComposerMount ? t('details.shim.late') : shimWords(o.shim);
  return `${o.type ?? t('details.unknown')} (${words})`;
}

/** U1: the Story input row. */
export function storyInputText(probe: ProbeReport, c4: CheckResult | undefined, drift: boolean): string {
  const seen = probe.acceptSeen ?? [];
  const lists = (xs: string[]): string => xs.map((a) => a || t('details.input.noAccept')).join('; ');
  let text: string;
  if (probe.storyInput === 'absent') {
    text = seen.length === 0 ? t('details.input.none') : t('details.input.noneImageOnly', { lists: lists(seen) });
  } else if (probe.acceptOk) {
    text = t('details.input.present');
  } else {
    const candidates = seen.filter(isStoryCandidateAccept);
    const shown = lists(candidates.length ? candidates : seen);
    text = drift ? t('details.input.changed', { lists: shown }) : t('details.input.differs', { lists: shown });
  }
  return c4 === 'unknown' ? t('details.input.notChecked', { text }) : text;
}

/** U1/AF-9: the Page row. */
export function pageText(route: ComposerRoute | undefined, path: string | undefined): string {
  if (path === undefined) {
    if (route === 'homeOnly') return `/ ${t('details.page.home')}`;
    if (route === 'direct') return `/create/story/ ${t('details.page.direct')}`;
    return t('details.unknown');
  }
  if (path === '/') return `/ ${t('details.page.home')}`;
  if (isComposerPath(path)) {
    if (route === 'direct') return `${path} ${t('details.page.direct')}`;
    if (route === 'homeOnly') return `${path} ${t('details.page.fromHome')}`;
    return `${path} ${t('details.page.composer')}`;
  }
  return path;
}

/** W5/§4.13: the Window row. */
export function windowText(w: WindowDiagnostics, raised = false): string {
  const fit = w.updates.find((u) => u.step === 'fit');
  const asked = fit ? size(fit.target) : t('details.window.outer', { w: w.requested.width, h: w.requested.height });
  const got = w.finalTab ? size(w.finalTab) : w.createdTab ? size(w.createdTab) : t('details.unknown');
  const attempts =
    w.attempts === 1 ? t('details.window.attempt', { n: w.attempts }) : t('details.window.attempts', { n: w.attempts });
  const calls = w.updates.filter((u) => u.step !== 'refit').reduce((n, u) => n + (u.applied ?? 1), 0);
  const reapplied = calls > w.attempts ? t('details.window.reapplied', { n: calls }) : '';
  const created =
    w.created && (w.created.width !== w.requested.width || w.created.height !== w.requested.height)
      ? t('details.window.created', {
          w: w.created.width,
          h: w.created.height,
          rw: w.requested.width,
          rh: w.requested.height,
        })
      : '';
  const manual = w.manualResize ? t('details.window.manual') : '';
  const r = w.updates.find((u) => u.step === 'refit');
  const refit = r ? (r.fitted ? t('details.window.refitted') : t('details.window.refitIgnored')) : '';
  const docked = w.docked ? t('details.window.docked') : '';
  return t('details.window', {
    asked,
    got,
    attempts,
    reapplied,
    manual,
    refit,
    created,
    docked,
    raised: raised ? t('details.yes') : t('details.no'),
  });
}

/** P6: the Browser row. */
export function browserText(f: BrowserFlavour): string {
  switch (f) {
    case 'arc':
      return t('details.browser.arc');
    case 'chrome':
      return 'Google Chrome';
    case 'edge':
      return 'Microsoft Edge';
    case 'chromium':
      return 'Chromium';
    case 'unknown':
      return t('details.unknown');
  }
}

/** P1/P3: the Service worker row. */
export function serviceWorkerText(probe: ProbeReport, intercepted = false): string {
  if (intercepted || probe.swIntercepted === true) return t('details.sw.intercepts');
  const control =
    probe.swControlled === true
      ? t('details.sw.controls')
      : probe.swControlled === false
        ? t('details.sw.notInControl')
        : t('details.unknown');
  return probe.swIntercepted === 'unknown' ? t('details.sw.interceptionUnknown', { control }) : control;
}

// ---- the autopilot rows (§4.13) ---------------------------------------------------------------

export function resultRowText(r: RunResult): string {
  switch (r.kind) {
    case 'posted': {
      if (r.markedBy === 'owner') return t('details.result.markedPosted');
      const text = r.late ? t('details.result.postedLate') : t('details.result.posted');
      return r.killed ? t('details.result.thenKilled', { text, code: r.killed }) : text;
    }
    case 'notPosted':
      if (r.markedBy === 'owner') return t('details.result.markedNotPosted');
      return t('details.result.notPosted', { code: r.code ?? 'UPLOAD_FAILED' });
    case 'unknown':
      return r.code === 'TEST_LEAK'
        ? t('details.result.testLeak')
        : t('details.result.unknown', { why: whyText(r.why, r.detail) });
    case 'tested':
      return t('details.result.tested');
    case 'shareTested':
      return t('details.result.shareTested');
    case 'checked':
      return r.lockedTo && r.account
        ? t('details.result.checkedLocked', { account: at(r.account), locked: at(r.lockedTo) })
        : t('details.result.checked');
    case 'stopped':
      return r.stoppedBy === 'window' ? t('details.result.stoppedWindow') : t('details.result.stopped');
  }
}

const hostName = (h: NetEntry['host']): string => (h === 'www' ? '' : h === 'i' ? 'i.' : t('details.request.other'));

/** One request after Share: `POST? i./rupload… 200 application/json`, digits already `<n>`. */
export function requestText(e: NetEntry): string {
  const type = e.type ? ` ${e.type.split(';')[0]}` : '';
  const redirected = e.redirected ? t('details.request.redirected') : '';
  return `${hostName(e.host)}${e.path} ${e.status}${type}${redirected} +${(e.end / 1000).toFixed(1)} s`;
}

/** The Evidence row: the share, the requests that decided, and the corroboration. */
export function evidenceText(ev: Evidence): string {
  const parts: string[] = [];
  if (ev.sharedAt !== null) {
    const time = clockSeconds(ev.sharedAt);
    parts.push(ev.sharedBy === 'owner' ? t('details.ev.shareByYou', { time }) : t('details.ev.share', { time }));
  }
  const upload = ev.net.find((e) => e.host === 'i' && e.path.startsWith('/rupload'));
  const publish = ev.net.find((e) => e.host === 'www' && e.path.includes('/media/configure'));
  if (upload) parts.push(t('details.ev.upload', { status: upload.status }));
  if (publish) {
    parts.push(
      t('details.ev.publish', {
        status: publish.status,
        type: publish.type ? ` ${publish.type.split(';')[0]}` : '',
        redirect: publish.redirected ? t('details.ev.redirected') : t('details.ev.noRedirect'),
      }),
    );
  }
  if (!upload && !publish) parts.push(t('details.ev.none'));
  if (ev.ui.wentHomeAt !== null && ev.sharedAt !== null) {
    parts.push(t('details.ev.wentHome', { s: ((ev.ui.wentHomeAt - ev.sharedAt) / 1000).toFixed(1) }));
  }
  if (ev.ui.progressSeen) parts.push(t('details.ev.progress'));
  if (ev.ui.toast !== 'none')
    parts.push(ev.ui.toast === 'action' ? t('details.ev.toastAction') : t('details.ev.toast'));
  return parts.join(' · ');
}

export function accountText(a: AccountFacts): string {
  const detected = a.detected
    ? t('details.account.detected', { handle: at(a.detected) })
    : t('details.account.unreadable', { n: a.candidates });
  const expected = a.expected
    ? t('details.account.expected', { handle: at(a.expected) })
    : t('details.account.noneExpected');
  const by =
    a.confirmedBy === 'owner'
      ? t('details.account.byYou')
      : a.confirmedBy === 'learned'
        ? t('details.account.remembered')
        : a.confirmedBy === 'unlocked'
          ? t('details.account.unlocked')
          : '';
  return `${detected}${expected}${by}`;
}

export function entryText(e: EntryFacts): string {
  const menu =
    e.menuCount === null
      ? t('details.entry.noMenu')
      : e.menuCount === 1
        ? t('details.entry.menuOne')
        : t('details.entry.menu', { n: e.menuCount });
  const story =
    e.storyIndex === null
      ? ''
      : e.fpUsed
        ? t('details.entry.storyKnown', { n: e.storyIndex + 1 })
        : t('details.entry.storyTrial', { n: e.storyIndex + 1 });
  const armed = e.armedMs === null ? '' : t('details.entry.armed', { s: (e.armedMs / 1000).toFixed(1) });
  return t('details.entry', { menu, story, armed, trials: e.trials, plus: e.plusTaps, result: e.result });
}

export function shareControlText(c: ComposeFacts): string {
  if (c.landscape) return t('details.share.landscape');
  if (c.controls !== 1) return t('details.share.controls', { n: c.controls });
  return t('details.share.footer', {
    variant: c.variant ?? '?',
    badge: c.fbAuto ? t('details.share.badge') : '',
    settled: c.settled ? '' : t('details.share.notSettled'),
  });
}

export function imageCheckText(c: ComposeFacts): string | null {
  if (c.imageScore === null) return null;
  return t('details.imageCheck', { score: c.imageScore.toFixed(2) });
}

/** §4.13 Steps: `opened 0.0 · Instagram 3.5 · account 3.7 · armed 5.1 · photo in composer 7.4 · Share 9.6 · confirmed 11.4 s`. */
export function stepsText(s: StepTimes): string {
  const since = (x: number | undefined): string | null => (x === undefined ? null : ((x - s.opened) / 1000).toFixed(1));
  const parts: [string, number | undefined][] = [
    [t('details.steps.instagram'), s.instagram],
    [t('details.steps.account'), s.account],
    [t('details.steps.armed'), s.armed],
    [t('details.steps.composer'), s.composer],
    [t('details.steps.share'), s.share],
    [t('details.steps.confirmed'), s.confirmed],
  ];
  const shown = parts.flatMap(([label, x]) => {
    const v = since(x);
    return v === null ? [] : [`${label} ${v}`];
  });
  return t('details.steps.unit', { steps: [`${t('details.steps.opened')} 0.0`, ...shown].join(' · ') });
}

/** §4.13 Quality (C8): how large Instagram redrew the photo. */
export function qualityText(canvas: Size | null): string | null {
  if (!canvas || canvas.h <= 0) return null;
  return t('details.quality', { w: canvas.w, h: canvas.h, pct: Math.round((canvas.h / 1920) * 100) });
}

export interface DetailRow {
  key: string;
  label: string;
  value: string;
}

export interface DetailInput {
  handoffId?: string | null;
  mode?: HandoffMode;
  result?: RunResult | null;
  evidence?: Evidence | null;
  account?: AccountFacts | null;
  entry?: EntryFacts | null;
  compose?: ComposeFacts | null;
  steps?: StepTimes | null;
  window?: WindowDiagnostics | null;
  raised?: boolean;
  browser?: BrowserFlavour | null;
  probe?: ProbeReport | null;
  decision?: {
    probe: ProbeReport;
    c4: CheckResult | undefined;
    path: string | undefined;
    route: ComposerRoute | undefined;
  } | null;
  code?: string | null;
}

/** Every row there is something to say for, in §4.13's order. */
export function detailRows(d: DetailInput): DetailRow[] {
  const rows: DetailRow[] = [];
  const add = (key: string, label: string, value: string | null | undefined) => {
    if (value) rows.push({ key, label, value });
  };
  if (d.result) add('result', t('details.row.result'), resultRowText(d.result));
  if (d.evidence) add('evidence', t('details.row.evidence'), evidenceText(d.evidence));
  if (d.account && d.account.decision !== null) add('account', t('details.row.account'), accountText(d.account));
  if (d.entry) add('story-entry', t('details.row.storyEntry'), entryText(d.entry));
  if (d.compose) {
    add('share-control', t('details.row.shareControl'), shareControlText(d.compose));
    add('image-check', t('details.row.imageCheck'), imageCheckText(d.compose));
  }
  if (d.steps) add('steps', t('details.row.steps'), stepsText(d.steps));
  if (d.window) add('window', t('details.row.window'), windowText(d.window, d.raised === true));
  if (d.compose) add('quality', t('details.row.quality'), qualityText(d.compose.canvas));
  if (d.decision) add('page', t('details.row.page'), pageText(d.decision.route, d.decision.path));
  if (d.browser) add('browser', t('details.row.browser'), browserText(d.browser));
  const p = d.probe ?? d.decision?.probe ?? null;
  if (p) {
    const yes = (b: boolean | 'unknown') =>
      b === 'unknown' ? t('details.unknown') : b ? t('details.yes') : t('details.no');
    add('mobile', t('details.row.mobile'), yes(p.isMobile));
    add(
      'viewport',
      t('details.row.viewport'),
      t('details.viewport', {
        w: p.inner.w,
        h: p.inner.h,
        dpr: p.dpr,
        orientation: p.portrait ? t('details.portrait') : t('details.landscape'),
      }),
    );
    if (p.orientation) add('screen', t('details.row.screen'), screenText(p.orientation));
  }
  if (d.decision) {
    add(
      'story-input',
      t('details.row.storyInput'),
      storyInputText(d.decision.probe, d.decision.c4, d.code === 'ACCEPT_DRIFT'),
    );
  }
  if (p) add('service-worker', t('details.row.serviceWorker'), serviceWorkerText(p, d.code === 'SW_INTERCEPTS'));
  if (p?.canvas) {
    add(
      'canvas',
      t('details.row.canvas'),
      t('details.canvas', {
        w: p.canvas.w,
        h: p.canvas.h,
        cw: Math.round(p.canvas.css.w),
        ch: Math.round(p.canvas.css.h),
      }),
    );
  }
  if (d.evidence && d.evidence.net.length > 0) {
    add('requests', t('details.row.requests'), d.evidence.net.map(requestText).join('; '));
  }
  if (d.result && d.result.alarms.length > 0) add('alarms', t('details.row.alarms'), d.result.alarms.join(', '));
  if (d.code) add('code', t('details.row.code'), d.code);
  if (d.handoffId) add('run', t('details.row.run'), `${d.handoffId}${d.result?.at ? ` · ${clock(d.result.at)}` : ''}`);
  return rows;
}

/** Copy diagnostics: the record as JSON, structural facts only (it includes the username). */
export function diagnosticsJson(d: DetailInput): string {
  return JSON.stringify(
    {
      run: d.handoffId ?? null,
      mode: d.mode ?? null,
      result: d.result ?? null,
      account: d.account ?? null,
      entry: d.entry ?? null,
      compose: d.compose ?? null,
      evidence: d.evidence ?? null,
      steps: d.steps ?? null,
      window: d.window ?? null,
      browser: d.browser ?? null,
      probe: d.probe ?? d.decision?.probe ?? null,
    },
    null,
    2,
  );
}
