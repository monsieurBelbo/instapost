/**
 * Details (ux.md §4.13, IU6): the structural facts of a run, as rows. Pure. The diagnostics rows of the
 * hand-off era (Page, Window, Browser, Mobile page, Viewport, Screen, Story input, Service worker, Canvas)
 * moved here from messages.ts; the autopilot adds Result, Evidence, Account, Story entry, Share control,
 * Image check, Steps, Quality, Requests, Alarms, Code and Run.
 *
 * Never a Meta-host URL and never a write-endpoint string in this module (check-bundle T3): request paths
 * arrive as data from the background, already normalised.
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
import { at, clock, whyText } from './copy.ts';

const size = (x: Size): string => `${Math.round(x.w)}×${Math.round(x.h)}`;

// ---- the hand-off era rows (U1, AM37) ----------------------------------------------------------

function shimWords(shim: OrientationShimState): string {
  switch (shim) {
    case 'installed':
      return 'portrait shim installed; the screen itself is landscape';
    case 'present':
      return 'portrait shim in place';
    case 'portrait':
      return 'the screen is portrait; no shim needed';
    case 'absent':
      return 'the page reports no screen orientation';
    case 'failed':
      return 'the portrait shim could not be installed';
    case 'off':
      return 'portrait shim switched off by a test flag';
  }
}

/** AM37: the Screen row. */
export function screenText(o: PageOrientation): string {
  const words = o.afterComposerMount
    ? 'portrait shim installed only after the composer had read the landscape screen'
    : shimWords(o.shim);
  return `${o.type ?? 'unknown'} (${words})`;
}

/** U1: the Story input row. */
export function storyInputText(probe: ProbeReport, c4: CheckResult | undefined, drift: boolean): string {
  const seen = probe.acceptSeen ?? [];
  const lists = (xs: string[]): string => xs.map((a) => a || '(no accept list)').join('; ');
  let text: string;
  if (probe.storyInput === 'absent') {
    text = seen.length === 0 ? 'none (no file input on the page)' : `none image-only (file inputs: ${lists(seen)})`;
  } else if (probe.acceptOk) {
    text = 'present';
  } else {
    const candidates = seen.filter(isStoryCandidateAccept);
    text = `present, ${drift ? 'accept list changed' : 'accept list differs'}: ${lists(candidates.length ? candidates : seen)}`;
  }
  return c4 === 'unknown' ? `${text} (not checked: stopped before this step)` : text;
}

const HOME_NOTE = "(home: Instagram's usual landing; instapost taps + → Story there)";

/** U1/AF-9: the Page row. */
export function pageText(route: ComposerRoute | undefined, path: string | undefined): string {
  if (path === undefined) {
    if (route === 'homeOnly') return `/ ${HOME_NOTE}`;
    if (route === 'direct') return '/create/story/ (the story composer directly)';
    return 'unknown';
  }
  if (path === '/') return `/ ${HOME_NOTE}`;
  if (isComposerPath(path)) {
    if (route === 'direct') return `${path} (the story composer directly)`;
    if (route === 'homeOnly') return `${path} (the story composer, opened from home)`;
    return `${path} (the story composer)`;
  }
  return path;
}

/** W5/§4.13: the Window row. */
export function windowText(w: WindowDiagnostics, raised = false): string {
  const fit = w.updates.find((u) => u.step === 'fit');
  const asked = fit ? size(fit.target) : `${w.requested.width}×${w.requested.height} outer`;
  const got = w.finalTab ? size(w.finalTab) : w.createdTab ? size(w.createdTab) : 'unknown';
  const attempts = `${w.attempts} ${w.attempts === 1 ? 'attempt' : 'attempts'}`;
  const calls = w.updates.filter((u) => u.step !== 'refit').reduce((n, u) => n + (u.applied ?? 1), 0);
  const reapplied = calls > w.attempts ? `, size re-applied: ${calls} updates` : '';
  const created =
    w.created && (w.created.width !== w.requested.width || w.created.height !== w.requested.height)
      ? `; opened at ${w.created.width}×${w.created.height} instead of ${w.requested.width}×${w.requested.height}`
      : '';
  const manual = w.manualResize ? '; resized by you' : '';
  const r = w.updates.find((u) => u.step === 'refit');
  const refit = r ? (r.fitted ? '; refitted once' : '; refit not honoured') : '';
  const docked = w.docked ? ' · docked right' : '';
  return `asked ${asked}, got ${got} (${attempts}${reapplied}${manual}${refit}${created})${docked} · raised: ${raised ? 'yes' : 'no'}`;
}

/** P6: the Browser row. */
export function browserText(f: BrowserFlavour): string {
  switch (f) {
    case 'arc':
      return 'Arc (recognised by its page colours)';
    case 'chrome':
      return 'Google Chrome';
    case 'edge':
      return 'Microsoft Edge';
    case 'chromium':
      return 'Chromium';
    case 'unknown':
      return 'unknown';
  }
}

/** P1/P3: the Service worker row. */
export function serviceWorkerText(probe: ProbeReport, intercepted = false): string {
  if (intercepted || probe.swIntercepted === true) return 'intercepts requests';
  const control =
    probe.swControlled === true
      ? 'controls the page — normal on Instagram'
      : probe.swControlled === false
        ? 'not in control'
        : 'unknown';
  return probe.swIntercepted === 'unknown' ? `${control}; interception unknown` : control;
}

// ---- the autopilot rows (§4.13) ---------------------------------------------------------------

export function resultRowText(r: RunResult): string {
  switch (r.kind) {
    case 'posted':
      if (r.markedBy === 'owner') return 'Marked as posted by you (Instagram didn’t confirm it)';
      return `Posted (Instagram confirmed it)${r.late ? ', late' : ''}${r.killed ? `; then ${r.killed}` : ''}`;
    case 'notPosted':
      if (r.markedBy === 'owner') return 'Marked as not posted by you';
      return `Not posted (${r.code ?? 'UPLOAD_FAILED'})`;
    case 'unknown':
      return r.code === 'TEST_LEAK'
        ? 'Test leak (publishing went through)'
        : `Couldn’t confirm: ${whyText(r.why, r.detail)}`;
    case 'tested':
      return 'Test passed (Share not pressed)';
    case 'shareTested':
      return 'Share test passed (upload blocked)';
    case 'checked':
      return r.lockedTo && r.account
        ? `Connection checked: logged in as @${r.account}, posts locked to @${r.lockedTo}`
        : 'Connection checked';
    case 'stopped':
      return r.stoppedBy === 'window' ? 'Stopped (the Instagram window was closed)' : 'Stopped';
  }
}

const hostName = (h: NetEntry['host']): string => (h === 'www' ? '' : h === 'i' ? 'i.' : 'other ');

/** One request after Share: `POST? i./rupload… 200 application/json`, digits already `<n>`. */
export function requestText(e: NetEntry): string {
  const type = e.type ? ` ${e.type.split(';')[0]}` : '';
  return `${hostName(e.host)}${e.path} ${e.status}${type}${e.redirected ? ' redirected' : ''} +${(e.end / 1000).toFixed(1)} s`;
}

/** The Evidence row: the share, the requests that decided, and the corroboration. */
export function evidenceText(ev: Evidence): string {
  const parts: string[] = [];
  if (ev.sharedAt !== null)
    parts.push(`Share ${ev.sharedBy === 'owner' ? 'tapped by you' : 'pressed'} ${clockSeconds(ev.sharedAt)}`);
  const upload = ev.net.find((e) => e.host === 'i' && e.path.startsWith('/rupload'));
  const publish = ev.net.find((e) => e.host === 'www' && e.path.includes('/media/configure'));
  if (upload) parts.push(`upload ${upload.status}`);
  if (publish) {
    parts.push(
      `publish ${publish.status}${publish.type ? ` ${publish.type.split(';')[0]}` : ''}${publish.redirected ? ', redirected' : ', no redirect'}`,
    );
  }
  if (!upload && !publish) parts.push('no upload or publish request seen');
  if (ev.ui.wentHomeAt !== null && ev.sharedAt !== null) {
    parts.push(`went home +${((ev.ui.wentHomeAt - ev.sharedAt) / 1000).toFixed(1)} s`);
  }
  if (ev.ui.progressSeen) parts.push('progress seen');
  if (ev.ui.toast !== 'none') parts.push(ev.ui.toast === 'action' ? 'a toast with an action' : 'a toast');
  return parts.join(' · ');
}

function clockSeconds(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function accountText(a: AccountFacts): string {
  const detected = a.detected
    ? `${at(a.detected)} (from Instagram’s navigation)`
    : `unreadable (${a.candidates} candidates)`;
  const expected = a.expected ? ` · expected ${at(a.expected)}` : ' · none expected';
  const by =
    a.confirmedBy === 'owner'
      ? ' · confirmed by you'
      : a.confirmedBy === 'learned'
        ? ' · remembered'
        : a.confirmedBy === 'unlocked'
          ? ' · “Only post as” off'
          : '';
  return `${detected}${expected}${by}`;
}

export function entryText(e: EntryFacts): string {
  const menu = e.menuCount === null ? 'no menu' : `menu ${e.menuCount} items`;
  const story =
    e.storyIndex === null ? '' : `, Story is item ${e.storyIndex + 1}${e.fpUsed ? ' (known)' : ' (found by trial)'}`;
  const armed = e.armedMs === null ? '' : ` · armed after ${(e.armedMs / 1000).toFixed(1)} s`;
  return `+ → Story · ${menu}${story}${armed} · ${e.trials} trials · + tapped ${e.plusTaps}× · ${e.result}`;
}

export function shareControlText(c: ComposeFacts): string {
  if (c.landscape) return 'rotate snackbar shown (no Share)';
  if (c.controls !== 1) return `${c.controls} Share controls`;
  return `footer ${c.variant ?? '?'}${c.fbAuto ? ' (Facebook badge)' : ''}${c.settled ? '' : ' (not settled)'}`;
}

export function imageCheckText(c: ComposeFacts): string | null {
  if (c.imageScore === null) return null;
  return `photo in composer matches the export (${c.imageScore.toFixed(2)})`;
}

/** §4.13 Steps: `opened 0.0 · Instagram 3.5 · account 3.7 · armed 5.1 · photo in composer 7.4 · Share 9.6 · confirmed 11.4 s`. */
export function stepsText(s: StepTimes): string {
  const t = (x: number | undefined): string | null => (x === undefined ? null : ((x - s.opened) / 1000).toFixed(1));
  const parts: [string, number | undefined][] = [
    ['Instagram', s.instagram],
    ['account', s.account],
    ['armed', s.armed],
    ['photo in composer', s.composer],
    ['Share', s.share],
    ['confirmed', s.confirmed],
  ];
  const shown = parts.flatMap(([label, x]) => {
    const v = t(x);
    return v === null ? [] : [`${label} ${v}`];
  });
  return `${['opened 0.0', ...shown].join(' · ')} s`;
}

/** §4.13 Quality (C8): how large Instagram redrew the photo. */
export function qualityText(canvas: Size | null): string | null {
  if (!canvas || canvas.h <= 0) return null;
  return `Instagram redrew the photo at ${canvas.w}×${canvas.h} (${Math.round((canvas.h / 1920) * 100)}% of 1920)`;
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
  if (d.result) add('result', 'Result', resultRowText(d.result));
  if (d.evidence) add('evidence', 'Evidence', evidenceText(d.evidence));
  if (d.account && d.account.decision !== null) add('account', 'Account', accountText(d.account));
  if (d.entry) add('story-entry', 'Story entry', entryText(d.entry));
  if (d.compose) {
    add('share-control', 'Share control', shareControlText(d.compose));
    add('image-check', 'Image check', imageCheckText(d.compose));
  }
  if (d.steps) add('steps', 'Steps', stepsText(d.steps));
  if (d.window) add('window', 'Window', windowText(d.window, d.raised === true));
  if (d.compose) add('quality', 'Quality', qualityText(d.compose.canvas));
  if (d.decision) add('page', 'Page', pageText(d.decision.route, d.decision.path));
  if (d.browser) add('browser', 'Browser', browserText(d.browser));
  const p = d.probe ?? d.decision?.probe ?? null;
  if (p) {
    const yes = (b: boolean | 'unknown') => (b === 'unknown' ? 'unknown' : b ? 'yes' : 'no');
    add('mobile', 'Mobile page', yes(p.isMobile));
    add('viewport', 'Viewport', `${p.inner.w}×${p.inner.h} @${p.dpr}x ${p.portrait ? 'portrait' : 'landscape'}`);
    if (p.orientation) add('screen', 'Screen', screenText(p.orientation));
  }
  if (d.decision) {
    add('story-input', 'Story input', storyInputText(d.decision.probe, d.decision.c4, d.code === 'ACCEPT_DRIFT'));
  }
  if (p) add('service-worker', 'Service worker', serviceWorkerText(p, d.code === 'SW_INTERCEPTS'));
  if (p?.canvas) {
    add(
      'canvas',
      'Canvas',
      `${p.canvas.w}×${p.canvas.h} px in ${Math.round(p.canvas.css.w)}×${Math.round(p.canvas.css.h)} CSS px`,
    );
  }
  if (d.evidence && d.evidence.net.length > 0) {
    add('requests', 'Requests after Share', d.evidence.net.map(requestText).join('; '));
  }
  if (d.result && d.result.alarms.length > 0) add('alarms', 'Alarms', d.result.alarms.join(', '));
  if (d.code) add('code', 'Code', d.code);
  if (d.handoffId) add('run', 'Run', `${d.handoffId}${d.result?.at ? ` · ${clock(d.result.at)}` : ''}`);
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
