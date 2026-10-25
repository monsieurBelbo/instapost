/**
 * The in-page driver (docs/inpage.md §10.4, §13; grown from spike S12): the window lane's autopilot,
 * sequential, against an engine frame inside the owner's desktop Instagram tab instead of a popup. Background
 * only; one run at a time.
 *
 * Modes `check`, `test`, `shareTest` and `post` (INPAGE_MODES; check-bundle looks for INPAGE_DRIVER_MARKER
 * exactly once in every build's background.js, and nowhere else). Test modes install the test write-block
 * rules 1002–1010 for the tab and for service workers, a Share test verifies them before Share, and a write
 * that gets through is TEST_LEAK: kill and lock, as in the window lane. `post` installs no write block (the
 * live build ships no static ruleset either; a guarded build's static ruleset still blocks it): the edited
 * export from the composer goes into Instagram's story editor, Share is pressed once, and decide()
 * (outcome.ts) says Posted only for configure_to_story 2xx JSON without a
 * redirect; never a retry. Posts count toward the rate guard's caps; check and test runs only need spacing.
 *
 * Steps (§10.4): the lane (lock, rate guard, noteOpen) → the rules (1001 in the chosen variant, 1020,
 * 1002–1010) → `inpage/open-frame` to the content script, the frame id from webRequest, the `load` from the
 * content script, FRAME_REFUSED / kill / stop as frameLoadVerdict says → the portrait shim and the agent with
 * `frameIds:[engine]` → `agent/probe` (with the one input wait) and evaluateProbe's rows → the account →
 * `check` ends; `test`: + → Story (with the stored menu fingerprint), the insert (a calibration card), the
 * compose watch, a C8 probe, and stop before Share; `shareTest`: verify the test rules, Share once, and
 * decide() with writes blocked → tear down: remove the frame, then the rules → the run record.
 *
 * The kill switch in a frame (§3.14): webRequest (the frame's navigations and redirects), the content
 * script (the frame's pathname, readable or not; its port: the page went away), tabs.onUpdated (F8: the
 * page itself moved to a checkpoint or a login; a change of its path only, RL-1) and tabs.onRemoved. Kills
 * lock the lane for 7 days with the unchanged lockMsite. After a post's Share nothing reports "not posted"
 * but Instagram's own refusal: a stop or a kill there is Couldn't confirm (a kill keeps its lock, RS-2), and
 * a security page in the desktop page waits for decide() (the frame is not cut mid-upload) and then locks.
 *
 * RS-1: the run's rules are read again right before the share command. RS-3: an in-flight marker (the run at
 * its start and right before Share) lets a restarted worker report a run it lost (restartedRecord).
 *
 * Reused unchanged: evaluateProbe, accountDecision, composerMayReadLandscape, decide, rehearsalRules,
 * testRulesInstalled, lockMsite, the rate guard, the agent and its protocol (acceptAgentMessage with the
 * engine frame's id and document).
 */
import { type DwellKind, dwellMs } from '../core/handoff/dwell.ts';
import { classifyEntry, decide, decideLate, normalizePath, type OutcomeBudgets } from '../core/handoff/outcome.ts';
import {
  type AgentFact,
  type ComposeFact,
  ENTRY_BUDGET_MS,
  type EntryFact,
  HOME_READY_MS,
  INPUT_WAIT_MS,
  INSERT_BUDGET_MS,
  MSITE_LOCK_MS,
  type MsiteLockReason,
  type NetEntry,
  PUBLISH_AFTER_UPLOAD_MS,
  type SessionPhase,
  SHARE_ACK_MS,
  UPLOAD_ENTRY_BUDGET_MS,
  UPLOAD_SETTLE_MS,
} from '../core/handoff/state.ts';
import { accountDecision, isValidHandle } from '../core/ig-contract/account.ts';
import type { PageOrientation, ProbeReport } from '../core/ig-contract/contract.ts';
import {
  FETCH_DEST_RULE_ID,
  fetchDestRule,
  frameUaRule,
  XFO_RULE_ID,
  xfoRule,
} from '../core/ig-contract/frame-rules.ts';
import { composerMayReadLandscape, evaluateProbe } from '../core/ig-contract/probe-eval.ts';
import {
  type DnrRule,
  REHEARSAL_FIRST_ID,
  REHEARSAL_LAST_ID,
  rehearsalRules,
  SESSION_RULE_IDS,
  UA_RULE_ID,
} from '../core/ig-contract/rules.ts';
import type { Box } from '../core/inpage/frame-box.ts';
import {
  type FrameLoadFacts,
  frameLoadVerdict,
  framePathVerdict,
  frameUrlVerdict,
  pageUrlVerdict,
} from '../core/inpage/frame-verdict.ts';
import { isRepostMeta, type RepostMeta } from '../core/repost/source.ts';
import type { LocalState } from '../handoff/local-state.ts';
import { testRulesInstalled } from '../handoff/runner.ts';
import type { DnrPort } from '../platform/dnr.ts';
import type { ScriptingPort } from '../platform/scripting.ts';
import type { TabInfo } from '../platform/tabs.ts';
import type { FrameRequestEvent } from '../platform/web-request.ts';
import {
  type ActiveAgentSession,
  type AgentReply,
  type AgentToBackground,
  acceptAgentMessage,
  bytesToB64,
  isAgentAck,
  type SenderLike,
} from '../shared/protocol.ts';
import { createFrameWatch, type FrameWatchSnapshot } from './frame-watch.ts';
import {
  acceptPageMessage,
  type BackgroundToPage,
  type DevToggles,
  isOpenFrameReply,
  isRunPhoto,
  type PageToBackground,
  type RunPhoto,
} from './messages.ts';

/** check-bundle T3: the in-page driver is in every build's background.js, once, and nowhere else. */
export const INPAGE_DRIVER_MARKER = 'instapost-inpage:modes=check,test,shareTest,post';
export const INPAGE_MODES = ['check', 'test', 'shareTest', 'post'] as const;
export type InpageMode = (typeof INPAGE_MODES)[number];
/** Test modes run with the write block; a post never does. */
export const writeBlockedFor = (mode: InpageMode): boolean => mode !== 'post';

/** docs/inpage.md §3.14: the frame must load within this. */
export const FRAME_LOAD_MS = 30_000;
/** After the page's port went away, how long tabs.onUpdated gets to name where the page went (F8). */
export const PAGE_LEFT_GRACE_MS = 400;
/** Decide() every this often after Share. */
export const DECIDE_TICK_MS = 1000;
/** The C8 probe once the composer drew the photo. */
export const READY_PROBE_MS = 5000;
/** Posted: the phone stays on Instagram's home this long (its own success toast), then the frame goes. */
export const POSTED_LINGER_MS = 2000;
/** Couldn't confirm while an upload may still run (O5, O6): keep the frame this long for a late answer. */
export const LATE_HOLD_MS = 120_000;

export type InpageOutcome =
  | 'checked'
  | 'tested'
  | 'shareTested'
  /** O1: configure_to_story answered 2xx JSON, not redirected. */
  | 'posted'
  /** O2, O4: Instagram refused the publish or the upload. */
  | 'notPosted'
  /** Stopped without a lock (FRAME_REFUSED, PAGE_LEFT, NOT_LOGGED_IN, a failed step, the owner's Stop). */
  | 'stopped'
  /** The kill switch: locked for 7 days. */
  | 'killed'
  /** After Share, the evidence did not decide. */
  | 'unknown';

export interface InpageStepLine {
  step: string;
  /** ms since the run started. */
  t: number;
  detail?: string;
}

/** The run record (Details in the panel; storage.local `inpageRecords`). Structural facts only. */
export interface InpageRecord {
  marker: typeof INPAGE_DRIVER_MARKER;
  runId: string;
  mode: InpageMode;
  /** Test modes: the write block is installed (and verified before a Share test). */
  writeBlocked: boolean;
  /**
   * What the insert served: the panel's export or the calibration card. RL-13: an export's SHA-256 and doc hash
   * (from the composer), so the duplicate guard can tell the same story again (story-guard.ts).
   */
  photo: {
    source: 'export' | 'calibration';
    mime: string;
    bytes: number;
    sha256?: string;
    docHash?: string;
  } | null;
  toggles: DevToggles;
  startedAt: number;
  endedAt: number | null;
  outcome: InpageOutcome | null;
  code: string | null;
  detail: string | null;
  locked: MsiteLockReason | null;
  tabId: number;
  frame: {
    id: number | null;
    documentId: string | null;
    box: Box | null;
    dpr: number | null;
    scale: number | null;
    loaded: boolean;
    readable: boolean;
    /** Pathnames (and off-host origins) of the frame's document requests, redirect targets included (webRequest). */
    urls: string[];
    /** Pathnames the content script read in the frame, in order (pushState moves included). */
    paths: string[];
    status: number | null;
    xfoSeen: string | null;
    error: string | null;
    otherSubFrames: number;
  };
  rules: { installed: number[]; after: number[] | null; ua: DevToggles['ua'] };
  orientation: PageOrientation | null;
  probe: ProbeReport | null;
  readyProbe: ProbeReport | null;
  account: { detected: string | null; expected: string | null; decision: string | null };
  entry: Omit<EntryFact, 'kind'> | null;
  compose: Omit<ComposeFact, 'kind'> | null;
  share: {
    sent: boolean;
    done: boolean;
    refused: string | null;
    decision: string | null;
    /** A Couldn't confirm upgraded by a later answer (§6.4). */
    late?: boolean;
  } | null;
  /** After Share: the agent's resource entries (paths normalised). */
  net: NetEntry[];
  /** Pathnames of the page itself seen during the run (F8), from the one it started on. */
  pageUrls: string[];
  steps: InpageStepLine[];
  /**
   * RS-3: rebuilt by a restarted worker from the in-flight marker (the run itself was lost with the old worker),
   * so the composer shows it even though it never saw the run start.
   */
  restarted?: true;
  /** RL-13: the owner's correction of a Couldn't confirm (It posted · It didn't post), and when. */
  mark?: 'posted' | 'notPosted';
  markedAt?: number;
  /** docs/repost.md RP-31: the story is a repost (its facts; no URL). */
  repost?: RepostMeta;
}

/** What the composer shows. */
export interface InpageStatus {
  running: boolean;
  tabId: number | null;
  record: InpageRecord | null;
}

export type StartRefusal =
  | 'BUSY'
  | 'PAUSED'
  | 'RATE_LIMITED'
  | 'SHARE_NOT_CONFIRMED'
  | 'NO_TAB'
  | 'NO_PHOTO'
  /** RS-7: the page is on Instagram's login page. */
  | 'NOT_LOGGED_IN'
  /** AM23 (SG4): a guarded build in a branded browser profile, as the window lane refuses it. */
  | 'BRANDED_BROWSER';

export interface InpageLogger {
  info(msg: string, ...data: unknown[]): void;
  warn(msg: string, ...data: unknown[]): void;
}

export interface InpageDeps {
  dnr: DnrPort;
  tabs: {
    get(tabId: number): Promise<TabInfo>;
    sendMessage<R = unknown>(tabId: number, message: unknown, frameId?: number): Promise<R>;
  };
  scripting: ScriptingPort;
  local: Pick<
    LocalState,
    'settings' | 'rate' | 'noteOpen' | 'lockMsite' | 'fingerprint' | 'storeFingerprint' | 'setExpectedAccount'
  >;
  toggles(): Promise<DevToggles>;
  saveRecord(r: InpageRecord): Promise<void>;
  /**
   * RS-3: the in-flight marker (storage.local, so it survives a worker crash and an extension reload or update):
   * the run as it stood at its start and again just before Share; cleared once the run's record is saved. A
   * worker that finds one at its start reports the lost run (restartedRecord).
   */
  inflight?: { save(r: InpageRecord): Promise<void>; clear(runId: string): Promise<void> };
  /** The insert's photo when the panel sent none (test modes only): a calibration card (src/raster/calibration.ts). */
  calibration(): Promise<{ mime: string; bytes: Uint8Array }>;
  now(): number;
  random(): number;
  uuid(): string;
  runtimeId: string;
  chromeMajor: number;
  /** One run at a time across both lanes. */
  windowLaneBusy(): boolean;
  /**
   * A guarded build (development, mock; strategy §5 SG4): the probe's fake-marker guard applies
   * (GUARD_NOT_FAKE) and a branded browser is refused before anything loads (AM23), as in the window lane.
   */
  guarded?: boolean;
  /** The worker's userAgentData brands name a branded browser (isBrandedBrowser). */
  brandedBrowser?: boolean;
  /** Any extension API call: keeps the service worker awake during a run (every 10 s). */
  keepAlive?: () => void;
  log?: InpageLogger;
  /** Tests only: scales every budget and dwell (0 < s ≤ 1). */
  scale?: number;
}

export interface InpageDriver {
  start(req: {
    tabId: number;
    mode: InpageMode;
    confirmShare: boolean;
    /** The edited export; required for `post`, optional for test modes (else the calibration card). */
    photo?: RunPhoto | null;
    /** RP-31: the export is a repost (diagnostics only: the driver posts pixels either way). */
    repost?: RepostMeta;
  }): Promise<{ ok: true; runId: string } | { ok: false; why: StartRefusal; freeAt?: number }>;
  /** The owner's Stop. */
  stop(): void;
  busy(): boolean;
  status(): InpageStatus;
  subscribe(listener: (s: InpageStatus) => void): () => void;
  /** An agent message: null when it is not addressed to the in-page run (the window lane's, then). */
  agentMessage(raw: unknown, sender: SenderLike): Promise<AgentReply> | null;
  pageMessage(raw: unknown, sender: SenderLike): void;
  /** The content script's PAGE_PORT went away (its document unloaded, or the tab closed). */
  pagePortClosed(tabId: number): void;
  frameRequest(e: FrameRequestEvent): void;
  tabUpdated(tabId: number, url: string | undefined): void;
  tabRemoved(tabId: number): void;
  /** Settles when the current run (if any) has ended. */
  idle(): Promise<void>;
  /** RS-3: shows a run a previous worker lost (restartedRecord) as the last result, when nothing runs. */
  adopt(rec: InpageRecord): void;
}

type Inbound =
  | { type: 'agent'; msg: AgentToBackground }
  | { type: 'page'; msg: PageToBackground }
  | { type: 'frame'; kind: 'frame-id' | 'settled' };

type StopVerdict = { kind: 'stop' | 'kill'; code: string; detail: string };

class Aborted extends Error {
  readonly verdict: StopVerdict;
  constructor(verdict: StopVerdict) {
    super(verdict.code);
    this.verdict = verdict;
  }
}
class TimedOut extends Error {}

const LOCK_REASON: Record<string, MsiteLockReason> = {
  KILLED_CHALLENGE: 'KILLED_CHALLENGE',
  KILLED_OFFHOST: 'KILLED_OFFHOST',
  TEST_LEAK: 'TEST_LEAK',
};

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname === 'www.instagram.com' ? u.pathname : `${u.protocol}//${u.hostname}${u.pathname}`;
  } catch {
    return '?';
  }
}

export function createInpageDriver(d: InpageDeps): InpageDriver {
  const log = d.log ?? { info: () => undefined, warn: () => undefined };
  const scale = d.scale !== undefined && d.scale > 0 && d.scale <= 1 ? d.scale : 1;
  const ms = (n: number) => Math.max(1, Math.round(n * scale));
  const listeners = new Set<(s: InpageStatus) => void>();
  const watch = createFrameWatch();

  interface Run {
    rec: InpageRecord;
    nonce: string;
    phase: SessionPhase;
    events: Inbound[];
    waiters: Set<() => void>;
    abort: StopVerdict | null;
    /** Teardown began: the page port closing now is the frame's own removal. */
    closing: boolean;
    loadedReadable: boolean;
    fileServed: boolean;
    photo: RunPhoto | null;
    done: Promise<void>;
    /** The desktop page's path as last seen (from the start): tabs.onUpdated acts on a change only (RL-1). */
    pagePath: string | null;
    /**
     * RL-1: a security page in the desktop page after a post's Share. It does not stop the run (the frame may
     * still be uploading); the lock follows once decide() has finished.
     */
    pageKill: StopVerdict | null;
  }
  let run: Run | null = null;
  let last: InpageRecord | null = null;
  let starting = false;

  const status = (): InpageStatus => ({
    running: run !== null,
    tabId: run?.rec.tabId ?? null,
    record: run ? structuredClone(run.rec) : last,
  });
  const push = () => {
    const s = status();
    for (const l of listeners) {
      try {
        l(s);
      } catch {
        listeners.delete(l);
      }
    }
  };

  function step(r: Run, name: string, detail?: string) {
    r.rec.steps.push({ step: name, t: d.now() - r.rec.startedAt, ...(detail ? { detail } : {}) });
    log.info(`inpage: ${name}${detail ? ` (${detail})` : ''}`);
    push();
  }

  function wake(r: Run) {
    for (const w of [...r.waiters]) w();
  }
  function deliver(r: Run, e: Inbound) {
    r.events.push(e);
    wake(r);
  }
  function abort(r: Run, v: StopVerdict) {
    if (r.abort) return;
    r.abort = v;
    log.warn(`inpage: ${v.kind} ${v.code} (${v.detail})`);
    wake(r);
  }

  /** Waits for an event from `from` on that `pick` accepts, or rejects on abort or after `limit` ms. */
  function waitFor<T>(r: Run, from: number, limit: number, pick: (e: Inbound) => T | undefined): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let cursor = from;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (fn: () => void) => {
        r.waiters.delete(check);
        if (timer !== null) clearTimeout(timer);
        fn();
      };
      const check = () => {
        const stop = r.abort;
        if (stop) return finish(() => reject(new Aborted(stop)));
        for (; cursor < r.events.length; cursor++) {
          const hit = pick(r.events[cursor] as Inbound);
          if (hit !== undefined) {
            cursor++;
            return finish(() => resolve(hit));
          }
        }
      };
      r.waiters.add(check);
      if (Number.isFinite(limit)) timer = setTimeout(() => finish(() => reject(new TimedOut())), limit);
      check();
    });
  }
  /** An abortable pause. */
  const pause = (r: Run, n: number) =>
    waitFor(r, r.events.length, n, () => undefined).catch((e: unknown) => {
      if (e instanceof TimedOut) return;
      throw e;
    });
  const dwell = (r: Run, kind: DwellKind) => pause(r, ms(dwellMs(kind, d.random)));

  const agentFact =
    <K extends AgentFact['kind']>(kinds: readonly K[]) =>
    (e: Inbound) =>
      e.type === 'agent' && e.msg.type === 'agent/fact' && (kinds as readonly string[]).includes(e.msg.fact.kind)
        ? (e.msg.fact as Extract<AgentFact, { kind: K }>)
        : undefined;
  const agentReport = (e: Inbound) => (e.type === 'agent' && e.msg.type === 'agent/report' ? e.msg.probe : undefined);

  async function sendAgent(r: Run, command: Record<string, unknown>): Promise<void> {
    const frameId = r.rec.frame.id;
    if (frameId === null) throw new Error('no engine frame');
    const ack = await d.tabs.sendMessage(
      r.rec.tabId,
      { v: 1, ...command, handoffId: r.rec.runId, nonce: r.nonce },
      frameId,
    );
    if (!isAgentAck(ack) || !ack.ok) throw new Error(`agent did not ack ${String(command.type)}`);
  }
  const sendPage = (r: Run, msg: BackgroundToPage) => d.tabs.sendMessage(r.rec.tabId, msg, 0);

  function stopWith(code: string, detail: string): never {
    throw new Aborted({ kind: 'stop', code, detail });
  }

  // ---- the run -------------------------------------------------------------------------------------------

  async function openFrame(r: Run): Promise<void> {
    const toggles = r.rec.toggles;
    const rules: DnrRule[] = [
      frameUaRule(r.rec.tabId, d.chromeMajor, 'full', toggles.ua),
      ...(toggles.xfoRule === 'on' ? [xfoRule(r.rec.tabId)] : []),
      ...(toggles.fetchDest === 'document' ? [fetchDestRule(r.rec.tabId)] : []),
      // A post's writes must reach Instagram: no write block. Test modes keep it.
      ...(r.rec.writeBlocked ? rehearsalRules(r.rec.tabId) : []),
    ];
    await d.dnr.updateSessionRules({ removeRuleIds: [...SESSION_RULE_IDS], addRules: rules });
    r.rec.rules.installed = rules.map((x) => x.id);
    step(
      r,
      'rules',
      `${UA_RULE_ID} (${toggles.ua})${toggles.xfoRule === 'on' ? `, ${XFO_RULE_ID}` : ', no 1020'}${toggles.fetchDest === 'document' ? `, ${FETCH_DEST_RULE_ID} (dest document)` : ''}, ${r.rec.writeBlocked ? 'write block' : 'writes open (post)'}`,
    );

    watch.arm(r.rec.tabId);
    const mark = r.events.length;
    const reply = await sendPage(r, {
      v: 1,
      type: 'inpage/open-frame',
      runId: r.rec.runId,
      frame: toggles.frame,
      view: toggles.view,
    }).catch((err: unknown) => ({ ok: false as const, why: err instanceof Error ? err.message : String(err) }));
    if (!isOpenFrameReply(reply) || !reply.ok) {
      stopWith(
        'PAGE_LEFT',
        `the page did not open the frame: ${isOpenFrameReply(reply) && !reply.ok ? reply.why : 'no answer'}`,
      );
    }
    r.rec.frame.box = reply.box;
    r.rec.frame.dpr = reply.dpr;
    r.rec.frame.scale = reply.scale;
    step(r, 'frame', `${reply.box.w} × ${reply.box.h} at DPR ${reply.dpr}, scale ${reply.scale.toFixed(2)}`);

    // The load (content script) and the frame id (webRequest), or a refusal, within FRAME_LOAD_MS.
    let loaded: { readable: boolean; path: string | null } | null = null;
    let timedOut = false;
    const deadline = d.now() + ms(FRAME_LOAD_MS);
    let cursor = mark;
    while (loaded === null || r.rec.frame.id === null) {
      const left = deadline - d.now();
      if (left <= 0) {
        timedOut = true;
        break;
      }
      try {
        const e = await waitFor(r, cursor, left, (x) => x);
        cursor = r.events.indexOf(e, cursor) + 1;
        if (e.type === 'page' && e.msg.type === 'inpage/frame-loaded' && loaded === null) {
          loaded = { readable: e.msg.readable, path: e.msg.path };
          if (e.msg.path !== null) r.rec.frame.paths.push(e.msg.path);
        }
        if (e.type === 'frame' && e.kind === 'settled' && watch.snapshot().error !== null && loaded === null) {
          // A network error (XFO refusal): the error page's own load will come too, but nothing else will.
          const late = await waitFor(r, cursor, ms(2000), (x) =>
            x.type === 'page' && x.msg.type === 'inpage/frame-loaded' ? x.msg : undefined,
          ).catch(() => null);
          loaded = late ? { readable: late.readable, path: late.path } : { readable: false, path: null };
          break;
        }
      } catch (err) {
        if (err instanceof TimedOut) {
          timedOut = true;
          break;
        }
        throw err;
      }
    }
    const snap = watch.snapshot();
    syncFrame(r, snap);
    const facts: FrameLoadFacts = {
      loaded: loaded !== null,
      readable: loaded?.readable ?? false,
      path: loaded?.path ?? null,
      status: snap.status,
      error: snap.error,
      urls: snap.urls,
      timedOut,
    };
    r.rec.frame.loaded = facts.loaded;
    r.rec.frame.readable = facts.readable;
    const v = frameLoadVerdict(facts);
    if (v.kind !== 'ok') throw new Aborted(v as StopVerdict);
    if (r.rec.frame.id === null) stopWith('FRAME_REFUSED', 'no frame id from webRequest');
    r.loadedReadable = true;
    step(r, 'frame loaded', `${facts.path ?? '?'}, HTTP ${snap.status ?? '?'}, XFO seen ${snap.xfoSeen ?? 'none'}`);
  }

  function syncFrame(r: Run, snap: FrameWatchSnapshot) {
    r.rec.frame.id = snap.frameId;
    r.rec.frame.urls = snap.urls.map(pathOf);
    r.rec.frame.status = snap.status;
    r.rec.frame.xfoSeen = snap.xfoSeen;
    r.rec.frame.error = snap.error;
    r.rec.frame.otherSubFrames = snap.otherSubFrames;
  }

  async function inject(r: Run): Promise<void> {
    const frameId = r.rec.frame.id as number;
    r.rec.orientation = await d.scripting.injectPortraitShim(r.rec.tabId, true, frameId);
    const { documentId } = await d.scripting.injectComposerAgent(r.rec.tabId, frameId);
    r.rec.frame.documentId = documentId ?? null;
    step(r, 'agent', `shim ${r.rec.orientation.shim}, screen ${r.rec.orientation.type ?? '?'}`);
  }

  async function probe(r: Run, limit: number): Promise<ProbeReport> {
    const mark = r.events.length;
    await sendAgent(r, { type: 'agent/probe' });
    const p = await waitFor(r, mark, limit, agentReport);
    const o = r.rec.orientation;
    return o ? { ...p, orientation: { type: o.type, shim: o.shim } } : p;
  }

  async function probeAndDecide(r: Run): Promise<ProbeReport> {
    r.phase = 'probing';
    let p = await probe(r, ms(HOME_READY_MS));
    let wantInput = r.rec.mode !== 'check' && p.storyInput === 'absent';
    let wantAccount = !isValidHandle(p.account?.handle ?? null);
    if (wantInput || wantAccount) {
      // P5: msite mounts its header and navigation after hydration: one wait for the watch, then probe again.
      // The wait ends only when everything still missing has appeared (an account alone must not end it).
      const mark = r.events.length;
      await sendAgent(r, { type: 'agent/watch' });
      await waitFor(r, mark, ms(INPUT_WAIT_MS), (e) => {
        if (e.type !== 'agent' || e.msg.type !== 'agent/event') return undefined;
        if (e.msg.event === 'input-appeared') wantInput = false;
        if (e.msg.event === 'account-appeared') wantAccount = false;
        return wantInput || wantAccount ? undefined : true;
      }).catch((err: unknown) => {
        if (!(err instanceof TimedOut)) throw err;
      });
      p = await probe(r, ms(HOME_READY_MS));
    }
    r.rec.probe = p;
    const frameUrl = r.rec.frame.urls.at(-1);
    const ev = evaluateProbe({
      probe: p,
      guarded: d.guarded === true,
      mode: r.rec.mode,
      url: frameUrl?.startsWith('/') ? `https://www.instagram.com${frameUrl}` : undefined,
      // The frame's size is instapost's choice: there is no window to refit.
      refitUsed: true,
      strict: false,
    });
    const dec = ev.decision;
    step(
      r,
      'probe',
      `is_mobile ${String(p.isMobile)}, viewport ${p.inner.w}×${p.inner.h} @${p.dpr}, input ${p.storyInput}, account ${p.account?.handle ?? '?'}, sw ${p.swControlled === true ? 'controls' : 'none'}`,
    );
    if (dec.kind === 'fail' && dec.code !== 'INPUT_MISSING') stopWith(dec.code, `probe: ${dec.code}`);
    // C15 (live 2026-10-14): a framed document Instagram refuses comes back as its "Sorry, this page isn't
    // available" page, msite's shell (logged in, mobile, HTTP 200 as far as the fake knows) with no header and
    // no navigation. After the one wait, neither the story input nor the account link: that is not msite's home,
    // whatever the mode, so the frame was refused (structural, no text read). Without rule 1021 this is what
    // every run gets (E62).
    if (p.storyInput === 'absent' && !isValidHandle(p.account?.handle ?? null)) {
      stopWith('FRAME_REFUSED', 'page unavailable: no header and no account link in the frame');
    }
    if (dec.kind === 'fail') stopWith(dec.code, `probe: ${dec.code}`);
    if (dec.kind === 'refit') stopWith('LAYOUT_TOO_WIDE', 'refit asked in a frame');
    return p;
  }

  async function account(r: Run, p: ProbeReport): Promise<void> {
    const settings = await d.local.settings();
    const detected = isValidHandle(p.account?.handle ?? null) ? (p.account?.handle as string) : null;
    const expected = settings.expectedAccount?.handle ?? null;
    const decision = accountDecision(expected, detected, settings.accountLock, r.rec.mode);
    r.rec.account = { detected, expected, decision };
    step(r, 'account', `${detected ? `@${detected}` : 'unreadable'} (${decision})`);
    if (decision === 'learn' && detected) await d.local.setExpectedAccount({ handle: detected, detectedAt: d.now() });
    if (r.rec.mode === 'check') return;
    // No account prompt in-page yet: anything the window lane would ask about stops the run (no tap yet).
    if (decision !== 'ok' && decision !== 'learn' && decision !== 'unlocked') {
      stopWith(
        'ACCOUNT_UNCONFIRMED',
        `account ${decision}: logged in as ${detected ? `@${detected}` : 'unreadable'}, expected ${expected ? `@${expected}` : 'none yet'}`,
      );
    }
  }

  async function entryStep(r: Run): Promise<void> {
    r.phase = 'openingEntry';
    await dwell(r, 'entry');
    const fp = await d.local.fingerprint().catch(() => null);
    const mark = r.events.length;
    const t0 = d.now();
    await sendAgent(r, { type: 'agent/drive', step: 'open-entry', fingerprint: fp });
    const f = await waitFor(r, mark, ms(ENTRY_BUDGET_MS), agentFact(['entry'] as const));
    const { kind: _k, ...facts } = f;
    r.rec.entry = facts;
    step(
      r,
      'story entry',
      `${f.result} in ${d.now() - t0} ms (menu ${f.menuCount ?? '?'}, item ${f.storyIndex ?? '?'}, trials ${f.trials})`,
    );
    if (f.result !== 'armed') {
      const code =
        f.result === 'ACTIVATION_ACTIVE'
          ? 'PAGE_IN_USE'
          : f.result === 'HIDDEN'
            ? 'TAB_HIDDEN'
            : f.result === 'SESSION_NOT_STARTED'
              ? 'LANDSCAPE'
              : 'STORY_ENTRY_MISSING';
      stopWith(code, `entry ${f.result}`);
    }
    if (f.storyIndex !== null && f.glyph !== null && f.menuCount !== null) {
      if (fp === null || fp.storyIndex !== f.storyIndex || fp.glyph !== f.glyph || fp.count !== f.menuCount) {
        await d.local.storeFingerprint({
          count: f.menuCount,
          storyIndex: f.storyIndex,
          glyph: f.glyph,
          savedAt: d.now(),
        });
      }
    }
  }

  async function insertAndCompose(r: Run): Promise<void> {
    r.phase = 'inserting';
    await dwell(r, 'insert');
    let mark = r.events.length;
    await sendAgent(r, { type: 'agent/drive', step: 'insert' });
    const ins = await waitFor(r, mark, ms(INSERT_BUDGET_MS), agentFact(['inserted', 'insert-failed'] as const));
    if (ins.kind === 'insert-failed') stopWith('INJECTION_IGNORED', `insert ${ins.why}`);
    step(r, 'inserted');
    mark = r.events.length;
    await sendAgent(r, { type: 'agent/drive', step: 'compose', sample: r.photo?.sample ?? null });
    const c = await waitFor(r, mark, ms(INSERT_BUDGET_MS), agentFact(['compose'] as const));
    const { kind: _k, ...facts } = c;
    r.rec.compose = facts;
    step(
      r,
      'composer',
      `drawn ${String(c.drawn)}, share controls ${c.controls} (${c.variant ?? '-'}), canvas ${c.canvas ? `${c.canvas.w}×${c.canvas.h}` : '?'}, settled ${c.settleMs} ms`,
    );
    if (!c.onComposer || !c.drawn) stopWith('INJECTION_IGNORED', 'composer not drawn');
    if (c.landscape) stopWith('SCREEN_LANDSCAPE', 'rotate snackbar shown');
    if (composerMayReadLandscape(r.rec.orientation, 'https://www.instagram.com/create/story/')) {
      stopWith('SCREEN_LANDSCAPE', `screen ${r.rec.orientation?.type ?? '?'}`);
    }
    if (c.controls !== 1) stopWith('SHARE_MISSING', `${c.controls} Share controls`);
    r.phase = 'composeReady';
    r.rec.readyProbe = await probe(r, ms(READY_PROBE_MS)).catch((err: unknown) => {
      if (err instanceof TimedOut) return null;
      throw err;
    });
  }

  type ShareEnd =
    | StopVerdict
    | 'shareTested'
    | { kind: 'posted'; detail: string }
    | { kind: 'notPosted'; detail: string };

  /** The agent's resource entries after Share, raw (decide() classifies them), and the record's copy. */
  function netEntries(r: Run, from: number): { raw: NetEntry[]; next: number } {
    let cursor = from;
    for (; cursor < r.events.length; cursor++) {
      const e = r.events[cursor];
      if (e?.type === 'agent' && e.msg.type === 'agent/fact' && e.msg.fact.kind === 'net') {
        for (const n of e.msg.fact.entries) {
          if (r.rec.net.length < 64) r.rec.net.push({ ...n, path: normalizePath(n.path) });
        }
      }
    }
    const raw = r.events.flatMap((e) =>
      e.type === 'agent' && e.msg.type === 'agent/fact' && e.msg.fact.kind === 'net' ? e.msg.fact.entries : [],
    );
    return { raw, next: cursor };
  }

  /**
   * The run's session rules as they are now: every rule it installed is still there (1001, 1020, 1021 and, for
   * a test, the write block for its tab); a post has no write block left. Null when they are, else what is
   * wrong. RS-1: anything else may remove session rules (the window lane's cleanup did, on any tab closing).
   */
  async function rulesProblem(r: Run): Promise<string | null> {
    const rules = await d.dnr.getSessionRules();
    const gone = r.rec.rules.installed.filter((id) => !rules.some((x) => x.id === id));
    if (gone.length > 0) return `session rules gone: ${gone.join(', ')}`;
    if (r.rec.writeBlocked) return testRulesInstalled(rules, r.rec.tabId) ? null : 'write-block rules not installed';
    const blocking = rules.filter((x) => x.id >= REHEARSAL_FIRST_ID && x.id <= REHEARSAL_LAST_ID);
    return blocking.length > 0 ? `write-block rules still installed (${blocking.length})` : null;
  }

  /**
   * Share once (IR11): the command goes out from here only, once per run, after the composer is ready and the
   * account was not refused; a test verifies its write block first, a post verifies that none is left, and
   * both again right before the command (after the dwell). The outcome is decide()'s (outcome.ts), never a
   * retry; a test whose write block goes away while deciding is a leak (kill and lock: the story may be live).
   */
  async function shareStep(r: Run): Promise<ShareEnd> {
    const before = await rulesProblem(r);
    if (before !== null) stopWith('AGENT_UNREACHABLE', before);
    step(r, r.rec.writeBlocked ? 'write block verified' : 'writes open');
    if (r.rec.share !== null) stopWith('SHARE_MISSING', 'share already sent in this run');
    await dwell(r, 'share');
    // RS-1: the dwell takes seconds; the rules are read again at the last moment before Share.
    const last = await rulesProblem(r);
    if (last !== null) stopWith('AGENT_UNREACHABLE', `${last} (before Share)`);
    await sendPage(r, { v: 1, type: 'inpage/unload-guard', runId: r.rec.runId, on: true }).catch(() => undefined);
    r.phase = 'sharing';
    r.rec.share = { sent: true, done: false, refused: null, decision: null };
    // RS-3: a worker that dies from here on loses a run that may have posted; its successor says so.
    await saveInflight(r);
    const mark = r.events.length;
    await sendAgent(r, { type: 'agent/drive', step: 'share' });
    step(r, 'share sent');
    const ack = await waitFor(r, mark, ms(SHARE_ACK_MS), agentFact(['share-done', 'share-refused'] as const)).catch(
      (err: unknown) => {
        // Share went out and nothing answered: it may have been pressed. Never "nothing was posted" here.
        if (err instanceof TimedOut && !r.rec.writeBlocked) return null;
        throw err;
      },
    );
    if (ack === null) {
      r.rec.share.decision = 'unknown share-not-acknowledged';
      return { kind: 'stop', code: 'OUTCOME_UNKNOWN', detail: 'share-not-acknowledged' };
    }
    if (ack.kind === 'share-refused') {
      r.rec.share.refused = ack.why;
      stopWith(
        ack.why === 'activation' ? 'PAGE_IN_USE' : ack.why === 'hidden' ? 'TAB_HIDDEN' : 'SHARE_MISSING',
        `share refused: ${ack.why}`,
      );
    }
    r.rec.share.done = true;
    r.phase = 'confirmingUpload';
    const t0 = d.now();
    step(r, 'shared');
    const budgets: OutcomeBudgets = {
      uploadEntryMs: ms(UPLOAD_ENTRY_BUDGET_MS),
      publishAfterUploadMs: ms(PUBLISH_AFTER_UPLOAD_MS),
      settleMs: ms(UPLOAD_SETTLE_MS),
    };
    let cursor = r.events.length;
    for (;;) {
      await pause(r, ms(DECIDE_TICK_MS));
      // A test's write block gone while its upload may still run: the story may go live. End now (the frame
      // goes at once) and treat it as the leak it may be.
      if (r.rec.writeBlocked && !testRulesInstalled(await d.dnr.getSessionRules(), r.rec.tabId)) {
        r.rec.share.decision = 'testLeak write block removed after Share';
        step(r, 'decided', r.rec.share.decision);
        return { kind: 'kill', code: 'TEST_LEAK', detail: 'write block removed after Share' };
      }
      const net = netEntries(r, cursor);
      cursor = net.next;
      const dec = decide(net.raw, d.now() - t0, r.rec.writeBlocked, budgets);
      if (dec.kind === 'pending') continue;
      r.rec.share.decision = `${dec.kind}${'detail' in dec ? ` ${dec.detail}` : ''}`;
      step(r, 'decided', r.rec.share.decision);
      switch (dec.kind) {
        case 'shareTested':
          return 'shareTested';
        case 'testLeak':
          return { kind: 'kill', code: 'TEST_LEAK', detail: dec.detail };
        case 'posted':
        case 'notPosted':
          return { kind: dec.kind, detail: dec.detail };
        case 'unknown': {
          // No hold once the page showed a security check (RL-1): the run ends and locks.
          if (!dec.mayRun || r.rec.writeBlocked || r.pageKill) {
            return { kind: 'stop', code: 'OUTCOME_UNKNOWN', detail: dec.why };
          }
          // §6.4, bounded: an upload may still run; keep the frame a little for a late answer, never retry.
          step(r, 'holding', `${dec.why}; up to ${Math.round(LATE_HOLD_MS / 1000)} s for a late answer`);
          const until = d.now() + ms(LATE_HOLD_MS);
          while (d.now() < until && !r.pageKill) {
            await pause(r, ms(DECIDE_TICK_MS));
            const late = netEntries(r, cursor);
            cursor = late.next;
            const up = decideLate(late.raw, budgets);
            if (up) {
              r.rec.share.late = true;
              r.rec.share.decision = `${up.kind} ${up.detail} (late)`;
              step(r, 'decided late', r.rec.share.decision);
              return { kind: up.kind, detail: up.detail };
            }
          }
          return { kind: 'stop', code: 'OUTCOME_UNKNOWN', detail: dec.why };
        }
      }
    }
  }

  async function teardown(r: Run): Promise<void> {
    watch.disarm();
    await sendPage(r, { v: 1, type: 'inpage/unload-guard', runId: r.rec.runId, on: false }).catch(() => undefined);
    await sendPage(r, { v: 1, type: 'inpage/remove-frame', runId: r.rec.runId }).catch(() => undefined);
    // Close first, then remove the rules (as the window lane does).
    await d.dnr.updateSessionRules({ removeRuleIds: [...SESSION_RULE_IDS] }).catch((err: unknown) => {
      log.warn('inpage: cannot remove the session rules', err);
    });
    const after = await d.dnr.getSessionRules().catch(() => null);
    r.rec.rules.after = after ? after.map((x) => x.id).filter((id) => SESSION_RULE_IDS.includes(id)) : null;
    void sendPage(r, { v: 1, type: 'inpage/run-state', running: false }).catch(() => undefined);
  }

  async function execute(r: Run): Promise<void> {
    let outcome: InpageOutcome = 'stopped';
    let verdict: StopVerdict | null = null;
    await saveInflight(r);
    try {
      await openFrame(r);
      await inject(r);
      const p = await probeAndDecide(r);
      await account(r, p);
      if (r.rec.mode === 'check') {
        outcome = 'checked';
      } else {
        await entryStep(r);
        await insertAndCompose(r);
        if (r.rec.mode === 'test') {
          outcome = 'tested';
        } else {
          const s = await shareStep(r);
          if (s === 'shareTested') outcome = 'shareTested';
          else if (s.kind === 'posted') {
            outcome = 'posted';
            r.rec.detail = s.detail;
          } else if (s.kind === 'notPosted') {
            outcome = 'notPosted';
            r.rec.code = 'UPLOAD_FAILED';
            r.rec.detail = s.detail;
          } else verdict = s;
        }
      }
    } catch (err) {
      if (err instanceof Aborted) verdict = err.verdict;
      else if (r.abort) verdict = r.abort;
      else if (err instanceof TimedOut)
        verdict = { kind: 'stop', code: 'TIMEOUT', detail: `timed out at ${r.rec.steps.at(-1)?.step ?? 'start'}` };
      else
        verdict = {
          kind: 'stop',
          code: 'AGENT_UNREACHABLE',
          detail: (err instanceof Error ? err.message : String(err)).slice(0, 160),
        };
    }
    // §7.5: on Posted the phone stays on Instagram's home briefly (its own success toast). RS-6: before the lock
    // is weighed, with the kill switch still listening (r.closing stays false), so a security page in the page
    // or the frame during these seconds still locks.
    if (outcome === 'posted' && !verdict) await new Promise((resolve) => setTimeout(resolve, ms(POSTED_LINGER_MS)));
    if (r.abort && !verdict && outcome !== 'posted' && outcome !== 'notPosted') verdict = r.abort;
    // The kill switch locks whatever is reported: a kill that stopped the run, a security page the desktop page
    // showed after a post's Share (deferred, RL-1), or a kill that came after Instagram had already answered (a
    // posted or not-posted story keeps its outcome, and the lane still locks: RS-6).
    const lockBy = verdict?.kind === 'kill' ? verdict : (r.pageKill ?? (r.abort?.kind === 'kill' ? r.abort : null));
    // A post whose Share went out may have posted: whatever stopped it afterwards, a kill included (RS-2), is a
    // Couldn't confirm that keeps the kill's lock, never "not posted" (ux.md §5).
    if (verdict && verdict.code !== 'OUTCOME_UNKNOWN' && shareMayHavePosted(r)) {
      verdict = { kind: 'stop', code: 'OUTCOME_UNKNOWN', detail: `${verdict.code}: ${verdict.detail}` };
    }
    if (verdict) {
      outcome = verdict.kind === 'kill' ? 'killed' : verdict.code === 'OUTCOME_UNKNOWN' ? 'unknown' : 'stopped';
      r.rec.code = verdict.code;
      r.rec.detail = verdict.detail;
    }
    const reason = lockBy ? LOCK_REASON[lockBy.code] : undefined;
    if (reason) {
      const now = d.now();
      await d.local
        .lockMsite(now + MSITE_LOCK_MS, reason, now)
        .catch((e: unknown) => log.warn('inpage: lock failed', e));
      r.rec.locked = reason;
    }
    r.rec.outcome = outcome;
    r.closing = true;
    step(r, 'closing', outcome + (verdict ? ` ${verdict.code}` : ''));
    await teardown(r);
    syncFrame(r, watch.snapshot());
    r.rec.endedAt = d.now();
    step(
      r,
      'done',
      r.rec.rules.after && r.rec.rules.after.length === 0
        ? 'rules after: none'
        : `rules after: ${String(r.rec.rules.after)}`,
    );
    await d.saveRecord(structuredClone(r.rec)).catch((e: unknown) => log.warn('inpage: record not saved', e));
    await d.inflight?.clear(r.rec.runId).catch((e: unknown) => log.warn('inpage: in-flight marker not cleared', e));
  }

  /** RS-3: the run as it stands, for a worker that has to report it after this one died. */
  async function saveInflight(r: Run): Promise<void> {
    await d.inflight?.save(structuredClone(r.rec)).catch((e: unknown) => log.warn('inpage: in-flight marker', e));
  }

  /** A post's Share command went out and the agent did not refuse it. */
  function shareMayHavePosted(r: Run): boolean {
    return !r.rec.writeBlocked && r.rec.share !== null && r.rec.share.sent && r.rec.share.refused === null;
  }

  // ---- inputs ----------------------------------------------------------------------------------------------

  function agentSession(r: Run): ActiveAgentSession | null {
    if (r.rec.frame.id === null) return null;
    return {
      runtimeId: d.runtimeId,
      tabId: r.rec.tabId,
      frameId: r.rec.frame.id,
      ...(r.rec.frame.documentId ? { documentId: r.rec.frame.documentId } : {}),
      handoffId: r.rec.runId,
      nonce: r.nonce,
      phase: r.phase,
    };
  }

  return {
    async start(req) {
      if (d.guarded && d.brandedBrowser) return { ok: false, why: 'BRANDED_BROWSER' };
      if (run !== null || starting || d.windowLaneBusy()) return { ok: false, why: 'BUSY' };
      if (req.mode === 'shareTest' && !req.confirmShare) return { ok: false, why: 'SHARE_NOT_CONFIRMED' };
      if (!(INPAGE_MODES as readonly string[]).includes(req.mode)) return { ok: false, why: 'BUSY' };
      if (!Number.isInteger(req.tabId) || req.tabId < 0) return { ok: false, why: 'NO_TAB' };
      const photo = req.photo ?? null;
      if (photo !== null && !isRunPhoto(photo)) return { ok: false, why: 'NO_PHOTO' };
      // A post uploads the owner's edited story, never a calibration card.
      if (req.mode === 'post' && photo === null) return { ok: false, why: 'NO_PHOTO' };
      starting = true;
      try {
        const now = d.now();
        const settings = await d.local.settings();
        if (settings.msiteLockedUntil !== null && settings.msiteLockedUntil > now) {
          return { ok: false, why: 'PAUSED', freeAt: settings.msiteLockedUntil };
        }
        // RL-1: where the page is now; only a move away from it is read as the page going somewhere.
        const startUrl = await d.tabs.get(req.tabId).then(
          (t) => t.url,
          () => undefined,
        );
        // RS-7: a page already on a security route (a checkpointed account) or a login page gets no run: nothing
        // is installed or opened, and a security route locks as the kill switch would one mid-run. An unreadable
        // URL (tabs.get failed) is not a reason to refuse: the run's own checks still apply.
        const startVerdict = startUrl === undefined ? null : pageUrlVerdict(startUrl);
        if (startVerdict?.kind === 'kill') {
          const reason = LOCK_REASON[startVerdict.code];
          const until = now + MSITE_LOCK_MS;
          if (reason) {
            await d.local.lockMsite(until, reason, now).catch((e: unknown) => log.warn('inpage: lock failed', e));
          }
          log.warn(`inpage: not started, ${startVerdict.detail}`);
          return { ok: false, why: 'PAUSED', freeAt: until };
        }
        if (startVerdict?.kind === 'stop') {
          return { ok: false, why: startVerdict.code === 'NOT_LOGGED_IN' ? 'NOT_LOGGED_IN' : 'NO_TAB' };
        }
        // Posts count toward the caps; checks and test runs only need the spacing.
        const kind = req.mode === 'post' ? 'post' : 'test';
        const rate = await d.local.rate(now, settings, kind);
        if (!rate.ok) return { ok: false, why: 'RATE_LIMITED', freeAt: rate.freeAt };
        await d.local.noteOpen(now, kind);
        const toggles = await d.toggles();
        const startPath = startUrl === undefined ? null : pathOf(startUrl);
        const runId = `inp_${d.uuid()}`;
        const r: Run = {
          rec: {
            marker: INPAGE_DRIVER_MARKER,
            runId,
            mode: req.mode,
            writeBlocked: writeBlockedFor(req.mode),
            photo:
              photo === null
                ? null
                : {
                    source: 'export',
                    mime: photo.mime,
                    bytes: Math.floor((photo.b64.length * 3) / 4),
                    ...(photo.sha256 ? { sha256: photo.sha256 } : {}),
                    ...(photo.docHash ? { docHash: photo.docHash } : {}),
                  },
            toggles,
            startedAt: now,
            endedAt: null,
            outcome: null,
            code: null,
            detail: null,
            locked: null,
            tabId: req.tabId,
            frame: {
              id: null,
              documentId: null,
              box: null,
              dpr: null,
              scale: null,
              loaded: false,
              readable: false,
              urls: [],
              paths: [],
              status: null,
              xfoSeen: null,
              error: null,
              otherSubFrames: 0,
            },
            rules: { installed: [], after: null, ua: toggles.ua },
            orientation: null,
            probe: null,
            readyProbe: null,
            account: { detected: null, expected: null, decision: null },
            entry: null,
            compose: null,
            share: null,
            net: [],
            pageUrls: startPath === null ? [] : [startPath],
            steps: [],
            ...(req.repost && isRepostMeta(req.repost) ? { repost: req.repost } : {}),
          },
          nonce: d.uuid(),
          phase: 'probing',
          events: [],
          waiters: new Set(),
          abort: null,
          closing: false,
          loadedReadable: false,
          fileServed: false,
          photo,
          done: Promise.resolve(),
          pagePath: startPath,
          pageKill: null,
        };
        run = r;
        step(r, 'start', `${req.mode}, ${toggles.ua}, frame ${toggles.frame}, view ${toggles.view}`);
        const awake = setInterval(() => d.keepAlive?.(), 10_000);
        r.done = execute(r)
          .catch((err: unknown) => log.warn('inpage: run failed', err))
          .finally(() => {
            clearInterval(awake);
            last = r.rec;
            if (run === r) run = null;
            push();
          });
        return { ok: true, runId };
      } finally {
        starting = false;
      }
    },
    stop() {
      // After a post's Share, removing the frame could cut the upload short: the run decides by itself.
      if (run && !shareMayHavePosted(run)) abort(run, { kind: 'stop', code: 'STOPPED', detail: 'stopped by you' });
    },
    busy: () => run !== null || starting,
    status,
    subscribe(listener) {
      listeners.add(listener);
      listener(status());
      return () => listeners.delete(listener);
    },
    agentMessage(raw, sender) {
      const r = run;
      if (!r || sender.tab?.id !== r.rec.tabId || sender.frameId === 0 || r.rec.frame.id === null) return null;
      const v = acceptAgentMessage(raw, sender, agentSession(r));
      if (!v.ok) {
        log.warn(
          `inpage: agent message dropped (${v.reason}); url ${sender.url?.split(/[?#]/)[0] ?? 'none'}, origin ${sender.origin ?? 'none'}, frame ${sender.frameId ?? '?'}`,
        );
        return Promise.resolve({ ok: false });
      }
      const msg = v.msg;
      if (msg.type === 'agent/get-file') {
        if (r.fileServed || r.phase !== 'inserting') return Promise.resolve({ ok: false });
        r.fileServed = true;
        const p = r.photo;
        if (p) {
          return Promise.resolve({
            ok: true as const,
            name: p.mime === 'image/png' ? 'story.png' : 'story.jpg',
            mime: p.mime,
            b64: p.b64,
          });
        }
        if (r.rec.mode === 'post') return Promise.resolve({ ok: false });
        return d.calibration().then(
          (f) => {
            r.rec.photo = { source: 'calibration', mime: f.mime, bytes: f.bytes.length };
            return {
              ok: true as const,
              name: f.mime === 'image/png' ? 'story.png' : 'story.jpg',
              mime: f.mime,
              b64: bytesToB64(f.bytes),
            };
          },
          () => ({ ok: false as const }),
        );
      }
      deliver(r, { type: 'agent', msg });
      return Promise.resolve({ ok: true });
    },
    pageMessage(raw, sender) {
      const r = run;
      const v = acceptPageMessage(raw, sender, d.runtimeId, r ? { tabId: r.rec.tabId, runId: r.rec.runId } : null);
      if (!v.ok || !r) return;
      const msg = v.msg;
      if (msg.type === 'inpage/frame-path') {
        if (!msg.readable) {
          if (r.loadedReadable) abort(r, { kind: 'kill', code: 'KILLED_OFFHOST', detail: 'the frame left Instagram' });
        } else if (msg.path !== null) {
          const p = msg.path;
          if (r.rec.frame.paths.at(-1) !== p && r.rec.frame.paths.length < 20) r.rec.frame.paths.push(p);
          const fv = framePathVerdict(p);
          if (fv.kind !== 'ok' && r.loadedReadable) abort(r, fv);
        }
      }
      deliver(r, { type: 'page', msg });
    },
    pagePortClosed(tabId) {
      const r = run;
      if (!r || r.rec.tabId !== tabId || r.closing) return;
      setTimeout(() => {
        if (run !== r || r.abort || r.closing) return;
        d.tabs
          .get(tabId)
          .then((t) => pageUrlVerdict(t.url))
          .catch(() => null)
          .then((v) => {
            if (run !== r || r.abort || r.closing) return;
            abort(
              r,
              v && v.kind !== 'ok'
                ? v
                : { kind: 'stop', code: 'PAGE_LEFT', detail: 'the Instagram page reloaded or closed' },
            );
          });
      }, ms(PAGE_LEFT_GRACE_MS));
    },
    frameRequest(e) {
      const r = run;
      if (!r) return;
      const u = watch.onEvent(e);
      if (!u) return;
      if (u.kind === 'frame-id') {
        r.rec.frame.id = u.frameId;
        deliver(r, { type: 'frame', kind: 'frame-id' });
      } else if (u.kind === 'settled') {
        syncFrame(r, watch.snapshot());
        deliver(r, { type: 'frame', kind: 'settled' });
      } else {
        syncFrame(r, watch.snapshot());
        // Only once the frame was open: before that, frameLoadVerdict reads the same URLs in its own order.
        if (r.loadedReadable) {
          const fv = frameUrlVerdict(u.url);
          if (fv.kind !== 'ok') abort(r, fv);
        }
      }
    },
    tabUpdated(tabId, url) {
      const r = run;
      if (!r || r.rec.tabId !== tabId || url === undefined || r.closing) return;
      // RL-1: tabs.onUpdated repeats the URL for every title, status or favicon change: only a move counts (a
      // run started on a Settings page is not the page going there).
      const p = pathOf(url);
      if (p === r.pagePath) return;
      r.pagePath = p;
      if (r.rec.pageUrls.length < 20) r.rec.pageUrls.push(p);
      const v = pageUrlVerdict(url);
      if (!v || v.kind === 'ok') return;
      if (v.kind === 'kill' && shareMayHavePosted(r)) {
        // After a post's Share the frame may still be uploading: the page's own route never removes it. The run
        // decides, then locks (execute).
        if (!r.pageKill) {
          r.pageKill = v;
          step(r, 'page check', v.detail);
        }
        return;
      }
      abort(r, v);
    },
    tabRemoved(tabId) {
      const r = run;
      if (r && r.rec.tabId === tabId)
        abort(r, { kind: 'stop', code: 'PAGE_LEFT', detail: 'the Instagram tab was closed' });
    },
    idle: async () => {
      while (run) await run.done;
    },
    adopt(rec) {
      if (run !== null || starting) return;
      last = rec;
      push();
    },
  };
}

/** RS-3: the in-flight marker's key in storage.local. */
export const INFLIGHT_KEY = 'inpageInflight';
/** RS-3: the detail (and Couldn't confirm's `{why}`) of a run a previous worker lost. */
export const RESTARTED_DETAIL = 'worker-restarted';

/** RS-3 (FX14): what a run lost with its worker becomes: Couldn't confirm once Share went out, else Stopped. */
export function restartedRecord(snapshot: InpageRecord, now: number): InpageRecord {
  const shared = snapshot.share?.sent === true && snapshot.share.refused === null;
  return {
    ...snapshot,
    endedAt: now,
    outcome: shared ? 'unknown' : 'stopped',
    code: shared ? 'OUTCOME_UNKNOWN' : 'STOPPED',
    detail: RESTARTED_DETAIL,
    locked: null,
    rules: { ...snapshot.rules, after: null },
    steps: [
      ...snapshot.steps,
      { step: 'restarted', t: Math.max(0, now - snapshot.startedAt), detail: 'the extension restarted mid-run' },
    ],
    restarted: true,
  };
}

/** A stored in-flight marker, if it is one (storage is data from an earlier worker). */
export function isInflightRecord(x: unknown): x is InpageRecord {
  const r = x as Partial<InpageRecord> | null;
  return (
    typeof r === 'object' &&
    r !== null &&
    // The marker's prefix, not the marker: check-bundle T3 counts the full marker once in background.js.
    typeof r.marker === 'string' &&
    r.marker.startsWith('instapost-inpage:') &&
    typeof r.runId === 'string' &&
    typeof r.tabId === 'number' &&
    typeof r.startedAt === 'number' &&
    (INPAGE_MODES as readonly unknown[]).includes(r.mode) &&
    Array.isArray(r.steps) &&
    typeof r.account === 'object' &&
    r.account !== null
  );
}

/** Kept for the record's readers: which entries were writes (the share test's evidence). */
export const isWriteEntry = (e: NetEntry): boolean => classifyEntry(e) !== 'other';
