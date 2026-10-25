/**
 * inpage-ui-spec.md FS6, FS8, FS11: the driver's raw steps become five owner-facing steps, a progress and
 * a result kind; the result's copy and actions follow the code.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLangSetting } from '../ui/i18n.ts';
import type { InpageRecord } from './driver.ts';
import { autoCopy, detailRows, resultKind, resultView, runProgress, runSteps, unknownWhy } from './run-view.ts';

function rec(over: Partial<InpageRecord> & { raw?: string[] } = {}): InpageRecord {
  const { raw = [], ...rest } = over;
  return {
    marker: 'instapost-inpage:modes=check,test,shareTest,post',
    runId: 'inp_1',
    mode: 'post',
    writeBlocked: false,
    photo: null,
    toggles: { ua: 'tabwide', frame: 'auto', view: 'phone', xfoRule: 'on', fetchDest: 'document' },
    startedAt: 1000,
    endedAt: null,
    outcome: null,
    code: null,
    detail: null,
    locked: null,
    tabId: 3,
    frame: {
      id: 5,
      documentId: null,
      box: { w: 540, h: 960 },
      dpr: 2,
      scale: 0.2,
      loaded: true,
      readable: true,
      urls: [],
      paths: [],
      status: 200,
      xfoSeen: null,
      error: null,
      otherSubFrames: 0,
    },
    rules: { installed: [1001, 1020], after: null, ua: 'tabwide' },
    orientation: null,
    probe: null,
    readyProbe: null,
    account: { detected: 'owner', expected: 'owner', decision: 'ok' },
    entry: null,
    compose: null,
    share: null,
    net: [],
    pageUrls: [],
    steps: raw.map((step, i) => ({ step, t: i * 100 })),
    ...rest,
  };
}

const states = (r: InpageRecord) => runSteps(r).map((s) => s.state);

describe('run view', () => {
  it('walks the five steps as the driver reports its raw ones', () => {
    expect(states(rec({ raw: ['start', 'rules', 'frame'] }))).toEqual([
      'active',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    const acc = rec({ raw: ['start', 'frame', 'frame loaded', 'agent', 'probe', 'account'] });
    expect(states(acc)).toEqual(['done', 'done', 'active', 'pending', 'pending']);
    expect(runSteps(acc)[1]?.text).toBe('Logged in as @owner');
    expect(runProgress(acc)).toMatchObject({ current: 2, frameLoaded: true, shared: false, result: null });
  });

  it('after Share the post cannot be stopped, and step 4 says Instagram is uploading', () => {
    const r = rec({
      raw: ['start', 'frame loaded', 'account', 'composer', 'writes open', 'share sent'],
      share: { sent: true, done: false, refused: null, decision: null },
    });
    expect(runProgress(r).shared).toBe(true);
    expect(runSteps(r)[3]).toEqual({ state: 'active', text: 'Instagram is uploading…' });
  });

  it('results: posted, test, stopped, failed and unknown', () => {
    const base = ['start', 'frame loaded', 'account', 'composer'];
    const posted = rec({ raw: [...base, 'shared', 'decided'], outcome: 'posted', endedAt: 19_000 });
    expect(states(posted)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(runProgress(posted).progress).toBe(1);
    const tested = rec({ mode: 'test', raw: base, outcome: 'tested' });
    expect(states(tested)).toEqual(['done', 'done', 'done', 'done', 'skip']);
    expect(resultKind(rec({ outcome: 'stopped', code: 'STOPPED' }))).toBe('stopped');
    const inUse = rec({
      raw: ['start', 'frame loaded', 'account', 'story entry'],
      outcome: 'stopped',
      code: 'PAGE_IN_USE',
    });
    expect(resultKind(inUse)).toBe('failed');
    expect(runSteps(inUse)[2]).toEqual({ state: 'fail', text: 'You were using Instagram' });
    const unknown = rec({
      raw: [...base, 'shared', 'holding'],
      outcome: 'unknown',
      code: 'OUTCOME_UNKNOWN',
      detail: 'no-upload-seen',
    });
    expect(runSteps(unknown)[4]?.state).toBe('unk');
    expect(unknownWhy('PAGE_LEFT: the Instagram page reloaded')).toContain('page was closed');
  });

  it('the result copy names the account and picks the actions by code', () => {
    const opts = { handle: 'owner', setup: false, time: '14:32', seconds: 18 };
    const posted = resultView(rec({ outcome: 'posted' }), opts);
    expect(posted).toMatchObject({ head: 'Story posted', primary: 'viewStory', secondary: 'newStory' });
    expect(posted?.title).toBe('Posted to @owner’s story');
    expect(posted?.chip).toEqual(['Posted to your story', '14:32 · confirmed']);
    const failed = resultView(rec({ outcome: 'notPosted', code: 'UPLOAD_FAILED' }), opts);
    expect(failed).toMatchObject({ kind: 'failed', kicker: true, primary: 'tryAgain', secondary: 'sendToPhone' });
    expect(failed?.body).toContain('your story wasn’t posted');
    const inUse = resultView(rec({ outcome: 'stopped', code: 'PAGE_IN_USE' }), opts);
    expect(inUse?.body).toContain('Nothing was posted.');
    const setup = resultView(rec({ mode: 'test', outcome: 'tested' }), { ...opts, setup: true });
    expect(setup?.title).toBe('Ready. You’re posting as @owner.');
    expect(resultView(rec(), opts)).toBeNull();
  });

  it('Details carry the code, the frame and the raw steps (FR8)', () => {
    const rows = Object.fromEntries(detailRows(rec({ outcome: 'stopped', code: 'TIMEOUT', raw: ['start', 'frame'] })));
    expect(rows.Code).toBe('TIMEOUT');
    expect(rows.Frame).toContain('540 × 960 at DPR 2');
    expect(rows.Steps).toBe('start → frame');
  });
});

describe('RS-2 / RL-1 / RS-3 / RL-8 results that must not invite a second post', () => {
  const opts = { handle: 'owner', setup: false, time: '14:32', seconds: 18 };
  const shared = { sent: true, done: true, refused: null, decision: null };

  it('a post killed after Share (/challenge/) is Couldn’t confirm with the pause, never "Not posted" + Send to phone', () => {
    // As the driver now records it, and as an older record (outcome killed) would read.
    for (const r of [
      rec({
        outcome: 'unknown',
        code: 'OUTCOME_UNKNOWN',
        detail: 'KILLED_CHALLENGE: the page went to /challenge/',
        locked: 'KILLED_CHALLENGE',
        share: shared,
      }),
      rec({
        outcome: 'killed',
        code: 'KILLED_CHALLENGE',
        detail: 'the page went to /challenge/',
        locked: 'KILLED_CHALLENGE',
        share: shared,
      }),
    ]) {
      const v = resultView(r, opts);
      expect(v).toMatchObject({ kind: 'unknown', head: 'Check your story', kicker: false, primary: 'checkStory' });
      expect(v?.body).toContain('Instagram asked for a security check before it answered');
      expect(v?.body).toContain('Desktop posting is paused for 7 days');
      expect(v?.body).not.toContain('Nothing was posted');
      expect(runProgress(r).result).toBe('unknown');
    }
    // Instagram's own refusal after Share stays Not posted; a kill before Share stays a failure.
    expect(resultKind(rec({ outcome: 'notPosted', code: 'UPLOAD_FAILED', share: shared }))).toBe('failed');
    expect(resultKind(rec({ outcome: 'killed', code: 'KILLED_CHALLENGE' }))).toBe('failed');
  });

  it('posted, then a security check in the page: Posted, with the pause said', () => {
    const v = resultView(rec({ outcome: 'posted', locked: 'KILLED_CHALLENGE', share: shared }), opts);
    expect(v).toMatchObject({ kind: 'posted', head: 'Story posted' });
    expect(v?.sub).toContain('desktop posting is paused for 7 days');
    expect(resultView(rec({ outcome: 'posted', share: shared }), opts)?.sub).toBeNull();
  });

  it('a run lost with its worker after Share: Couldn’t confirm, "instapost restarted"', () => {
    const v = resultView(
      rec({ outcome: 'unknown', code: 'OUTCOME_UNKNOWN', detail: 'worker-restarted', share: shared, restarted: true }),
      opts,
    );
    expect(v?.body).toContain('instapost restarted before Instagram answered');
  });

  it('RL-8: ACCOUNT_UNCONFIRMED says what happened: another account, an unreadable one, or none known yet', () => {
    const body = (decision: string) =>
      resultView(
        rec({
          outcome: 'stopped',
          code: 'ACCOUNT_UNCONFIRMED',
          account: { detected: null, expected: 'owner', decision },
        }),
        opts,
      )?.body ?? '';
    expect(body('prompt-mismatch')).toContain('logged in as a different account');
    expect(body('prompt-unreadable')).toContain('couldn’t read which account is logged in');
    expect(body('prompt-unreadable')).toContain('turn off “Only post as” in Settings');
    expect(body('prompt-unreadable')).not.toContain('different account');
    expect(body('prompt-first')).toContain('Run the setup test first');
  });
});

describe('RL-17 the held note only while the hold is live', () => {
  const held = ['start', 'frame loaded', 'account', 'composer', 'share sent', 'shared', 'decided', 'holding'];
  it('holding while the run waits for a late answer; not once the 2-minute hold ran out (the frame is gone)', () => {
    expect(runProgress(rec({ raw: held })).holding).toBe(true);
    const timedOut = rec({
      raw: [...held, 'closing', 'done'],
      outcome: 'unknown',
      code: 'OUTCOME_UNKNOWN',
      detail: 'no-finalize-after-upload',
      endedAt: 130_000,
    });
    expect(runProgress(timedOut)).toMatchObject({ holding: false, result: 'unknown' });
    expect(runProgress(rec({ raw: [...held, 'decided late'] })).holding).toBe(false);
  });
});

describe('RL-19 Instagram changed its page: specific copy, Send to phone, no Try again', () => {
  afterEach(() => setLangSetting('en'));
  const opts = { handle: 'owner', setup: false, time: '14:32', seconds: 18 };
  for (const code of ['SW_INTERCEPTS', 'ACCEPT_DRIFT']) {
    it(code, () => {
      for (const l of ['en', 'es'] as const) {
        setLangSetting(l);
        const v = resultView(rec({ outcome: 'stopped', code, raw: ['start', 'frame loaded', 'probe'] }), opts);
        expect(v).toMatchObject({ kind: 'failed', primary: 'sendToPhone', secondary: null });
        const generic = resultView(rec({ outcome: 'stopped', code: 'SOMETHING_NEW' }), opts);
        expect(v?.title).not.toBe(generic?.title);
        expect(v?.body).toContain(l === 'en' ? 'Instagram’s side' : 'cambio de Instagram');
        expect(v?.body).toMatch(l === 'en' ? /Nothing was posted\.$/ : /No se publicó nada\.$/);
      }
    });
  }
});

describe('RV-7 copies saved by themselves', () => {
  const repost = {
    kind: 'post' as const,
    author: 'some.user',
    via: 'dialog' as const,
    slide: null,
    mediaW: 1080,
    consent: 'unknown' as const,
    bar: 'seen' as const,
  };
  it('a post not confirmed, or posted with Keep copies; never a repost (AM59)', () => {
    expect(autoCopy(rec(), 'failed', false)).toBe(true);
    expect(autoCopy(rec(), 'unknown', false)).toBe(true);
    expect(autoCopy(rec(), 'posted', false)).toBe(false);
    expect(autoCopy(rec(), 'posted', true)).toBe(true);
    expect(autoCopy(rec({ mode: 'test' }), 'failed', true)).toBe(false);
    expect(autoCopy(rec(), 'stopped', true)).toBe(false);
    for (const kind of ['failed', 'unknown', 'posted'] as const) {
      expect(autoCopy(rec({ repost }), kind, true), kind).toBe(false);
    }
  });
});
