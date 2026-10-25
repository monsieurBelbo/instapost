/**
 * Typed wrapper over extension storage (strategy §3.3).
 * - session: the active hand-off state, its timer deadlines and the editor tab id (survives
 *   service-worker restarts, cleared with the browser session; the default access level keeps
 *   it away from the agent).
 * - local: settings (editor-owned), the rate-guard open log, the kill-switch lock (background-only, AM25),
 *   the open composer popup (AM22), and the autopilot's background-owned keys (ux.md IR14): the detected
 *   account, the last test pass, the + menu fingerprint and the last result.
 */
import { browser } from 'wxt/browser';
import type {
  ExpectedAccount,
  HandoffState,
  HandoffTimer,
  LastResult,
  MenuFingerprint,
  MsiteLockReason,
  Settings,
} from '../core/handoff/state.ts';

export interface SessionSchema {
  handoff: HandoffState;
  editorTabId: number;
  /** Pending hand-off timers as epoch-ms deadlines, so a restarted service worker re-arms them. */
  timers: Partial<Record<HandoffTimer, number>>;
  /**
   * FX14 (RL-2): a one-off notice for the editor tab the toolbar opens: the Instagram tab it was pressed on has
   * no content script (the extension was updated and re-injecting failed). The editor shows it and removes it.
   */
  editorNotice: 'reloadInstagram';
}

export interface LocalSchema {
  settings: Settings;
  /** Epoch ms of composer opens (rate guard). */
  rateLog: number[];
  /** Epoch ms of the latest test-run open (check, setup test, Share test): spacing only, no caps. */
  lastTestOpen: number;
  /**
   * AM25: the kill-switch lock (epoch ms, null = none). Written only by the background, so no
   * editor settings write can race it away; settings() merges it into Settings.msiteLockedUntil.
   */
  msiteLock: number | null;
  /** AP-12: why `msiteLock` was set (background-only; cleared with the lock on Resume). */
  msiteLockReasons: MsiteLockReason[];
  /** AM22: the open composer popup, so a reloaded extension can close it (storage.session is gone then). */
  composerWindow: ComposerWindowRecord | null;
  /** ux.md §4.12: the account instapost detected (background-owned; the editor asks to forget it). */
  expectedAccount: ExpectedAccount | null;
  /** OD10: when the setup test (a Test run) last passed (background-owned). */
  lastTestPassAt: number | null;
  /** ux.md C10: the + menu's fingerprint (background-owned). */
  menuFingerprint: MenuFingerprint | null;
  /** The last run's result, for an editor opened later (background-owned). */
  lastResult: LastResult | null;
  /** ux.md §4.3: the autosaved draft (editor-owned). */
  lastDocId: string | null;
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
