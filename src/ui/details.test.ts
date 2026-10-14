/**
 * U29 (ux.md §4.13, IU6): Details, one component for the run view, results and History. Rows only for what
 * there is to say, in §4.13's order; the evidence that decided a result in words; never a Meta-host URL and
 * never a write-endpoint string beyond the normalised paths the background sends as data.
 */
import { describe, expect, it } from 'vitest';
import { EDITOR_ONLY, hits } from '../../tools/bundle/patterns.ts';
import type { AccountFacts, ComposeFacts, EntryFacts, Evidence, NetEntry, RunResult } from '../core/handoff/state.ts';
import type { ProbeReport } from '../core/ig-contract/contract.ts';
import {
  accountText,
  detailRows,
  diagnosticsJson,
  entryText,
  evidenceText,
  imageCheckText,
  pageText,
  qualityText,
  requestText,
  resultRowText,
  shareControlText,
  stepsText,
} from './details.ts';

const T = Date.UTC(2026, 9, 13, 12);
const upload: NetEntry = {
  host: 'i',
  path: '/rupload_igphoto/fb_uploader_<n>',
  status: 200,
  type: 'application/json',
  redirected: false,
  start: 100,
  end: 1500,
};
const publish: NetEntry = {
  host: 'www',
  path: '/api/v<n>/media/configure_to_story/',
  status: 200,
  type: 'application/json; charset=utf-8',
  redirected: false,
  start: 1600,
  end: 2500,
};
const evidence: Evidence = {
  sharedAt: T,
  sharedBy: 'autopilot',
  net: [upload, publish],
  ui: { progressSeen: true, toast: 'none', wentHomeAt: T + 2800 },
  alarms: [],
};
const account: AccountFacts = {
  detected: 'testuser',
  candidates: 1,
  expected: 'testuser',
  decision: 'ok',
  confirmedBy: 'match',
};
const entry: EntryFacts = {
  result: 'armed',
  fpUsed: true,
  storyIndex: 0,
  glyph: '0badc0de',
  menuCount: 2,
  trials: 0,
  plusTaps: 1,
  armedMs: 140,
};
const compose: ComposeFacts = {
  onComposer: true,
  drawn: true,
  landscape: false,
  controls: 1,
  variant: 'v2',
  fbAuto: true,
  settled: true,
  settleMs: 1600,
  canvas: { w: 1080, h: 1920 },
  imageScore: 0.973,
};
const probe: ProbeReport = {
  marker: false,
  isMobile: true,
  inner: { w: 511, h: 909 },
  dpr: 2,
  portrait: true,
  swControlled: true,
  swIntercepted: false,
  navType: 'reload',
  storyInput: 'present',
  acceptOk: true,
  lang: 'en',
  orientation: { type: 'landscape-primary', shim: 'installed' },
};
const posted: RunResult = { kind: 'posted', alarms: [], at: T + 2600, account: 'testuser' };

describe('U29 the rows', () => {
  it('a posted run: every row there is something to say for, in §4.13’s order', () => {
    const rows = detailRows({
      handoffId: 'hof_1',
      mode: 'post',
      result: posted,
      evidence,
      account,
      entry,
      compose,
      steps: {
        opened: T - 9600,
        instagram: T - 6100,
        account: T - 5900,
        composer: T - 2200,
        share: T,
        confirmed: T + 2600,
      },
      browser: 'chromium',
      probe,
    });
    expect(rows.map((r) => r.key)).toEqual([
      'result',
      'evidence',
      'account',
      'story-entry',
      'share-control',
      'image-check',
      'steps',
      'quality',
      'browser',
      'mobile',
      'viewport',
      'screen',
      'service-worker',
      'requests',
      'run',
    ]);
    const value = (k: string) => rows.find((r) => r.key === k)?.value;
    expect(value('result')).toBe('Posted (Instagram confirmed it)');
    expect(value('account')).toBe('@testuser (from Instagram’s navigation) · expected @testuser');
    expect(value('share-control')).toBe('footer v2 (Facebook badge)');
    expect(value('image-check')).toBe('photo in composer matches the export (0.97)');
    expect(value('quality')).toBe('Instagram redrew the photo at 1080×1920 (100% of 1920)');
    expect(value('screen')).toContain('portrait shim installed');
  });

  it('an empty run says nothing', () => {
    expect(detailRows({})).toEqual([]);
  });

  it('a Couldn’t confirm run shows the alarms and the code', () => {
    const r: RunResult = {
      kind: 'unknown',
      code: 'OUTCOME_UNKNOWN',
      why: 'configure-5xx',
      detail: 'publish 503',
      alarms: ['DUPLICATE_UPLOAD'],
      at: T,
    };
    const rows = detailRows({ result: r, code: 'OUTCOME_UNKNOWN' });
    expect(rows.find((x) => x.key === 'result')?.value).toContain('(503)');
    expect(rows.find((x) => x.key === 'alarms')?.value).toBe('DUPLICATE_UPLOAD');
    expect(rows.find((x) => x.key === 'code')?.value).toBe('OUTCOME_UNKNOWN');
  });

  it('no row value carries a Meta-host URL', () => {
    const rows = detailRows({ handoffId: 'hof_1', result: posted, evidence, account, entry, compose, probe });
    for (const r of rows) expect(hits(r.value, EDITOR_ONLY), r.key).not.toContain('Meta host URL');
  });
});

describe('U29 the texts', () => {
  it('evidence: the Share, the two requests, the corroboration', () => {
    const text = evidenceText(evidence);
    expect(text).toMatch(/^Share pressed /);
    expect(text).toContain('upload 200');
    expect(text).toContain('publish 200 application/json, no redirect');
    expect(text).toContain('went home +2.8 s');
    expect(text).toContain('progress seen');
    expect(evidenceText({ ...evidence, net: [], sharedBy: 'owner' })).toContain('no upload or publish request seen');
    expect(evidenceText({ ...evidence, sharedBy: 'owner' })).toMatch(/^Share tapped by you /);
  });

  it('a request: host, normalised path, status, type, offset', () => {
    expect(requestText(upload)).toBe('i./rupload_igphoto/fb_uploader_<n> 200 application/json +1.5 s');
    expect(requestText({ ...publish, redirected: true, type: 'text/html' })).toBe(
      '/api/v<n>/media/configure_to_story/ 200 text/html redirected +2.5 s',
    );
  });

  it('the account, the entry and the Share control', () => {
    expect(accountText({ ...account, detected: null, candidates: 2, confirmedBy: 'owner' })).toBe(
      'unreadable (2 candidates) · expected @testuser · confirmed by you',
    );
    expect(entryText(entry)).toBe(
      '+ → Story · menu 2 items, Story is item 1 (known) · armed after 0.1 s · 0 trials · + tapped 1× · armed',
    );
    expect(entryText({ ...entry, result: 'MENU_DRIFT', menuCount: 3, storyIndex: null, armedMs: null })).toBe(
      '+ → Story · menu 3 items · 0 trials · + tapped 1× · MENU_DRIFT',
    );
    expect(shareControlText({ ...compose, controls: 2 })).toBe('2 Share controls');
    expect(shareControlText({ ...compose, landscape: true })).toBe('rotate snackbar shown (no Share)');
    expect(imageCheckText({ ...compose, imageScore: null })).toBeNull();
  });

  it('the steps, from the window opening', () => {
    expect(stepsText({ opened: T, instagram: T + 3500, account: T + 3700, share: T + 9600 })).toBe(
      'opened 0.0 · Instagram 3.5 · account 3.7 · Share 9.6 s',
    );
  });

  it('quality, the page, every result kind', () => {
    expect(qualityText({ w: 720, h: 1280 })).toBe('Instagram redrew the photo at 720×1280 (67% of 1920)');
    expect(qualityText(null)).toBeNull();
    expect(pageText('homeOnly', '/')).toContain('instapost taps + → Story there');
    for (const kind of ['posted', 'notPosted', 'unknown', 'tested', 'shareTested', 'checked', 'stopped'] as const) {
      expect(resultRowText({ kind, alarms: [], at: T }).length, kind).toBeGreaterThan(4);
    }
  });

  it('AP-3, AP-4: a mark is the owner’s, and a check names the account lock it found', () => {
    const marked = resultRowText({ kind: 'posted', alarms: [], at: T, markedBy: 'owner' });
    expect(marked).toBe('Marked as posted by you (Instagram didn’t confirm it)');
    expect(marked).not.toContain('Instagram confirmed');
    expect(resultRowText({ kind: 'notPosted', code: 'OUTCOME_UNKNOWN', alarms: [], at: T, markedBy: 'owner' })).toBe(
      'Marked as not posted by you',
    );
    expect(resultRowText({ kind: 'posted', alarms: [], at: T })).toBe('Posted (Instagram confirmed it)');
    expect(resultRowText({ kind: 'checked', account: 'other', lockedTo: 'testuser', alarms: [], at: T })).toBe(
      'Connection checked: logged in as @other, posts locked to @testuser',
    );
  });

  it('Copy diagnostics: the structural record as JSON', () => {
    const json = JSON.parse(diagnosticsJson({ handoffId: 'hof_1', mode: 'post', result: posted, account, probe }));
    expect(Object.keys(json)).toEqual([
      'run',
      'mode',
      'result',
      'account',
      'entry',
      'compose',
      'evidence',
      'steps',
      'window',
      'browser',
      'probe',
    ]);
    expect(json).toMatchObject({ run: 'hof_1', result: { kind: 'posted' }, account: { detected: 'testuser' } });
  });
});
