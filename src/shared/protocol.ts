/**
 * Every message between editor, background and composer agent (strategy §3.5, ux.md IP1–IP4). JSON
 * discriminated unions with `v: 1`. The envelope stays v1 because editor, background and agent ship
 * together; the breaking change lives in the state contract (state.ts v7).
 *
 * The canonical payload types live in src/core (ProbeReport in ig-contract/contract.ts, the hand-off
 * vocabulary in handoff/state.ts) so the pure reducer can use them; this module re-exports them and adds
 * the envelopes, guards and the agent acceptance check. Agent payloads are untrusted data from a page's
 * world (the agent runs beside Instagram's scripts): every one is checked against bounds and copied with
 * only the known fields.
 */
import type { ScreenAvail } from '../core/geometry/window-fit.ts';
import {
  type AgentCommand,
  type AgentEventName,
  type AgentFact,
  type AgentFactKind,
  ALARMS,
  ENTRY_RESULTS,
  ERROR_CODES,
  type ErrorCode,
  type HandoffMode,
  type HandoffPhase,
  type HandoffStatus,
  INSERT_FAILURES,
  type Lane,
  MAX_NET_ENTRIES,
  MAX_WINDOW_UPDATES,
  type MenuFingerprint,
  type NetEntry,
  RESULT_KINDS,
  type RunResult,
  type SessionPhase,
  SHARE_REFUSALS,
  UNKNOWN_WHYS,
  type WindowDiagnostics,
} from '../core/handoff/state.ts';
import { BROWSER_FLAVOURS, type BrowserFlavour } from '../core/ig-contract/browser-flavour.ts';
import {
  NAV_TYPES,
  ORIENTATION_SHIM_STATES,
  type PageOrientation,
  type ProbeReport,
} from '../core/ig-contract/contract.ts';
import { IG_ORIGIN } from '../core/ig-contract/urls.ts';
import type { ExportId, HandoffId, Nonce } from '../core/model/ids.ts';

export { b64ToBytes, bytesToB64 } from './b64.ts';
export type {
  AgentEventName,
  AgentFact,
  BrowserFlavour,
  ErrorCode,
  HandoffMode,
  HandoffPhase,
  HandoffStatus,
  Lane,
  NetEntry,
  PageOrientation,
  ProbeReport,
  RunResult,
  ScreenAvail,
  SessionPhase,
};

export const PROTOCOL_VERSION = 1;
/** runtime.connect({name}) used by the editor for the hand-off port. */
export const HANDOFF_PORT = 'handoff';

export const HANDOFF_MODES = ['post', 'test', 'shareTest', 'check'] as const satisfies readonly HandoffMode[];

// ---- Editor → background (port) -----------------------------------------------------

export interface HandoffStartMsg {
  v: 1;
  type: 'handoff/start';
  /** null for mode 'check' (no file). */
  exportId: ExportId | null;
  mode: HandoffMode;
  screen: ScreenAvail;
  /** P6: the browser the editor detected (src/ui/browser-flavour.ts). */
  browser: BrowserFlavour;
  /** K10/K11: wait for the 60 s spacing instead of refusing. */
  queue: boolean;
  /** IA7: the export's 16×16 RGBA sample, base64 (diagnostic image check). */
  exportSample?: string;
  /** The duplicate guard (K8/K12) keys records by these. */
  exportSha256?: string;
  docHash?: string;
}
/** Stop (Esc). Honoured before the Share command only. */
export interface HandoffCancelMsg {
  v: 1;
  type: 'handoff/cancel';
}
/** ux.md §4.8: the owner's answer to the account prompt. */
export interface HandoffAccountChoiceMsg {
  v: 1;
  type: 'handoff/account-choice';
  handoffId: HandoffId;
  proceed: boolean;
}
/** ux.md §4.9: Finish by hand. */
export interface HandoffManualMsg {
  v: 1;
  type: 'handoff/manual';
  handoffId: HandoffId;
}
/** ux.md §4.7/§4.11: "It posted" / "It didn't post" on a Couldn't confirm record. */
export interface HandoffMarkMsg {
  v: 1;
  type: 'handoff/mark';
  handoffId: HandoffId;
  posted: boolean;
}
/**
 * Resume (§4.10, AM25). Only the background writes the kill-switch lock; it clears it in its own queue, and
 * only when the stored lock is no later than `lockedUntil`, the lock the editor showed.
 */
export interface HandoffEnableMsiteMsg {
  v: 1;
  type: 'handoff/enable-msite';
  lockedUntil: number | null;
}
/**
 * ux.md §8: links to Instagram (Open instagram.com, View story, Check my story) open in a normal tab from
 * the background, which validates the handle; the editor bundle holds no Meta-host URL (T3).
 */
export interface UiOpenInstagramMsg {
  v: 1;
  type: 'ui/open-instagram';
  page: 'home' | 'story';
  handle?: string;
}
/** Settings → Forget this account (the key is the background's). */
export interface UiForgetAccountMsg {
  v: 1;
  type: 'ui/forget-account';
}
/**
 * AP-4: a check found Instagram logged in as another account than posts are locked to: make that one the
 * expected account. The background takes the handle from its own `lastResult` for this check, never from
 * the message.
 */
export interface UiUseAccountMsg {
  v: 1;
  type: 'ui/use-account';
  handoffId: HandoffId;
}
/** The editor showed this result: the toolbar badge may clear. */
export interface UiResultSeenMsg {
  v: 1;
  type: 'ui/result-seen';
  handoffId: HandoffId;
}
export type EditorToBackground =
  | HandoffStartMsg
  | HandoffCancelMsg
  | HandoffAccountChoiceMsg
  | HandoffManualMsg
  | HandoffMarkMsg
  | HandoffEnableMsiteMsg
  | UiOpenInstagramMsg
  | UiForgetAccountMsg
  | UiUseAccountMsg
  | UiResultSeenMsg;

// ---- Background → editor (port) -----------------------------------------------------

export type HandoffStatusMsg = { v: 1; type: 'handoff/status' } & HandoffStatus;
export type HandoffLaneMsg = { v: 1; type: 'handoff/lane' } & Lane;
export type BackgroundToEditor = HandoffStatusMsg | HandoffLaneMsg;

// ---- Background → agent (tabs.sendMessage(tabId, msg, {frameId: 0})) ----------------

interface AgentAddress {
  handoffId: HandoffId;
  nonce: Nonce;
}
export type AgentProbeMsg = { v: 1; type: 'agent/probe' } & AgentAddress;
export type AgentWatchMsg = { v: 1; type: 'agent/watch' } & AgentAddress;
export type AgentDriveMsg = { v: 1 } & Extract<AgentCommand, { type: 'agent/drive' }> & AgentAddress;
export type AgentObserveMsg = { v: 1; type: 'agent/observe'; from: 'manual' } & AgentAddress;
export type BackgroundToAgent = AgentProbeMsg | AgentWatchMsg | AgentDriveMsg | AgentObserveMsg;

// ---- Agent → background (runtime.sendMessage) ---------------------------------------

export type AgentReportMsg = { v: 1; type: 'agent/report'; probe: ProbeReport } & AgentAddress;
/** Answered via sendResponse with GetFileReply. */
export type AgentGetFileMsg = { v: 1; type: 'agent/get-file' } & AgentAddress;
export type AgentEventMsg = { v: 1; type: 'agent/event'; event: AgentEventName } & AgentAddress;
export type AgentFactMsg = { v: 1; type: 'agent/fact'; fact: AgentFact } & AgentAddress;
export type AgentToBackground = AgentReportMsg | AgentGetFileMsg | AgentEventMsg | AgentFactMsg;

export type GetFileReply = { ok: true; name: string; mime: string; b64: string } | { ok: false };

/**
 * Every message in both background ⇄ agent directions is answered, so no sendMessage promise is left to a
 * closed port: the agent acks each valid command at once with `{ok: true}` (results travel separately as
 * agent/report, agent/event and agent/fact); the background answers agent/get-file with GetFileReply and
 * every other agent message with `{ok}` (`false` = dropped).
 */
export interface AgentAck {
  ok: boolean;
}
export type AgentReply = GetFileReply | AgentAck;

// ---- Guards (shape only; they never trust the sender) --------------------------------

/** Every session phase, for runtime checks (the type-level check below keeps it complete). */
export const HANDOFF_PHASES = [
  'idle',
  'queued',
  'opening',
  'scoping',
  'fitting',
  'resizing',
  'navigating',
  'reloading',
  'probing',
  'awaitingAccount',
  'openingEntry',
  'inserting',
  'composeReady',
  'sharing',
  'confirmingUpload',
  'manual',
  'finished',
  'closing',
] as const satisfies readonly SessionPhase[];

export const AGENT_EVENT_NAMES = [
  'input-appeared',
  'account-appeared',
  'sw-controller-change',
  'sw-intercepted',
] as const satisfies readonly AgentEventName[];

export const AGENT_FACT_KINDS = [
  'entry',
  'inserted',
  'insert-failed',
  'compose',
  'share-done',
  'share-refused',
  'net',
  'ui',
  'visibility',
  'owner-share',
] as const satisfies readonly AgentFactKind[];

/** Compile-time completeness: a phase, event or fact added in src/core must be listed here too. */
type Complete<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : never;
const _phasesComplete: Complete<SessionPhase, (typeof HANDOFF_PHASES)[number]> = true;
const _eventsComplete: Complete<AgentEventName, (typeof AGENT_EVENT_NAMES)[number]> = true;
const _factsComplete: Complete<AgentFactKind, (typeof AGENT_FACT_KINDS)[number]> = true;
const _modesComplete: Complete<HandoffMode, (typeof HANDOFF_MODES)[number]> = true;
void [_phasesComplete, _eventsComplete, _factsComplete, _modesComplete];

/** Caps on page-derived strings carried in a ProbeReport (they end up in IndexedDB records). */
export const PROBE_LIMITS = { lang: 64, acceptEntries: 32, acceptLength: 512, orientationType: 32 } as const;
/** Caps on agent facts (ux.md IP3). */
export const FACT_LIMITS = { entries: MAX_NET_ENTRIES, path: 200, type: 64, glyph: 32, ms: 86_400_000 } as const;
/** Cap on the composer path a status carries (U1). */
export const MAX_PATH_LENGTH = 512;
/** Ids and nonces are `<prefix>_<uuid>` or a uuid; anything longer is not ours. */
const MAX_ID_LENGTH = 128;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isStr =
  (max: number) =>
  (x: unknown): x is string =>
    typeof x === 'string' && x.length <= max;
const isId = (x: unknown): x is string => typeof x === 'string' && x !== '' && x.length <= MAX_ID_LENGTH;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => list.includes(x as T);
const isSize = (x: unknown): x is { w: number; h: number } => isObj(x) && isNum(x.w) && isNum(x.h);
const isRect = (x: unknown): boolean => isSize(x) && isNum((x as Obj).x) && isNum((x as Obj).y);
const isBox = (x: unknown): boolean => isObj(x) && isNum(x.left) && isNum(x.top) && isNum(x.width) && isNum(x.height);
const orNull = (ok: (y: unknown) => boolean) => (y: unknown) => y === null || ok(y);
const isInt =
  (min: number, max: number) =>
  (x: unknown): x is number =>
    typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;
const v1 = (x: unknown): x is Obj => isObj(x) && x.v === PROTOCOL_VERSION && typeof x.type === 'string';
const optional = (o: Obj, key: string, ok: (y: unknown) => boolean): boolean => o[key] === undefined || ok(o[key]);

const isScreen = (x: unknown): x is ScreenAvail =>
  isObj(x) && isNum(x.availLeft) && isNum(x.availTop) && isNum(x.availWidth) && isNum(x.availHeight);

/** W5: the popup's sizing as statuses carry it (structural numbers only). */
export function isWindowDiagnostics(x: unknown): x is WindowDiagnostics {
  if (!isObj(x)) return false;
  const updatesOk =
    Array.isArray(x.updates) &&
    x.updates.length <= MAX_WINDOW_UPDATES &&
    x.updates.every(
      (u) =>
        isObj(u) &&
        oneOf(['fit', 'retry', 'refit'], u.step) &&
        isBox(u.box) &&
        isSize(u.target) &&
        isBox(u.outer) &&
        isSize(u.tab) &&
        isBool(u.fitted),
    );
  return (
    isScreen(x.screen) &&
    isBox(x.requested) &&
    orNull(isBox)(x.created) &&
    orNull(isSize)(x.createdTab) &&
    orNull(isSize)(x.frameDelta) &&
    updatesOk &&
    isNum(x.attempts) &&
    isBool(x.manualResize) &&
    orNull(isSize)(x.finalTab) &&
    orNull(isNum)(x.zoom) &&
    optional(x, 'docked', isBool)
  );
}

const isResize = (x: unknown): boolean => isObj(x) && isSize(x.tab) && isBool(x.ok) && isNum(x.until) && isNum(x.maxW);

const isHandleText = (x: unknown): boolean => typeof x === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(x);

export function isRunResult(x: unknown): x is RunResult {
  if (!isObj(x)) return false;
  return (
    oneOf(RESULT_KINDS, x.kind) &&
    Array.isArray(x.alarms) &&
    x.alarms.every((a) => oneOf(ALARMS, a)) &&
    isNum(x.at) &&
    optional(x, 'code', (y) => oneOf(ERROR_CODES, y)) &&
    optional(x, 'why', (y) => oneOf(UNKNOWN_WHYS, y)) &&
    optional(x, 'detail', isStr(300)) &&
    optional(x, 'killed', (y) => oneOf(['KILLED_CHALLENGE', 'KILLED_OFFHOST', 'TEST_LEAK'], y)) &&
    optional(x, 'facebook', isBool) &&
    optional(x, 'held', isBool) &&
    optional(x, 'late', isBool) &&
    optional(x, 'markedBy', (y) => y === 'owner') &&
    optional(x, 'lockedTo', isHandleText) &&
    optional(x, 'stoppedBy', (y) => oneOf(['owner', 'window'], y)) &&
    optional(x, 'account', (y) => y === null || isHandleText(y))
  );
}

/** A resource entry after Share, with the IP3 bounds. */
export function isNetEntry(x: unknown): x is NetEntry {
  return (
    isObj(x) &&
    oneOf(['www', 'i', 'other'], x.host) &&
    typeof x.path === 'string' &&
    x.path.length <= FACT_LIMITS.path &&
    isInt(0, 599)(x.status) &&
    typeof x.type === 'string' &&
    x.type.length <= FACT_LIMITS.type &&
    isBool(x.redirected) &&
    isNum(x.start) &&
    isNum(x.end) &&
    Math.abs(x.start) <= FACT_LIMITS.ms &&
    Math.abs(x.end) <= FACT_LIMITS.ms
  );
}

const isNetList = (x: unknown): boolean => Array.isArray(x) && x.length <= FACT_LIMITS.entries && x.every(isNetEntry);
const isUiFacts = (x: unknown): boolean =>
  isObj(x) && isBool(x.progressSeen) && oneOf(['none', 'plain', 'action'], x.toast) && orNull(isNum)(x.wentHomeAt);
const isEvidence = (x: unknown): boolean =>
  isObj(x) &&
  orNull(isNum)(x.sharedAt) &&
  (x.sharedBy === null || oneOf(['autopilot', 'owner'], x.sharedBy)) &&
  isNetList(x.net) &&
  isUiFacts(x.ui) &&
  Array.isArray(x.alarms) &&
  x.alarms.every((a) => oneOf(ALARMS, a));
const isAccountFacts = (x: unknown): boolean =>
  isObj(x) &&
  (x.detected === null || isHandleText(x.detected)) &&
  isNum(x.candidates) &&
  (x.expected === null || isHandleText(x.expected)) &&
  (x.decision === null ||
    oneOf(
      ['ok', 'learn', 'unlocked', 'prompt-mismatch', 'prompt-unreadable', 'prompt-first', 'mismatch', 'unreadable'],
      x.decision,
    )) &&
  (x.confirmedBy === null || oneOf(['match', 'owner', 'learned', 'unlocked'], x.confirmedBy));
const isSteps = (x: unknown): boolean =>
  isObj(x) &&
  isNum(x.opened) &&
  ['instagram', 'account', 'armed', 'composer', 'share', 'confirmed'].every((k) => optional(x, k, isNum));

const isGlyph = (x: unknown): boolean => typeof x === 'string' && /^[0-9a-f]{1,32}$/.test(x);

function isEntryFields(x: Obj): boolean {
  return (
    oneOf(ENTRY_RESULTS, x.result) &&
    isBool(x.fpUsed) &&
    (x.storyIndex === null || isInt(0, 16)(x.storyIndex)) &&
    (x.glyph === null || isGlyph(x.glyph)) &&
    (x.menuCount === null || isInt(0, 64)(x.menuCount)) &&
    isInt(0, 4)(x.trials) &&
    isInt(0, 8)(x.plusTaps) &&
    (x.armedMs === null || (isNum(x.armedMs) && x.armedMs >= 0 && x.armedMs <= FACT_LIMITS.ms))
  );
}

function isComposeFields(x: Obj): boolean {
  return (
    isBool(x.onComposer) &&
    isBool(x.drawn) &&
    isBool(x.landscape) &&
    isInt(0, 64)(x.controls) &&
    (x.variant === null || oneOf(['v1', 'v2'], x.variant)) &&
    isBool(x.fbAuto) &&
    isBool(x.settled) &&
    isNum(x.settleMs) &&
    x.settleMs >= 0 &&
    x.settleMs <= FACT_LIMITS.ms &&
    (x.canvas === null || (isSize(x.canvas) && x.canvas.w >= 0 && x.canvas.h >= 0)) &&
    (x.imageScore === null || (isNum(x.imageScore) && x.imageScore >= 0 && x.imageScore <= 1))
  );
}

/** An agent fact, with the IP3 bounds. */
export function isAgentFact(x: unknown): x is AgentFact {
  if (!isObj(x) || !oneOf(AGENT_FACT_KINDS, x.kind)) return false;
  switch (x.kind) {
    case 'entry':
      return isEntryFields(x);
    case 'inserted':
      return true;
    case 'insert-failed':
      return oneOf(INSERT_FAILURES, x.why);
    case 'compose':
      return isComposeFields(x);
    case 'share-done':
    case 'owner-share':
      return isNum(x.t0Wall);
    case 'share-refused':
      return oneOf(SHARE_REFUSALS, x.why);
    case 'net':
      return isNetList(x.entries) && isNum(x.elapsedMs) && x.elapsedMs >= 0 && x.elapsedMs <= FACT_LIMITS.ms;
    case 'ui':
      return isBool(x.progressSeen) && oneOf(['none', 'plain', 'action'], x.toast) && isBool(x.wentHome);
    case 'visibility':
      return isBool(x.hidden);
  }
}

/** A copy of a valid fact with only the known fields (nothing extra reaches storage). */
export function normalizeFact(f: AgentFact): AgentFact {
  switch (f.kind) {
    case 'entry':
      return {
        kind: 'entry',
        result: f.result,
        fpUsed: f.fpUsed,
        storyIndex: f.storyIndex,
        glyph: f.glyph,
        menuCount: f.menuCount,
        trials: f.trials,
        plusTaps: f.plusTaps,
        armedMs: f.armedMs === null ? null : Math.round(f.armedMs),
      };
    case 'inserted':
      return { kind: 'inserted' };
    case 'insert-failed':
      return { kind: 'insert-failed', why: f.why };
    case 'compose':
      return {
        kind: 'compose',
        onComposer: f.onComposer,
        drawn: f.drawn,
        landscape: f.landscape,
        controls: f.controls,
        variant: f.variant,
        fbAuto: f.fbAuto,
        settled: f.settled,
        settleMs: Math.round(f.settleMs),
        canvas: f.canvas ? { w: Math.round(f.canvas.w), h: Math.round(f.canvas.h) } : null,
        imageScore: f.imageScore === null ? null : Math.round(f.imageScore * 1000) / 1000,
      };
    case 'share-done':
    case 'owner-share':
      return { kind: f.kind, t0Wall: f.t0Wall };
    case 'share-refused':
      return { kind: 'share-refused', why: f.why };
    case 'net':
      return {
        kind: 'net',
        entries: f.entries.map((e) => ({
          host: e.host,
          path: e.path,
          status: e.status,
          type: e.type,
          redirected: e.redirected,
          start: Math.round(e.start),
          end: Math.round(e.end),
        })),
        elapsedMs: Math.round(f.elapsedMs),
      };
    case 'ui':
      return { kind: 'ui', progressSeen: f.progressSeen, toast: f.toast, wentHome: f.wentHome };
    case 'visibility':
      return { kind: 'visibility', hidden: f.hidden };
  }
}

export function isEditorToBackground(x: unknown): x is EditorToBackground {
  if (!v1(x)) return false;
  switch (x.type) {
    case 'handoff/start':
      return (
        (x.exportId === null || isId(x.exportId)) &&
        oneOf(HANDOFF_MODES, x.mode) &&
        isScreen(x.screen) &&
        oneOf(BROWSER_FLAVOURS, x.browser) &&
        isBool(x.queue) &&
        optional(x, 'exportSample', (y) => typeof y === 'string' && y.length <= 2048 && /^[A-Za-z0-9+/=]*$/.test(y)) &&
        optional(x, 'exportSha256', (y) => typeof y === 'string' && /^[0-9a-f]{64}$/.test(y)) &&
        optional(x, 'docHash', (y) => typeof y === 'string' && /^[0-9a-f]{64}$/.test(y))
      );
    case 'handoff/cancel':
    case 'ui/forget-account':
      return true;
    case 'handoff/account-choice':
      return isId(x.handoffId) && isBool(x.proceed);
    case 'handoff/manual':
      return isId(x.handoffId);
    case 'handoff/mark':
      return isId(x.handoffId) && isBool(x.posted);
    case 'handoff/enable-msite':
      return x.lockedUntil === null || isNum(x.lockedUntil);
    case 'ui/open-instagram':
      return oneOf(['home', 'story'], x.page) && optional(x, 'handle', (y) => typeof y === 'string' && y.length <= 64);
    case 'ui/result-seen':
    case 'ui/use-account':
      return isId(x.handoffId);
    default:
      return false;
  }
}

export function isLane(x: unknown): x is Lane {
  return (
    isObj(x) &&
    oneOf(['ready', 'spacing', 'queued', 'hourly', 'daily', 'paused', 'busy'], x.kind) &&
    optional(x, 'freeAt', isNum) &&
    optional(x, 'handoffId', isId) &&
    isNum(x.today) &&
    isNum(x.hour) &&
    isObj(x.caps) &&
    isNum(x.caps.hour) &&
    isNum(x.caps.day)
  );
}

export function isHandoffStatus(x: unknown): x is HandoffStatus {
  if (!isObj(x)) return false;
  const opt = (key: string, ok: (y: unknown) => boolean): boolean => optional(x, key, ok);
  return (
    (x.handoffId === null || isId(x.handoffId)) &&
    oneOf(HANDOFF_PHASES, x.phase) &&
    opt('mode', (y) => oneOf(HANDOFF_MODES, y)) &&
    opt('step', (y) => oneOf(['instagram', 'account', 'story', 'share', 'confirm'], y)) &&
    opt('error', (y) => oneOf(ERROR_CODES, y)) &&
    opt('probe', isProbeReport) &&
    opt('banner', (y) => y === 'FAKE_INSTAGRAM') &&
    opt('freeAt', isNum) &&
    opt('route', (y) => oneOf(['direct', 'homeOnly'], y)) &&
    opt('detail', (y) => typeof y === 'string') &&
    opt('resize', isResize) &&
    opt('window', isWindowDiagnostics) &&
    opt('path', (y) => typeof y === 'string' && y.length <= MAX_PATH_LENGTH) &&
    opt('c4', (y) => oneOf(['pass', 'fail', 'unknown'], y)) &&
    opt('account', isAccountFacts) &&
    opt(
      'accountPrompt',
      (y) =>
        isObj(y) &&
        oneOf(['mismatch', 'unreadable', 'first'], y.kind) &&
        (y.detected === null || isHandleText(y.detected)) &&
        (y.expected === null || isHandleText(y.expected)) &&
        isNum(y.until),
    ) &&
    opt('queuedUntil', isNum) &&
    opt('result', isRunResult) &&
    opt('compose', (y) => isObj(y) && isComposeFields(y)) &&
    opt('entry', (y) => isObj(y) && isEntryFields(y)) &&
    opt('evidence', isEvidence) &&
    opt('steps', isSteps) &&
    opt('startedAt', isNum) &&
    opt('held', (y) => oneOf(['upload', 'offerManual'], y)) &&
    opt('closeAt', isNum) &&
    opt('canStop', isBool) &&
    opt('shareSent', isBool) &&
    opt('manual', (y) => isObj(y) && oneOf(['pick', 'share'], y.needs) && isNum(y.until)) &&
    opt('raised', isBool)
  );
}

export function isBackgroundToEditor(x: unknown): x is BackgroundToEditor {
  if (!v1(x)) return false;
  if (x.type === 'handoff/status') return isHandoffStatus(x);
  if (x.type === 'handoff/lane') return isLane(x);
  return false;
}

const isAddressed = (x: Obj): boolean => isId(x.handoffId) && isId(x.nonce);

export function isMenuFingerprint(x: unknown): x is MenuFingerprint {
  return isObj(x) && isInt(1, 16)(x.count) && isInt(0, 15)(x.storyIndex) && isGlyph(x.glyph) && isNum(x.savedAt);
}

export function isBackgroundToAgent(x: unknown): x is BackgroundToAgent {
  if (!v1(x) || !isAddressed(x)) return false;
  switch (x.type) {
    case 'agent/probe':
    case 'agent/watch':
      return true;
    case 'agent/drive':
      switch (x.step) {
        case 'open-entry':
          return x.fingerprint === null || isMenuFingerprint(x.fingerprint);
        case 'insert':
        case 'share':
          return true;
        case 'compose':
          return x.sample === null || (typeof x.sample === 'string' && x.sample.length <= 2048);
        default:
          return false;
      }
    case 'agent/observe':
      return x.from === 'manual';
    default:
      return false;
  }
}

export function isAgentToBackground(x: unknown): x is AgentToBackground {
  if (!v1(x) || !isAddressed(x)) return false;
  switch (x.type) {
    case 'agent/report':
      return isProbeReport(x.probe);
    case 'agent/get-file':
      return true;
    case 'agent/event':
      return oneOf(AGENT_EVENT_NAMES, x.event);
    case 'agent/fact':
      return isAgentFact(x.fact);
    default:
      return false;
  }
}

/**
 * AM37: a screen orientation reading, as statuses and records carry it. `type` is short, lower-case
 * letters and dashes (`portrait-primary`), or null. `afterComposerMount` (SH-1) is absent or true.
 */
export function isPageOrientation(x: unknown): x is PageOrientation {
  return (
    isObj(x) &&
    oneOf(ORIENTATION_SHIM_STATES, x.shim) &&
    (x.type === null ||
      (typeof x.type === 'string' && x.type.length <= PROBE_LIMITS.orientationType && /^[a-z-]+$/.test(x.type))) &&
    (x.afterComposerMount === undefined || x.afterComposerMount === true)
  );
}

/**
 * AM37: the portrait shim's executeScript result as the background keeps it (untrusted: it comes from the
 * page's MAIN world). Anything that is not a well-formed reading becomes `{type: null, shim: 'failed'}`.
 */
export function toPageOrientation(raw: unknown): PageOrientation {
  return isPageOrientation(raw) ? { type: raw.type, shim: raw.shim } : { type: null, shim: 'failed' };
}

export function isProbeReport(x: unknown): x is ProbeReport {
  if (!isObj(x)) return false;
  const canvasOk =
    x.canvas === undefined || (isObj(x.canvas) && isNum(x.canvas.w) && isNum(x.canvas.h) && isRect(x.canvas.css));
  const acceptSeenOk =
    x.acceptSeen === undefined ||
    (Array.isArray(x.acceptSeen) &&
      x.acceptSeen.length <= PROBE_LIMITS.acceptEntries &&
      x.acceptSeen.every((a) => typeof a === 'string' && a.length <= PROBE_LIMITS.acceptLength));
  return (
    isBool(x.marker) &&
    (isBool(x.isMobile) || x.isMobile === 'unknown') &&
    isSize(x.inner) &&
    isNum(x.dpr) &&
    x.dpr > 0 &&
    isBool(x.portrait) &&
    (isBool(x.swControlled) || x.swControlled === 'unknown') &&
    (isBool(x.swIntercepted) || x.swIntercepted === 'unknown') &&
    oneOf(NAV_TYPES, x.navType) &&
    oneOf(['present', 'absent'], x.storyInput) &&
    isBool(x.acceptOk) &&
    acceptSeenOk &&
    canvasOk &&
    typeof x.lang === 'string' &&
    x.lang.length <= PROBE_LIMITS.lang &&
    (x.orientation === undefined || isPageOrientation(x.orientation)) &&
    optional(
      x,
      'account',
      (y) => isObj(y) && (y.handle === null || isHandleText(y.handle)) && isInt(0, 64)(y.candidates),
    ) &&
    optional(x, 'entryFound', isBool) &&
    optional(x, 'activation', (y) => isObj(y) && isBool(y.isActive) && isBool(y.hasBeenActive)) &&
    optional(x, 'visibility', (y) => oneOf(['visible', 'hidden'], y))
  );
}

export function isAgentAck(x: unknown): x is AgentAck {
  return isObj(x) && isBool(x.ok);
}

export function isGetFileReply(x: unknown): x is GetFileReply {
  if (!isObj(x)) return false;
  if (x.ok === false) return true;
  return x.ok === true && typeof x.name === 'string' && typeof x.mime === 'string' && typeof x.b64 === 'string';
}

/**
 * A copy of a valid report with only the known fields (nothing extra reaches storage). The agent's report
 * never carries `orientation` (AM37): the background stamps it from the shim's own result.
 */
export function normalizeProbeReport(p: ProbeReport): ProbeReport {
  return {
    marker: p.marker,
    isMobile: p.isMobile,
    inner: { w: p.inner.w, h: p.inner.h },
    dpr: p.dpr,
    portrait: p.portrait,
    swControlled: p.swControlled,
    swIntercepted: p.swIntercepted,
    navType: p.navType,
    storyInput: p.storyInput,
    acceptOk: p.acceptOk,
    ...(p.acceptSeen ? { acceptSeen: [...p.acceptSeen] } : {}),
    ...(p.canvas
      ? {
          canvas: {
            w: p.canvas.w,
            h: p.canvas.h,
            css: { x: p.canvas.css.x, y: p.canvas.css.y, w: p.canvas.css.w, h: p.canvas.css.h },
          },
        }
      : {}),
    lang: p.lang,
    ...(p.account ? { account: { handle: p.account.handle, candidates: p.account.candidates } } : {}),
    ...(p.entryFound !== undefined ? { entryFound: p.entryFound } : {}),
    ...(p.activation
      ? { activation: { isActive: p.activation.isActive, hasBeenActive: p.activation.hasBeenActive } }
      : {}),
    ...(p.visibility ? { visibility: p.visibility } : {}),
  };
}

// ---- Agent message acceptance (§3.5, ux.md IP3) --------------------------------------

/** The parts of runtime.MessageSender the check reads (no extension typings needed). */
export interface SenderLike {
  id?: string;
  tab?: { id?: number };
  frameId?: number;
  /** Chrome 106+: the sending document (docs/inpage.md §8.2). */
  documentId?: string;
  url?: string;
  /** Chrome 80+: the sending document's origin. Arc reports an unexpected `url` for subframes. */
  origin?: string;
}

/** The active hand-off as the background sees it. */
export interface ActiveAgentSession {
  runtimeId: string;
  tabId: number;
  /** The agent's frame: 0 (the window lane's popup, the default) or the in-page engine frame (U34). */
  frameId?: number;
  /** Once known (the injection's result), only this document may speak (docs/inpage.md §8.2, U34). */
  documentId?: string;
  handoffId: HandoffId;
  nonce: Nonce;
  phase: SessionPhase;
}

/** The phases after the deciding probe in which the agent may still speak. */
const DECIDED: readonly SessionPhase[] = [
  'awaitingAccount',
  'openingEntry',
  'inserting',
  'composeReady',
  'sharing',
  'confirmingUpload',
  'manual',
  'finished',
];

/**
 * Phases in which each agent message type is accepted. `report`: the probe, and the C8 probe once the
 * composer drew the photo (AM13); `get-file`: inserting only (the reducer also checks its sub-step);
 * `event`: from the probe on (P3 tripwire, P5 waits); `fact`: per kind (AGENT_FACT_PHASES).
 */
export const AGENT_MESSAGE_PHASES: Readonly<Record<AgentToBackground['type'], readonly SessionPhase[]>> = {
  'agent/report': ['probing', 'composeReady', 'sharing', 'confirmingUpload', 'finished'],
  'agent/get-file': ['inserting'],
  'agent/event': ['probing', ...DECIDED],
  'agent/fact': ['probing', ...DECIDED],
};

/** ux.md IP3: the phases in which each fact kind is accepted. */
export const AGENT_FACT_PHASES: Readonly<Record<AgentFactKind, readonly SessionPhase[]>> = {
  entry: ['openingEntry'],
  inserted: ['inserting'],
  'insert-failed': ['inserting'],
  compose: ['inserting', 'composeReady', 'manual'],
  'share-done': ['sharing'],
  'share-refused': ['sharing'],
  net: ['sharing', 'confirmingUpload', 'finished', 'manual'],
  ui: ['sharing', 'confirmingUpload', 'finished', 'manual'],
  visibility: ['probing', ...DECIDED],
  'owner-share': ['manual'],
};

export type AgentRejection =
  | 'shape'
  | 'no-session'
  | 'sender-id'
  | 'tab'
  | 'frame'
  | 'document'
  | 'origin'
  | 'handoff'
  | 'nonce'
  | 'phase';

export type AgentAcceptance = { ok: true; msg: AgentToBackground } | { ok: false; reason: AgentRejection };

/** The sending document's origin: the browser's own `origin`, else derived from its `url`. */
export function senderOrigin(sender: SenderLike): string | null {
  return sender.origin ?? originOf(sender.url);
}

function originOf(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Equal-length string comparison without an early exit (the nonce is a per-hand-off secret). */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function normalizeAgentMessage(m: AgentToBackground): AgentToBackground {
  const address = { v: 1 as const, handoffId: m.handoffId, nonce: m.nonce };
  switch (m.type) {
    case 'agent/report':
      return { ...address, type: m.type, probe: normalizeProbeReport(m.probe) };
    case 'agent/get-file':
      return { ...address, type: m.type };
    case 'agent/event':
      return { ...address, type: m.type, event: m.event };
    case 'agent/fact':
      return { ...address, type: m.type, fact: normalizeFact(m.fact) };
  }
}

/**
 * Accepts an agent message only when all hold: valid shape; an active session; `sender.id === runtimeId`;
 * `sender.tab.id === tabId` and `sender.frameId` is the session's frame (0 unless the session names the
 * in-page engine frame); the session's `documentId`, once known, is the sender's; `new URL(sender.url).origin
 * === IG_ORIGIN`; handoffId and nonce match; the phase allows the message type (and, for a fact, its kind).
 * Checks run in that order, so `reason` names the first one that failed. Tested by U12 and U34.
 */
export function acceptAgentMessage(
  raw: unknown,
  sender: SenderLike,
  active: ActiveAgentSession | null,
): AgentAcceptance {
  if (!isAgentToBackground(raw)) return { ok: false, reason: 'shape' };
  if (active === null) return { ok: false, reason: 'no-session' };
  if (sender.id === undefined || sender.id !== active.runtimeId) return { ok: false, reason: 'sender-id' };
  if (sender.tab?.id === undefined || sender.tab.id !== active.tabId) return { ok: false, reason: 'tab' };
  if (sender.frameId !== (active.frameId ?? 0)) return { ok: false, reason: 'frame' };
  if (active.documentId !== undefined && sender.documentId !== active.documentId) {
    return { ok: false, reason: 'document' };
  }
  if (senderOrigin(sender) !== IG_ORIGIN) return { ok: false, reason: 'origin' };
  if (raw.handoffId !== active.handoffId) return { ok: false, reason: 'handoff' };
  if (!sameSecret(raw.nonce, active.nonce)) return { ok: false, reason: 'nonce' };
  if (!AGENT_MESSAGE_PHASES[raw.type].includes(active.phase)) return { ok: false, reason: 'phase' };
  if (raw.type === 'agent/fact' && !AGENT_FACT_PHASES[raw.fact.kind].includes(active.phase)) {
    return { ok: false, reason: 'phase' };
  }
  return { ok: true, msg: normalizeAgentMessage(raw) };
}

/** Kept for callers that classify error codes from a status. */
export const isErrorCode = (x: unknown): x is ErrorCode => oneOf(ERROR_CODES, x);
