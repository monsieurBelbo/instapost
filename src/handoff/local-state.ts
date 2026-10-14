/**
 * storage.local bookkeeping for the hand-off (strategy §3.3, §3.6; ux.md IR14): settings (merged over the
 * defaults), the msite lock written by the kill switch, the rate-guard open log, the open composer popup,
 * and the autopilot's background-owned keys.
 *
 * AM25: every key the background writes is its own and is written only from its single effect queue, so
 * no editor edit and no background write can be lost to a cross-context read-merge-write: `msiteLock`,
 * `expectedAccount`, `lastTestPassAt`, `menuFingerprint`, `lastResult`. The editor owns `settings` and
 * never writes those keys (Forget this account and Resume are requests to the background). A lock left in
 * the old place, `settings.msiteLockedUntil`, still counts until Resume clears it. Keys of earlier builds
 * in the stored settings (`accountLabel`, `assistedInsert`, `rehearsal`) are ignored.
 */

import {
  checkRate,
  effectiveCaps,
  type LocalDay,
  pruneOpens,
  type RateCaps,
  type RateCounts,
  type RateDecision,
  rateCounts,
} from '../core/handoff/rate-guard.ts';
import {
  defaultSettings,
  type ExpectedAccount,
  type LastResult,
  type MenuFingerprint,
  MSITE_LOCK_REASONS,
  type MsiteLockReason,
  type Settings,
} from '../core/handoff/state.ts';
import { isValidHandle } from '../core/ig-contract/account.ts';
import { type Area, type ComposerWindowRecord, type LocalSchema, local } from '../platform/storage.ts';
import { isMenuFingerprint, isRunResult } from '../shared/protocol.ts';

export type { ComposerWindowRecord };

/** Local midnight at or before `t`, in the machine's time zone. */
export const machineDay: LocalDay = { startOf: (t) => new Date(t).setHours(0, 0, 0, 0) };

export interface RateInfo {
  decision: RateDecision;
  counts: RateCounts;
  caps: RateCaps;
}

export interface LocalState {
  /** The stored settings over the defaults, with the lock, the expected account and the last test pass merged in. */
  settings(): Promise<Settings>;
  /**
   * msiteLock = until (never shortens an existing lock), and `reason` joins the reasons of the lock still in
   * force at `now` (AP-12: the banner says each). Never writes `settings`.
   */
  lockMsite(until: number, reason?: MsiteLockReason, now?: number): Promise<void>;
  /**
   * Resume: clears the lock when it is no later than `seen`, the lock the editor showed (a newer kill
   * stays). Returns whether the lane is unlocked afterwards.
   */
  clearMsiteLock(seen: number | null): Promise<boolean>;
  rate(now: number, settings: Settings): Promise<RateDecision>;
  /** ux.md §4.10: the decision with the counts and caps (the lane, History's header). */
  rateInfo(now: number, settings: Settings): Promise<RateInfo>;
  noteOpen(t: number): Promise<void>;
  /** AM22: the popup of the active (or an interrupted) hand-off. */
  composerWindow(): Promise<ComposerWindowRecord | null>;
  rememberWindow(rec: ComposerWindowRecord): Promise<void>;
  forgetWindow(): Promise<void>;
  fingerprint(): Promise<MenuFingerprint | null>;
  storeFingerprint(fp: MenuFingerprint): Promise<void>;
  setExpectedAccount(account: ExpectedAccount): Promise<void>;
  forgetAccount(): Promise<void>;
  setLastTestPass(at: number): Promise<void>;
  lastResult(): Promise<LastResult | null>;
  writeLastResult(last: LastResult): Promise<void>;
}

/** Fails closed: a lock value that is neither null nor a finite date locks until Resume clears it. */
function lockOf(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  return typeof x === 'number' && Number.isFinite(x) ? x : Number.MAX_SAFE_INTEGER;
}

const later = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

/** AP-12: the stored lock reasons, known ones only, each once, in MSITE_LOCK_REASONS order. */
export function lockReasonsOf(x: unknown): MsiteLockReason[] {
  const list: unknown[] = Array.isArray(x) ? x : [];
  return MSITE_LOCK_REASONS.filter((r) => list.includes(r));
}

const isId = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

export function accountOf(x: unknown): ExpectedAccount | null {
  if (typeof x !== 'object' || x === null) return null;
  const a = x as { handle?: unknown; detectedAt?: unknown };
  return isValidHandle(a.handle) && typeof a.detectedAt === 'number' && Number.isFinite(a.detectedAt)
    ? { handle: a.handle, detectedAt: a.detectedAt }
    : null;
}

const timeOf = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/**
 * The editor-owned settings as stored, over the defaults: only the known keys (keys of earlier builds,
 * such as `rehearsal`, are dropped), each with a sane type or its default.
 */
export function editorSettings(stored: Partial<Record<string, unknown>> | undefined, guarded: boolean): Settings {
  const d = defaultSettings(guarded);
  const s = stored ?? {};
  return {
    ...d,
    chMode: s.chMode === 'uaOnly' ? 'uaOnly' : 'full',
    composerProfile: (s.composerProfile as Settings['composerProfile']) ?? null,
    rateCaps: typeof s.rateCaps === 'object' && s.rateCaps !== null ? (s.rateCaps as Settings['rateCaps']) : {},
    accountLock: typeof s.accountLock === 'boolean' ? s.accountLock : d.accountLock,
    keepCopies: typeof s.keepCopies === 'boolean' ? s.keepCopies : d.keepCopies,
    onboardedAt: timeOf(s.onboardedAt),
  };
}

export function localState(guarded: boolean, day: LocalDay = machineDay, area: Area<LocalSchema> = local): LocalState {
  async function lock(stored?: Partial<Settings>): Promise<number | null> {
    const legacy = lockOf((stored ?? (await area.get('settings')))?.msiteLockedUntil);
    return later(lockOf(await area.get('msiteLock')), legacy);
  }
  async function settings(): Promise<Settings> {
    const stored = await area.get('settings');
    const [account, testAt] = await Promise.all([area.get('expectedAccount'), area.get('lastTestPassAt')]);
    return {
      ...editorSettings(stored as Partial<Record<string, unknown>> | undefined, guarded),
      msiteLockedUntil: await lock(stored),
      expectedAccount: accountOf(account),
      lastTestPassAt: timeOf(testAt),
    };
  }
  async function opens(): Promise<number[]> {
    const log = await area.get('rateLog');
    return Array.isArray(log) ? log.filter((t) => typeof t === 'number' && Number.isFinite(t)) : [];
  }
  return {
    settings,
    async lockMsite(until, reason, now = Date.now()) {
      const current = lockOf(await area.get('msiteLock'));
      await area.set('msiteLock', later(until, current));
      if (reason === undefined) return;
      // A lock that had already run out says nothing about this one.
      const kept = current !== null && current > now ? lockReasonsOf(await area.get('msiteLockReasons')) : [];
      await area.set('msiteLockReasons', lockReasonsOf([...kept, reason]));
    },
    async clearMsiteLock(seen) {
      const stored = await area.get('settings');
      const current = await lock(stored);
      if (current === null) return true;
      if (seen === null || current > seen) return false;
      await area.remove('msiteLock');
      await area.remove('msiteLockReasons');
      if (lockOf(stored?.msiteLockedUntil) !== null && stored) {
        await area.set('settings', { ...stored, msiteLockedUntil: null });
      }
      return true;
    },
    async rate(now, s) {
      return checkRate(await opens(), now, effectiveCaps(s.rateCaps), day);
    },
    async rateInfo(now, s) {
      const log = await opens();
      const caps = effectiveCaps(s.rateCaps);
      return { decision: checkRate(log, now, caps, day), counts: rateCounts(log, now, day), caps };
    },
    async noteOpen(t) {
      await area.set('rateLog', pruneOpens([...(await opens()), t], t, day));
    },
    async composerWindow() {
      const rec = await area.get('composerWindow');
      if (!rec || !isId(rec.windowId) || !isId(rec.tabId) || typeof rec.handoffId !== 'string') return null;
      return { windowId: rec.windowId, tabId: rec.tabId, handoffId: rec.handoffId };
    },
    async rememberWindow(rec) {
      await area.set('composerWindow', { windowId: rec.windowId, tabId: rec.tabId, handoffId: rec.handoffId });
    },
    async forgetWindow() {
      await area.remove('composerWindow');
    },
    async fingerprint() {
      const fp = await area.get('menuFingerprint');
      return isMenuFingerprint(fp) ? fp : null;
    },
    async storeFingerprint(fp) {
      await area.set('menuFingerprint', {
        count: fp.count,
        storyIndex: fp.storyIndex,
        glyph: fp.glyph,
        savedAt: fp.savedAt,
      });
    },
    async setExpectedAccount(account) {
      const a = accountOf(account);
      if (a) await area.set('expectedAccount', a);
    },
    async forgetAccount() {
      await area.remove('expectedAccount');
    },
    async setLastTestPass(at) {
      await area.set('lastTestPassAt', at);
    },
    async lastResult() {
      const last = await area.get('lastResult');
      if (!last || typeof last !== 'object' || typeof last.handoffId !== 'string' || !isRunResult(last.result)) {
        return null;
      }
      return last;
    },
    async writeLastResult(last) {
      await area.set('lastResult', last);
    },
  };
}
