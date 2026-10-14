/**
 * The logged-in account (ux.md §4.8, docs/contract.md C14). Pure.
 *
 * The agent reads the handle structurally from Instagram's own navigation: the one link to `/<username>/`
 * (PolarisProfileNavItem), never text. Instagram usernames are 1–30 letters, digits, dots and underscores;
 * a first path segment that is one of Instagram's own routes is never a username.
 *
 * Without a human looking at the composer, the account lock is the only guard against posting to the wrong
 * account (R10), so a mismatch, an unreadable account or no expected account pauses before any tap and asks.
 * Tests learn the account without asking (the setup test, OD10); a check never asks (it taps nothing).
 */
import type { AccountDecisionKind, AccountPromptKind, HandoffMode } from '../handoff/state.ts';

export const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

/** First path segments that are Instagram routes, not profiles (lower case). */
export const RESERVED_SEGMENTS: readonly string[] = [
  'about',
  'accounts',
  'api',
  'ar',
  'challenge',
  'checkpoint',
  'create',
  'developer',
  'direct',
  'emails',
  'explore',
  'graphql',
  'legal',
  'login',
  'logout',
  'nametag',
  'p',
  'privacy',
  'reel',
  'reels',
  'session',
  'static',
  'stories',
  'terms',
  'tv',
  'web',
  'auth_platform',
  'your_activity',
  'notifications',
  'directory',
  'lite',
  'download',
  'help',
  'oauth',
  'data',
];

/** A plausible Instagram username: the charset and length, no leading/trailing dot, not a route. */
export function isValidHandle(h: unknown): h is string {
  if (typeof h !== 'string' || !HANDLE_RE.test(h)) return false;
  if (h.startsWith('.') || h.endsWith('.') || h.includes('..')) return false;
  return !RESERVED_SEGMENTS.includes(h.toLowerCase());
}

/** Instagram handles are case-insensitive. */
export const sameHandle = (a: string | null, b: string | null): boolean =>
  a !== null && b !== null && a.toLowerCase() === b.toLowerCase();

/**
 * What to do with the account before any tap:
 * - `ok`: the lock is on and the detected account is the expected one;
 * - `learn`: no account is expected yet and this is a test or a check: carry on and remember it;
 * - `unlocked`: "Only post as" is off: carry on (remembering it when none is expected);
 * - `prompt-…`: pause and ask (posts with no expected account, any mismatch, any unreadable account).
 * A check never prompts: it taps nothing and only reports what it read, with the same relation a post
 * would meet (`mismatch`, `unreadable`), so its result never claims a match it did not see (AP-4).
 */
export function accountDecision(
  expected: string | null,
  detected: string | null,
  lock: boolean,
  mode: HandoffMode,
): AccountDecisionKind {
  if (mode === 'check') {
    if (detected === null) return 'unreadable';
    if (expected === null) return 'learn';
    if (!lock) return 'unlocked';
    return sameHandle(expected, detected) ? 'ok' : 'mismatch';
  }
  if (!lock) return 'unlocked';
  if (detected === null) return 'prompt-unreadable';
  if (expected === null) return mode === 'post' ? 'prompt-first' : 'learn';
  return sameHandle(expected, detected) ? 'ok' : 'prompt-mismatch';
}

export function promptOf(d: AccountDecisionKind): AccountPromptKind | null {
  if (d === 'prompt-mismatch') return 'mismatch';
  if (d === 'prompt-unreadable') return 'unreadable';
  if (d === 'prompt-first') return 'first';
  return null;
}
