/**
 * U25 (ux.md §4.8, C14): handle validation, Instagram's own routes, and the account decision in every
 * case and mode. Without a human at the composer, the lock is the only wrong-account guard: a mismatch,
 * an unreadable account or (for a post) no expected account asks before any tap.
 */
import { describe, expect, it } from 'vitest';
import type { HandoffMode } from '../handoff/state.ts';
import { accountDecision, isValidHandle, promptOf, RESERVED_SEGMENTS, sameHandle } from './account.ts';

describe('U25 handles', () => {
  it('accepts Instagram usernames: letters, digits, dots, underscores, 1–30', () => {
    for (const h of ['a', 'testuser', 'first.last', 'x_y_z', 'A1', 'a'.repeat(30), 'user.name_99']) {
      expect(isValidHandle(h), h).toBe(true);
    }
  });

  it('rejects the rest: empty, too long, other characters, dots at the ends or doubled', () => {
    for (const h of [
      '',
      'a'.repeat(31),
      'with space',
      'emoji🙂',
      'a-b',
      '.lead',
      'trail.',
      'dou..ble',
      '@testuser',
      7,
      null,
    ]) {
      expect(isValidHandle(h), String(h)).toBe(false);
    }
  });

  it('rejects Instagram’s own first path segments, in any case', () => {
    for (const seg of ['explore', 'reels', 'direct', 'accounts', 'stories', 'create', 'p', 'Explore']) {
      expect(isValidHandle(seg), seg).toBe(false);
    }
    expect(RESERVED_SEGMENTS).toContain('stories');
  });

  it('compares handles case-insensitively', () => {
    expect(sameHandle('TestUser', 'testuser')).toBe(true);
    expect(sameHandle('testuser', 'other')).toBe(false);
    expect(sameHandle(null, 'testuser')).toBe(false);
  });
});

describe('U25 accountDecision', () => {
  const modes: HandoffMode[] = ['post', 'test', 'shareTest', 'check'];

  it('the lock on: the expected account goes on; any other asks', () => {
    for (const m of ['post', 'test', 'shareTest'] as const) {
      expect(accountDecision('testuser', 'testuser', true, m)).toBe('ok');
      expect(accountDecision('testuser', 'TESTUSER', true, m)).toBe('ok');
      expect(accountDecision('testuser', 'other', true, m)).toBe('prompt-mismatch');
      expect(accountDecision('testuser', null, true, m)).toBe('prompt-unreadable');
      expect(accountDecision(null, null, true, m)).toBe('prompt-unreadable');
    }
  });

  it('no expected account: tests learn it; a post asks (after Forget this account)', () => {
    expect(accountDecision(null, 'testuser', true, 'test')).toBe('learn');
    expect(accountDecision(null, 'testuser', true, 'shareTest')).toBe('learn');
    expect(accountDecision(null, 'testuser', true, 'post')).toBe('prompt-first');
  });

  it('the lock off: never asks', () => {
    for (const m of ['post', 'test', 'shareTest'] as const) {
      expect(accountDecision('testuser', 'other', false, m)).toBe('unlocked');
      expect(accountDecision(null, null, false, m)).toBe('unlocked');
    }
  });

  it('a check never asks (it taps nothing); it learns an account when none is expected', () => {
    expect(accountDecision('testuser', 'testuser', true, 'check')).toBe('ok');
    expect(accountDecision('testuser', 'TestUser', true, 'check')).toBe('ok');
    expect(accountDecision(null, 'testuser', true, 'check')).toBe('learn');
    expect(accountDecision(null, 'testuser', false, 'check')).toBe('learn');
    expect(accountDecision('testuser', 'other', false, 'check')).toBe('unlocked');
  });

  it('AP-4: a check reports the relation a post would meet, never a match it did not see', () => {
    // The lock on and another account logged in: a mismatch (a post would stop and ask), not 'ok'.
    expect(accountDecision('testuser', 'someoneelse', true, 'check')).toBe('mismatch');
    expect(accountDecision('testuser', null, true, 'check')).toBe('unreadable');
    expect(accountDecision(null, null, false, 'check')).toBe('unreadable');
    // Neither is a prompt: a check taps nothing and asks nothing.
    expect(promptOf('mismatch')).toBeNull();
    expect(promptOf('unreadable')).toBeNull();
  });

  it('prompts map to the three prompt kinds; every other decision is none', () => {
    expect(promptOf('prompt-mismatch')).toBe('mismatch');
    expect(promptOf('prompt-unreadable')).toBe('unreadable');
    expect(promptOf('prompt-first')).toBe('first');
    for (const d of ['ok', 'learn', 'unlocked'] as const) expect(promptOf(d)).toBeNull();
    for (const m of modes)
      expect(
        m === 'check'
          ? ['ok', 'learn', 'unlocked', 'mismatch', 'unreadable']
          : ['ok', 'learn', 'unlocked', 'prompt-mismatch', 'prompt-unreadable', 'prompt-first'],
      ).toContain(accountDecision('a', 'b', true, m));
  });
});
