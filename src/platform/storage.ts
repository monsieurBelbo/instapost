/**
 * Typed wrapper over extension storage (strategy §3.3).
 * - session: the active hand-off state, its timer deadlines and the editor tab id (survives
 *   service-worker restarts, cleared with the browser session; the default access level keeps
 *   it away from the agent).
 * - local: settings, the rate-guard open log, the kill-switch lock (background-only, AM25) and
 *   the open composer popup (AM22).
 */
import { browser } from 'wxt/browser';
import type { HandoffState, HandoffTimer, Settings } from '../core/handoff/state.ts';

export interface SessionSchema {
  handoff: HandoffState;
  editorTabId: number;
  /** Pending hand-off timers as epoch-ms deadlines, so a restarted service worker re-arms them. */
  timers: Partial<Record<HandoffTimer, number>>;
}

export interface LocalSchema {
  settings: Settings;
  /** Epoch ms of composer opens (rate guard). */
  rateLog: number[];
  /**
   * AM25: the kill-switch lock (epoch ms, null = none). Written only by the background, so no
   * editor settings write can race it away; settings() merges it into Settings.msiteLockedUntil.
   */
  msiteLock: number | null;
  /** AM22: the open composer popup, so a reloaded extension can close it (storage.session is gone then). */
  composerWindow: ComposerWindowRecord | null;
}

export interface ComposerWindowRecord {
  windowId: number;
  tabId: number;
  handoffId: string;
}

export interface Area<S> {
  get<K extends keyof S>(key: K): Promise<S[K] | undefined>;
  set<K extends keyof S>(key: K, value: S[K]): Promise<void>;
  remove(key: keyof S): Promise<void>;
}

const area = <S>(name: 'session' | 'local'): Area<S> => ({
  async get(key) {
    const k = key as string;
    const got = await browser.storage[name].get(k);
    return got[k] as never;
  },
  async set(key, value) {
    await browser.storage[name].set({ [key as string]: value });
  },
  async remove(key) {
    await browser.storage[name].remove(key as string);
  },
});

export const session: Area<SessionSchema> = area<SessionSchema>('session');
export const local: Area<LocalSchema> = area<LocalSchema>('local');
