/**
 * U21 (ux.md §5, IU7): the copy. Every error code has a title, a body and its actions; "Nothing was posted"
 * is said only when the context says nothing could have been posted, and never for a result that only
 * exists after Share; no copy names a code (codes are for Details), carries a Meta-host URL, or quotes
 * Instagram's own UI beyond the names of its controls (+, Story, Share).
 */
import { describe, expect, it } from 'vitest';
import { EDITOR_ONLY, hits } from '../../tools/bundle/patterns.ts';
import {
  ERROR_CODES,
  type ErrorCode,
  MSITE_LOCK_REASONS,
  RESULT_KINDS,
  type RunResult,
  UNKNOWN_WHYS,
} from '../core/handoff/state.ts';
import {
  ACTION_LABEL,
  type ActionId,
  accountPromptFoot,
  accountPromptText,
  type CopyCtx,
  ERROR_COPY,
  fakeBarText,
  finishByHandText,
  heldText,
  howItWorks,
  mmss,
  modeChip,
  POST_NOTES,
  pauseReasonText,
  resizeText,
  resultActions,
  resultText,
  runHeader,
  runHint,
  STEP_COPY,
  tabTitle,
  whyText,
} from './copy.ts';

const NOW = Date.UTC(2026, 9, 13, 12);
const NOTHING = 'Nothing was posted';
const ACTIONS = Object.keys(ACTION_LABEL) as ActionId[];

/** The contexts a body may be rendered with. */
const contexts: CopyCtx[] = [
  { nothingPosted: true },
  { nothingPosted: false },
  { nothingPosted: true, detail: 'story 30 s', freeAt: NOW + 60_000, handle: 'testuser', expected: 'other', now: NOW },
  { nothingPosted: false, detail: 'page /consent/', why: 'configure-5xx', postedBeforeKill: true },
  { nothingPosted: true, detail: 'unreadable', handle: null },
  { nothingPosted: true, detail: 'manual 300 s' },
  { nothingPosted: true, detail: 'story session refused' },
];

const result = (r: Partial<RunResult> & Pick<RunResult, 'kind'>): RunResult => ({ alarms: [], at: NOW, ...r });

/** Every result the run view and History can show. */
function allResults(): RunResult[] {
  const out: RunResult[] = [];
  for (const kind of RESULT_KINDS) out.push(result({ kind }));
  for (const code of ERROR_CODES) out.push(result({ kind: 'notPosted', code }));
  for (const why of UNKNOWN_WHYS) out.push(result({ kind: 'unknown', code: 'OUTCOME_UNKNOWN', why }));
  out.push(result({ kind: 'unknown', code: 'TEST_LEAK', killed: 'TEST_LEAK', detail: 'upload 200' }));
  out.push(result({ kind: 'unknown', code: 'OUTCOME_UNKNOWN', why: 'unexpected-page', killed: 'KILLED_CHALLENGE' }));
  out.push(result({ kind: 'posted', killed: 'KILLED_OFFHOST', account: 'testuser' }));
  out.push(result({ kind: 'posted', alarms: ['DUPLICATE_UPLOAD'] }));
  out.push(result({ kind: 'posted', late: true, facebook: true, account: 'testuser' }));
  out.push(result({ kind: 'notPosted', code: 'UPLOAD_FAILED', late: true, detail: 'publish 400' }));
  out.push(result({ kind: 'stopped', stoppedBy: 'window' }));
  out.push(result({ kind: 'posted', account: 'testuser', why: 'no-upload-seen', markedBy: 'owner' }));
  out.push(result({ kind: 'notPosted', code: 'OUTCOME_UNKNOWN', markedBy: 'owner' }));
  out.push(result({ kind: 'checked', account: 'someoneelse', lockedTo: 'testuser' }));
  return out;
}

/** Every text the copy module produces, for the scans below. */
function everyText(): string[] {
  const texts: string[] = [
    ...Object.values(ACTION_LABEL),
    howItWorks(),
    heldText(),
    runHint(),
    fakeBarText(),
    accountPromptFoot(),
    resizeText({ w: 600, h: 900 }, false, 60_000),
    finishByHandText('pick', null),
    finishByHandText('share', null),
  ];
  for (const c of Object.values(ERROR_COPY)) {
    texts.push(c.title);
    for (const ctx of contexts) texts.push(c.body(ctx));
  }
  for (const s of Object.values(STEP_COPY)) {
    texts.push(s.active, s.done({ window: { w: 511, h: 909 }, handle: 'testuser', facebook: true }));
    if (s.test) texts.push(s.test);
    if (s.shareTest) texts.push(s.shareTest);
  }
  for (const n of Object.values(POST_NOTES)) texts.push(typeof n === 'function' ? n('14:05') : n);
  texts.push(POST_NOTES.K7upload(null));
  for (const r of allResults()) {
    for (const ctx of contexts) {
      const t = resultText(r, { ...ctx, durationMs: 18_000 });
      texts.push(t.title, t.body);
    }
  }
  for (const kind of ['mismatch', 'unreadable', 'first'] as const) {
    texts.push(...accountPromptText(kind, 'testuser', 'other').lines);
  }
  for (const mode of ['post', 'test', 'shareTest', 'check'] as const) {
    texts.push(runHeader(mode, 'testuser'), modeChip(mode) ?? '');
  }
  texts.push(pauseReasonText([]), pauseReasonText(MSITE_LOCK_REASONS));
  return texts;
}

describe('U21 every code has its copy', () => {
  it('a title, a body for every context, and actions that exist', () => {
    for (const code of ERROR_CODES) {
      const c = ERROR_COPY[code];
      expect(c, code).toBeDefined();
      expect(c.title.length, code).toBeGreaterThan(3);
      for (const ctx of contexts) expect(c.body(ctx).length, code).toBeGreaterThan(10);
      for (const a of [c.primary, c.secondary]) if (a !== null) expect(ACTIONS, code).toContain(a);
      expect(c.primary === null || c.primary !== c.secondary, code).toBe(true);
    }
  });

  it('every Couldn’t confirm reason has its own words; a 5xx names its status', () => {
    const seen = new Set<string>();
    for (const why of UNKNOWN_WHYS) {
      const w = whyText(why);
      expect(w.length, why).toBeGreaterThan(10);
      seen.add(w);
    }
    expect(seen.size).toBeGreaterThanOrEqual(UNKNOWN_WHYS.length - 1); // configure-html and redirected agree
    expect(whyText('configure-5xx', 'publish 503 application/json')).toContain('(503)');
    expect(whyText('unexpected-page', 'page /consent/')).toContain('/consent/');
    // AP-8: a Share test whose upload reached a server says the block failed, with the status.
    expect(whyText('not-blocked', 'upload 403')).toContain('didn’t stop the upload');
    expect(whyText('not-blocked', 'upload 403')).toContain('403');
  });

  it('RATE_LIMITED says which pace rule applies (a test within the minute is not "6 posts in the past hour")', () => {
    const body = (detail?: string) =>
      ERROR_COPY.RATE_LIMITED.body({ nothingPosted: true, freeAt: 0, ...(detail ? { detail } : {}) });
    expect(body('spacing')).toMatch(/at least a minute apart/);
    expect(body('spacing')).not.toMatch(/6 posts/);
    expect(body('hour')).toMatch(/6 posts in the past hour/);
    expect(body('day')).toMatch(/15 posts a day/);
    expect(body()).toMatch(/6 posts in the past hour/);
  });

  it('TIMEOUT names the step and its budget from the detail', () => {
    expect(ERROR_COPY.TIMEOUT.body({ nothingPosted: true, detail: 'story 30 s' })).toContain(
      'The step “Story” didn’t finish within 30 seconds',
    );
    expect(ERROR_COPY.TIMEOUT.body({ nothingPosted: true, detail: 'manual 300 s' })).toContain('5 minutes');
  });
});

describe('U21 "Nothing was posted" (ux.md §5)', () => {
  it('is said only when the context says nothing could have been posted', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_COPY[code].body({ nothingPosted: false }), code).not.toContain(NOTHING);
    }
  });

  it('is never said for a result that exists only after Share, whatever the context', () => {
    const afterShare = allResults().filter(
      (r) => r.kind === 'posted' || r.kind === 'unknown' || (r.kind === 'notPosted' && r.code === 'UPLOAD_FAILED'),
    );
    for (const r of afterShare) {
      for (const ctx of contexts) {
        const t = resultText(r, ctx);
        expect(`${t.title} ${t.body}`, JSON.stringify(r)).not.toContain(NOTHING);
      }
    }
    for (const code of ['OUTCOME_UNKNOWN', 'UPLOAD_FAILED', 'TEST_LEAK'] as ErrorCode[]) {
      expect(ERROR_COPY[code].body({ nothingPosted: true }), code).not.toContain(NOTHING);
    }
  });

  it('a stop says it only when nothing could have been posted', () => {
    expect(resultText(result({ kind: 'stopped' }), { nothingPosted: true }).body).toBe('Nothing was posted.');
    expect(resultText(result({ kind: 'stopped' }), { nothingPosted: false }).body).not.toContain(NOTHING);
  });

  it('a test and a Share test say it: their writes were blocked', () => {
    expect(resultText(result({ kind: 'tested' }), { nothingPosted: false }).body).toContain(NOTHING);
    expect(resultText(result({ kind: 'shareTested' }), { nothingPosted: false }).body).toContain(NOTHING);
  });
});

describe('U21 what copy never says', () => {
  it('no error code (codes are for Details)', () => {
    const code = new RegExp(`\\b(?:${ERROR_CODES.join('|')}|DUPLICATE_UPLOAD)\\b`);
    for (const t of everyText()) expect(t, t).not.toMatch(code);
  });

  it('no Meta-host URL', () => {
    for (const t of everyText()) expect(hits(t, EDITOR_ONLY), t).not.toContain('Meta host URL');
  });

  it('no Instagram UI string beyond the names of its controls (+, Story, Share)', () => {
    const theirs = [
      /\bAdd to (?:your )?story\b/i,
      /\bShare to\b/,
      /\bClose Friends\b/,
      /\bNew post\b/i,
      /\bCreate\b/,
      /\bSend to\b(?! phone)/,
      /\bDiscard\b/,
    ];
    // Quoted words are instapost's own names (its steps, its result, its settings), never Instagram's labels.
    const ours = new Set(['Instagram', 'Account', 'Story', 'Share', 'Confirm', 'Posted', 'Only post as']);
    for (const t of everyText()) {
      for (const re of theirs) expect(t, t).not.toMatch(re);
      for (const m of t.matchAll(/“([^”]*)”/g)) expect(ours, t).toContain(m[1]);
    }
  });
});

describe('U21 results and their actions', () => {
  it('Posted offers nothing to do; Couldn’t confirm offers Check my story; failures their code’s actions', () => {
    expect(resultActions(result({ kind: 'posted' }))).toEqual({ primary: null, secondary: null });
    expect(resultActions(result({ kind: 'unknown', code: 'OUTCOME_UNKNOWN', why: 'agent-lost' }))).toEqual({
      primary: 'checkStory',
      secondary: null,
    });
    expect(resultActions(result({ kind: 'unknown', code: 'TEST_LEAK' }))).toEqual({
      primary: 'checkStory',
      secondary: 'resume',
    });
    for (const code of ERROR_CODES) {
      const { primary, secondary } = resultActions(result({ kind: 'notPosted', code }));
      expect({ primary, secondary }, code).toEqual({
        primary: ERROR_COPY[code].primary,
        secondary: ERROR_COPY[code].secondary,
      });
    }
  });

  it('Posted names the account, the time and Instagram’s confirmation; Facebook only when Instagram did it', () => {
    const t = resultText(result({ kind: 'posted', account: 'testuser' }), { nothingPosted: false, durationMs: 18_400 });
    expect(t.title).toBe('Posted to @testuser’s story');
    expect(t.body).toContain('took 18 s');
    expect(t.body).toContain('Instagram confirmed it');
    expect(t.body).not.toContain('Facebook');
    expect(resultText(result({ kind: 'posted', facebook: true }), { nothingPosted: false }).body).toContain('Facebook');
  });

  it('a kill after Posted keeps Posted and explains the pause', () => {
    const t = resultText(result({ kind: 'posted', killed: 'KILLED_CHALLENGE', account: 'testuser' }), {
      nothingPosted: false,
    });
    expect(t.icon).toBe('✓');
    expect(t.body).toContain('Your story was posted before the check.');
  });

  it('a duplicate upload asks for a check; a late answer says so', () => {
    expect(resultText(result({ kind: 'posted', alarms: ['DUPLICATE_UPLOAD'] }), { nothingPosted: false }).title).toBe(
      'Posted — check for a duplicate',
    );
    expect(resultText(result({ kind: 'posted', late: true }), { nothingPosted: false }).body).toMatch(/^Update:/);
  });
});

describe('U21 smaller pieces', () => {
  it('the account prompt says who is logged in and what posting does', () => {
    expect(accountPromptText('first', 'testuser', null)).toEqual({
      lines: ['Instagram is logged in as @testuser. Post as @testuser?'],
      proceed: 'Post as @testuser',
    });
    expect(accountPromptText('mismatch', 'testuser', 'other').lines).toEqual([
      'Instagram in this browser is logged in as @testuser.',
      'You usually post as @other.',
    ]);
    expect(accountPromptText('unreadable', null, 'other').proceed).toBe('Post anyway');
    // A test never posts: its button says so.
    expect(accountPromptText('unreadable', null, null, 'test').proceed).toBe('Continue anyway');
    expect(accountPromptText('mismatch', 'testuser', 'other', 'shareTest').proceed).toBe('Test as @testuser');
  });

  it('Finish by hand names the safety copy when there is one, the folder once', () => {
    const pick = finishByHandText('pick', null);
    expect(pick.split('Downloads/instapost')).toHaveLength(2);
    expect(finishByHandText('pick', '2026-10-13_150000_story.png')).toContain(
      'pick 2026-10-13_150000_story.png from Downloads/instapost',
    );
    expect(finishByHandText('share', null)).toMatch(/^Check the photo .* tap Share/);
  });

  it('the tab title follows the run', () => {
    expect(tabTitle(null)).toBe('instapost');
    expect(tabTitle({ running: true, elapsedMs: 42_100 })).toBe('Posting… 0:43 · instapost');
    expect(tabTitle({ result: result({ kind: 'posted' }) })).toBe('✓ Posted · instapost');
    expect(tabTitle({ result: result({ kind: 'unknown' }) })).toBe('? Check your story · instapost');
    expect(tabTitle({ result: result({ kind: 'notPosted' }) })).toBe('Not posted · instapost');
  });

  it('mm:ss rounds up and never goes negative', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(59_001)).toBe('1:00');
    expect(mmss(-5)).toBe('0:00');
    expect(mmss(125_000)).toBe('2:05');
  });

  it('the run header and the mode chip', () => {
    expect(runHeader('post', 'testuser')).toBe('Posting to @testuser’s story');
    expect(runHeader('post', null)).toBe('Posting to your story');
    expect(runHeader('check', 'testuser')).toBe('Checking the connection');
    expect(modeChip('test')).toBe('Test run — nothing will be posted');
    expect(modeChip('post')).toBeNull();
  });
});

describe('AP-3 an owner’s mark is never Instagram’s confirmation', () => {
  const unknown = result({ kind: 'unknown', code: 'OUTCOME_UNKNOWN', why: 'no-upload-seen', account: 'testuser' });
  const markedPosted: RunResult = { ...unknown, kind: 'posted', markedBy: 'owner' };
  const markedNot: RunResult = { ...unknown, kind: 'notPosted', markedBy: 'owner' };

  it('the card, and the tab title, say it was marked by the owner', () => {
    for (const ctx of contexts) {
      const t = resultText(markedPosted, ctx);
      expect(`${t.title} ${t.body}`).not.toContain('Instagram confirmed');
      expect(t.title).toBe('Marked as posted by you');
      expect(t.body).toContain('couldn’t confirm it with Instagram');
      const n = resultText(markedNot, ctx);
      expect(n.title).toBe('Marked as not posted by you');
      expect(`${n.title} ${n.body}`).not.toContain('Instagram confirmed');
    }
    expect(tabTitle({ result: markedPosted })).toBe('✓ Marked as posted · instapost');
    // Instagram's own answer keeps its words.
    expect(resultText(result({ kind: 'posted' }), { nothingPosted: false }).body).toContain('Instagram confirmed it');
  });
});

describe('AP-4 a check that found another account than posts are locked to', () => {
  it('says the lock, never “Posts go to this account”', () => {
    const t = resultText(result({ kind: 'checked', account: 'someoneelse', lockedTo: 'testuser' }), {
      nothingPosted: true,
    });
    expect(t.title).toBe('Connected as @someoneelse — posts are locked to @testuser');
    expect(t.body).not.toContain('Posts go to this account');
    expect(t.body).toContain('Use @someoneelse');
    expect(resultText(result({ kind: 'checked', account: 'testuser' }), { nothingPosted: true }).body).toBe(
      'Posts go to this account.',
    );
  });
});

describe('AP-10 the K7 note for a window held while Instagram may still upload', () => {
  it('does not tell the owner to press Done (Done keeps an upload-held window)', () => {
    expect(POST_NOTES.K7upload('14:05')).toContain('closes by itself at 14:05');
    expect(POST_NOTES.K7upload('14:05')).not.toContain('Done');
    expect(POST_NOTES.K7held).toContain('Press Done on its result');
  });
});

describe('AP-12 the pause banner names the reason', () => {
  it('TEST_LEAK says to check and delete the test story, not a security check', () => {
    const t = pauseReasonText(['TEST_LEAK']);
    expect(t).toContain('delete the test story');
    expect(t).not.toContain('security check');
  });

  it('the kill switch reasons keep their own words; a lock without a reason keeps the general text', () => {
    expect(pauseReasonText(['KILLED_CHALLENGE'])).toContain('security check');
    expect(pauseReasonText(['KILLED_OFFHOST'])).toContain('another website');
    expect(pauseReasonText(['KILLED_CHALLENGE', 'TEST_LEAK'])).toContain('delete the test story');
    expect(pauseReasonText([])).toContain('security check (or the window left Instagram)');
  });
});
