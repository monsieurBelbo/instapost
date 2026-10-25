/**
 * The in-page lane's background wiring (docs/inpage.md §10.4, §13; inpage-ui-spec.md FI4), in every build
 * (background-main starts it beside the window lane's runner). Builds the in-page driver (check, test, Share
 * test, post) over the real platform wrappers and registers, synchronously:
 *
 * - the observational webRequest listeners (the engine frame's id, URLs, redirects, status, errors);
 * - PANEL_PORT (the composer, an extension page framed in an Instagram tab) and PAGE_PORT (the content
 *   script's port while its page holds a frame: its disconnect means the page went away);
 * - the content script's messages (`inpage/*`): the run's frame reports go to the driver; its UI messages
 *   (hello, the composer's mode, the page's look, the coach) are answered or relayed to the composer of the
 *   same tab, and the composer's requests (close, hide, open, the preview size) to its page. Page ⇄ composer
 *   traffic always goes through here, never `window.postMessage` (R25);
 * - `inpage/state` (the run as each Instagram tab sees it) to every Instagram tab whenever it changes;
 * - tabs.onUpdated (the page's own URL, F8) and tabs.onRemoved;
 * - docs/repost.md RP-19: the owner's Add to story (`inpage/repost`, metadata only) is accepted from frame 0 on
 *   www (and refused during a run in that tab), held in memory one per tab (the newest wins, 60 s, never
 *   stored) and relayed once to that tab's composer as `ui/repost`, replayed on connect before `ui/page` and
 *   `ui/mode` when the composer's port was not up yet. `inpage/repost-diag` goes to storage.local `repostDiag`
 *   (diagnostics, structural). `ui/open-settings` opens the editor's Settings (the permission row, RP-20).
 *
 * The window lane's composer window is an Instagram tab too: its content script asks first (`inpage/attach`)
 * and is told to stay out, so that lane's page gets no host element, entry or observer (no behaviour change
 * there). The Developer toggles (DEV_TOGGLES_KEY) are read in guarded builds only; live runs use
 * DEFAULT_TOGGLES (inpage-ui-spec.md FS14: "Never in the live build").
 *
 * At every worker start, when the window lane is idle, it removes the session rules 1001–1029: a worker that
 * stopped mid-run lost its in-memory run, and its content script has already removed the frame (its port
 * went away), so nothing may keep the frame's rules (§8.3).
 */
import { type Browser, browser } from 'wxt/browser';
import type { HandoffState } from '../core/handoff/state.ts';
import { chromeMajorFromUa, isBrandedBrowser } from '../core/ig-contract/device-profile.ts';
import { SESSION_RULE_IDS } from '../core/ig-contract/rules.ts';
import type { RepostSource } from '../core/repost/source.ts';
import type { LocalState } from '../handoff/local-state.ts';
import type { Logger, Runner } from '../handoff/runner.ts';
import { actionShortcut } from '../platform/commands.ts';
import { dnr } from '../platform/dnr.ts';
import { injectPageScript, scripting } from '../platform/scripting.ts';
import { tabs } from '../platform/tabs.ts';
import { listenFrameRequests } from '../platform/web-request.ts';
import { calibrationCanvas, cornerMarkers } from '../raster/calibration.ts';
import { GUARDED } from '../shared/env.ts';
import type { AgentReply, SenderLike } from '../shared/protocol.ts';
import { browserLanguage, resolveLang } from '../ui/i18n-core.ts';
import { appendRepostDiag } from '../ui/repost/diag.ts';
import {
  createInpageDriver,
  INFLIGHT_KEY,
  type InpageDriver,
  type InpageRecord,
  type InpageStatus,
  isInflightRecord,
  restartedRecord,
} from './driver.ts';
import {
  acceptPageUiMessage,
  type BackgroundToPage,
  type BackgroundToPanel,
  type ComposerMode,
  DEFAULT_TOGGLES,
  DEV_TOGGLES_KEY,
  IDLE_RUN,
  type InpageUiPrefs,
  isOwnFramedPage,
  isPageShaped,
  isPageUiToBackground,
  isPanelToBackground,
  PAGE_PORT,
  PANEL_PORT,
  type PageRunState,
  type PageState,
  toToggles,
  toUiPrefs,
  UI_PREFS_KEY,
} from './messages.ts';
import { runProgress } from './run-view.ts';
import { applyMark, type OwnerMark } from './story-guard.ts';

const RECORDS_KEY = 'inpageRecords';
const MAX_RECORDS = 20;
const IG_PREFIX = 'https://www.instagram.com/';
const IG_TABS = 'https://www.instagram.com/*';
/** docs/repost.md RP-19: a held repost is dropped after this long. */
export const REPOST_HOLD_MS = 60_000;
const EDITOR_SETTINGS = '/editor.html#settings';

/** RP-19: the newest repost per tab, in memory only, consumed once. */
export function repostHold(now: () => number = Date.now) {
  const held = new Map<number, { src: RepostSource; at: number }>();
  return {
    put(tabId: number, src: RepostSource): void {
      held.set(tabId, { src, at: now() });
    },
    /** The held repost (once), or null when there is none or it is older than REPOST_HOLD_MS. */
    take(tabId: number): RepostSource | null {
      const h = held.get(tabId);
      held.delete(tabId);
      return h && now() - h.at <= REPOST_HOLD_MS ? h.src : null;
    },
    drop(tabId: number): void {
      held.delete(tabId);
    },
    size: () => held.size,
  };
}

/** The insert's photo when a test run comes without one: a 1080×1920 calibration card, as a PNG. */
async function calibrationPng(): Promise<{ mime: string; bytes: Uint8Array }> {
  const canvas = calibrationCanvas(1080, 1920, cornerMarkers(1080, 1920, 160, 60), '#8a8f98');
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()) };
}

async function storedRecords(): Promise<InpageRecord[]> {
  const got = await browser.storage.local.get(RECORDS_KEY);
  return Array.isArray(got[RECORDS_KEY]) ? (got[RECORDS_KEY] as InpageRecord[]) : [];
}

async function saveRecord(rec: InpageRecord): Promise<void> {
  const list = await storedRecords();
  await browser.storage.local.set({ [RECORDS_KEY]: [...list, rec].slice(-MAX_RECORDS) });
}

/** RL-13: the owner's It posted · It didn't post, written onto the stored record (History and the guard read it). */
export async function markRecord(runId: string, mark: OwnerMark, at: number): Promise<void> {
  const list = await storedRecords();
  const next = applyMark(list, runId, mark, at);
  if (next.some((r, i) => r !== list[i])) await browser.storage.local.set({ [RECORDS_KEY]: next });
}

/** RS-3: the in-flight marker in storage.local (kept through a worker crash and an extension reload or update). */
const inflight = {
  save: (rec: InpageRecord) => browser.storage.local.set({ [INFLIGHT_KEY]: rec }),
  async clear(runId: string) {
    const got = await browser.storage.local.get(INFLIGHT_KEY);
    const cur = got[INFLIGHT_KEY] as { runId?: unknown } | undefined;
    if (cur === undefined || cur?.runId === runId) await browser.storage.local.remove(INFLIGHT_KEY);
  },
};

/**
 * RS-3 (FX14): a run a previous worker lost. Its marker becomes a record (Couldn't confirm after Share, else
 * Stopped), unless that run's own record was saved before the worker died; the marker goes either way.
 */
export async function recoverLostRun(
  now: number,
  running: (runId: string) => boolean = () => false,
): Promise<InpageRecord | null> {
  const got = await browser.storage.local.get(INFLIGHT_KEY);
  const snap = got[INFLIGHT_KEY];
  if (snap === undefined) return null;
  if (!isInflightRecord(snap)) {
    await browser.storage.local.remove(INFLIGHT_KEY);
    return null;
  }
  // A run of this worker (it started before this check ran) is not lost.
  if (running(snap.runId)) return null;
  await inflight.clear(snap.runId);
  if ((await storedRecords()).some((r) => r.runId === snap.runId)) return null;
  const rec = restartedRecord(snap, now);
  await saveRecord(rec);
  return rec;
}

/** The window lane's composer tab, while that lane has one (its content script stays out). */
export function windowLaneTab(state: HandoffState): number | null {
  return 'tabId' in state && typeof state.tabId === 'number' ? state.tabId : null;
}

/** FI4: the run as the tab `tabId` sees it. */
export function pageRunState(status: InpageStatus, tabId: number): PageRunState {
  const rec = status.record;
  if (!rec) return { ...IDLE_RUN };
  const p = runProgress(rec);
  return {
    phase: status.running && p.result === null ? 'running' : 'result',
    here: rec.tabId === tabId,
    runId: rec.runId,
    mode: rec.mode,
    step: p.current,
    progress: p.progress,
    shared: p.shared,
    frameLoaded: p.frameLoaded,
    startedAt: rec.startedAt,
    endedAt: rec.endedAt ?? (p.result !== null ? Date.now() : null),
    result: p.result,
    handle: rec.account.detected ?? rec.account.expected,
  };
}

export interface InpageLane {
  driver: InpageDriver;
  /** An agent message from an engine frame, or null (the window lane's). */
  agentMessage(raw: unknown, sender: SenderLike): Promise<AgentReply> | null;
  /**
   * The toolbar (or its shortcut) on an Instagram tab toggles the composer there (`toggled`). Anywhere else it
   * opens the editor (`editor`). FX14: an Instagram tab without the content script gets it re-injected and is
   * asked again; if that fails too, the editor opens with "reload your Instagram tab" (`reload`).
   */
  actionClicked(tab: { id?: number; url?: string } | undefined): Promise<'toggled' | 'editor' | 'reload'>;
  /** FX14: the content script into every Instagram tab that was open before an install or update. */
  reinject(): Promise<void>;
}

/** FX14: how long a re-injected content script gets to attach (it asks the background first), and how often. */
export const REINJECT_TRIES = 10;
export const REINJECT_STEP_MS = 150;

/**
 * FX14: the toolbar on an Instagram tab. Its content script toggles the composer; without one (the tab was
 * open before an install or update) it is injected and asked again while it attaches; `reload` when that fails.
 */
export async function toggleOrInject(io: {
  toggle(): Promise<boolean>;
  inject(): Promise<void>;
  sleep(ms: number): Promise<void>;
}): Promise<'toggled' | 'reload'> {
  if (await io.toggle()) return 'toggled';
  try {
    await io.inject();
  } catch {
    return 'reload';
  }
  for (let i = 0; i < REINJECT_TRIES; i++) {
    await io.sleep(REINJECT_STEP_MS);
    if (await io.toggle()) return 'toggled';
  }
  return 'reload';
}

interface PageInfo {
  mode: ComposerMode;
  compact: boolean;
  closing: boolean;
  scheme: 'light' | 'dark';
  loggedIn: boolean | null;
  handle: string | null;
}

export function startInpageLane(runner: Runner, local: LocalState, log: Logger): InpageLane {
  const driver = createInpageDriver({
    dnr,
    tabs,
    scripting,
    local,
    // inpage-ui-spec.md FS14: the Developer toggles exist in guarded builds only (compiled out of live).
    toggles: async () =>
      GUARDED ? toToggles((await browser.storage.local.get(DEV_TOGGLES_KEY))[DEV_TOGGLES_KEY]) : DEFAULT_TOGGLES,
    saveRecord,
    inflight,
    calibration: calibrationPng,
    now: () => Date.now(),
    random: () => Math.random(),
    uuid: () => crypto.randomUUID(),
    runtimeId: browser.runtime.id,
    chromeMajor: chromeMajorFromUa(globalThis.navigator?.userAgent ?? '') ?? 0,
    windowLaneBusy: () => runner.state().phase !== 'idle',
    guarded: GUARDED,
    brandedBrowser: isBrandedBrowser(
      (
        (globalThis.navigator as { userAgentData?: { brands?: { brand: string }[] } } | undefined)?.userAgentData
          ?.brands ?? []
      ).map((b) => b.brand),
    ),
    keepAlive: () => void browser.storage.session.get('timers').catch(() => undefined),
    log,
  });

  listenFrameRequests((e) => driver.frameRequest(e));

  /** The composer port of each Instagram tab, and what its page last said. */
  const panels = new Map<number, Browser.runtime.Port>();
  const pages = new Map<number, PageInfo>();
  const toPanel = (tabId: number, msg: BackgroundToPanel | { v: 1; type: string; [k: string]: unknown }) => {
    try {
      panels.get(tabId)?.postMessage(msg);
    } catch {
      panels.delete(tabId);
    }
  };
  const toPage = (tabId: number, msg: BackgroundToPage) => tabs.sendMessage(tabId, msg, 0).catch(() => undefined);
  const reposts = repostHold();
  /** RP-19: hand a held repost to the tab's composer, once; kept when its port is not up. */
  const relayRepost = (tabId: number): void => {
    const port = panels.get(tabId);
    if (!port) return;
    const src = reposts.take(tabId);
    if (!src) return;
    try {
      port.postMessage({ v: 1, type: 'ui/repost', src } satisfies BackgroundToPanel);
    } catch {
      panels.delete(tabId);
      reposts.put(tabId, src);
    }
  };

  // ---- inpage/state to every Instagram tab ------------------------------------------------------------

  async function pageState(tabId: number): Promise<PageState> {
    const [settings, got, shortcut] = await Promise.all([
      local.settings().catch(() => null),
      browser.storage.local.get(UI_PREFS_KEY).catch(() => ({}) as Record<string, unknown>),
      actionShortcut(),
    ]);
    return {
      run: pageRunState(driver.status(), tabId),
      pausedUntil: settings?.msiteLockedUntil ?? null,
      prefs: toUiPrefs((got as Record<string, unknown>)[UI_PREFS_KEY]),
      // AM48: Settings → Language for the entry and the coach; Auto follows the browser's UI language.
      lang: resolveLang(settings?.lang ?? 'auto', browserLanguage()),
      shortcut,
    };
  }
  const sent = new Map<number, string>();
  let broadcasting: ReturnType<typeof setTimeout> | null = null;
  function broadcast(): void {
    if (broadcasting !== null) return;
    broadcasting = setTimeout(() => {
      broadcasting = null;
      void browser.tabs
        .query({ url: IG_TABS })
        .then(async (list) => {
          for (const t of list) {
            if (t.id === undefined) continue;
            const state = await pageState(t.id);
            const json = JSON.stringify(state);
            if (sent.get(t.id) === json) continue;
            sent.set(t.id, json);
            void toPage(t.id, { v: 1, type: 'inpage/state', state });
          }
        })
        .catch(() => undefined);
    }, 30);
  }
  driver.subscribe(() => broadcast());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (UI_PREFS_KEY in changes || 'settings' in changes || 'msiteLock' in changes) broadcast();
  });

  // ---- the composer's port ----------------------------------------------------------------------------

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PAGE_PORT) {
      const tabId = port.sender?.tab?.id;
      if (port.sender?.id !== browser.runtime.id || port.sender.frameId !== 0 || tabId === undefined) {
        port.disconnect();
        return;
      }
      port.onDisconnect.addListener(() => driver.pagePortClosed(tabId));
      return;
    }
    if (port.name !== PANEL_PORT) return;
    const sender = port.sender as SenderLike | undefined;
    if (!sender || !isOwnFramedPage(sender, browser.runtime.id)) {
      log.warn('composer port refused: not our framed page');
      port.disconnect();
      return;
    }
    const tabId = sender.tab?.id as number;
    panels.set(tabId, port);
    toPanel(tabId, { v: 1, type: 'ui/hello', tabId });
    // RP-19: a repost clicked before the composer's port was up, before ui/page and ui/mode (no import flash).
    relayRepost(tabId);
    const info = pages.get(tabId);
    if (info) {
      toPanel(tabId, { v: 1, type: 'ui/page', scheme: info.scheme, loggedIn: info.loggedIn, handle: info.handle });
      toPanel(tabId, { v: 1, type: 'ui/mode', mode: info.mode, compact: info.compact, closing: info.closing });
    }
    const off = driver.subscribe((status) => {
      try {
        port.postMessage({ v: 1, type: 'run/status', status });
      } catch {
        off();
      }
    });
    port.onDisconnect.addListener(() => {
      off();
      if (panels.get(tabId) === port) panels.delete(tabId);
    });
    port.onMessage.addListener((raw: unknown) => {
      if (!isPanelToBackground(raw)) return;
      switch (raw.type) {
        case 'run/stop':
          driver.stop();
          return;
        case 'ui/close-panel':
          void toPage(tabId, { v: 1, type: 'inpage/ui', action: 'close' });
          return;
        case 'ui/request':
          void toPage(tabId, { v: 1, type: 'inpage/ui', action: raw.action, ...(raw.auto ? { auto: true } : {}) });
          return;
        case 'ui/preview':
          void toPage(tabId, { v: 1, type: 'inpage/preview', preview: raw.preview });
          return;
        case 'ui/open-settings':
          void tabs
            .create((browser.runtime.getURL as (path: string) => string)(EDITOR_SETTINGS))
            .catch(() => undefined);
          return;
        case 'ui/view-story':
          void tabs.navigate(tabId, `${IG_PREFIX}stories/${raw.handle}/`).catch(() => undefined);
          return;
        case 'ui/mark':
          void markRecord(raw.runId, raw.mark, Date.now()).catch((e: unknown) => log.warn('inpage: mark not saved', e));
          return;
        case 'ui/show-tab':
          void browser.tabs
            .get(raw.tabId)
            .then((t) => {
              if (!(t.url ?? '').startsWith(IG_PREFIX)) return;
              return Promise.all([
                tabs.activate(raw.tabId),
                browser.windows.update(t.windowId, { focused: true }).catch(() => undefined),
              ]);
            })
            .catch(() => undefined);
          return;
        case 'run/start':
          void driver
            .start({
              tabId,
              mode: raw.mode,
              confirmShare: raw.confirmShare,
              photo: raw.photo ?? null,
              ...(raw.repost ? { repost: raw.repost } : {}),
            })
            .then((r) => {
              if (r.ok) return;
              try {
                port.postMessage({
                  v: 1,
                  type: 'run/refused',
                  why: r.why,
                  ...(r.freeAt ? { freeAt: r.freeAt } : {}),
                });
              } catch {
                // The composer went away.
              }
            });
          return;
      }
    });
  });

  // ---- the content script's messages ------------------------------------------------------------------

  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse: (r: unknown) => void) => {
    if (isPageUiToBackground(msg)) {
      const v = acceptPageUiMessage(msg, sender as SenderLike, browser.runtime.id);
      if (!v.ok) return false;
      const m = v.msg;
      const tabId = v.tabId;
      const info: PageInfo = pages.get(tabId) ?? {
        mode: 'closed',
        compact: false,
        closing: false,
        scheme: 'light',
        loggedIn: null,
        handle: null,
      };
      switch (m.type) {
        case 'inpage/attach':
          void runner.ready().then(
            () => sendResponse({ attach: windowLaneTab(runner.state()) !== tabId }),
            () => sendResponse({ attach: true }),
          );
          return true;
        case 'inpage/hello':
          sent.delete(tabId);
          pages.set(tabId, { ...info, mode: 'closed', closing: false });
          void pageState(tabId).then(
            (s) => {
              sent.set(tabId, JSON.stringify(s));
              sendResponse(s);
            },
            () => sendResponse(null),
          );
          return true;
        case 'inpage/composer':
          pages.set(tabId, { ...info, mode: m.mode, compact: m.compact, closing: m.closing });
          toPanel(tabId, { v: 1, type: 'ui/mode', mode: m.mode, compact: m.compact, closing: m.closing });
          return false;
        case 'inpage/page':
          pages.set(tabId, { ...info, scheme: m.scheme, loggedIn: m.loggedIn, handle: m.handle });
          toPanel(tabId, { v: 1, type: 'ui/page', scheme: m.scheme, loggedIn: m.loggedIn, handle: m.handle });
          return false;
        case 'inpage/repost': {
          // RP-19: never during a run in this tab (the entry shows busy then; this is the second line).
          const run = pageRunState(driver.status(), tabId);
          if (run.here && run.phase === 'running') {
            void appendRepostDiag('post', 'refused-running');
            return false;
          }
          reposts.put(tabId, m.src);
          relayRepost(tabId);
          return false;
        }
        case 'inpage/repost-diag':
          void appendRepostDiag(m.where, m.why);
          return false;
        case 'inpage/coach-seen':
          void browser.storage.local
            .get(UI_PREFS_KEY)
            .then((got) => {
              const prefs: InpageUiPrefs = { ...toUiPrefs(got[UI_PREFS_KEY]), coachSeen: true };
              return browser.storage.local.set({ [UI_PREFS_KEY]: prefs });
            })
            .catch(() => undefined);
          return false;
      }
    }
    if (!isPageShaped(msg)) return false;
    driver.pageMessage(msg, sender as SenderLike);
    return false;
  });

  tabs.onUpdated((tabId, update) => driver.tabUpdated(tabId, update.url));
  tabs.onRemoved((tabId) => {
    driver.tabRemoved(tabId);
    pages.delete(tabId);
    sent.delete(tabId);
    panels.delete(tabId);
    reposts.drop(tabId);
  });

  // §8.3: no run survives a worker restart; nothing may keep its rules. RS-3: a run the previous worker lost
  // is reported (Couldn't confirm after Share, Stopped before), so the composer never just shows the editor.
  void recoverLostRun(Date.now(), (runId) => driver.busy() && driver.status().record?.runId === runId)
    .then((rec) => {
      if (rec) driver.adopt(rec);
    })
    .catch((err: unknown) => log.warn('inpage: a lost run could not be recovered', err));
  void runner.ready().then(async () => {
    if (runner.state().phase !== 'idle' || driver.busy()) return;
    await dnr.updateSessionRules({ removeRuleIds: [...SESSION_RULE_IDS] }).catch(() => undefined);
  });

  const toggle = (tabId: number): Promise<boolean> =>
    tabs.sendMessage(tabId, { v: 1, type: 'inpage/toggle-panel' } satisfies BackgroundToPage, 0).then(
      () => true,
      () => false,
    );

  return {
    driver,
    agentMessage: (raw, sender) => driver.agentMessage(raw, sender),
    async actionClicked(tab) {
      if (tab?.id === undefined || !(tab.url ?? '').startsWith(IG_PREFIX)) return 'editor';
      const tabId = tab.id;
      return toggleOrInject({
        toggle: () => toggle(tabId),
        inject: () => injectPageScript(tabId),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
    },
    async reinject() {
      const list = await browser.tabs.query({ url: IG_TABS }).catch(() => []);
      await Promise.all(
        list.map((t) =>
          t.id === undefined || t.discarded ? undefined : injectPageScript(t.id).catch(() => undefined),
        ),
      );
    },
  };
}
