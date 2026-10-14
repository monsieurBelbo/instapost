/**
 * The hand-off effect runner (strategy §3.1, §3.6; ux.md IB1; protocol at the top of
 * src/core/handoff/reducer.ts). The imperative shell around the pure `handoffReducer`:
 *
 * - **One event at a time.** Every input (editor port, agent message, tab and window listeners, timers,
 *   effect results) goes through one promise queue. A task samples the context, runs the reducer, writes
 *   the new state to storage.session *before* any effect runs, then runs the effects in order, each
 *   awaited. That order is what makes Share-once survive a worker restart: the state saying `shareSent`
 *   is stored before the Share command leaves.
 * - **Effect results are new events**, queued behind the current task. A rejected platform call becomes
 *   `effectFailed`; the remaining effects of the batch still run (a kill must lock even if the window is
 *   already gone). Nothing retries.
 * - **Service-worker restarts.** The queue's first task loads the stored state and timer deadlines;
 *   overdue timers fire before anything else.
 * - **Agent messages** are checked by acceptAgentMessage() against the state *at processing time*.
 *   `agent/get-file` is answered with the export's bytes when the transition emitted `serveFile`.
 * - **The lane** (ux.md §8) is pushed to every editor port as `handoff/lane` on connect and after every
 *   transition, so the Post card knows the pace, the lock and a running hand-off before the click.
 * - **A popup left over from a reloaded extension** (§11 AM22) is closed before anything else.
 * - **Resume** (§11 AM25), **Forget this account** and **open Instagram** (ux.md §8) are editor requests
 *   the runner handles in this same queue, so they are serialised with the kill switch's lock.
 * - **Fitting the popup** (W2) and the **portrait shim** (AM37): unchanged, see the reducer and AM29/AM37.
 */

import type { Size } from '../core/geometry/fit.ts';
import { isFitted, type WindowBox } from '../core/geometry/window-fit.ts';
import { laneOf } from '../core/handoff/lane.ts';
import { handoffReducer, statusOf } from '../core/handoff/reducer.ts';
import {
  type AgentCommand,
  FIT_HOLD_MS,
  FIT_REAPPLY_MS,
  FIT_SETTLE_MAX_MS,
  FIT_SETTLE_POLL_MS,
  FIT_VERIFY_MAX_MS,
  FIT_VERIFY_POLL_MS,
  type HandoffCtx,
  type HandoffEffect,
  type HandoffEvent,
  type HandoffState,
  type HandoffStatus,
  type HandoffTimer,
  IDLE,
  type Lane,
} from '../core/handoff/state.ts';
import { isValidHandle } from '../core/ig-contract/account.ts';
import { chromeMajorFromUa, isBrandedBrowser } from '../core/ig-contract/device-profile.ts';
import { REHEARSAL_FIRST_ID } from '../core/ig-contract/rules.ts';
import { igPath, isComposerUrl } from '../core/ig-contract/urls.ts';
import { WRITE_URL_FILTERS } from '../core/ig-contract/write-endpoints.ts';
import type { HandoffId, Nonce } from '../core/model/ids.ts';
import type { BadgePort } from '../platform/action.ts';
import type { DnrPort } from '../platform/dnr.ts';
import type { RunnerTestHooks } from '../platform/e2e-hooks.ts';
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
  tabs: Pick<TabsPort, 'get' | 'getZoom' | 'navigate' | 'hardReload' | 'sendMessage' | 'create'>;
  windows: Pick<WindowsPort, 'createPopup' | 'update' | 'getBox' | 'remove' | 'describe' | 'lastFocusedId'>;
  scripting: ScriptingPort;
  store: SessionStore;
  local: LocalState;
  records: RecordStore;
  exports: ExportSource;
  badge: BadgePort;
  /** ux.md §4.6: focus the editor tab's window again (no-op when there is none). */
  focusEditor: () => Promise<void>;
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
  /** [0, 1) for the human-pace dwell; Math.random by default. */
  random?: () => number;
  clock: Clock;
  /** The waits inside measureTab (settle) and updateWindow (verify). Defaults to the clock's setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Keeps the worker awake while timers are pending (timers.ts); omitted in tests. */
  keepAlive?: () => void;
  /** Guarded builds only (e2e-hooks.ts). */
  e2e?: RunnerTestHooks;
  log?: Logger;
}

export interface Runner {
  ready(): Promise<void>;
  dispatch(event: HandoffEvent): Promise<void>;
  tabUpdated(tabId: number, update: TabUpdate): Promise<void>;
  windowBoundsChanged(windowId: number): Promise<void>;
  agentMessage(raw: unknown, sender: SenderLike): Promise<AgentReply>;
  editorMessage(raw: unknown): Promise<void>;
  /** Registers an editor port; it gets the current status and lane at once. Returns the detach function. */
  connectEditor(post: (msg: BackgroundToEditor) => void): () => void;
  settled(): Promise<void>;
  state(): HandoffState;
}

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
  const address = { handoffId: a.handoffId, nonce: a.nonce };
  switch (command.type) {
    case 'agent/probe':
    case 'agent/watch':
      return { v: 1, type: command.type, ...address };
    case 'agent/observe':
      return { v: 1, type: command.type, from: command.from, ...address };
    case 'agent/drive':
      return { v: 1, ...command, ...address };
  }
}

const addressOf = (s: HandoffState): Address | null =>
  s.phase === 'idle' || s.phase === 'queued' ? null : { handoffId: s.handoffId, nonce: s.nonce };

/** The status an editor sees when it connects (statusOf, the reducer's own). */
export const currentStatus = (s: HandoffState): HandoffStatus => statusOf(s);

/**
 * The timer that ends a session found without any (the worker stopped between persisting the state and
 * arming its timers): by phase, the one whose expiry decides what that phase would.
 */
export function backstopFor(s: Exclude<HandoffState, { phase: 'idle' }>, now: number): [HandoffTimer, number] {
  switch (s.phase) {
    case 'queued':
      return ['queue', Math.max(0, s.startAt - now)];
    case 'opening':
    case 'closing':
      return ['stepDeadline', 0];
    case 'finished':
      return [s.hold === 'upload' ? 'uploadHold' : s.hold === 'offerManual' ? 'offerManual' : 'closeDelay', 0];
    case 'sharing':
      return ['shareAck', 0];
    case 'confirmingUpload':
      return ['confirmTick', 0];
    case 'manual':
      return ['manualDeadline', Math.max(0, s.until - now)];
    default:
      return ['preShareCap', Math.max(0, (s.preShareUntil ?? now) - now)];
  }
}

const sameBox = (a: WindowBox, b: WindowBox): boolean =>
  a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;

/** ux.md §8: Instagram's pages the editor may ask the background to open in a normal tab. */
export function instagramUrl(page: 'home' | 'story', handle?: string): string | null {
  if (page === 'home') return 'https://www.instagram.com/';
  return handle !== undefined && isValidHandle(handle) ? `https://www.instagram.com/stories/${handle}/` : null;
}

/** The write-block session rules (1002…) must name the composer tab (a Share test checks them). */
export function testRulesInstalled(rules: readonly { id: number; condition: { tabIds?: number[] } }[], tabId: number) {
  const ids = WRITE_URL_FILTERS.map((_, i) => REHEARSAL_FIRST_ID + i);
  return ids.every((id) => rules.some((r) => r.id === id && (r.condition.tabIds ?? []).includes(tabId)));
}

export function createRunner(ports: RunnerPorts, env: RunnerEnv): Runner {
  const log = env.log ?? consoleLogger;
  const { clock } = env;
  const random = env.random ?? (() => Math.random());
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((resolve) => void clock.setTimeout(resolve, ms)));
  const chromeMajor = chromeMajorFromUa(env.userAgent) ?? 0;
  const brandedBrowser = isBrandedBrowser(env.brands ?? []);
  const sinks = new Set<(msg: BackgroundToEditor) => void>();
  let current: HandoffState = IDLE;
  let chain: Promise<void> = Promise.resolve();
  /** The result the toolbar badge shows, so an editor that showed it can clear it. */
  let badgeFor: string | null = null;

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

  async function guardedHook<T>(read: ((h: RunnerTestHooks) => Promise<T>) | null): Promise<T | undefined> {
    if (!env.guarded || !env.e2e || !read) return undefined;
    return await read(env.e2e).catch(() => undefined);
  }

  async function sampleCtx(): Promise<HandoffCtx> {
    const now = clock.now();
    const settings = await ports.local.settings();
    const [resizeTimeoutMs, dwellScale, budgetScale] = await Promise.all([
      guardedHook((h) => h.resizeTimeoutMs()),
      guardedHook((h) => h.dwellScale()),
      guardedHook((h) => h.budgetScale()),
    ]);
    return {
      now,
      guarded: env.guarded,
      chromeMajor,
      settings,
      rate: await ports.local.rate(now, settings),
      uuid: env.uuid,
      random,
      fingerprint: await ports.local.fingerprint().catch(() => null),
      brandedBrowser,
      ...(resizeTimeoutMs !== undefined ? { resizeTimeoutMs } : {}),
      ...(dwellScale !== undefined ? { dwellScale } : {}),
      ...(budgetScale !== undefined ? { budgetScale } : {}),
    };
  }

  async function settledBox(windowId: number): Promise<WindowBox> {
    let box = await ports.windows.getBox(windowId);
    for (let i = 0; i < Math.ceil(FIT_SETTLE_MAX_MS / FIT_SETTLE_POLL_MS); i++) {
      await sleep(FIT_SETTLE_POLL_MS);
      const next = await ports.windows.getBox(windowId);
      if (sameBox(box, next)) return next;
      box = next;
    }
    return box;
  }

  async function tabSize(tabId: number): Promise<Size> {
    const tab = await ports.tabs.get(tabId);
    if (tab.width === undefined || tab.height === undefined) throw new Error('tabs.get returned no size');
    return { w: tab.width, h: tab.height };
  }

  type UpdateWindow = Extract<HandoffEffect, { type: 'updateWindow' }>;
  const applyBox = (eff: UpdateWindow) => ports.windows.update(eff.windowId, { state: 'normal', ...eff.box });

  async function verifyFit(eff: UpdateWindow): Promise<{ fitted: boolean; inner: Size; applied: number }> {
    let applied = 1;
    const reapplyAt = eff.reapply ? FIT_REAPPLY_MS.filter((ms) => ms > 0 && ms < FIT_VERIFY_MAX_MS) : [];
    const holdUntil = eff.reapply ? Math.min(FIT_HOLD_MS, FIT_VERIFY_MAX_MS) : 0;
    const polls = Array.from({ length: Math.ceil(FIT_VERIFY_MAX_MS / FIT_VERIFY_POLL_MS) }, (_, i) =>
      Math.min((i + 1) * FIT_VERIFY_POLL_MS, FIT_VERIFY_MAX_MS),
    );
    const ticks = [...new Set([...polls, ...reapplyAt])].sort((a, b) => a - b);
    let inner = await tabSize(eff.tabId);
    let t = 0;
    for (const at of ticks) {
      if (isFitted(inner, eff.inner) && t >= holdUntil) break;
      await sleep(at - t);
      t = at;
      inner = await tabSize(eff.tabId);
      if (reapplyAt.includes(at) && !isFitted(inner, eff.inner)) {
        await applyBox(eff);
        applied++;
      }
    }
    return { fitted: isFitted(inner, eff.inner) && t >= holdUntil, inner, applied };
  }

  async function fitAnswer(eff: UpdateWindow): Promise<HandoffEvent> {
    const { fitted, inner, applied } = await verifyFit(eff);
    const outer = await ports.windows.getBox(eff.windowId);
    return { type: 'windowFitted', box: eff.box, target: eff.inner, fitted, inner, outer, applied };
  }

  const detached = new Set<Promise<void>>();
  function detach(effect: HandoffEffect['type'], work: () => Promise<HandoffEvent>): void {
    const task: Promise<void> = work().then(
      (answer) => queueEvent(answer),
      (err: unknown) => {
        const message = errorMessage(err);
        log.warn(`effect ${effect} failed`, message);
        queueEvent({ type: 'effectFailed', effect, message });
      },
    );
    detached.add(task);
    void task.finally(() => detached.delete(task));
  }

  function post(msg: BackgroundToEditor): void {
    for (const sink of sinks) {
      try {
        sink(msg);
      } catch (err) {
        log.warn('editor port gone', errorMessage(err));
        sinks.delete(sink);
      }
    }
  }

  const broadcast = (status: HandoffStatus): void => post({ v: 1, type: 'handoff/status', ...status });

  async function currentLane(): Promise<Lane> {
    const now = clock.now();
    const settings = await ports.local.settings();
    const info = await ports.local.rateInfo(now, settings);
    return laneOf(current, info.decision, info.counts, info.caps, settings.msiteLockedUntil, now);
  }

  async function pushLane(only?: (msg: BackgroundToEditor) => void): Promise<void> {
    if (sinks.size === 0 && !only) return;
    try {
      const msg: BackgroundToEditor = { v: 1, type: 'handoff/lane', ...(await currentLane()) };
      if (only) only(msg);
      else post(msg);
    } catch (err) {
      log.warn('lane unavailable', errorMessage(err));
    }
  }

  async function shimInstalls(tabId: number): Promise<boolean> {
    if (!env.guarded || !env.e2e) return true;
    const off = await env.e2e.portraitShimOff().catch(() => false);
    if (off !== 'home') return off !== true;
    const tab = await ports.tabs.get(tabId).catch(() => null);
    return isComposerUrl(tab?.url);
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
        const outer = eff.settle ? await settledBox(eff.windowId) : await ports.windows.getBox(eff.windowId);
        const inner = await tabSize(eff.tabId);
        const zoom = await ports.tabs.getZoom(eff.tabId).catch(() => null);
        return { type: 'tabMeasured', inner, outer, zoom };
      }
      case 'updateWindow': {
        await applyBox(eff);
        if (eff.reapply) return fitAnswer(eff);
        detach(eff.type, () => fitAnswer(eff));
        return null;
      }
      case 'readSize': {
        const inner = await tabSize(eff.tabId);
        const outer = await ports.windows.getBox(eff.windowId);
        return { type: 'windowSized', inner, outer };
      }
      case 'navigate':
        await ports.tabs.navigate(eff.tabId, eff.url);
        return null;
      case 'hardReload':
        await ports.tabs.hardReload(eff.tabId);
        return null;
      case 'injectAgent': {
        const install = await shimInstalls(eff.tabId);
        const orientation = await ports.scripting.injectPortraitShim(eff.tabId, install);
        const { fresh } = await ports.scripting.injectComposerAgent(eff.tabId);
        return { type: 'agentInjected', fresh, orientation };
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
        await ports.records.patchOutcome(eff.handoffId, eff.outcome, eff.result, eff.patch);
        return null;
      case 'markRecord': {
        const applied = await ports.records.mark(eff.handoffId, eff.posted, clock.now());
        if (applied) {
          const last = await ports.local.lastResult();
          if (last && last.handoffId === eff.handoffId) {
            await ports.local.writeLastResult({
              ...last,
              result: { ...last.result, kind: eff.posted ? 'posted' : 'notPosted', at: clock.now(), markedBy: 'owner' },
            });
          }
        }
        return null;
      }
      case 'lockMsite':
        await ports.local.lockMsite(eff.until, eff.reason, clock.now());
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
      case 'raiseWindow':
        await ports.windows.update(eff.windowId, { focused: true });
        return null;
      case 'setBadge':
        badgeFor = eff.text === '' ? null : (addressOf(current)?.handoffId ?? lastId());
        await ports.badge.set(eff.text, eff.color);
        return null;
      case 'focusEditor': {
        // ux.md §4.6: only if the owner was watching the Instagram window when it closes.
        const focused = await ports.windows.lastFocusedId();
        if (focused === eff.ifFocused) await ports.focusEditor();
        return null;
      }
      case 'verifyTestRules': {
        const rules = await ports.dnr.getSessionRules();
        return { type: 'rulesVerified', ok: testRulesInstalled(rules, eff.tabId) };
      }
      case 'storeFingerprint':
        await ports.local.storeFingerprint(eff.fingerprint);
        return null;
      case 'setExpectedAccount':
        await ports.local.setExpectedAccount(eff.account);
        return null;
      case 'setLastTestPass':
        await ports.local.setLastTestPass(eff.at);
        return null;
      case 'writeLastResult':
        await ports.local.writeLastResult(eff.last);
        return null;
    }
  }

  const lastId = (): string | null => (current.phase === 'idle' ? (current.last?.handoffId ?? null) : null);

  const queueEvent = (event: HandoffEvent): void => void enqueue(() => step(event));

  /** One reducer transition: persist the state, then run the effects in order, then push the lane. */
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
    if (state.phase !== prev.phase || effects.some((e) => e.type === 'noteOpen' || e.type === 'lockMsite')) {
      await pushLane();
    }
  }

  async function closeOrphanPopup(): Promise<void> {
    const rec = await ports.local.composerWindow();
    if (!rec) return;
    const owner =
      current.phase === 'idle' || current.phase === 'queued' || current.phase === 'opening' ? null : current.windowId;
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
    // Safety net: the state was persisted but the worker stopped before its timers were armed. A
    // stepDeadline decides by phase (TIMEOUT before Share, nothing after it); the backstop closes a
    // `closing` session whose windowRemoved never came.
    if (current.phase !== 'idle' && Object.keys(stored.timers).length === 0) {
      const s = current;
      const [timer, ms] = backstopFor(s, clock.now());
      await timers.arm(timer, ms);
    }
    for (const name of overdue) await fireTimer(name);
  }

  const started = enqueue(init);

  function agentSession(s: HandoffState): ActiveAgentSession | null {
    const tabId = composerTabId(s);
    if (tabId === null || s.phase === 'idle' || s.phase === 'queued') return null;
    return { runtimeId: env.runtimeId, tabId, handoffId: s.handoffId, nonce: s.nonce, phase: s.phase };
  }

  const quiet = (p: Promise<void>): Promise<void> => p.catch(() => undefined);

  async function editorRequest(raw: unknown): Promise<void> {
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
          screen: raw.screen,
          browser: raw.browser,
          queue: raw.queue,
          ...(raw.exportSample ? { exportSample: raw.exportSample } : {}),
          ...(raw.exportSha256 ? { exportSha256: raw.exportSha256 } : {}),
          ...(raw.docHash ? { docHash: raw.docHash } : {}),
        });
      case 'handoff/cancel':
        return step({ type: 'cancel' });
      case 'handoff/account-choice':
        return step({ type: 'accountChoice', handoffId: raw.handoffId, proceed: raw.proceed });
      case 'handoff/manual':
        return step({ type: 'manual', handoffId: raw.handoffId });
      case 'handoff/mark':
        return step({ type: 'mark', handoffId: raw.handoffId, posted: raw.posted });
      case 'handoff/enable-msite':
        if (!(await ports.local.clearMsiteLock(raw.lockedUntil))) {
          log.warn('Resume kept a lock newer than the one the editor showed');
        }
        await pushLane();
        return;
      case 'ui/open-instagram': {
        const url = instagramUrl(raw.page, raw.handle);
        if (url === null) {
          log.warn('open-instagram dropped (handle)');
          return;
        }
        await ports.tabs.create(url);
        return;
      }
      case 'ui/forget-account':
        await ports.local.forgetAccount();
        return;
      case 'ui/use-account': {
        // AP-4: only the handle this check read, from the background's own record of it.
        const last = await ports.local.lastResult();
        const r = last?.handoffId === raw.handoffId ? last.result : null;
        if (r?.kind !== 'checked' || !r.lockedTo || !r.account) {
          log.warn('use-account dropped (not the last check, or no mismatch)');
          return;
        }
        await ports.local.setExpectedAccount({ handle: r.account, detectedAt: r.at });
        return;
      }
      case 'ui/result-seen':
        if (badgeFor !== null && badgeFor === raw.handoffId && current.phase === 'idle') {
          badgeFor = null;
          await ports.badge.set('', null).catch(() => undefined);
        }
        return;
    }
  }

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
    windowBoundsChanged: (windowId) =>
      quiet(
        enqueue(async () => {
          const s = current;
          const owner = s.phase === 'idle' || s.phase === 'queued' || s.phase === 'opening' ? null : s.windowId;
          if (owner === null || owner !== windowId) return;
          await step({ type: 'boundsChanged', windowId });
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
          case 'agent/fact':
            await step({ type: 'agentFact', fact: m.fact });
            return { ok: true };
          case 'agent/get-file': {
            const slot: FileSlot = { reply: null };
            await step({ type: 'agentGetFile' }, slot);
            return slot.reply ?? { ok: false };
          }
        }
      }).catch((): AgentReply => ({ ok: false })),
    editorMessage: (raw) => quiet(enqueue(() => editorRequest(raw))),
    connectEditor(sink) {
      sinks.add(sink);
      void enqueue(async () => {
        if (!sinks.has(sink)) return;
        try {
          sink({ v: 1, type: 'handoff/status', ...currentStatus(current) });
          await pushLane(sink);
        } catch {
          sinks.delete(sink);
        }
      });
      return () => {
        sinks.delete(sink);
      };
    },
    async settled() {
      for (;;) {
        const seen = chain;
        await seen;
        if (detached.size > 0) {
          await Promise.allSettled([...detached]);
          continue;
        }
        if (seen === chain) return;
      }
    },
    state: () => current,
  };
}
