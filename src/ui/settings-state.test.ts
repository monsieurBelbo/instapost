/**
 * U28 (ux.md §4.12, IU8): the settings store. Defaults per build, serialised editor writes of the editor's
 * own keys only (the account lock, Keep copies, onboarding, the language), and the background-owned keys (the kill-switch
 * lock, AM25; the detected account; the setup test's pass; the last result), which the editor shows and
 * never writes: no editor write can erase them whatever the interleaving, and Resume is a request to the
 * background, sent only with its confirmation checked.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { defaultSettings, type Settings } from '../core/handoff/state.ts';
import { editorSettings, localState } from '../handoff/local-state.ts';
import { local } from '../platform/storage.ts';
import { lang, langSetting } from './i18n.ts';
import {
  type EditorPatch,
  initSettings,
  isMsiteLocked,
  lastResult,
  lastRunNotLoggedIn,
  msiteLockReasons,
  resumeMsite,
  settings,
  updateSettings,
} from './settings-state.ts';

const stored = async (): Promise<Record<string, unknown> | undefined> =>
  (await fakeBrowser.storage.local.get('settings')).settings as Record<string, unknown> | undefined;
const storedKey = async (key: string): Promise<unknown> => (await fakeBrowser.storage.local.get(key))[key];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('U28 settings store', () => {
  test('defaults: the account lock on, Keep copies off, not onboarded, nothing learned', () => {
    expect(settings.value).toEqual(defaultSettings(true));
    expect(settings.value).toMatchObject({
      accountLock: true,
      keepCopies: false,
      onboardedAt: null,
      expectedAccount: null,
      lastTestPassAt: null,
      msiteLockedUntil: null,
    });
  });

  test('rapid writes are applied at once and all persist', async () => {
    const a = updateSettings({ accountLock: false });
    const b = updateSettings({ keepCopies: true });
    const c = updateSettings({ onboardedAt: 1234 });
    expect(settings.value).toMatchObject({ accountLock: false, keepCopies: true, onboardedAt: 1234 });
    await Promise.all([a, b, c]);
    expect(await stored()).toEqual({ accountLock: false, keepCopies: true, onboardedAt: 1234 });
  });

  test('the editor never writes a background-owned key, even when a patch carries one', async () => {
    const patch = {
      keepCopies: true,
      msiteLockedUntil: 123,
      expectedAccount: { handle: 'mallory', detectedAt: 1 },
      lastTestPassAt: 99,
      chMode: 'uaOnly',
    } as unknown as EditorPatch;
    await updateSettings(patch);
    expect(await stored()).toEqual({ keepCopies: true });
    expect(await storedKey('msiteLock')).toBeUndefined();
    expect(await storedKey('expectedAccount')).toBeUndefined();
    expect(await storedKey('lastTestPassAt')).toBeUndefined();
    expect(settings.value.expectedAccount).toBeNull();
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
    await updateSettings({ keepCopies: true });
    expect(raced).toBe(true);
    expect((await background.settings()).msiteLockedUntil).toBe(until);
    expect(await stored()).toMatchObject({ keepCopies: true });
  });

  test('AM25: concurrent lock, account learning and edit in either order keep all three', async () => {
    const background = localState(true);
    const until = Date.now() + 86_400_000;
    await Promise.all([
      background.lockMsite(until),
      background.setExpectedAccount({ handle: 'testuser', detectedAt: 5 }),
      updateSettings({ accountLock: false }),
    ]);
    await Promise.all([updateSettings({ keepCopies: true }), background.lockMsite(until + 1)]);
    const s = await background.settings();
    expect(s.msiteLockedUntil).toBe(until + 1);
    expect(s.expectedAccount).toEqual({ handle: 'testuser', detectedAt: 5 });
    expect(s).toMatchObject({ accountLock: false, keepCopies: true });
  });

  test('Resume asks the background only with its confirmation checked, with the lock the editor shows', () => {
    const until = Date.now() + 86_400_000;
    settings.value = { ...settings.value, msiteLockedUntil: until };
    const sent: (number | null)[] = [];
    const send = (lockedUntil: number | null) => void sent.push(lockedUntil);
    expect(resumeMsite(false, send)).toBe(false);
    expect(sent).toEqual([]);
    expect(resumeMsite(true, send)).toBe(true);
    expect(sent).toEqual([until]);
  });

  test('isMsiteLocked compares with now', () => {
    const s: Settings = { ...defaultSettings(true), msiteLockedUntil: 1000 };
    expect(isMsiteLocked(s, 999)).toBe(true);
    expect(isMsiteLocked(s, 1000)).toBe(false);
    expect(isMsiteLocked({ ...s, msiteLockedUntil: null }, 0)).toBe(false);
  });

  test('initSettings shows the background-owned keys and follows their changes', async () => {
    const until = Date.now() + 86_400_000;
    await local.set('settings', { keepCopies: true } as unknown as Settings);
    await local.set('expectedAccount', { handle: 'testuser', detectedAt: 7 });
    await local.set('lastTestPassAt', 42);
    await initSettings();
    expect(settings.value).toMatchObject({
      keepCopies: true,
      expectedAccount: { handle: 'testuser', detectedAt: 7 },
      lastTestPassAt: 42,
      msiteLockedUntil: null,
    });
    expect(lastResult.value).toBeNull();

    await local.set('msiteLock', until);
    await vi.waitFor(() => expect(settings.value.msiteLockedUntil).toBe(until));
    await local.remove('expectedAccount');
    await vi.waitFor(() => expect(settings.value.expectedAccount).toBeNull());
    const last = {
      handoffId: 'hof_1',
      mode: 'post',
      result: { kind: 'posted', alarms: [], at: 9 },
      exportId: 'exp_1',
      exportSha256: null,
      docHash: null,
      startedAt: 1,
      durationMs: 8,
    };
    await local.set('lastResult', last as never);
    await vi.waitFor(() => expect(lastResult.value).toMatchObject({ handoffId: 'hof_1', result: { kind: 'posted' } }));
    // A malformed lastResult is not shown.
    await local.set('lastResult', { handoffId: 'hof_2', result: { kind: 'maybe' } } as never);
    await vi.waitFor(() => expect(lastResult.value).toBeNull());
    // AP-12: the lock's reasons follow storage too; a Resume (both keys removed) clears them.
    await local.set('msiteLockReasons', ['TEST_LEAK']);
    await vi.waitFor(() => expect(msiteLockReasons.value).toEqual(['TEST_LEAK']));
    await local.remove('msiteLockReasons');
    await vi.waitFor(() => expect(msiteLockReasons.value).toEqual([]));
  });

  test('AP-11: a setup test that failed NOT_LOGGED_IN highlights onboarding step 1 after Done, until a pass', () => {
    const last = (kind: 'notPosted' | 'tested', code: 'NOT_LOGGED_IN' | 'TIMEOUT' | undefined, at: number) => ({
      handoffId: 'hof_1',
      mode: 'test' as const,
      result: { kind, alarms: [], at, ...(code ? { code } : {}) },
      exportId: null,
      exportSha256: null,
      docHash: null,
      startedAt: at - 5000,
      durationMs: 5000,
    });
    expect(lastRunNotLoggedIn(last('notPosted', 'NOT_LOGGED_IN', 1000), null)).toBe(true);
    expect(lastRunNotLoggedIn(last('notPosted', 'NOT_LOGGED_IN', 1000), 500)).toBe(true);
    // A pass after it: logged in now.
    expect(lastRunNotLoggedIn(last('notPosted', 'NOT_LOGGED_IN', 1000), 2000)).toBe(false);
    expect(lastRunNotLoggedIn(last('notPosted', 'TIMEOUT', 1000), null)).toBe(false);
    expect(lastRunNotLoggedIn(last('tested', undefined, 1000), null)).toBe(false);
    expect(lastRunNotLoggedIn(null, null)).toBe(false);
  });
});

describe('AM44 the language setting', () => {
  test('editorSettings keeps auto, en and es; anything else is Auto', () => {
    for (const l of ['auto', 'en', 'es'] as const) expect(editorSettings({ lang: l }, true).lang).toBe(l);
    expect(editorSettings({ lang: 'fr' }, true).lang).toBe('auto');
    expect(editorSettings({ lang: 3 }, false).lang).toBe('auto');
    expect(editorSettings(undefined, false).lang).toBe('auto');
  });

  test('a choice is stored as the editor’s own key and the copy follows it at once', async () => {
    const write = updateSettings({ lang: 'es' });
    expect(settings.value.lang).toBe('es');
    expect(langSetting.value).toBe('es');
    expect(lang.value).toBe('es');
    await write;
    expect(await stored()).toMatchObject({ lang: 'es' });
    await updateSettings({ lang: 'auto' });
    expect(langSetting.value).toBe('auto');
    expect(await stored()).toMatchObject({ lang: 'auto' });
  });
});
