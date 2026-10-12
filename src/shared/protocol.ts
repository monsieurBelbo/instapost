/**
 * Every message between editor, background and composer agent (strategy §3.5). JSON
 * discriminated unions with `v: 1`. The export travels to the agent as base64 (b64.ts),
 * hidden behind this module so changing the encoding is a one-file change.
 *
 * The canonical payload types live in src/core (ProbeReport in ig-contract/contract.ts, the
 * hand-off vocabulary in handoff/state.ts) so the pure reducer can use them; this module
 * re-exports them and adds the envelopes, guards and the agent acceptance check.
 */
import type { ScreenAvail } from '../core/geometry/window-fit.ts';
import {
  type AgentEventName,
  ERROR_CODES,
  type ErrorCode,
  type HandoffLevel,
  type HandoffMode,
  type HandoffPhase,
  type HandoffStatus,
} from '../core/handoff/state.ts';
import type { ProbeReport } from '../core/ig-contract/contract.ts';
import { IG_ORIGIN } from '../core/ig-contract/urls.ts';
import type { ExportId, HandoffId, Nonce } from '../core/model/ids.ts';

export { b64ToBytes, bytesToB64 } from './b64.ts';
export type {
  AgentEventName,
  ErrorCode,
  HandoffLevel,
  HandoffMode,
  HandoffPhase,
  HandoffStatus,
  ProbeReport,
  ScreenAvail,
};

export const PROTOCOL_VERSION = 1;
/** runtime.connect({name}) used by the editor for the hand-off port. */
export const HANDOFF_PORT = 'handoff';

// ---- Editor → background (port) -----------------------------------------------------

export interface HandoffStartMsg {
  v: 1;
  type: 'handoff/start';
  /** null for mode 'probe' (no file). */
  exportId: ExportId | null;
  mode: HandoffMode;
  rehearsal: boolean;
  screen: ScreenAvail;
}
export interface HandoffCancelMsg {
  v: 1;
  type: 'handoff/cancel';
}
export interface HandoffOutcomeMsg {
  v: 1;
  type: 'handoff/outcome';
  handoffId: HandoffId;
  posted: boolean;
}
/**
 * The owner typed ENABLE (§3.6, AM25). Only the background writes the kill-switch lock; it clears
 * it in its own queue, and only when the stored lock is no later than `lockedUntil`, the lock the
 * editor showed (a kill that happened meanwhile is kept).
 */
export interface HandoffEnableMsiteMsg {
  v: 1;
  type: 'handoff/enable-msite';
  lockedUntil: number | null;
}
export type EditorToBackground = HandoffStartMsg | HandoffCancelMsg | HandoffOutcomeMsg | HandoffEnableMsiteMsg;

// ---- Background → editor (port) -----------------------------------------------------

export type HandoffStatusMsg = { v: 1; type: 'handoff/status' } & HandoffStatus;
export type BackgroundToEditor = HandoffStatusMsg;

// ---- Background → agent (tabs.sendMessage(tabId, msg, {frameId: 0})) ----------------

interface AgentAddress {
  handoffId: HandoffId;
  nonce: Nonce;
}
export type AgentProbeMsg = { v: 1; type: 'agent/probe' } & AgentAddress;
export type AgentInjectMsg = { v: 1; type: 'agent/inject' } & AgentAddress;
export type AgentWatchMsg = { v: 1; type: 'agent/watch'; readyTimeoutMs: number } & AgentAddress;
export type BackgroundToAgent = AgentProbeMsg | AgentInjectMsg | AgentWatchMsg;

// ---- Agent → background (runtime.sendMessage) ---------------------------------------

export type AgentReportMsg = { v: 1; type: 'agent/report'; probe: ProbeReport } & AgentAddress;
/** Answered via sendResponse with GetFileReply. */
export type AgentGetFileMsg = { v: 1; type: 'agent/get-file' } & AgentAddress;
export type AgentEventMsg = { v: 1; type: 'agent/event'; event: AgentEventName } & AgentAddress;
export type AgentToBackground = AgentReportMsg | AgentGetFileMsg | AgentEventMsg;

export type GetFileReply = { ok: true; name: string; mime: string; b64: string } | { ok: false };

/**
 * Every message in both background ⇄ agent directions is answered, so no sendMessage promise is
 * left to a closed port: the agent acks each valid command at once with `{ok: true}` (results
 * travel separately as agent/report and agent/event); the background answers agent/get-file with
 * GetFileReply and every other agent message with `{ok}` (`false` = dropped).
 */
export interface AgentAck {
  ok: boolean;
}
export type AgentReply = GetFileReply | AgentAck;

// ---- Guards (shape only; they never trust the sender) --------------------------------

/** Every HandoffPhase, for runtime checks (the type-level check below keeps it complete). */
export const HANDOFF_PHASES = [
  'idle',
  'opening',
  'scoping',
  'fitting',
  'navigating',
  'reloading',
  'probing',
  'injecting',
  'awaitingPick',
  'awaitingShare',
  'finished',
  'closing',
] as const satisfies readonly HandoffPhase[];

export const AGENT_EVENT_NAMES = [
  'input-appeared',
  'composer-ready',
  'composer-left',
  'inject-ignored',
  'inject-unconfirmed',
  'sw-controller-change',
] as const satisfies readonly AgentEventName[];

/** Compile-time completeness: a phase or event added in src/core must be listed here too. */
type Complete<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : never;
const _phasesComplete: Complete<HandoffPhase, (typeof HANDOFF_PHASES)[number]> = true;
const _eventsComplete: Complete<AgentEventName, (typeof AGENT_EVENT_NAMES)[number]> = true;
void [_phasesComplete, _eventsComplete];

/** Caps on page-derived strings carried in a ProbeReport (they end up in IndexedDB records). */
export const PROBE_LIMITS = { lang: 64, acceptEntries: 32, acceptLength: 512 } as const;
/** Ids and nonces are `<prefix>_<uuid>` or a uuid; anything longer is not ours. */
const MAX_ID_LENGTH = 128;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const isId = (x: unknown): x is string => typeof x === 'string' && x !== '' && x.length <= MAX_ID_LENGTH;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => list.includes(x as T);
const isSize = (x: unknown): x is { w: number; h: number } => isObj(x) && isNum(x.w) && isNum(x.h);
const isRect = (x: unknown): boolean => isSize(x) && isNum((x as Obj).x) && isNum((x as Obj).y);
const v1 = (x: unknown): x is Obj => isObj(x) && x.v === PROTOCOL_VERSION && typeof x.type === 'string';

const isScreen = (x: unknown): x is ScreenAvail =>
  isObj(x) && isNum(x.availLeft) && isNum(x.availTop) && isNum(x.availWidth) && isNum(x.availHeight);

export function isEditorToBackground(x: unknown): x is EditorToBackground {
  if (!v1(x)) return false;
  switch (x.type) {
    case 'handoff/start':
      return (
        (x.exportId === null || isId(x.exportId)) &&
        oneOf(['post', 'probe'], x.mode) &&
        isBool(x.rehearsal) &&
        isScreen(x.screen)
      );
    case 'handoff/cancel':
      return true;
    case 'handoff/outcome':
      return isId(x.handoffId) && isBool(x.posted);
    case 'handoff/enable-msite':
      return x.lockedUntil === null || isNum(x.lockedUntil);
    default:
      return false;
  }
}

export function isBackgroundToEditor(x: unknown): x is BackgroundToEditor {
  if (!v1(x) || x.type !== 'handoff/status') return false;
  const optional = (key: string, ok: (y: unknown) => boolean): boolean => x[key] === undefined || ok(x[key]);
  return (
    (x.handoffId === null || isId(x.handoffId)) &&
    oneOf(HANDOFF_PHASES, x.phase) &&
    (x.level === null || oneOf(['H1', 'H0'], x.level)) &&
    optional('error', (y) => oneOf(ERROR_CODES, y)) &&
    optional('probe', isProbeReport) &&
    optional('banner', (y) => y === 'FAKE_INSTAGRAM') &&
    optional('freeAt', isNum) &&
    optional('route', (y) => oneOf(['direct', 'homeOnly'], y)) &&
    optional('detectedPosted', isBool) &&
    optional('postedUnknown', isBool) &&
    optional('detail', (y) => typeof y === 'string') &&
    optional('rehearsal', isBool) &&
    optional('assistedInsert', isBool) &&
    optional('holdOpen', isBool)
  );
}

const isAddressed = (x: Obj): boolean => isId(x.handoffId) && isId(x.nonce);

export function isBackgroundToAgent(x: unknown): x is BackgroundToAgent {
  if (!v1(x) || !isAddressed(x)) return false;
  switch (x.type) {
    case 'agent/probe':
    case 'agent/inject':
      return true;
    case 'agent/watch':
      return isNum(x.readyTimeoutMs) && x.readyTimeoutMs >= 0;
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
    default:
      return false;
  }
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
    oneOf(['present', 'absent'], x.storyInput) &&
    isBool(x.acceptOk) &&
    acceptSeenOk &&
    canvasOk &&
    typeof x.lang === 'string' &&
    x.lang.length <= PROBE_LIMITS.lang
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

/** A copy of a valid report with only the known fields (nothing extra reaches storage). */
export function normalizeProbeReport(p: ProbeReport): ProbeReport {
  return {
    marker: p.marker,
    isMobile: p.isMobile,
    inner: { w: p.inner.w, h: p.inner.h },
    dpr: p.dpr,
    portrait: p.portrait,
    swControlled: p.swControlled,
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
  };
}

// ---- Agent message acceptance (§3.5) -------------------------------------------------

/** The parts of runtime.MessageSender the check reads (no extension typings needed). */
export interface SenderLike {
  id?: string;
  tab?: { id?: number };
  frameId?: number;
  url?: string;
}

/** The active hand-off as the background sees it. */
export interface ActiveAgentSession {
  runtimeId: string;
  tabId: number;
  handoffId: HandoffId;
  nonce: Nonce;
  phase: HandoffPhase;
}

/**
 * Phases in which each agent message is accepted. `get-file` only in `injecting`; `report` also in
 * `awaitingShare`, where it answers the C8 probe sent at composer-ready (§11 AM13); `event` also in
 * `probing`, where the reducer buffers it until a same-document re-injection resumes (§11 AM16).
 */
export const AGENT_MESSAGE_PHASES: Readonly<Record<AgentToBackground['type'], readonly HandoffPhase[]>> = {
  'agent/report': ['probing', 'awaitingShare'],
  'agent/get-file': ['injecting'],
  'agent/event': ['probing', 'injecting', 'awaitingPick', 'awaitingShare', 'finished'],
};

export type AgentRejection =
  | 'shape'
  | 'no-session'
  | 'sender-id'
  | 'tab'
  | 'frame'
  | 'origin'
  | 'handoff'
  | 'nonce'
  | 'phase';

export type AgentAcceptance = { ok: true; msg: AgentToBackground } | { ok: false; reason: AgentRejection };

/** The page origin of a sender URL, or null when it does not parse. */
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

/** A copy of a valid agent message with only the known fields. */
function normalizeAgentMessage(m: AgentToBackground): AgentToBackground {
  const address = { v: 1 as const, handoffId: m.handoffId, nonce: m.nonce };
  switch (m.type) {
    case 'agent/report':
      return { ...address, type: m.type, probe: normalizeProbeReport(m.probe) };
    case 'agent/get-file':
      return { ...address, type: m.type };
    case 'agent/event':
      return { ...address, type: m.type, event: m.event };
  }
}

/**
 * Accepts an agent message only when all hold: valid shape; an active session;
 * `sender.id === runtimeId`; `sender.tab.id === tabId` and `sender.frameId === 0`;
 * `new URL(sender.url).origin === IG_ORIGIN` (src/core/ig-contract/urls.ts); handoffId and
 * nonce match; the phase allows the message type (AGENT_MESSAGE_PHASES). Anything else is
 * dropped and logged by the caller. The accepted message is a copy with only the known fields.
 * Checks run in that order, so `reason` names the first one that failed. Tested by U12.
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
  if (sender.frameId !== 0) return { ok: false, reason: 'frame' };
  if (originOf(sender.url) !== IG_ORIGIN) return { ok: false, reason: 'origin' };
  if (raw.handoffId !== active.handoffId) return { ok: false, reason: 'handoff' };
  if (!sameSecret(raw.nonce, active.nonce)) return { ok: false, reason: 'nonce' };
  if (!AGENT_MESSAGE_PHASES[raw.type].includes(active.phase)) return { ok: false, reason: 'phase' };
  return { ok: true, msg: normalizeAgentMessage(raw) };
}
