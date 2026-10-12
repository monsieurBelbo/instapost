/**
 * Settings store (strategy §3.3, §7.10 settings view): defaults per build, serialised editor writes,
 * and the kill-switch lock (§11 AM25): the background owns it in its own key, so no editor write can
 * erase it whatever the interleaving, and ENABLE is a request to the background, never an editor write.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { defaultSettings, type Settings } from '../core/handoff/state.ts';
import { localState } from '../handoff/local-state.ts';
import { local } from '../platform/storage.ts';
import { ENABLE_WORD, isMsiteLocked, reEnableMsite, settings, updateSettings } from './settings-state.ts';

const stored = async (): Promise<Settings | undefined> =>
  (await fakeBrowser.storage.local.get('settings')).settings as Settings | undefined;
const storedLock = async (): Promise<unknown> => (await fakeBrowser.storage.local.get('msiteLock')).msiteLock;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settings store', () => {
  test('defaults: rehearsal on; assisted insert on in guarded builds (Vitest is guarded)', () => {
    expect(settings.value).toEqual(defaultSettings(true));
    expect(defaultSettings(false).assistedInsert).toBe(false);
    expect(defaultSettings(false).rehearsal).toBe(true);
  });

  test('rapid writes are applied at once and all persist', async () => {
    const a = updateSettings({ rehearsal: false });
    const b = updateSettings({ assistedInsert: false });
    const c = updateSettings({ accountLabel: '@secondary' });
    expect(settings.value).toMatchObject({ rehearsal: false, assistedInsert: false, accountLabel: '@secondary' });
    await Promise.all([a, b, c]);
    expect(await stored()).toMatchObject({ rehearsal: false, assistedInsert: false, accountLabel: '@secondary' });
  });

  test('the editor never writes a lock, even when a patch carries one', async () => {
    await updateSettings({ accountLabel: '@a', msiteLockedUntil: 123 });
    expect((await stored())?.msiteLockedUntil ?? null).toBeNull();
    expect(await storedLock()).toBeUndefined();
  });

  test('AM25: a kill-switch lock written between the editor read and write survives, and so does the edit', async () => {
    const background = localState(true);
    const until = Date.now() + 7 * 86_400_000;
    const get = local.get.bind(local);
    let raced = false;
    vi.spyOn(local, 'get').mockImplementation(async (key) => {
      const value = await get(key);
      if (key === 'settings' && !raced) {
        // The editor has read `settings`; the kill switch fires before its write lands.
        raced = true;
        await background.lockMsite(until);
      }
      return value;
    });
    await updateSettings({ accountLabel: '@typed' });
    expect(raced).toBe(true);
    expect((await background.settings()).msiteLockedUntil).toBe(until);
    expect(await stored()).toMatchObject({ accountLabel: '@typed' });
  });

  test('AM25: concurrent lock and edit in either order keep both', async () => {
    const background = localState(true);
    const until = Date.now() + 86_400_000;
    await Promise.all([background.lockMsite(until), updateSettings({ accountLabel: '@one' })]);
    await Promise.all([updateSettings({ accountLabel: '@two' }), background.lockMsite(until + 1)]);
    expect((await background.settings()).msiteLockedUntil).toBe(until + 1);
    expect((await background.settings()).accountLabel).toBe('@two');
  });

  test('only the exact word ENABLE asks the background, with the lock the editor shows', () => {
    const until = Date.now() + 86_400_000;
    settings.value = { ...settings.value, msiteLockedUntil: until };
    const sent: (number | null)[] = [];
    const send = (lockedUntil: number | null) => void sent.push(lockedUntil);
    expect(reEnableMsite('enable', send)).toBe(false);
    expect(reEnableMsite(' ENABLE', send)).toBe(false);
    expect(sent).toEqual([]);
    expect(reEnableMsite(ENABLE_WORD, send)).toBe(true);
    expect(sent).toEqual([until]);
  });

  test('isMsiteLocked compares with now', () => {
    const s = { ...defaultSettings(true), msiteLockedUntil: 1000 };
    expect(isMsiteLocked(s, 999)).toBe(true);
    expect(isMsiteLocked(s, 1000)).toBe(false);
    expect(isMsiteLocked({ ...s, msiteLockedUntil: null }, 0)).toBe(false);
  });
});
