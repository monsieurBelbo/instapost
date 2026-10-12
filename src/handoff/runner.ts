/**
 * The hand-off effect runner (strategy §3.1, §3.6; protocol at the top of
 * src/core/handoff/reducer.ts). The imperative shell around the pure `handoffReducer`:
 *
 * - **One event at a time.** Every input (editor port, agent message, tab and window
 *   listeners, timers, effect results) goes through one promise queue. A task samples the
 *   context, runs the reducer, writes the new state to storage.session *before* any effect
 *   runs, then runs the effects in order, each awaited.
 * - **Effect results are new events**, queued behind the current task (so statuses reach the
 *   editor in order). A rejected platform call becomes `effectFailed`; the remaining effects of
 *   the batch still run (a kill must lock even if the window is already gone). Nothing retries.
 * - **Service-worker restarts.** The queue's first task loads the stored state and timer
 *   deadlines; overdue timers fire before anything else. A fresh runner over the same
 *   storage.session therefore carries on mid-flow.
 * - **Agent messages** are checked by acceptAgentMessage() against the state *at processing
 *   time*; everything else is dropped and logged. `agent/get-file` is answered with the
 *   export's bytes when the transition emitted `serveFile`, otherwise `{ok:false}`.
 * - **A popup left over from a reloaded extension** (§11 AM22). Reloading, updating or disabling
 *   the extension clears storage.session and the session rules, but not an https popup. Before
 *   anything else, the first task closes the popup storage.local still names when no stored session
 *   owns it, so no composer window stays open without rehearsal rules or kill switch.
 * - **ENABLE** (§11 AM25): the editor asks, the runner clears the lock in this same queue, so it
 *   is serialised with the kill switch's lockMsite.
 */

import { handoffReducer } from '../core/handoff/reducer.ts';
import {
  type AgentCommand,
  ERROR_CODES,
  type ErrorCode,
  type HandoffCtx,
  type HandoffEffect,
  type HandoffEvent,
  type HandoffState,
  type HandoffStatus,
  type HandoffTimer,
  IDLE,
  INACTIVITY_TIMEOUT_MS,
} from '../core/handoff/state.ts';
import { chromeMajorFromUa, isBrandedBrowser } from '../core/ig-contract/device-profile.ts';
import { igPath } from '../core/ig-contract/urls.ts';
import type { HandoffId, Nonce } from '../core/model/ids.ts';
import type { DnrPort } from '../platform/dnr.ts';
import type { ScriptingPort } from '../platform/scripting.ts';
import type { TabsPort, TabUpdate } from '../platform/tabs.ts';
import type { WindowsPort } from '../platform/windows.ts';
import {
  type ActiveAgentSession,
  type AgentReply,
  acceptAgentMessage,
  type BackgroundToAgent,
  type BackgroundToEditor,
  bytesToB64,
  type GetFileReply,
  isAgentAck,
  isEditorToBackground,
  type SenderLike,
} from '../shared/protocol.ts';
import { composerTabEvent, composerTabId, describeVerdict, killSwitchVerdict } from './kill-switch.ts';
import type { LocalState } from './local-state.ts';
import type { ExportSource, RecordStore } from './records.ts';
import type { SessionStore } from './session-store.ts';
import { type Clock, createTimers } from './timers.ts';

export interface RunnerPorts {
  dnr: DnrPort;
  tabs: Pick<TabsPort, 'get' | 'navigate' | 'hardReload' | 'sendMessage'>;
  windows: Pick<WindowsPort, 'createPopup' | 'update' | 'getBox' | 'remove' | 'describe'>;
  scripting: ScriptingPort;
  store: SessionStore;
  local: LocalState;
  records: RecordStore;
  exports: ExportSource;
}

export interface Logger {
  info(msg: string, ...data: unknown[]): void;
  warn(msg: string, ...data: unknown[]): void;
  error(msg: string, ...data: unknown[]): void;
}

export const consoleLogger: Logger = {
  info: (msg, ...data) => console.info(`[instapost] ${msg}`, ...data),
  warn: (msg, ...data) => console.warn(`[instapost] ${msg}`, ...data),
  error: (msg, ...data) => console.error(`[instapost] ${msg}`, ...data),
};

export interface RunnerEnv {
  /** MODE !== 'live'. */
  guarded: boolean;
  /** runtime.id, for the agent sender check. */
  runtimeId: string;
  /** The background's navigator.userAgent (rule 1001 takes its Chrome major). */
  userAgent: string;
  /** navigator.userAgentData.brands[].brand of the background (AM23); empty when unknown. */
  brands?: readonly string[];
  /** crypto.randomUUID. */
  uuid: () => string;
  clock: Clock;
  /** Keeps the worker awake while timers are pending (timers.ts); omitted in tests. */
  keepAlive?: () => void;
  log?: Logger;
}

export interface Runner {
  /** Resolves once the stored session is loaded (queued first at creation). */
  ready(): Promise<void>;
  /** Queues a reducer event; resolves after its transition and effects ran. Never rejects. */
  dispatch(event: HandoffEvent): Promise<void>;
  /** tabs.onUpdated: only the composer tab's updates reach the reducer. */
  tabUpdated(tabId: number, update: TabUpdate): Promise<void>;
  /** runtime.onMessage from the agent: validated, then answered (AgentReply). */
  agentMessage(raw: unknown, sender: SenderLike): Promise<AgentReply>;
  /** A message on the editor's `handoff` port. */
  editorMessage(raw: unknown): Promise<void>;
  /** Registers an editor port; it gets the current status at once. Returns the detach function. */
  connectEditor(post: (msg: BackgroundToEditor) => void): () => void;
  /** Resolves when the queue is empty (tests). */
  settled(): Promise<void>;
  /** The current state (tests, diagnostics). */
  state(): HandoffState;
}

/** The pending answer to one agent/get-file. */
interface FileSlot {
  reply: GetFileReply | null;
}

interface Address {
  handoffId: HandoffId;
  nonce: Nonce;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/** The file name the agent gives the File (strategy §3.8: `story.png`). */
export function storyFileName(mime: string): string {
  if (mime === 'image/png') return 'story.png';
  if (mime === 'image/jpeg') return 'story.jpg';
  return 'story';
}

function agentMessageOf(command: AgentCommand, a: Address): BackgroundToAgent {
  switch (command.type) {
    case 'agent/probe':
    case 'agent/inject':
      return { v: 1, type: command.type, handoffId: a.handoffId, nonce: a.nonce };
    case 'agent/watch':
      return { v: 1, type: command.type, readyTimeoutMs: command.readyTimeoutMs, ...a };
  }
}

const addressOf = (s: HandoffState): Address | null =>
  s.phase === 'idle' ? null : { handoffId: s.handoffId, nonce: s.nonce };

/** The code in a `failed:` or `killed:` outcome. */
function outcomeError(outcome: string): ErrorCode | undefined {
  const code = outcome.slice(outcome.indexOf(':') + 1);
  return outcome.includes(':') && (ERROR_CODES as readonly string[]).includes(code) ? (code as ErrorCode) : undefined;
}

/**
 * The status an editor sees when it connects. Idle with no earlier hand-off is
 * `{handoffId: null, phase: 'idle', level: null}` with no `error` (a refused start always has one).
 */
export function currentStatus(s: HandoffState): HandoffStatus {
  if (s.phase === 'idle') {
    if (!s.last) return { handoffId: null, phase: 'idle', level: null };
    const error = outcomeError(s.last.outcome);
    return { handoffId: s.last.handoffId, phase: 'idle', level: null, ...(error ? { error } : {}) };
  }
  // AM21: the session's own switches, so a reconnected editor shows them too.
  const switches = { rehearsal: s.rehearsal, assistedInsert: s.assistedInsert };
  if (s.phase === 'opening') return { handoffId: s.handoffId, phase: s.phase, level: null, ...switches };
  if (s.phase === 'closing') {
    const error = outcomeError(s.outcome);
    return { handoffId: s.handoffId, phase: s.phase, level: s.level, ...switches, ...(error ? { error } : {}) };
  }
  return {
    handoffId: s.handoffId,
    phase: s.phase,
    level: s.level,
    ...switches,
    ...(s.fakeBanner ? { banner: 'FAKE_INSTAGRAM' as const } : {}),
    ...(s.route ? { route: s.route } : {}),
    ...(s.phase === 'finished' ? { detectedPosted: s.detectedPosted } : {}),
    ...(s.phase === 'finished' && s.holdOpen ? { holdOpen: true } : {}),
    // AM28: no pre-answer, and the unexpected page that ended it, survive an editor reload too.
    ...(s.phase === 'finished' && s.postedUnknown ? { postedUnknown: true } : {}),
    ...(s.phase === 'finished' && s.unexpectedPage
      ? { error: 'UNEXPECTED_PAGE' as const, detail: `page ${s.unexpectedPage}` }
      : {}),
  };
}

export function createRunner(ports: RunnerPorts, env: RunnerEnv): Runner {
  const log = env.log ?? consoleLogger;
  const { clock } = env;
  const chromeMajor = chromeMajorFromUa(env.userAgent) ?? 0;
  const brandedBrowser = isBrandedBrowser(env.brands ?? []);
  const sinks = new Set<(msg: BackgroundToEditor) => void>();
  let current: HandoffState = IDLE;
  let chain: Promise<void> = Promise.resolve();

  /** Appends a task to the queue. The returned promise settles with the task; the queue never breaks. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task);
    chain = run.then(
      () => undefined,
      (err: unknown) => log.error('hand-off task failed', err),
    );
    return run;
  }

  const timers = createTimers({
    clock,
    save: (deadlines) => ports.store.saveTimers(deadlines),
    onDue: (name) => void enqueue(() => fireTimer(name)),
    keepAlive: env.keepAlive,
  });

  async function fireTimer(name: HandoffTimer): Promise<void> {
    if (await timers.take(name)) await step({ type: 'timer', timer: name });
  }

  async function sampleCtx(): Promise<HandoffCtx> {
    const now = clock.now();
    const settings = await ports.local.settings();
    return {
      now,
      guarded: env.guarded,
      chromeMajor,
      settings,
      rate: await ports.local.rate(now, settings),
      uuid: env.uuid,
      brandedBrowser,
    };
  }

  function broadcast(status: HandoffStatus): void {
    const msg: BackgroundToEditor = { v: 1, type: 'handoff/status', ...status };
    for (const post of sinks) {
      try {
        post(msg);
      } catch (err) {
        log.warn('editor port gone', errorMessage(err));
        sinks.delete(post);
      }
    }
  }

  /** Runs one effect; returns the event that answers it, if any. Throws when the platform call fails. */
  async function perform(
    eff: HandoffEffect,
    address: Address | null,
    file: FileSlot | null,
  ): Promise<HandoffEvent | null> {
    switch (eff.type) {
      case 'openWindow': {
        const { windowId, tabId } = await ports.windows.createPopup(eff.box);
        return { type: 'windowCreated', windowId, tabId };
      }
      case 'installRules':
        await ports.dnr.updateSessionRules({ removeRuleIds: eff.removeRuleIds, addRules: eff.addRules });
        return { type: 'rulesInstalled' };
      case 'measureTab': {
        const tab = await ports.tabs.get(eff.tabId);
        const outer = await ports.windows.getBox(eff.windowId);
        if (tab.width === undefined || tab.height === undefined) throw new Error('tabs.get returned no size');
        return { type: 'tabMeasured', inner: { w: tab.width, h: tab.height }, outer };
      }
      case 'updateWindow':
        await ports.windows.update(eff.windowId, eff.box);
        return { type: 'windowFitted' };
      case 'navigate':
        await ports.tabs.navigate(eff.tabId, eff.url);
        return null;
      case 'hardReload':
        await ports.tabs.hardReload(eff.tabId);
        return null;
      case 'injectAgent': {
        const { fresh } = await ports.scripting.injectComposerAgent(eff.tabId);
        return { type: 'agentInjected', fresh };
      }
      case 'sendAgent': {
        if (!address) throw new Error('sendAgent without a session');
        const ack = await ports.tabs.sendMessage(eff.tabId, agentMessageOf(eff.command, address));
        if (!isAgentAck(ack) || !ack.ok) throw new Error(`agent did not ack ${eff.command.type}`);
        return null;
      }
      case 'serveFile': {
        if (!file) throw new Error('serveFile without a pending agent/get-file');
        const found = await ports.exports(eff.exportId);
        if (!found) throw new Error('export not found');
        if (!found.mime.startsWith('image/')) throw new Error(`export is ${found.mime}, not an image`);
        file.reply = { ok: true, name: storyFileName(found.mime), mime: found.mime, b64: bytesToB64(found.bytes) };
        return null;
      }
      case 'notifyEditor':
        broadcast(eff.status);
        return null;
      case 'closeWindow':
        await ports.windows.remove(eff.windowId);
        return null;
      case 'removeRules':
        await ports.dnr.updateSessionRules({ removeRuleIds: eff.ruleIds });
        return null;
      case 'writeRecord':
        await ports.records.put(eff.record);
        return null;
      case 'patchRecordOutcome':
        await ports.records.patchOutcome(eff.handoffId, eff.outcome);
        return null;
      case 'lockMsite':
        await ports.local.lockMsite(eff.until);
        return null;
      case 'noteOpen':
        await ports.local.noteOpen(eff.t);
        return null;
      case 'rememberWindow':
        await ports.local.rememberWindow({ windowId: eff.windowId, tabId: eff.tabId, handoffId: eff.handoffId });
        return null;
      case 'forgetWindow':
        await ports.local.forgetWindow();
        return null;
      case 'armTimer':
        await timers.arm(eff.timer, eff.ms);
        return null;
      case 'clearTimer':
        await timers.clear(eff.timer);
        return null;
    }
  }

  const queueEvent = (event: HandoffEvent): void => void enqueue(() => step(event));

  /** One reducer transition: persist the state, then run the effects in order. */
  async function step(event: HandoffEvent, file: FileSlot | null = null): Promise<void> {
    const prev = current;
    const { state, effects } = handoffReducer(prev, event, await sampleCtx());
    if (state !== prev) {
      current = state;
      try {
        await ports.store.saveState(state);
      } catch (err) {
        log.error('cannot persist the hand-off state', errorMessage(err));
      }
    }
    const address = addressOf(state) ?? addressOf(prev);
    for (const eff of effects) {
      try {
        const answer = await perform(eff, address, file);
        if (answer) queueEvent(answer);
      } catch (err) {
        const message = errorMessage(err);
        log.warn(`effect ${eff.type} failed`, message);
        queueEvent({ type: 'effectFailed', effect: eff.type, message });
      }
    }
  }

  /**
   * AM22: a popup storage.local remembers but no stored session owns (the extension was reloaded,
   * updated or re-enabled mid-hand-off) is closed, if it still is our popup: type `popup`, one tab,
   * on www.instagram.com (host permission shows that URL). A record from an earlier browser session
   * whose id now names another window fails that check and is only forgotten.
   */
  async function closeOrphanPopup(): Promise<void> {
    const rec = await ports.local.composerWindow();
    if (!rec) return;
    const owner = current.phase === 'idle' || current.phase === 'opening' ? null : current.windowId;
    if (owner === rec.windowId) return;
    const w = await ports.windows.describe(rec.windowId);
    const ours =
      w !== null &&
      w.type === 'popup' &&
      w.tabUrls.length === 1 &&
      w.tabUrls.every((u) => u !== undefined && igPath(u) !== null);
    if (ours) {
      log.warn('closing the composer popup of an interrupted hand-off', rec.handoffId);
      try {
        await ports.windows.remove(rec.windowId);
      } catch (err) {
        log.warn('cannot close the orphan composer popup', errorMessage(err));
      }
    }
    await ports.local.forgetWindow();
  }

  async function init(): Promise<void> {
    const stored = await ports.store.load();
    current = stored.state;
    try {
      await closeOrphanPopup();
    } catch (err) {
      log.error('orphan popup check failed', errorMessage(err));
    }
    const overdue = timers.restore(stored.timers);
    // Safety net: the state was persisted but the worker stopped before `armTimer` ran.
    if (current.phase !== 'idle' && stored.timers.inactivity === undefined) {
      const quiet = clock.now() - current.lastEventAt;
      await timers.arm('inactivity', Math.max(0, INACTIVITY_TIMEOUT_MS - quiet));
    }
    for (const name of overdue) await fireTimer(name);
  }

  const started = enqueue(init);

  function agentSession(s: HandoffState): ActiveAgentSession | null {
    const tabId = composerTabId(s);
    if (tabId === null || s.phase === 'idle') return null;
    return { runtimeId: env.runtimeId, tabId, handoffId: s.handoffId, nonce: s.nonce, phase: s.phase };
  }

  /** `void`-able: errors are logged by the queue, never thrown at listeners. */
  const quiet = (p: Promise<void>): Promise<void> => p.catch(() => undefined);

  return {
    ready: () => quiet(started),
    dispatch: (event) => quiet(enqueue(() => step(event))),
    tabUpdated: (tabId, update) =>
      quiet(
        enqueue(async () => {
          const event = composerTabEvent(current, tabId, update);
          if (!event) return;
          const line = describeVerdict(killSwitchVerdict(current, update.url), update.url);
          if (line) log.warn(line);
          await step(event);
        }),
      ),
    agentMessage: (raw, sender) =>
      enqueue(async (): Promise<AgentReply> => {
        const verdict = acceptAgentMessage(raw, sender, agentSession(current));
        if (!verdict.ok) {
          const type = (raw as { type?: unknown } | null)?.type;
          log.warn(`agent message dropped (${verdict.reason})`, typeof type === 'string' ? type : typeof raw);
          return { ok: false };
        }
        const m = verdict.msg;
        switch (m.type) {
          case 'agent/report':
            await step({ type: 'agentReport', probe: m.probe });
            return { ok: true };
          case 'agent/event':
            await step({ type: 'agentEvent', event: m.event });
            return { ok: true };
          case 'agent/get-file': {
            const slot: FileSlot = { reply: null };
            await step({ type: 'agentGetFile' }, slot);
            return slot.reply ?? { ok: false };
          }
        }
      }).catch((): AgentReply => ({ ok: false })),
    editorMessage: (raw) =>
      quiet(
        enqueue(async () => {
          if (!isEditorToBackground(raw)) {
            log.warn('editor message dropped (shape)');
            return;
          }
          switch (raw.type) {
            case 'handoff/start':
              return step({
                type: 'start',
                exportId: raw.exportId,
                mode: raw.mode,
                rehearsal: raw.rehearsal,
                screen: raw.screen,
              });
            case 'handoff/cancel':
              return step({ type: 'cancel' });
            case 'handoff/outcome':
              return step({ type: 'outcome', handoffId: raw.handoffId, posted: raw.posted });
            case 'handoff/enable-msite':
              if (!(await ports.local.clearMsiteLock(raw.lockedUntil))) {
                log.warn('ENABLE kept a lock newer than the one the editor showed');
              }
              return;
          }
        }),
      ),
    connectEditor(post) {
      sinks.add(post);
      void enqueue(async () => {
        if (!sinks.has(post)) return;
        try {
          post({ v: 1, type: 'handoff/status', ...currentStatus(current) });
        } catch {
          sinks.delete(post);
        }
      });
      return () => {
        sinks.delete(post);
      };
    },
    async settled() {
      let seen: Promise<void>;
      do {
        seen = chain;
        await seen;
      } while (seen !== chain);
    },
    state: () => current,
  };
}
