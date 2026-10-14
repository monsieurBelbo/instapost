/**
 * Settings in chrome.storage.local (strategy §3.3, ux.md §4.12, IU8), shared with the background. The
 * editor shows and edits its own keys (`settings`: the account lock, Keep copies, onboarding); the
 * background owns the kill-switch lock (`msiteLock`, AM25), the detected account (`expectedAccount`), the
 * setup test's pass (`lastTestPassAt`) and the last result (`lastResult`), which the editor only shows:
 * Resume and Forget this account are requests to the background. Editor writes touch the `settings` object
 * only, so a background write at any moment survives every edit. storage.onChanged keeps the signals current.
 */
import { signal } from '@preact/signals';
import { browser } from 'wxt/browser';
import type { LastResult, MsiteLockReason, Settings } from '../core/handoff/state.ts';
import { accountOf, editorSettings, lockReasonsOf } from '../handoff/local-state.ts';
import { local } from '../platform/storage.ts';
import { GUARDED } from '../shared/env.ts';
import { isRunResult } from '../shared/protocol.ts';
import { requestResume } from './run-state.ts';

export const settings = signal<Settings>(editorSettings(undefined, GUARDED));
export const settingsLoaded = signal(false);
/** storage.local `lastResult` (the top bar's Last:). */
export const lastResult = signal<LastResult | null>(null);
/** AP-12: storage.local `msiteLockReasons`: why desktop posting is paused (the banner's text). */
export const msiteLockReasons = signal<MsiteLockReason[]>([]);

type Stored = Partial<Record<string, unknown>> | undefined;
let storedSettings: Stored;
let storedLock: unknown;
let storedAccount: unknown;
let storedTestAt: unknown;

const later = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));
const lockValue = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** The stored settings over the defaults, with the background-owned keys merged in. */
function view(): Settings {
  return {
    ...editorSettings(storedSettings, GUARDED),
    msiteLockedUntil: later(lockValue(storedLock), lockValue(storedSettings?.msiteLockedUntil)),
    expectedAccount: accountOf(storedAccount),
    lastTestPassAt: lockValue(storedTestAt),
  };
}

function lastOf(x: unknown): LastResult | null {
  if (typeof x !== 'object' || x === null) return null;
  const l = x as Partial<LastResult>;
  return typeof l.handoffId === 'string' && isRunResult(l.result) ? (l as LastResult) : null;
}

let started = false;

/** Loads the settings once and follows later changes. Idempotent. */
export async function initSettings(): Promise<void> {
  if (started) return;
  started = true;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let touched = false;
    if (changes.settings) {
      storedSettings = changes.settings.newValue as Stored;
      touched = true;
    }
    if (changes.msiteLock) {
      storedLock = changes.msiteLock.newValue;
      touched = true;
    }
    if (changes.expectedAccount) {
      storedAccount = changes.expectedAccount.newValue;
      touched = true;
    }
    if (changes.lastTestPassAt) {
      storedTestAt = changes.lastTestPassAt.newValue;
      touched = true;
    }
    if (changes.lastResult) lastResult.value = lastOf(changes.lastResult.newValue);
    if (changes.msiteLockReasons) msiteLockReasons.value = lockReasonsOf(changes.msiteLockReasons.newValue);
    if (touched) settings.value = view();
  });
  const [s, l, a, t, r, why] = await Promise.all([
    local.get('settings'),
    local.get('msiteLock'),
    local.get('expectedAccount'),
    local.get('lastTestPassAt'),
    local.get('lastResult'),
    local.get('msiteLockReasons'),
  ]);
  storedSettings = s as Stored;
  storedLock = l;
  storedAccount = a;
  storedTestAt = t;
  lastResult.value = lastOf(r);
  msiteLockReasons.value = lockReasonsOf(why);
  settings.value = view();
  settingsLoaded.value = true;
}

/** The keys the editor may write. */
export type EditorPatch = Partial<Pick<Settings, 'accountLock' | 'keepCopies' | 'onboardedAt'>>;

let writes: Promise<void> = Promise.resolve();

/**
 * Applies `patch` to the signal at once (optimistic), then queues a read-merge-write of the `settings`
 * object, so rapid edits never overwrite each other. Only the editor's own keys are written.
 */
export function updateSettings(patch: EditorPatch): Promise<void> {
  const own: EditorPatch = {};
  if (patch.accountLock !== undefined) own.accountLock = patch.accountLock;
  if (patch.keepCopies !== undefined) own.keepCopies = patch.keepCopies;
  if (patch.onboardedAt !== undefined) own.onboardedAt = patch.onboardedAt;
  settings.value = { ...settings.value, ...own };
  const write = writes.then(async () => {
    const stored = (await local.get('settings')) as Stored;
    await local.set('settings', { ...(stored ?? {}), ...own } as unknown as Settings);
  });
  writes = write.catch(() => undefined);
  return write;
}

/**
 * AP-11 (ux.md §4.2): the last run ended because Instagram was not logged in, and no setup test has passed
 * since: onboarding highlights step 1. Read from `lastResult`, which outlives the result card's Done.
 */
export function lastRunNotLoggedIn(last: LastResult | null, lastTestPassAt: number | null): boolean {
  if (last?.result.kind !== 'notPosted' || last.result.code !== 'NOT_LOGGED_IN') return false;
  return lastTestPassAt === null || last.result.at > lastTestPassAt;
}

/** The lock is active at `now`. */
export const isMsiteLocked = (s: Settings, now: number): boolean =>
  s.msiteLockedUntil !== null && s.msiteLockedUntil > now;

/**
 * Resume (§4.10): sent only with the confirmation checked; the background lifts the lock shown now (AM25)
 * and the signal follows once it has. Returns whether the request was sent.
 */
export function resumeMsite(confirmed: boolean, send: (lockedUntil: number | null) => void = requestResume): boolean {
  if (!confirmed) return false;
  send(settings.value.msiteLockedUntil);
  return true;
}
