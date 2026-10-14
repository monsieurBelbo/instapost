/**
 * The run in the editor (ux.md §8, IU13; replaces handoff-state.ts): one port client for the page, the
 * lane, the latest validated status of the run this editor follows, and the result shown in place of the
 * run view.
 *
 * The run belongs to the background: closing the editor does not stop it, and a reopened editor gets the
 * run (or its result) from the first status. Some facts must outlive the status that carried them, because
 * the session moves on to `closing` and `idle` within seconds: the deciding probe, the window, the FAKE
 * bar, the evidence. They are kept per hand-off and cleared by the next one.
 */
import { computed, signal } from '@preact/signals';
import type { ScreenAvail } from '../core/geometry/window-fit.ts';
import type {
  AccountFacts,
  ComposeFacts,
  EntryFacts,
  ErrorCode,
  Evidence,
  HandoffMode,
  Lane,
  RunResult,
  StepTimes,
  WindowDiagnostics,
} from '../core/handoff/state.ts';
import type { BrowserFlavour } from '../core/ig-contract/browser-flavour.ts';
import type { CheckResult, ProbeReport } from '../core/ig-contract/contract.ts';
import type { ComposerRoute } from '../core/ig-contract/urls.ts';
import type { ExportId, HandoffId } from '../core/model/ids.ts';
import { createHandoffClient, type HandoffClient, type StartRequest } from '../publish/msite.ts';
import type { HandoffStatusMsg } from '../shared/protocol.ts';
import { detectBrowserFlavour } from './browser-flavour.ts';

export const connected = signal(false);
export const lane = signal<Lane | null>(null);
/** The latest status of the followed run. */
export const status = signal<HandoffStatusMsg | null>(null);
/** A start was sent and no status has answered it yet. */
export const starting = signal<{ mode: HandoffMode; at: number } | null>(null);
/** The last refused start (a status without a hand-off). */
export const refusal = signal<{
  error: ErrorCode;
  freeAt?: number;
  detail?: string;
  at: number;
  mode: HandoffMode;
} | null>(null);

export interface RunDiag {
  probe: ProbeReport | null;
  decision: {
    probe: ProbeReport;
    c4: CheckResult | undefined;
    path: string | undefined;
    route: ComposerRoute | undefined;
  } | null;
  window: WindowDiagnostics | null;
  browser: BrowserFlavour | null;
  fake: boolean;
  raised: boolean;
}

const emptyDiag = (): RunDiag => ({
  probe: null,
  decision: null,
  window: null,
  browser: null,
  fake: false,
  raised: false,
});
export const diag = signal<RunDiag>(emptyDiag());

/** The result shown in place of the run view (§4.7), until dismissed. */
export interface ShownResult {
  handoffId: HandoffId;
  mode: HandoffMode;
  result: RunResult;
  steps: StepTimes | null;
  startedAt: number;
  account: AccountFacts | null;
  compose: ComposeFacts | null;
  entry: EntryFacts | null;
  evidence: Evidence | null;
  held: 'upload' | 'offerManual' | null;
  closeAt: number | null;
  /** The window is still open (finished, closing). */
  windowOpen: boolean;
  /** The export this run used, when this editor started it. */
  exportId: ExportId | null;
  /** The safety copy (§5): the file name in Downloads/instapost, and its download id for Show. */
  copy: { file: string; downloadId: number } | null;
}
export const shown = signal<ShownResult | null>(null);
/** The safety copy of the followed run (Finish by hand names it), kept after its result card goes. */
export const safetyCopy = signal<{ handoffId: HandoffId; file: string } | null>(null);

/** The run this editor started, with its export (the safety copy needs the blob). */
export const ownRun = signal<{
  handoffId: HandoffId | null;
  mode: HandoffMode;
  exportId: ExportId | null;
  at: number;
  /** The posted PNG's object URL (the run view's thumbnail). */
  thumb: string | null;
} | null>(null);

/** A run is active (or starting, or queued). */
export const runActive = computed(() => {
  if (starting.value) return true;
  const s = status.value;
  return s !== null && s.phase !== 'idle' && s.result === undefined;
});

let client: HandoffClient | null = null;
let currentId: HandoffId | null = null;
const resultListeners = new Set<(r: ShownResult, fresh: boolean) => void>();

/** Subscribes to results as they arrive (the safety copy, the badge). `fresh`: this editor started it. */
export function onResult(listener: (r: ShownResult, fresh: boolean) => void): () => void {
  resultListeners.add(listener);
  return () => resultListeners.delete(listener);
}

const DISMISSED_KEY = 'instapost.dismissedResults';
function dismissedIds(): string[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(DISMISSED_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function rememberDismissed(id: string): void {
  try {
    const ids = [...dismissedIds().filter((x) => x !== id), id].slice(-20);
    globalThis.sessionStorage?.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {
    // Per-viewer convenience only.
  }
}

/** A result older than this is not brought back by a reconnect (the top bar's Last: shows it). */
const RESULT_FRESH_MS = 10 * 60 * 1000;

/** A new run: its diagnostics start empty, except the browser this editor detected for a run it started. */
function resetForNew(keepBrowser = false): void {
  diag.value = { ...emptyDiag(), browser: keepBrowser ? diag.value.browser : null };
}

function onStatus(s: HandoffStatusMsg): void {
  // A refused start: no hand-off; the Post card shows it.
  if (s.handoffId === null) {
    const pending = starting.value;
    if (s.error)
      refusal.value = {
        error: s.error,
        freeAt: s.freeAt,
        detail: s.detail,
        at: Date.now(),
        mode: pending?.mode ?? 'post',
      };
    starting.value = null;
    if (!pending && s.phase === 'idle') status.value = s;
    return;
  }
  if (s.handoffId !== currentId) {
    currentId = s.handoffId;
    // A status for a run started elsewhere (another editor tab) or before a reload: follow it.
    const own = ownRun.value;
    const mine = own !== null && own.handoffId === null && starting.value !== null;
    resetForNew(mine);
    if (mine) ownRun.value = { ...own, handoffId: s.handoffId };
  }
  starting.value = null;
  if (s.phase !== 'idle') refusal.value = null;
  const d = diag.value;
  diag.value = {
    probe: s.probe ?? d.probe,
    decision: s.probe && s.c4 !== undefined ? { probe: s.probe, c4: s.c4, path: s.path, route: s.route } : d.decision,
    window: s.window ?? d.window,
    browser: d.browser,
    fake: d.fake || s.banner === 'FAKE_INSTAGRAM',
    raised: d.raised || s.raised === true,
  };
  status.value = s;
  if (s.result) showResult(s);
  // §4.9: Finish by hand resumes the run: its result card gives way to the run view until the new result.
  else if (s.phase !== 'idle' && shown.value?.handoffId === s.handoffId) shown.value = null;
}

function showResult(s: HandoffStatusMsg): void {
  const r = s.result;
  if (!r || s.handoffId === null) return;
  const prev = shown.value;
  const same = prev?.handoffId === s.handoffId;
  const own = ownRun.value?.handoffId === s.handoffId;
  // A reconnect brings back only a recent result that was not dismissed.
  if (!same && !own && (Date.now() - r.at > RESULT_FRESH_MS || dismissedIds().includes(s.handoffId))) return;
  const next: ShownResult = {
    handoffId: s.handoffId,
    mode: s.mode ?? prev?.mode ?? 'post',
    result: r,
    steps: s.steps ?? (same ? prev.steps : null),
    startedAt: s.startedAt ?? (same ? prev.startedAt : r.at),
    account: s.account ?? (same ? prev.account : null),
    compose: s.compose ?? (same ? prev.compose : null),
    entry: s.entry ?? (same ? prev.entry : null),
    evidence: s.evidence ?? (same ? prev.evidence : null),
    held: s.held ?? null,
    closeAt: s.closeAt ?? null,
    windowOpen: s.phase === 'finished' || s.phase === 'closing',
    exportId: own ? (ownRun.value?.exportId ?? null) : same ? prev.exportId : null,
    copy: same ? prev.copy : null,
  };
  const changed = !same || prev.result.kind !== r.kind || prev.result.at !== r.at;
  shown.value = next;
  if (changed) for (const l of resultListeners) l(next, own);
}

/** The page's client, connected on first use (also re-syncs a run that kept going across a reload). */
export function handoffClient(): HandoffClient {
  if (!client) {
    client = createHandoffClient();
    client.onConnection((c) => {
      connected.value = c;
    });
    client.onStatus(onStatus);
    client.onLane((l) => {
      const { v: _v, type: _t, ...rest } = l;
      lane.value = rest;
    });
  }
  return client;
}

/** `screen.avail*` of the editor's screen (the Instagram window docks at its right edge). */
export function screenAvail(): ScreenAvail {
  const s = screen as Screen & { availLeft?: number; availTop?: number };
  return {
    availLeft: s.availLeft ?? 0,
    availTop: s.availTop ?? 0,
    availWidth: s.availWidth,
    availHeight: s.availHeight,
  };
}

export function startRun(req: Omit<StartRequest, 'screen' | 'browser'>, thumb: string | null = null): void {
  currentId = null;
  resetForNew();
  refusal.value = null;
  shown.value = null;
  status.value = null;
  const browser = detectBrowserFlavour();
  diag.value = { ...emptyDiag(), browser };
  starting.value = { mode: req.mode, at: Date.now() };
  ownRun.value = { handoffId: null, mode: req.mode, exportId: req.exportId, at: Date.now(), thumb };
  try {
    handoffClient().start({ ...req, screen: screenAvail(), browser });
  } catch (err) {
    starting.value = null;
    throw err;
  }
}

/** Stop (Esc): honoured before Share only (the background decides). Also cancels a queued post. */
export function stopRun(): void {
  handoffClient().cancel();
}

export function chooseAccount(proceed: boolean): void {
  const id = status.value?.handoffId;
  if (id) handoffClient().accountChoice(id, proceed);
}

export function finishByHand(): void {
  const id = status.value?.handoffId ?? shown.value?.handoffId;
  if (id) handoffClient().manual(id);
}

export function markOutcome(handoffId: HandoffId, posted: boolean): void {
  handoffClient().mark(handoffId, posted);
  const s = shown.value;
  if (s?.handoffId === handoffId) {
    shown.value = { ...s, result: markedResult(s.result, posted, Date.now()) };
  }
}

/** AP-3: the owner's mark on a Couldn't confirm: their kind, flagged as theirs (never "Instagram confirmed it"). */
export function markedResult(r: RunResult, posted: boolean, at: number): RunResult {
  return { ...r, kind: posted ? 'posted' : 'notPosted', at, markedBy: 'owner' };
}

/** AP-4: a check's "Use @account". */
export function adoptCheckedAccount(handoffId: HandoffId): void {
  handoffClient().useAccount(handoffId);
}

export function openInstagram(page: 'home' | 'story', handle?: string | null): void {
  handoffClient().openInstagram(page, handle ?? undefined);
}

export function forgetAccount(): void {
  handoffClient().forgetAccount();
}

/** Resume (§4.10, AM25): the background clears the lock the editor showed, in its own queue. */
export function requestResume(lockedUntil: number | null): void {
  handoffClient().enableMsite(lockedUntil);
}

/**
 * The result card was dismissed (Done, New story): it stays in History. A window the result still keeps
 * open closes now (the owner declined Finish by hand, or it was about to close anyway), except one held
 * while Instagram may still be uploading: closing that could cut the upload off (§6.4, R21).
 */
export function dismissResult(): void {
  const s = shown.value;
  if (s) {
    rememberDismissed(s.handoffId);
    handoffClient().resultSeen(s.handoffId);
    const st = status.value;
    if (s.windowOpen && s.held !== 'upload' && st?.handoffId === s.handoffId && st.phase === 'finished') {
      handoffClient().cancel();
    }
  }
  shown.value = null;
  refusal.value = null;
}

/** The editor showed this result (the toolbar badge may clear). */
export function resultSeen(id: HandoffId): void {
  try {
    handoffClient().resultSeen(id);
  } catch {
    // The port is down; the badge clears with the next result.
  }
}

/** The safety copy was saved (shown with its Show link). */
export function setResultCopy(handoffId: HandoffId, copy: { file: string; downloadId: number }): void {
  safetyCopy.value = { handoffId, file: copy.file };
  const s = shown.value;
  if (s?.handoffId === handoffId) shown.value = { ...s, copy };
}
