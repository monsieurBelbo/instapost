/**
 * U12 (strategy §7.11): the agent acceptance check rejects wrong tab, frame, origin, nonce and
 * phase (and every other §3.5 condition), in the documented order; the message guards; and a
 * base64 round trip of 12 MB.
 */
import { describe, expect, it } from 'vitest';
import type { SessionPhase } from '../core/handoff/state.ts';
import type { ProbeReport } from '../core/ig-contract/contract.ts';
import { b64ToBytes, bytesToB64 } from './b64.ts';
import {
  type ActiveAgentSession,
  AGENT_FACT_PHASES,
  AGENT_MESSAGE_PHASES,
  type AgentRejection,
  type AgentToBackground,
  acceptAgentMessage,
  HANDOFF_PHASES,
  isAgentAck,
  isAgentFact,
  isAgentToBackground,
  isBackgroundToAgent,
  isBackgroundToEditor,
  isEditorToBackground,
  isGetFileReply,
  isLane,
  isPageOrientation,
  isProbeReport,
  normalizeFact,
  PROBE_LIMITS,
  type SenderLike,
  toPageOrientation,
} from './protocol.ts';

const RUNTIME_ID = 'jehchapoghccaofddgdkakdkjijmknhk';
const TAB = 42;
const HID = 'hof_7c1d';
const NONCE = '0b9f6a52-5d5c-4c2e-9a53-6f3f1b7e2d10';

const probe = (over: Partial<ProbeReport> = {}): ProbeReport => ({
  marker: true,
  isMobile: true,
  inner: { w: 511, h: 909 },
  dpr: 2,
  portrait: true,
  swControlled: false,
  swIntercepted: false,
  navType: 'reload',
  storyInput: 'present',
  acceptOk: true,
  acceptSeen: ['image/avif,image/jpeg,image/png'],
  lang: 'en',
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  v: 1,
  type: 'agent/report',
  probe: probe(),
  handoffId: HID,
  nonce: NONCE,
  ...over,
});
const getFile = (over: Record<string, unknown> = {}) => ({
  v: 1,
  type: 'agent/get-file',
  handoffId: HID,
  nonce: NONCE,
  ...over,
});
const event = (name: string, over: Record<string, unknown> = {}) => ({
  v: 1,
  type: 'agent/event',
  event: name,
  handoffId: HID,
  nonce: NONCE,
  ...over,
});

const factMsg = (f: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  v: 1,
  type: 'agent/fact',
  fact: f,
  handoffId: HID,
  nonce: NONCE,
  ...over,
});
const NET_ENTRY = {
  host: 'i',
  path: '/rupload_igphoto/fb_uploader_1',
  status: 200,
  type: 'application/json',
  redirected: false,
  start: 10,
  end: 900,
};

const sender = (over: Partial<SenderLike> = {}): SenderLike => ({
  id: RUNTIME_ID,
  tab: { id: TAB },
  frameId: 0,
  url: 'https://www.instagram.com/create/story/',
  ...over,
});
const active = (phase: SessionPhase, over: Partial<ActiveAgentSession> = {}): ActiveAgentSession => ({
  runtimeId: RUNTIME_ID,
  tabId: TAB,
  handoffId: HID,
  nonce: NONCE,
  phase,
  ...over,
});

const reason = (raw: unknown, s: SenderLike, a: ActiveAgentSession | null): AgentRejection | 'ok' => {
  const r = acceptAgentMessage(raw, s, a);
  return r.ok ? 'ok' : r.reason;
};

describe('U12 acceptAgentMessage (§3.5)', () => {
  it('accepts a well-formed report from the composer tab in probing', () => {
    const r = acceptAgentMessage(report(), sender(), active('probing'));
    expect(r).toEqual({ ok: true, msg: report() });
  });

  it.each<[string, SenderLike]>([
    ['another tab', sender({ tab: { id: 43 } })],
    ['no tab (an extension page)', sender({ tab: undefined })],
    ['a tab without id', sender({ tab: {} })],
  ])('rejects the wrong tab: %s', (_, s) => {
    expect(reason(report(), s, active('probing'))).toBe('tab');
  });

  it.each<[string, SenderLike]>([
    ['a subframe', sender({ frameId: 3 })],
    ['frameId missing', sender({ frameId: undefined })],
  ])('rejects the wrong frame: %s', (_, s) => {
    expect(reason(report(), s, active('probing'))).toBe('frame');
  });

  it.each([
    ['http', 'http://www.instagram.com/create/story/'],
    ['apex host', 'https://instagram.com/create/story/'],
    ['another subdomain', 'https://accountscenter.instagram.com/'],
    ['explicit port', 'https://www.instagram.com:8443/create/story/'],
    ['userinfo lookalike', 'https://www.instagram.com@evil.example/'],
    ['suffix lookalike', 'https://www.instagram.com.evil.example/'],
    ['about:blank', 'about:blank'],
    ['extension page', `chrome-extension://${RUNTIME_ID}/editor.html`],
    ['not a URL', 'www.instagram.com/create/story/'],
    ['missing', undefined],
  ])('rejects the wrong origin: %s', (_, url) => {
    expect(reason(report(), sender({ url }), active('probing'))).toBe('origin');
  });

  it('accepts any path and query on the Instagram origin (the URL check is the origin only)', () => {
    expect(reason(report(), sender({ url: 'https://www.instagram.com/?x=1#y' }), active('probing'))).toBe('ok');
  });

  it.each([
    ['another nonce', { nonce: 'f'.repeat(NONCE.length) }],
    ['a prefix of the nonce', { nonce: NONCE.slice(0, -1) }],
    ['the nonce plus a suffix', { nonce: `${NONCE}0` }],
  ])('rejects the wrong nonce: %s', (_, over) => {
    expect(reason(report(over), sender(), active('probing'))).toBe('nonce');
  });

  it('rejects another hand-off id', () => {
    expect(reason(report({ handoffId: 'hof_other' }), sender(), active('probing'))).toBe('handoff');
  });

  it.each<[string, string | undefined]>([
    ['another extension', 'abcdefghijklmnopabcdefghijklmnop'],
    ['no sender id', undefined],
  ])('rejects the wrong sender id: %s', (_, id) => {
    expect(reason(report(), sender({ id }), active('probing'))).toBe('sender-id');
  });

  it('rejects everything without an active session', () => {
    expect(reason(report(), sender(), null)).toBe('no-session');
    expect(reason(getFile(), sender(), null)).toBe('no-session');
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'agent/report'],
    ['an array', [report()]],
    ['v missing', report({ v: undefined })],
    ['v 2', report({ v: 2 })],
    ['unknown type', report({ type: 'agent/click' })],
    ['a background command', { v: 1, type: 'agent/probe', handoffId: HID, nonce: NONCE }],
    ['nonce missing', report({ nonce: undefined })],
    ['empty nonce', report({ nonce: '' })],
    ['numeric handoffId', report({ handoffId: 7 })],
    ['oversized id', report({ handoffId: 'h'.repeat(129) })],
    ['report without probe', report({ probe: undefined })],
    ['report with a bad probe', report({ probe: { ...probe(), isMobile: 'yes' } })],
    ['unknown event', event('composer-clicked')],
    ['a hand-off era event', event('composer-ready')],
    ['an unknown fact', factMsg({ kind: 'tapped' })],
    ['a net fact past the bounds', factMsg({ kind: 'net', entries: Array(65).fill(NET_ENTRY), elapsedMs: 1 })],
    [
      'a net entry with a long path',
      factMsg({ kind: 'net', entries: [{ ...NET_ENTRY, path: `/${'x'.repeat(200)}` }], elapsedMs: 1 }),
    ],
    [
      'a net entry with a status out of range',
      factMsg({ kind: 'net', entries: [{ ...NET_ENTRY, status: 600 }], elapsedMs: 1 }),
    ],
    [
      'a net entry from an unknown host class',
      factMsg({ kind: 'net', entries: [{ ...NET_ENTRY, host: 'evil' }], elapsedMs: 1 }),
    ],
  ])('rejects a malformed message: %s', (_, raw) => {
    expect(reason(raw, sender(), active('probing'))).toBe('shape');
  });

  describe('phase gating (AGENT_MESSAGE_PHASES, AGENT_FACT_PHASES)', () => {
    const cases: [string, () => unknown, AgentToBackground['type']][] = [
      ['agent/report', () => report(), 'agent/report'],
      ['agent/get-file', () => getFile(), 'agent/get-file'],
      ['agent/event', () => event('input-appeared'), 'agent/event'],
    ];
    for (const [name, make, type] of cases) {
      for (const phase of HANDOFF_PHASES) {
        const allowed = AGENT_MESSAGE_PHASES[type].includes(phase);
        it(`${name} in ${phase}: ${allowed ? 'accepted' : 'phase'}`, () => {
          expect(reason(make(), sender(), active(phase))).toBe(allowed ? 'ok' : 'phase');
        });
      }
    }

    const facts: [string, Record<string, unknown>][] = [
      [
        'entry',
        {
          kind: 'entry',
          result: 'armed',
          fpUsed: false,
          storyIndex: 1,
          glyph: 'ab12',
          menuCount: 2,
          trials: 0,
          plusTaps: 1,
          armedMs: 300,
        },
      ],
      ['inserted', { kind: 'inserted' }],
      ['insert-failed', { kind: 'insert-failed', why: 'not-armed' }],
      [
        'compose',
        {
          kind: 'compose',
          onComposer: true,
          drawn: true,
          landscape: false,
          controls: 1,
          variant: 'v1',
          fbAuto: false,
          settled: true,
          settleMs: 1500,
          canvas: { w: 1, h: 2 },
          imageScore: null,
        },
      ],
      ['share-done', { kind: 'share-done', t0Wall: 1 }],
      ['share-refused', { kind: 'share-refused', why: 'controls' }],
      ['net', { kind: 'net', entries: [NET_ENTRY], elapsedMs: 1000 }],
      ['ui', { kind: 'ui', progressSeen: true, toast: 'none', wentHome: false }],
      ['visibility', { kind: 'visibility', hidden: true }],
      ['owner-share', { kind: 'owner-share', t0Wall: 1 }],
    ];
    for (const [name, f] of facts) {
      for (const phase of HANDOFF_PHASES) {
        const allowed =
          AGENT_MESSAGE_PHASES['agent/fact'].includes(phase) &&
          AGENT_FACT_PHASES[f.kind as keyof typeof AGENT_FACT_PHASES].includes(phase);
        it(`fact ${name} in ${phase}: ${allowed ? 'accepted' : 'phase'}`, () => {
          expect(reason(factMsg(f), sender(), active(phase))).toBe(allowed ? 'ok' : 'phase');
        });
      }
    }

    it('get-file only while inserting; Share’s answer only while sharing; taps’ facts only in their phase', () => {
      expect(AGENT_MESSAGE_PHASES['agent/get-file']).toEqual(['inserting']);
      expect(AGENT_FACT_PHASES['share-done']).toEqual(['sharing']);
      expect(AGENT_FACT_PHASES.entry).toEqual(['openingEntry']);
      expect(AGENT_FACT_PHASES.net).toEqual(['sharing', 'confirmingUpload', 'finished', 'manual']);
      expect(AGENT_FACT_PHASES['owner-share']).toEqual(['manual']);
    });
  });

  it('checks in the documented order: the first failing condition is named', () => {
    const everythingWrong = sender({ id: 'other', tab: { id: 1 }, frameId: 2, url: 'https://evil.example/' });
    expect(reason(report({ nonce: 'x' }), everythingWrong, active('idle'))).toBe('sender-id');
    expect(reason(report({ nonce: 'x' }), sender({ tab: { id: 1 }, frameId: 2 }), active('idle'))).toBe('tab');
    expect(reason(report({ nonce: 'x' }), sender({ frameId: 2, url: 'about:blank' }), active('idle'))).toBe('frame');
    expect(reason(report({ handoffId: 'h', nonce: 'x' }), sender({ url: 'about:blank' }), active('idle'))).toBe(
      'origin',
    );
    expect(reason(report({ handoffId: 'h', nonce: 'x' }), sender(), active('idle'))).toBe('handoff');
    expect(reason(report({ nonce: 'x' }), sender(), active('idle'))).toBe('nonce');
    expect(reason(report(), sender(), active('idle'))).toBe('phase');
  });

  it('a fact is copied with only its known fields (nothing extra reaches storage)', () => {
    const raw = factMsg({
      kind: 'net',
      entries: [{ ...NET_ENTRY, html: '<x>', start: 10.4 }],
      elapsedMs: 900.6,
      extra: 1,
    });
    const r = acceptAgentMessage(raw, sender(), active('confirmingUpload'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.msg).toEqual(factMsg({ kind: 'net', entries: [{ ...NET_ENTRY, start: 10 }], elapsedMs: 901 }));
    expect(normalizeFact({ kind: 'visibility', hidden: true, x: 1 } as never)).toEqual({
      kind: 'visibility',
      hidden: true,
    });
  });

  it('returns a copy with only the known fields', () => {
    const raw = { ...report(), extra: 'x', probe: { ...probe(), html: '<html>', canvas: undefined } };
    const r = acceptAgentMessage(raw, sender(), active('probing'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.msg).toEqual(report());
    expect(Object.keys(r.msg)).not.toContain('extra');
    expect(Object.keys((r.msg as { probe: object }).probe)).not.toContain('html');
  });
});

describe('U12 guards', () => {
  const screen = { availLeft: 0, availTop: 33, availWidth: 1512, availHeight: 949 };

  it('isEditorToBackground', () => {
    const start = {
      v: 1,
      type: 'handoff/start',
      exportId: 'exp_1',
      mode: 'post',
      queue: true,
      screen,
      browser: 'chromium',
    };
    expect(isEditorToBackground(start)).toBe(true);
    // P6: the editor's browser flavour is one of the known ones, and required.
    expect(isEditorToBackground({ ...start, browser: 'arc' })).toBe(true);
    expect(isEditorToBackground({ ...start, browser: 'unknown' })).toBe(true);
    expect(isEditorToBackground({ ...start, browser: 'safari' })).toBe(false);
    expect(isEditorToBackground({ ...start, browser: undefined })).toBe(false);
    expect(isEditorToBackground({ ...start, exportId: null, mode: 'check' })).toBe(true);
    for (const mode of ['test', 'shareTest']) expect(isEditorToBackground({ ...start, mode })).toBe(true);
    expect(
      isEditorToBackground({ ...start, exportSha256: 'a'.repeat(64), docHash: 'b'.repeat(64), exportSample: 'AAAA' }),
    ).toBe(true);
    expect(isEditorToBackground({ ...start, exportSha256: 'nothex' })).toBe(false);
    expect(isEditorToBackground({ ...start, exportSample: '<script>' })).toBe(false);
    expect(isEditorToBackground({ v: 1, type: 'handoff/cancel' })).toBe(true);
    expect(isEditorToBackground({ v: 1, type: 'handoff/account-choice', handoffId: HID, proceed: true })).toBe(true);
    expect(isEditorToBackground({ v: 1, type: 'handoff/account-choice', handoffId: HID })).toBe(false);
    expect(isEditorToBackground({ v: 1, type: 'handoff/manual', handoffId: HID })).toBe(true);
    expect(isEditorToBackground({ v: 1, type: 'handoff/mark', handoffId: HID, posted: false })).toBe(true);
    expect(isEditorToBackground({ v: 1, type: 'ui/open-instagram', page: 'home' })).toBe(true);
    expect(isEditorToBackground({ v: 1, type: 'ui/open-instagram', page: 'story', handle: 'testuser' })).toBe(true);
    expect(isEditorToBackground({ v: 1, type: 'ui/open-instagram', page: 'https://evil.example/' })).toBe(false);
    expect(isEditorToBackground({ v: 1, type: 'ui/forget-account' })).toBe(true);
    // AP-4: Use @account names the check, never a handle (the background takes the one it read).
    expect(isEditorToBackground({ v: 1, type: 'ui/use-account', handoffId: HID })).toBe(true);
    expect(isEditorToBackground({ v: 1, type: 'ui/use-account' })).toBe(false);
    expect(isEditorToBackground({ v: 1, type: 'ui/result-seen', handoffId: HID })).toBe(true);
    // The "Posted?" question is gone (DL1).
    expect(isEditorToBackground({ v: 1, type: 'handoff/outcome', handoffId: HID, posted: false })).toBe(false);

    expect(isEditorToBackground({ ...start, mode: 'publish' })).toBe(false);
    expect(isEditorToBackground({ ...start, mode: 'probe' })).toBe(false);
    expect(isEditorToBackground({ ...start, queue: 'yes' })).toBe(false);
    expect(isEditorToBackground({ ...start, screen: { ...screen, availHeight: Number.NaN } })).toBe(false);
    expect(isEditorToBackground({ ...start, exportId: '' })).toBe(false);
    expect(isEditorToBackground({ ...start, v: 2 })).toBe(false);
    // AM25: ENABLE carries the lock the editor showed (or null).
    expect(isEditorToBackground({ v: 1, type: 'handoff/enable-msite', lockedUntil: 5 })).toBe(true);
    expect(isEditorToBackground({ v: 1, type: 'handoff/enable-msite', lockedUntil: null })).toBe(true);
    expect(isEditorToBackground({ v: 1, type: 'handoff/enable-msite' })).toBe(false);
    expect(isEditorToBackground({ v: 1, type: 'handoff/enable-msite', lockedUntil: 'x' })).toBe(false);
    expect(isEditorToBackground({ v: 1, type: 'handoff/status', handoffId: null, phase: 'idle' })).toBe(false);
  });

  it('isBackgroundToEditor', () => {
    const status = { v: 1, type: 'handoff/status', handoffId: HID, phase: 'openingEntry', mode: 'post', step: 'story' };
    expect(isBackgroundToEditor(status)).toBe(true);
    const result = {
      kind: 'unknown',
      code: 'OUTCOME_UNKNOWN',
      why: 'no-upload-seen',
      alarms: [],
      at: 5,
      held: true,
      account: 'testuser',
    };
    expect(
      isBackgroundToEditor({
        ...status,
        phase: 'finished',
        error: 'OUTCOME_UNKNOWN',
        probe: probe(),
        banner: 'FAKE_INSTAGRAM',
        route: 'homeOnly',
        freeAt: 5,
        detail: 'x',
        result,
        held: 'upload',
        closeAt: 9,
        canStop: false,
        shareSent: true,
        steps: { opened: 1, instagram: 2, share: 3 },
        account: { detected: 'testuser', candidates: 1, expected: 'testuser', decision: 'ok', confirmedBy: 'match' },
        evidence: {
          sharedAt: 3,
          sharedBy: 'autopilot',
          net: [NET_ENTRY],
          ui: { progressSeen: true, toast: 'none', wentHomeAt: null },
          alarms: ['DUPLICATE_UPLOAD'],
        },
      }),
    ).toBe(true);
    expect(isBackgroundToEditor({ ...status, phase: 'queued', queuedUntil: 5 })).toBe(true);
    expect(
      isBackgroundToEditor({
        ...status,
        phase: 'awaitingAccount',
        accountPrompt: { kind: 'mismatch', detected: 'other', expected: 'testuser', until: 5 },
      }),
    ).toBe(true);
    expect(
      isBackgroundToEditor({ ...status, accountPrompt: { kind: 'maybe', detected: null, expected: null, until: 5 } }),
    ).toBe(false);
    expect(isBackgroundToEditor({ ...status, result: { ...result, kind: 'probably' } })).toBe(false);
    expect(isBackgroundToEditor({ ...status, result: { ...result, account: 'not a handle!' } })).toBe(false);
    expect(isBackgroundToEditor({ ...status, held: 'forever' })).toBe(false);
    expect(isBackgroundToEditor({ ...status, canStop: 'yes' })).toBe(false);
    expect(isBackgroundToEditor({ ...status, mode: 'probe' })).toBe(false);
    // The hand-off era phases no longer parse (a stale status, IR1).
    expect(isBackgroundToEditor({ ...status, phase: 'awaitingShare' })).toBe(false);
    expect(isBackgroundToEditor({ ...status, error: 'OOPS' })).toBe(false);
    for (const code of [
      'STORY_ENTRY_MISSING',
      'SHARE_MISSING',
      'WINDOW_IN_USE',
      'WINDOW_HIDDEN',
      'ACCOUNT_UNCONFIRMED',
      'UPLOAD_FAILED',
      'TEST_LEAK',
    ]) {
      expect(isBackgroundToEditor({ ...status, error: code })).toBe(true);
    }
    expect(
      isBackgroundToEditor({ v: 1, type: 'handoff/status', handoffId: null, phase: 'idle', error: 'RATE_LIMITED' }),
    ).toBe(true);
    // 2026-10-12: the guided resize and the window diagnostics.
    const win = {
      screen,
      requested: { left: 2970, top: -328, width: 524, height: 1012 },
      created: { left: 1831, top: 13, width: 1512, height: 949 },
      createdTab: { w: 1512, h: 902 },
      frameDelta: { w: 0, h: 47 },
      updates: [
        {
          step: 'fit',
          box: { left: 2970, top: -212, width: 524, height: 979 },
          target: { w: 524, h: 932 },
          outer: { left: 1831, top: 13, width: 1512, height: 949 },
          tab: { w: 1512, h: 902 },
          fitted: false,
        },
      ],
      attempts: 1,
      manualResize: false,
      finalTab: { w: 1512, h: 902 },
      zoom: 1,
      docked: true,
    };
    const resizing = {
      ...status,
      phase: 'resizing',
      resize: { tab: { w: 1512, h: 902 }, ok: false, until: 5, maxW: 767 },
      window: win,
    };
    expect(isBackgroundToEditor(resizing)).toBe(true);
    expect(isBackgroundToEditor({ ...resizing, resize: { tab: { w: 1, h: 1 }, ok: 'no', until: 5, maxW: 767 } })).toBe(
      false,
    );
    expect(isBackgroundToEditor({ ...resizing, window: { ...win, docked: 'right' } })).toBe(false);
    expect(isBackgroundToEditor({ ...status, path: 'x'.repeat(513) })).toBe(false);
    // The lane.
    const lane = {
      v: 1,
      type: 'handoff/lane',
      kind: 'spacing',
      freeAt: 5,
      today: 3,
      hour: 1,
      caps: { hour: 6, day: 15 },
    };
    expect(isBackgroundToEditor(lane)).toBe(true);
    expect(isLane({ kind: 'busy', handoffId: HID, today: 0, hour: 0, caps: { hour: 6, day: 15 } })).toBe(true);
    expect(isBackgroundToEditor({ ...lane, kind: 'maybe' })).toBe(false);
    expect(isBackgroundToEditor({ ...lane, caps: undefined })).toBe(false);
  });

  it('isBackgroundToAgent', () => {
    const base = { v: 1, handoffId: HID, nonce: NONCE };
    expect(isBackgroundToAgent({ ...base, type: 'agent/probe' })).toBe(true);
    expect(isBackgroundToAgent({ ...base, type: 'agent/watch' })).toBe(true);
    expect(isBackgroundToAgent({ ...base, type: 'agent/drive', step: 'open-entry', fingerprint: null })).toBe(true);
    expect(
      isBackgroundToAgent({
        ...base,
        type: 'agent/drive',
        step: 'open-entry',
        fingerprint: { count: 2, storyIndex: 1, glyph: '0a1b2c3d', savedAt: 5 },
      }),
    ).toBe(true);
    expect(
      isBackgroundToAgent({
        ...base,
        type: 'agent/drive',
        step: 'open-entry',
        fingerprint: { count: 2, storyIndex: 9, glyph: 'zz', savedAt: 5 },
      }),
    ).toBe(false);
    expect(isBackgroundToAgent({ ...base, type: 'agent/drive', step: 'insert' })).toBe(true);
    expect(isBackgroundToAgent({ ...base, type: 'agent/drive', step: 'compose', sample: null })).toBe(true);
    expect(isBackgroundToAgent({ ...base, type: 'agent/drive', step: 'share' })).toBe(true);
    expect(isBackgroundToAgent({ ...base, type: 'agent/drive', step: 'retry' })).toBe(false);
    expect(isBackgroundToAgent({ ...base, type: 'agent/observe', from: 'manual' })).toBe(true);
    expect(isBackgroundToAgent({ ...base, type: 'agent/observe', from: 'anything' })).toBe(false);
    // The hand-off era's insert is gone (DL3).
    expect(isBackgroundToAgent({ ...base, type: 'agent/inject' })).toBe(false);
    expect(isBackgroundToAgent({ ...base, type: 'agent/click' })).toBe(false);
    expect(isBackgroundToAgent({ v: 1, type: 'agent/probe', handoffId: HID })).toBe(false);
    expect(isBackgroundToAgent(getFile())).toBe(false);
  });

  it('isAgentToBackground', () => {
    expect(isAgentToBackground(report())).toBe(true);
    expect(isAgentToBackground(getFile())).toBe(true);
    for (const name of ['input-appeared', 'account-appeared', 'sw-controller-change', 'sw-intercepted']) {
      expect(isAgentToBackground(event(name))).toBe(true);
    }
    for (const name of ['composer-ready', 'composer-left', 'inject-ignored', 'posted']) {
      expect(isAgentToBackground(event(name))).toBe(false);
    }
    expect(isAgentToBackground(factMsg({ kind: 'net', entries: [NET_ENTRY], elapsedMs: 5 }))).toBe(true);
    expect(isAgentFact({ kind: 'ui', progressSeen: true, toast: 'action', wentHome: true })).toBe(true);
    expect(isAgentFact({ kind: 'ui', progressSeen: true, toast: 'shout', wentHome: true })).toBe(false);
    expect(isAgentFact({ kind: 'compose', onComposer: true })).toBe(false);
    expect(isAgentFact({ kind: 'entry', result: 'GUESSED' })).toBe(false);
    expect(isAgentFact({ kind: 'share-refused', why: 'tired' })).toBe(false);
    expect(
      isAgentFact({ kind: 'net', entries: [{ ...NET_ENTRY, start: Number.POSITIVE_INFINITY }], elapsedMs: 5 }),
    ).toBe(false);
  });

  it('isProbeReport', () => {
    expect(isProbeReport(probe())).toBe(true);
    expect(isProbeReport(probe({ isMobile: 'unknown', swControlled: 'unknown', storyInput: 'absent' }))).toBe(true);
    expect(isProbeReport(probe({ canvas: { w: 1022, h: 1818, css: { x: 0, y: 0, w: 511, h: 909 } } }))).toBe(true);
    expect(isProbeReport(probe({ acceptSeen: undefined }))).toBe(true);
    // P3: the tripwire reading and the navigation type are required.
    expect(isProbeReport(probe({ swIntercepted: 'unknown', navType: 'unknown' }))).toBe(true);
    expect(isProbeReport(probe({ swIntercepted: true, navType: 'navigate' }))).toBe(true);
    expect(isProbeReport({ ...probe(), swIntercepted: undefined })).toBe(false);
    expect(isProbeReport(probe({ navType: 'teleport' as never }))).toBe(false);

    expect(isProbeReport(probe({ dpr: 0 }))).toBe(false);
    expect(isProbeReport(probe({ inner: { w: Number.NaN, h: 1 } }))).toBe(false);
    expect(isProbeReport(probe({ canvas: { w: 1, h: 1, css: { x: 0, y: 0, w: 1 } } as never }))).toBe(false);
    expect(isProbeReport({ ...probe(), lang: undefined })).toBe(false);
    expect(isProbeReport(probe({ lang: 'x'.repeat(PROBE_LIMITS.lang + 1) }))).toBe(false);
    expect(isProbeReport(probe({ acceptSeen: Array(PROBE_LIMITS.acceptEntries + 1).fill('image/png') }))).toBe(false);
    expect(isProbeReport(probe({ acceptSeen: ['x'.repeat(PROBE_LIMITS.acceptLength + 1)] }))).toBe(false);
  });

  it('isGetFileReply and isAgentAck', () => {
    expect(isGetFileReply({ ok: false })).toBe(true);
    expect(isGetFileReply({ ok: true, name: 'story.png', mime: 'image/png', b64: 'AA==' })).toBe(true);
    expect(isGetFileReply({ ok: true, name: 'story.png', mime: 'image/png' })).toBe(false);
    expect(isGetFileReply(undefined)).toBe(false);
    expect(isAgentAck({ ok: true })).toBe(true);
    expect(isAgentAck({ ok: 'true' })).toBe(false);
    expect(isAgentAck(undefined)).toBe(false);
  });
});

describe('U12 base64 (b64.ts)', () => {
  /** Deterministic pseudo-random bytes (xorshift32). */
  function bytes(n: number, seed = 0x9e3779b9): Uint8Array {
    const out = new Uint8Array(n);
    let x = seed >>> 0;
    for (let i = 0; i < n; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      out[i] = x & 0xff;
    }
    return out;
  }

  it('round-trips 12 MB and matches Node’s encoder', () => {
    const data = bytes(12 * 1024 * 1024);
    const b64 = bytesToB64(data);
    expect(b64).toBe(Buffer.from(data).toString('base64'));
    const back = b64ToBytes(b64);
    expect(back.length).toBe(data.length);
    expect(Buffer.from(back).equals(Buffer.from(data))).toBe(true);
  });

  it.each([0, 1, 2, 3, 4, 5, 24_575, 24_576, 24_577, 32_768, 49_153])(
    'round-trips %i bytes across chunk edges',
    (n) => {
      const data = bytes(n, n + 1);
      const b64 = bytesToB64(data);
      expect(b64).toBe(Buffer.from(data).toString('base64'));
      expect(Array.from(b64ToBytes(b64))).toEqual(Array.from(data));
    },
  );

  it('decodes into a plain ArrayBuffer', () => {
    expect(b64ToBytes('AAEC').buffer).toBeInstanceOf(ArrayBuffer);
  });

  it.each(['A', 'AB=', 'A===', '====', 'AB=C', 'AB C', 'AB\nC', '-_AA', 'ÄÄÄÄ', 'AAAA='])(
    'throws on malformed %j',
    (s) => {
      expect(() => b64ToBytes(s)).toThrow(TypeError);
    },
  );
});

describe('U12 AM37: the portrait shim’s reading is the background’s, never the agent’s', () => {
  it('an agent report that carries an orientation is accepted with it dropped', () => {
    const forged = report({ probe: probe({ orientation: { type: 'portrait-primary', shim: 'installed' } }) });
    const r = acceptAgentMessage(forged, sender(), active('probing'));
    expect(r.ok).toBe(true);
    if (!r.ok || r.msg.type !== 'agent/report') throw new Error('not accepted');
    expect('orientation' in r.msg.probe).toBe(false);
  });

  it('isPageOrientation: a known shim state and a short lower-case type, or null', () => {
    expect(isPageOrientation({ type: 'portrait-primary', shim: 'installed' })).toBe(true);
    expect(isPageOrientation({ type: 'landscape-secondary', shim: 'off' })).toBe(true);
    expect(isPageOrientation({ type: null, shim: 'absent' })).toBe(true);
    for (const shim of ['present', 'portrait', 'failed']) {
      expect(isPageOrientation({ type: 'portrait-primary', shim })).toBe(true);
    }
    expect(isPageOrientation({ type: 'portrait-primary', shim: 'maybe' })).toBe(false);
    expect(isPageOrientation({ type: 'Portrait-Primary', shim: 'installed' })).toBe(false);
    expect(isPageOrientation({ type: 'x'.repeat(PROBE_LIMITS.orientationType + 1), shim: 'installed' })).toBe(false);
    expect(isPageOrientation({ shim: 'installed' })).toBe(false);
    expect(isPageOrientation('portrait-primary')).toBe(false);
    // SH-1: the background's own mark, on records and statuses, is true or absent.
    expect(isPageOrientation({ type: 'portrait-primary', shim: 'installed', afterComposerMount: true })).toBe(true);
    expect(isPageOrientation({ type: 'portrait-primary', shim: 'installed', afterComposerMount: false })).toBe(false);
    expect(isPageOrientation({ type: 'portrait-primary', shim: 'installed', afterComposerMount: 1 })).toBe(false);
  });

  it('SH-1: a page cannot set the background’s late-shim mark: toPageOrientation drops it', () => {
    expect(toPageOrientation({ type: 'portrait-primary', shim: 'installed', afterComposerMount: true })).toEqual({
      type: 'portrait-primary',
      shim: 'installed',
    });
  });

  it('SH-2: every unreadable shim result (a throw in the page gives null or undefined) is {null, failed}', () => {
    for (const raw of [undefined, null, {}, [], 'x', { type: 'portrait-primary' }, { type: 1, shim: 'present' }]) {
      expect(toPageOrientation(raw), JSON.stringify(raw)).toEqual({ type: null, shim: 'failed' });
    }
  });

  it('toPageOrientation keeps a valid reading’s two fields; anything else is a failed shim with no type', () => {
    expect(toPageOrientation({ type: 'portrait-primary', shim: 'present', extra: 1 })).toEqual({
      type: 'portrait-primary',
      shim: 'present',
    });
    expect(toPageOrientation(undefined)).toEqual({ type: null, shim: 'failed' });
    expect(toPageOrientation({ type: '<b>', shim: 'installed' })).toEqual({ type: null, shim: 'failed' });
  });

  it('isProbeReport and statuses accept a stamped report, and reject a malformed reading', () => {
    expect(isProbeReport(probe({ orientation: { type: 'portrait-primary', shim: 'installed' } }))).toBe(true);
    expect(isProbeReport(probe({ orientation: { type: 'portrait-primary', shim: 'yes' } as never }))).toBe(false);
  });
});
