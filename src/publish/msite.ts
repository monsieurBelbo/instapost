/**
 * Editor side of the hand-off port (strategy §3.5, ux.md IP1/IP2): `runtime.connect({name: 'handoff'})`.
 * Editor → background: handoff/start, handoff/cancel (Stop), handoff/account-choice, handoff/manual
 * (Finish by hand), handoff/mark, handoff/enable-msite (Resume), ui/open-instagram, ui/forget-account,
 * ui/result-seen. Background → editor: handoff/status and handoff/lane, validated with the protocol guard
 * before any listener sees them.
 *
 * The port drops whenever the background service worker restarts. While a hand-off is active
 * the client reconnects on its own (with backoff), so statuses keep flowing; the background is
 * expected to post the current status to a newly connected port. While idle it reconnects
 * lazily on the next send, so an open editor never keeps the worker awake. Resending a message
 * whose postMessage threw is transport, not a hand-off retry: it never left the editor.
 */
import { browser } from 'wxt/browser';
import type { ScreenAvail } from '../core/geometry/window-fit.ts';
import type { HandoffMode } from '../core/handoff/state.ts';
import type { BrowserFlavour } from '../core/ig-contract/browser-flavour.ts';
import type { ExportId, HandoffId } from '../core/model/ids.ts';
import {
  type BackgroundToEditor,
  type EditorToBackground,
  HANDOFF_PORT,
  type HandoffLaneMsg,
  type HandoffStatusMsg,
  isBackgroundToEditor,
} from '../shared/protocol.ts';

/** The parts of runtime.Port the client uses. */
export interface PortLike {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(cb: (message: unknown) => void): void };
  onDisconnect: { addListener(cb: () => void): void };
}

export type ConnectFn = () => PortLike;

export interface StartRequest {
  /** null for mode 'check' (no file). */
  exportId: ExportId | null;
  mode: HandoffMode;
  screen: ScreenAvail;
  /** P6: the editor's detection (src/ui/browser-flavour.ts). */
  browser: BrowserFlavour;
  /** K10/K11: queue behind the 60 s spacing. */
  queue: boolean;
  exportSample?: string;
  exportSha256?: string;
  docHash?: string;
}

export interface HandoffClient {
  start(req: StartRequest): void;
  /** Stop (before Share). */
  cancel(): void;
  accountChoice(handoffId: HandoffId, proceed: boolean): void;
  manual(handoffId: HandoffId): void;
  mark(handoffId: HandoffId, posted: boolean): void;
  /** Resume (§11 AM25): asks the background to lift the kill-switch lock the editor showed. */
  enableMsite(lockedUntil: number | null): void;
  openInstagram(page: 'home' | 'story', handle?: string): void;
  forgetAccount(): void;
  /** AP-4: a check's "Use @account": the account that check read becomes the expected one. */
  useAccount(handoffId: HandoffId): void;
  resultSeen(handoffId: HandoffId): void;
  /** Subscribes to validated statuses (connects if needed). Returns the unsubscribe function. */
  onStatus(listener: (status: HandoffStatusMsg) => void): () => void;
  /** Subscribes to the lane (connects if needed). */
  onLane(listener: (lane: HandoffLaneMsg) => void): () => void;
  /** Port connected (true) or dropped (false). Returns the unsubscribe function. */
  onConnection(listener: (connected: boolean) => void): () => void;
  /** Disconnects for good: no reconnects, sends throw. */
  close(): void;
}

export interface HandoffClientOptions {
  connect?: ConnectFn;
  /** Shape guard for background messages (default: the protocol's). */
  isMessage?: (x: unknown) => x is BackgroundToEditor;
  /** First reconnect delay while active; doubles up to `maxReconnectMs`. */
  reconnectMs?: number;
  maxReconnectMs?: number;
  log?: (msg: string, detail?: unknown) => void;
}

export const defaultConnect: ConnectFn = () => {
  const port = browser.runtime.connect({ name: HANDOFF_PORT });
  // Reading lastError marks a failed connection as handled (no "Unchecked runtime.lastError").
  port.onDisconnect.addListener(() => void browser.runtime.lastError);
  return port;
};

export function createHandoffClient(opts: HandoffClientOptions = {}): HandoffClient {
  const connect = opts.connect ?? defaultConnect;
  const isMessage = opts.isMessage ?? isBackgroundToEditor;
  const baseDelay = opts.reconnectMs ?? 250;
  const maxDelay = opts.maxReconnectMs ?? 5000;
  const log = opts.log ?? ((msg: string, detail?: unknown) => console.warn(`[instapost] ${msg}`, detail ?? ''));

  const statusListeners = new Set<(s: HandoffStatusMsg) => void>();
  const laneListeners = new Set<(s: HandoffLaneMsg) => void>();
  const connListeners = new Set<(c: boolean) => void>();
  let port: PortLike | null = null;
  let closed = false;
  /** A hand-off is (probably) running: start sent, or the last status was not idle. */
  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = baseDelay;

  const emitConn = (c: boolean): void => {
    for (const l of connListeners) l(c);
  };

  const onMessage = (raw: unknown): void => {
    let ok = false;
    try {
      ok = isMessage(raw);
    } catch (err) {
      log('hand-off status guard failed; message dropped', err);
      return;
    }
    if (!ok) {
      log('malformed hand-off message dropped', raw);
      return;
    }
    const msg = raw as BackgroundToEditor;
    delay = baseDelay;
    if (msg.type === 'handoff/lane') {
      for (const l of laneListeners) l(msg);
      return;
    }
    active = msg.phase !== 'idle';
    for (const l of statusListeners) l(msg);
  };

  const scheduleReconnect = (): void => {
    if (closed || timer !== null || !active) return;
    timer = setTimeout(() => {
      timer = null;
      if (closed || port) return;
      try {
        ensurePort();
      } catch (err) {
        log('hand-off port reconnect failed', err);
        delay = Math.min(delay * 2, maxDelay);
        scheduleReconnect();
      }
    }, delay);
    delay = Math.min(delay * 2, maxDelay);
  };

  function ensurePort(): PortLike {
    if (closed) throw new Error('hand-off client closed');
    if (port) return port;
    const p = connect();
    port = p;
    p.onMessage.addListener((m) => {
      if (port === p) onMessage(m);
    });
    p.onDisconnect.addListener(() => {
      if (port !== p) return;
      port = null;
      emitConn(false);
      scheduleReconnect();
    });
    emitConn(true);
    return p;
  }

  const send = (msg: EditorToBackground): void => {
    try {
      ensurePort().postMessage(msg);
    } catch (err) {
      if (closed) throw err;
      // A port that died silently throws on postMessage: reconnect once and resend.
      port = null;
      ensurePort().postMessage(msg);
    }
  };

  return {
    start(req) {
      active = true;
      send({
        v: 1,
        type: 'handoff/start',
        exportId: req.exportId,
        mode: req.mode,
        screen: req.screen,
        browser: req.browser,
        queue: req.queue,
        ...(req.exportSample ? { exportSample: req.exportSample } : {}),
        ...(req.exportSha256 ? { exportSha256: req.exportSha256 } : {}),
        ...(req.docHash ? { docHash: req.docHash } : {}),
      });
    },
    cancel() {
      send({ v: 1, type: 'handoff/cancel' });
    },
    accountChoice(handoffId, proceed) {
      send({ v: 1, type: 'handoff/account-choice', handoffId, proceed });
    },
    manual(handoffId) {
      send({ v: 1, type: 'handoff/manual', handoffId });
    },
    mark(handoffId, posted) {
      send({ v: 1, type: 'handoff/mark', handoffId, posted });
    },
    enableMsite(lockedUntil) {
      send({ v: 1, type: 'handoff/enable-msite', lockedUntil });
    },
    openInstagram(page, handle) {
      send({ v: 1, type: 'ui/open-instagram', page, ...(handle ? { handle } : {}) });
    },
    forgetAccount() {
      send({ v: 1, type: 'ui/forget-account' });
    },
    useAccount(handoffId) {
      send({ v: 1, type: 'ui/use-account', handoffId });
    },
    resultSeen(handoffId) {
      send({ v: 1, type: 'ui/result-seen', handoffId });
    },
    onStatus(listener) {
      statusListeners.add(listener);
      if (!closed) ensurePort();
      return () => statusListeners.delete(listener);
    },
    onLane(listener) {
      laneListeners.add(listener);
      if (!closed) ensurePort();
      return () => laneListeners.delete(listener);
    },
    onConnection(listener) {
      connListeners.add(listener);
      return () => connListeners.delete(listener);
    },
    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const p = port;
      port = null;
      p?.disconnect();
    },
  };
}
