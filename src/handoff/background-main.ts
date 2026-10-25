/**
 * Background wiring (strategy §3.1, §3.5, §3.6 step 10; ux.md IB3): builds the runner over the real
 * platform wrappers and registers every listener synchronously, in the worker's first turn,
 * so Chrome can wake a stopped worker for any of them.
 *
 * - action click (and its shortcut, `commands._execute_action`, ⌥⇧S): on an Instagram tab, toggle the in-page
 *   composer there; anywhere else (or when that tab has no composer), open or focus the editor tab (its id
 *   lives in storage.session, so no `tabs` permission is needed);
 * - the toolbar badge shows the run (`…`) and its result (✓ ! ?) until the editor has shown it;
 * - runtime.onConnect `handoff`: the editor port (our own extension pages only);
 * - runtime.onMessage: composer-agent messages (`agent/*`), each answered (protocol AgentReply);
 * - tabs.onUpdated: the composer tab's updates (hard reload, kill switch, AM2 re-probes);
 * - windows.onBoundsChanged: the composer window being resized by hand (W3, guided resize);
 * - windows.onRemoved, tabs.onRemoved, runtime.onStartup, runtime.onInstalled: cleanup, which
 *   removes session rules 1001–1029 idempotently, except while an in-page run holds them (RS-1). A popup
 *   left open by a reload, update or disable/enable of the extension is closed first, when the runner
 *   starts (runner.ts, AM22). onInstalled (install, update) also re-injects the in-page content script into
 *   Instagram tabs that were already open (FX14).
 *
 * The in-page lane (docs/inpage.md §13, every build): its listeners (src/inpage/background.ts); agent messages
 * from an engine frame go to the in-page driver; the editor's `handoff/start` is refused while an in-page run
 * is in progress (one run at a time across both lanes). The window lane (the editor tab and its docked
 * composer window) is unchanged and stays as the fallback.
 */
import { browser } from 'wxt/browser';
import { type InpageLane, startInpageLane } from '../inpage/background.ts';
import { badge } from '../platform/action.ts';
import { dnr } from '../platform/dnr.ts';
import { e2eRunnerHooks } from '../platform/e2e-hooks.ts';
import { scripting } from '../platform/scripting.ts';
import { session } from '../platform/storage.ts';
import { tabs } from '../platform/tabs.ts';
import { windows } from '../platform/windows.ts';
import { GUARDED } from '../shared/env.ts';
import { type AgentReply, HANDOFF_PORT } from '../shared/protocol.ts';
import { localState } from './local-state.ts';
import { idbExports, idbRecords, pruneExports } from './records.ts';
import { consoleLogger, createRunner, type Logger, type Runner } from './runner.ts';
import { sessionStore } from './session-store.ts';
import { realClock } from './timers.ts';

export const EDITOR_PATH = '/editor.html';

/** Opens the editor tab, or focuses the one opened before. */
export async function openOrFocusEditor(): Promise<void> {
  const editorUrl = browser.runtime.getURL(EDITOR_PATH);
  const known = await session.get('editorTabId');
  if (known !== undefined) {
    try {
      const tab = await tabs.get(known);
      // url is visible for our own pages; if the tab went elsewhere, open a new editor.
      if (tab.url === undefined || tab.url.startsWith(editorUrl)) {
        await tabs.activate(tab.id);
        await windows.update(tab.windowId, { focused: true });
        return;
      }
    } catch {
      // The tab is gone: fall through and open a new one.
    }
  }
  const tab = await tabs.create(editorUrl);
  await session.set('editorTabId', tab.id);
}

/** ux.md §4.6: brings the editor tab's window back to the front, if there is an editor tab. */
export async function focusEditorWindow(): Promise<void> {
  const known = await session.get('editorTabId');
  if (known === undefined) return;
  try {
    const tab = await tabs.get(known);
    await windows.update(tab.windowId, { focused: true });
  } catch {
    // The editor tab is gone: nothing to focus.
  }
}

/** A sender that is one of this extension's own pages (not a content script in a web page). */
function isOwnPage(sender: { id?: string; url?: string } | undefined): boolean {
  return sender?.id === browser.runtime.id && (sender.url ?? '').startsWith(browser.runtime.getURL('/'));
}

const isAgentShaped = (msg: unknown): boolean => {
  const type = (msg as { type?: unknown } | null)?.type;
  return typeof type === 'string' && type.startsWith('agent/');
};

export function createBackgroundRunner(log: Logger = consoleLogger): Runner {
  return createRunner(
    {
      dnr,
      tabs,
      windows,
      scripting,
      store: sessionStore(),
      local: localState(GUARDED),
      records: idbRecords,
      exports: idbExports,
      badge,
      focusEditor: focusEditorWindow,
    },
    {
      guarded: GUARDED,
      runtimeId: browser.runtime.id,
      userAgent: globalThis.navigator?.userAgent ?? '',
      brands: (
        (globalThis.navigator as { userAgentData?: { brands?: { brand: string }[] } } | undefined)?.userAgentData
          ?.brands ?? []
      ).map((b) => b.brand),
      uuid: () => crypto.randomUUID(),
      clock: realClock,
      // Any extension API call resets the worker's idle timer (Chrome 110+).
      keepAlive: () => void session.get('timers').catch(() => undefined),
      // F2: test flags exist in guarded builds only (compiled out of live, check-bundle T3).
      ...(GUARDED ? { e2e: e2eRunnerHooks } : {}),
      log,
    },
  );
}

/** One run at a time across both lanes: the window lane does not start while an in-page run is in progress. */
function inpageRefusesEditorMessage(msg: unknown, inpage: InpageLane): boolean {
  const m = msg as { type?: unknown } | null;
  return m?.type === 'handoff/start' && inpage.driver.busy();
}

/** Starts the in-page lane over the window lane's runner; unit tests of the window lane may pass none. */
export type InpageStarter = (runner: Runner, log: Logger) => InpageLane | null;
const startInpage: InpageStarter = (runner, log) => startInpageLane(runner, localState(GUARDED), log);

/** Registers every listener; call synchronously from defineBackground's main. */
export function startBackground(
  runner: Runner = createBackgroundRunner(),
  log: Logger = consoleLogger,
  inpageLane: InpageStarter = startInpage,
): Runner {
  const inpage = inpageLane(runner, log);

  browser.action.onClicked.addListener((tab) => {
    const open = () => openOrFocusEditor().catch((err: unknown) => log.error('cannot open the editor', err));
    if (!inpage) {
      void open();
      return;
    }
    void inpage.actionClicked(tab).then((how) => {
      if (how === 'toggled') return;
      // FX14: an Instagram tab without the content script, even after re-injecting it: say to reload it.
      if (how === 'reload') void session.set('editorNotice', 'reloadInstagram').catch(() => undefined);
      void open();
    });
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== HANDOFF_PORT) return;
    if (!isOwnPage(port.sender)) {
      log.warn('hand-off port refused: not an extension page');
      port.disconnect();
      return;
    }
    const detach = runner.connectEditor((msg) => port.postMessage(msg));
    port.onMessage.addListener((msg: unknown) => {
      if (inpage && inpageRefusesEditorMessage(msg, inpage)) {
        log.warn('hand-off start refused: an in-page run is in progress');
        return;
      }
      void runner.editorMessage(msg);
    });
    port.onDisconnect.addListener(detach);
  });

  browser.runtime.onMessage.addListener((msg: unknown, sender, sendResponse: (reply: AgentReply) => void) => {
    if (!isAgentShaped(msg)) return false;
    const viaInpage = inpage ? inpage.agentMessage(msg, sender) : null;
    (viaInpage ?? runner.agentMessage(msg, sender)).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  });

  tabs.onUpdated((tabId, update) => void runner.tabUpdated(tabId, update));
  windows.onBoundsChanged((windowId) => void runner.windowBoundsChanged(windowId));
  // RS-1: the window lane's idle cleanup removes the session rules 1001–1029 on every tab or window that closes.
  // While an in-page run holds them (the window lane is idle then, one run at a time), they are that run's:
  // its Android profile, its frame rules and a Share test's write block. The run removes them itself.
  const inpageHoldsRules = () => inpage?.driver.busy() === true && runner.state().phase === 'idle';
  tabs.onRemoved((tabId) => {
    if (!inpageHoldsRules()) void runner.dispatch({ type: 'tabRemoved', tabId });
  });
  windows.onRemoved((windowId) => {
    if (!inpageHoldsRules()) void runner.dispatch({ type: 'windowRemoved', windowId });
  });
  const startup = () => {
    if (!inpageHoldsRules()) void runner.dispatch({ type: 'startup' });
    // ux.md IB5: exports older than 30 days go (History shows a placeholder for them).
    pruneExports(Date.now()).catch((err: unknown) => log.warn('export pruning failed', err));
  };
  browser.runtime.onStartup.addListener(startup);
  browser.runtime.onInstalled.addListener((details) => {
    startup();
    // FX14 (RL-2): Instagram tabs open before an install or update get the content script now.
    if (inpage && (details.reason === 'install' || details.reason === 'update')) void inpage.reinject();
  });
  return runner;
}
