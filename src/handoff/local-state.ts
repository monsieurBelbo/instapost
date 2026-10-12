/**
 * storage.local bookkeeping for the hand-off (strategy §3.3, §3.6): settings (merged over the
 * mode's defaults), the msite lock written by the kill switch, the rate-guard open log, and the
 * open composer popup.
 *
 * AM25: the lock lives in its own key, `msiteLock`, that only the background writes, in its single
 * effect queue: lockMsite and the owner's ENABLE (sent by the editor as a message) never race each
 * other, and the background never rewrites the editor-owned `settings` object, so no editor edit and
 * no lock can be lost to a cross-context read-merge-write. A lock left in the old place,
 * `settings.msiteLockedUntil`, still counts until ENABLE clears it.
 */
import { checkRate, effectiveCaps, type LocalDay, pruneOpens, type RateDecision } from '../core/handoff/rate-guard.ts';
import { defaultSettings, type Settings } from '../core/handoff/state.ts';
import { type Area, type ComposerWindowRecord, type LocalSchema, local } from '../platform/storage.ts';

export type { ComposerWindowRecord };

/** Local midnight at or before `t`, in the machine's time zone. */
export const machineDay: LocalDay = { startOf: (t) => new Date(t).setHours(0, 0, 0, 0) };

export interface LocalState {
  /** The stored settings over the defaults, with `msiteLockedUntil` from the lock key (and a legacy lock). */
  settings(): Promise<Settings>;
  /** msiteLock = until (never shortens an existing lock). Never writes `settings`. */
  lockMsite(until: number): Promise<void>;
  /**
   * ENABLE: clears the lock when it is no later than `seen`, the lock the editor showed (a newer kill
   * stays). Returns whether the lane is unlocked afterwards.
   */
  clearMsiteLock(seen: number | null): Promise<boolean>;
  rate(now: number, settings: Settings): Promise<RateDecision>;
  noteOpen(t: number): Promise<void>;
  /** AM22: the popup of the active (or an interrupted) hand-off. */
  composerWindow(): Promise<ComposerWindowRecord | null>;
  rememberWindow(rec: ComposerWindowRecord): Promise<void>;
  forgetWindow(): Promise<void>;
}

/** Fails closed: a lock value that is neither null nor a finite date locks until `ENABLE` clears it. */
function lockOf(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  return typeof x === 'number' && Number.isFinite(x) ? x : Number.MAX_SAFE_INTEGER;
}

const later = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

const isId = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

export function localState(guarded: boolean, day: LocalDay = machineDay, area: Area<LocalSchema> = local): LocalState {
  async function lock(stored?: Partial<Settings>): Promise<number | null> {
    const legacy = lockOf((stored ?? (await area.get('settings')))?.msiteLockedUntil);
    return later(lockOf(await area.get('msiteLock')), legacy);
  }
  async function settings(): Promise<Settings> {
    const stored = await area.get('settings');
    const merged: Settings = { ...defaultSettings(guarded), ...stored };
    return { ...merged, msiteLockedUntil: await lock(stored), rateCaps: merged.rateCaps ?? {} };
  }
  async function opens(): Promise<number[]> {
    const log = await area.get('rateLog');
    return Array.isArray(log) ? log.filter((t) => typeof t === 'number' && Number.isFinite(t)) : [];
  }
  return {
    settings,
    async lockMsite(until) {
      await area.set('msiteLock', later(until, lockOf(await area.get('msiteLock'))));
    },
    async clearMsiteLock(seen) {
      const stored = await area.get('settings');
      const current = await lock(stored);
      if (current === null) return true;
      if (seen === null || current > seen) return false;
      await area.remove('msiteLock');
      // A lock from before AM25 sits in the settings object: clear it there too (once).
      if (lockOf(stored?.msiteLockedUntil) !== null && stored) {
        await area.set('settings', { ...stored, msiteLockedUntil: null });
      }
      return true;
    },
    async rate(now, s) {
      return checkRate(await opens(), now, effectiveCaps(s.rateCaps), day);
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
  };
}
