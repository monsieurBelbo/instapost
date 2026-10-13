/**
 * The agent's watch (strategy §3.6 step 8, §3.8, §3.9 C6/C9). All waiting happens here, in the
 * composer document, so the background stays event-driven. A 250 ms poll reports:
 *
 * - `input-appeared`: a story-input candidate (C4) is in the DOM;
 * - `composer-ready`: C6 holds on a canvas that was not already ready when this document's watch
 *   first started (AM24: a pre-existing canvas, e.g. a camera preview, never counts until it has
 *   stopped satisfying C6 and does again). In an H1 run (`readyTimeoutMs > 0`) it is reported only
 *   after the insert (`expectReady`), so it always speaks for the inserted file;
 * - `composer-left` (C9): the path left `/create/story` (each time it does, after being on it), or
 *   the ready canvas has been gone for more than C9_CANVAS_GONE_MS. The watch keeps running after
 *   it (AM18): the background decides whether it counts, and a composer left before it was used
 *   (a client-side redirect home) is followed by + → Story and a pick in the same document;
 * - `inject-unconfirmed` (AM28): after an H1 insert was dispatched, C6 did not hold within the ready
 *   deadline (the file may still be in the composer, e.g. under 50% coverage or a stale canvas);
 * - `inject-ignored`: the insert could not be made at all (no input, no file, the assignment threw);
 * - `sw-controller-change`: a service worker took control of this document (reported from the
 *   `controllerchange` listener, which the agent installs once per document). Diagnostics only since
 *   P2: Instagram's worker claims every logged-in page (F2). Reported once per `controllerchange`
 *   (not again on a restart), so the background's count is the real one;
 * - `sw-intercepted` (P3): a www/i.instagram.com request of this document was handled by a service
 *   worker (resource timing `workerStart > 0`, or the navigation's when it was not a reload). Scanned
 *   incrementally every tick, so a worker that claims the page after the probe is still caught. The
 *   page's resource-timing buffer stops growing at 250 entries (its default, which an Instagram page
 *   can fill), so a PerformanceObserver created when the agent starts in the document (`buffered`)
 *   sees every later entry too; the agent never resizes the page's buffer (that would change page
 *   state). `intercepted()` lets the probe report what the observer saw.
 *
 * `restart` (every `agent/watch`) forgets what this run reported and re-reports the current
 * state at once, e.g. `composer-ready` straight away when the composer is already ready. What
 * the document showed (composer path seen, canvas seen, the canvases ready at the first start) is
 * kept across restarts.
 */
import type { AgentEventName } from '../core/handoff/state.ts';
import { INJECT_READY_TIMEOUT_MS } from '../core/handoff/state.ts';
import { C9_CANVAS_GONE_MS } from '../core/ig-contract/contract.ts';
import {
  type AgentWindow,
  hasStoryCandidate,
  isComposerPath,
  navigationIntercepted,
  readyCanvases,
  resourceIntercepted,
  type TimingLike,
} from './probes.ts';

export const WATCH_TICK_MS = 250;

export interface Watch {
  /** Starts or restarts the run. `readyTimeoutMs > 0`: the H1 ready deadline after an insert; 0: none. */
  restart(readyTimeoutMs: number): void;
  /** An insert was dispatched: C6 must hold within the run's deadline (default 10 s), else inject-unconfirmed. */
  expectReady(): void;
  /** The insert could not be made (no input, no file): inject-ignored at once. */
  injectFailed(): void;
  /** From the `controllerchange` listener. */
  controllerChanged(): void;
  /** P3: a worker handled a www/i.instagram.com request of this document (scan or observer), so far. */
  intercepted(): boolean;
  stop(): void;
  running(): boolean;
}

export interface WatchOptions {
  emit(event: AgentEventName): void;
  /** Defaults to win.performance.now(). */
  now?: () => number;
}

export function createWatch(win: AgentWindow, opts: WatchOptions): Watch {
  const now = opts.now ?? (() => win.performance.now());
  // Document facts, kept across restarts.
  let composerSeen = false;
  let readySeen = false;
  let goneSince: number | null = null;
  /** P2: `controllerchange` events in this document, and how many were reported. */
  let controllerChanges = 0;
  let controllerReported = 0;
  /** P3: a worker handled one of this document's requests (a document fact, re-reported on restart). */
  let intercepted = false;
  /** Resource entries already scanned (the buffer only grows, unless the page clears it). */
  let scanned = 0;
  let navChecked = false;
  /** C6 canvases already ready when the watch first started in this document (AM24). */
  let stale: Set<HTMLCanvasElement> | null = null;
  // The current run.
  let interval: number | null = null;
  let readyTimeoutMs = 0;
  let deadline: number | null = null;
  /** H1: the insert happened in this run, so composer-ready may be reported. */
  let inserted = false;
  const reported = new Set<AgentEventName>();

  function once(event: AgentEventName): void {
    if (reported.has(event)) return;
    reported.add(event);
    opts.emit(event);
  }

  /** P3: scans the timeline entries added since the last tick (resources) and the navigation entry once. */
  function scanInterception(): void {
    if (intercepted) return;
    const perf = win.performance as Partial<Performance> | undefined;
    if (!perf || typeof perf.getEntriesByType !== 'function') return;
    try {
      if (!navChecked) {
        const nav = perf.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        if (nav && navigationIntercepted(nav)) intercepted = true;
        navChecked = true;
      }
      const res = perf.getEntriesByType('resource') as PerformanceResourceTiming[];
      // clearResourceTimings() by the page shrinks the buffer: start over.
      if (res.length < scanned) scanned = 0;
      for (let i = scanned; i < res.length && !intercepted; i++) {
        const e = res[i];
        if (e && resourceIntercepted(e)) intercepted = true;
      }
      scanned = res.length;
    } catch {
      // The timeline is unreadable here: the probes report `swIntercepted: 'unknown'`.
    }
  }

  /**
   * P3: every resource entry from the agent's start on (and the buffered ones before it), past the
   * timeline buffer's 250-entry limit. Without PerformanceObserver (or if observing throws) the scan
   * alone remains.
   */
  function observeInterception(): void {
    const Observer = (win as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
    if (typeof Observer !== 'function') return;
    try {
      const observer = new Observer((list) => {
        if (intercepted) return;
        if (list.getEntries().some((e) => resourceIntercepted(e as unknown as TimingLike))) {
          intercepted = true;
          observer.disconnect();
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // The scan of getEntriesByType still runs every tick.
    }
  }
  observeInterception();

  /** C6 on a canvas that was not ready before the watch began; stale ones that stop being ready count again later. */
  function readyNow(): boolean {
    const ready = readyCanvases(win);
    if (stale) for (const el of stale) if (!ready.includes(el)) stale.delete(el);
    return ready.some((el) => !stale?.has(el));
  }

  function tick(): void {
    const t = now();
    const onComposer = isComposerPath(win.location.pathname);
    if (onComposer) {
      composerSeen = true;
      // Back on the composer: a later leave is a new composer-left.
      reported.delete('composer-left');
    }

    if (readyNow()) {
      readySeen = true;
      goneSince = null;
      if (readyTimeoutMs === 0 || inserted) {
        deadline = null;
        once('composer-ready');
      }
    } else if (readySeen && goneSince === null) {
      goneSince = t;
    }
    if (hasStoryCandidate(win.document)) once('input-appeared');
    reportControllerChanges();
    scanInterception();
    if (intercepted) once('sw-intercepted');

    const canvasGone = goneSince !== null && t - goneSince > C9_CANVAS_GONE_MS;
    if ((composerSeen && !onComposer) || canvasGone) {
      once('composer-left');
      if (canvasGone) {
        // One report per ready episode; a canvas that comes back starts a new one.
        readySeen = false;
        goneSince = null;
      }
    }
    if (deadline !== null && t >= deadline) {
      deadline = null;
      once('inject-unconfirmed');
    }
  }

  function reportControllerChanges(): void {
    if (interval === null) return;
    while (controllerReported < controllerChanges) {
      controllerReported++;
      opts.emit('sw-controller-change');
    }
  }

  function halt(): void {
    if (interval !== null) win.clearInterval(interval);
    interval = null;
  }

  function restart(ms: number): void {
    stale ??= new Set(readyCanvases(win));
    reported.clear();
    readyTimeoutMs = ms > 0 ? ms : 0;
    deadline = null;
    inserted = false;
    halt();
    interval = win.setInterval(tick, WATCH_TICK_MS);
    tick();
  }

  return {
    restart,
    expectReady() {
      if (interval === null) restart(readyTimeoutMs);
      inserted = true;
      deadline = now() + (readyTimeoutMs > 0 ? readyTimeoutMs : INJECT_READY_TIMEOUT_MS);
      tick();
    },
    injectFailed() {
      deadline = null;
      once('inject-ignored');
    },
    controllerChanged() {
      controllerChanges++;
      reportControllerChanges();
    },
    intercepted() {
      scanInterception();
      return intercepted;
    },
    stop: halt,
    running: () => interval !== null,
  };
}
