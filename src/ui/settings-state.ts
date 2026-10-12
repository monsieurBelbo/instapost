/**
 * Settings in chrome.storage.local (strategy §3.3), shared with the background. The editor shows
 * and edits them; the background reads them per hand-off.
 *
 * The kill-switch lock is not the editor's to write (§11 AM25). The background keeps it in its own
 * key, `msiteLock`, written only from its effect queue; the editor shows it (merged into
 * `settings.msiteLockedUntil`) and asks the background to lift it on ENABLE. Editor writes touch the
 * `settings` object only, never the lock, and never carry a lock value of their own, so a lock the
 * kill switch writes at any moment survives every edit. storage.onChanged keeps the signal current.
 */
import { signal } from '@preact/signals';
import { browser } from 'wxt/browser';
import { defaultSettings, type Settings } from '../core/handoff/state.ts';
import { local } from '../platform/storage.ts';
import { GUARDED } from '../shared/env.ts';
import { requestMsiteEnable } from './handoff-state.ts';

export const settings = signal<Settings>(defaultSettings(GUARDED));
export const settingsLoaded = signal(false);

/** The two stored sources the signal is built from. */
let storedSettings: Partial<Settings> | undefined;
let storedLock: number | null | undefined;

const later = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));
const lockValue = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** The stored settings over the defaults; the lock is the background's key (and a pre-AM25 one). */
function view(): Settings {
  const merged: Settings = { ...defaultSettings(GUARDED), ...storedSettings };
  return {
    ...merged,
    msiteLockedUntil: later(lockValue(storedLock), lockValue(storedSettings?.msiteLockedUntil)),
  };
}

let started = false;

/** Loads the settings once and follows later changes. Idempotent. */
export async function initSettings(): Promise<void> {
  if (started) return;
  started = true;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) storedSettings = changes.settings.newValue as Partial<Settings> | undefined;
    if (changes.msiteLock) storedLock = changes.msiteLock.newValue as number | null | undefined;
    if (changes.settings || changes.msiteLock) settings.value = view();
  });
  [storedSettings, storedLock] = await Promise.all([local.get('settings'), local.get('msiteLock')]);
  settings.value = view();
  settingsLoaded.value = true;
}

let writes: Promise<void> = Promise.resolve();

/**
 * Applies `patch` to the signal at once (optimistic), then queues a read-merge-write of the
 * `settings` object, so rapid edits never overwrite each other. A lock in `patch` is ignored: the
 * editor never writes one (AM25).
 */
export function updateSettings(patch: Partial<Settings>): Promise<void> {
  const { msiteLockedUntil: _lock, ...own } = patch;
  settings.value = { ...settings.value, ...own };
  const write = writes.then(async () => {
    const stored = await local.get('settings');
    // Whatever lock field is stored stays as it is (a pre-AM25 lock counts until ENABLE clears it).
    const next: Settings = { ...defaultSettings(GUARDED), ...stored, ...own };
    await local.set('settings', { ...next, msiteLockedUntil: stored?.msiteLockedUntil ?? null });
  });
  writes = write.catch(() => undefined);
  return write;
}

/** The lock is active at `now`. */
export const isMsiteLocked = (s: Settings, now: number): boolean =>
  s.msiteLockedUntil !== null && s.msiteLockedUntil > now;

/** The exact word the owner types to lift a kill-switch lock (§3.6). */
export const ENABLE_WORD = 'ENABLE';

/**
 * When `typed` is exactly ENABLE, asks the background to lift the lock shown now (AM25); the
 * signal follows once the background has cleared it. Returns whether the request was sent.
 */
export function reEnableMsite(typed: string, send: (lockedUntil: number | null) => void = requestMsiteEnable): boolean {
  if (typed !== ENABLE_WORD) return false;
  send(settings.value.msiteLockedUntil);
  return true;
}
