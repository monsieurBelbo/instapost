/**
 * Hand-off status in the editor (strategy §3.5, §7.10 "Hand-off panel"): one port client for the
 * page, the latest validated status and the phase timeline of the current hand-off.
 *
 * Some facts must outlive the status that carried them, because the session moves on to
 * `closing` and `idle` within seconds: the FAKE INSTAGRAM banner, the last error (with its
 * fallback), the probe report, and the "Posted?" question (the background still records a late
 * answer for the previous hand-off). They are kept per hand-off and cleared by the next one.
 * The background is the only authority on guards (lock, rate, busy); the editor renders them.
 */
import { computed, signal } from '@preact/signals';
import type { ScreenAvail } from '../core/geometry/window-fit.ts';
import type { ErrorCode, HandoffMode, PhaseLogEntry } from '../core/handoff/state.ts';
import type { ProbeReport } from '../core/ig-contract/contract.ts';
import type { ExportId, HandoffId } from '../core/model/ids.ts';
import { createHandoffClient, type HandoffClient } from '../publish/msite.ts';
import type { HandoffStatusMsg } from '../shared/protocol.ts';

export const status = signal<HandoffStatusMsg | null>(null);
/** Phases seen for the current hand-off, in arrival order (consecutive repeats collapsed). */
export const timeline = signal<PhaseLogEntry[]>([]);
/** Sticky per hand-off: once the background reports the fake marker on a live build. */
export const fakeBanner = signal(false);
export const connected = signal(false);
/** A start was sent and no status has answered it yet. */
export const starting = signal(false);
/** Downloaded export name (after `uniquify`) for the H0 instructions and the fallback. */
export const handoffFile = signal<string | null>(null);
/** The owner's "Posted?" answer for the current hand-off. */
export const postedAnswer = signal<boolean | null>(null);
/**
 * Set when the hand-off reached `finished`: the question stays until answered or replaced.
 * `postedUnknown` (AM28): no pre-answer, Share may have been tapped.
 */
export const finishedInfo = signal<{ handoffId: HandoffId; detectedPosted: boolean; postedUnknown: boolean } | null>(
  null,
);
/** The last error of the current hand-off (or of a guard refusal), with its detail (AM28: the page). */
export const lastError = signal<{ code: ErrorCode; freeAt: number | undefined; detail?: string } | null>(null);
/** The last probe report of the current hand-off. */
export const probeReport = signal<ProbeReport | null>(null);
/** The switches a start request carried, shown until the background's first status answers it (AM21). */
const requestedSwitches = signal<{ rehearsal: boolean; assistedInsert: boolean } | null>(null);

export const isActive = computed(() => starting.value || (status.value !== null && status.value.phase !== 'idle'));

/**
 * AM21: the switches of the running hand-off, which the background fixed at start: from its statuses,
 * or from the start request while it is pending. null when no hand-off runs (the panel then shows the
 * stored settings, which apply to the next one).
 */
export const sessionSwitches = computed<{ rehearsal: boolean; assistedInsert: boolean } | null>(() => {
  const s = status.value;
  if (s && s.phase !== 'idle' && s.rehearsal !== undefined && s.assistedInsert !== undefined) {
    return { rehearsal: s.rehearsal, assistedInsert: s.assistedInsert };
  }
  return starting.value ? requestedSwitches.value : null;
});

let client: HandoffClient | null = null;
let currentId: HandoffId | null = null;

function resetForNew(): void {
  timeline.value = [];
  fakeBanner.value = false;
  postedAnswer.value = null;
  finishedInfo.value = null;
  lastError.value = null;
  probeReport.value = null;
}

function onStatus(s: HandoffStatusMsg): void {
  if (s.handoffId !== null && s.handoffId !== currentId) {
    currentId = s.handoffId;
    resetForNew();
  }
  const last = timeline.value.at(-1);
  if (last?.phase !== s.phase) timeline.value = [...timeline.value, { phase: s.phase, t: Date.now() }];
  if (s.banner === 'FAKE_INSTAGRAM') fakeBanner.value = true;
  if (s.error) {
    // The closing and idle statuses repeat the error without its detail: keep the detail it came with.
    const prev = lastError.value;
    const detail = s.detail ?? (prev?.code === s.error ? prev.detail : undefined);
    lastError.value = { code: s.error, freeAt: s.freeAt, ...(detail ? { detail } : {}) };
  }
  if (s.probe) probeReport.value = s.probe;
  if (s.phase === 'finished' && s.handoffId) {
    finishedInfo.value = {
      handoffId: s.handoffId,
      detectedPosted: s.detectedPosted ?? false,
      postedUnknown: s.postedUnknown ?? false,
    };
  }
  starting.value = false;
  status.value = s;
}

/** The page's client, connected on first use (also re-syncs a hand-off running across a reload). */
export function handoffClient(): HandoffClient {
  if (!client) {
    client = createHandoffClient();
    client.onConnection((c) => {
      connected.value = c;
    });
    client.onStatus(onStatus);
  }
  return client;
}

/** `screen.avail*` (availLeft/availTop are Chrome extensions to Screen). */
export function screenAvail(): ScreenAvail {
  const s = screen as Screen & { availLeft?: number; availTop?: number };
  return {
    availLeft: s.availLeft ?? 0,
    availTop: s.availTop ?? 0,
    availWidth: s.availWidth,
    availHeight: s.availHeight,
  };
}

export function startHandoff(req: {
  exportId: ExportId | null;
  mode: HandoffMode;
  rehearsal: boolean;
  /** The assisted-insert setting at the click; the background takes its own snapshot at start. */
  assistedInsert: boolean;
  file: string | null;
}): void {
  currentId = null;
  resetForNew();
  status.value = null;
  handoffFile.value = req.file;
  requestedSwitches.value = {
    rehearsal: req.rehearsal,
    // As the background decides it: H1 needs a post with a saved export.
    assistedInsert: req.assistedInsert && req.mode === 'post' && req.exportId !== null,
  };
  starting.value = true;
  try {
    handoffClient().start({ exportId: req.exportId, mode: req.mode, rehearsal: req.rehearsal, screen: screenAvail() });
  } catch (err) {
    starting.value = false;
    throw err;
  }
}

export function cancelHandoff(): void {
  handoffClient().cancel();
}

export function answerPosted(posted: boolean): void {
  const id = finishedInfo.value?.handoffId;
  if (!id) return;
  postedAnswer.value = posted;
  handoffClient().outcome(id, posted);
}

/** ENABLE (AM25): the background clears the lock the editor showed, in its own queue. */
export function requestMsiteEnable(lockedUntil: number | null): void {
  handoffClient().enableMsite(lockedUntil);
}
