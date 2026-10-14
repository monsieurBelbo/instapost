/**
 * The agent's watch (strategy §3.6, P2, P3, P5; ux.md IA4). A 250 ms poll reports:
 *
 * - `input-appeared`: a story-input candidate (C4) is in the DOM (msite mounts its header after hydration);
 * - `account-appeared`: exactly one account link is readable (C14), for the same reason;
 * - `sw-controller-change`: a service worker took control of this document (diagnostics only since P2),
 *   reported once per `controllerchange` (not again on a restart), so the background's count is the real one;
 * - `sw-intercepted` (P3): a www/i.instagram.com request of this document was handled by a service worker.
 *   The page's resource-timing buffer stops growing at 250 entries (and Instagram clears it), so a
 *   PerformanceObserver created when the agent starts (`buffered`) sees every later entry too.
 *
 * The composer's own state (C6/C9 of the hand-off era) is gone: the compose watch (drive.ts) reports the
 * composer once its Share footer settles, and going home after Share is corroboration only (net.ts).
 * `restart` (every `agent/watch`) forgets what this run reported and re-reports the current state at once.
 */
import type { AgentEventName } from '../core/handoff/state.ts';
import { readAccount } from './locators.ts';
import {
  type AgentWindow,
  hasStoryCandidate,
  navigationIntercepted,
  resourceIntercepted,
  type TimingLike,
} from './probes.ts';

export const WATCH_TICK_MS = 250;

export interface Watch {
  /** Starts or restarts the run. */
  restart(): void;
  /** From the `controllerchange` listener. */
  controllerChanged(): void;
  /** P3: a worker handled a www/i.instagram.com request of this document (scan or observer), so far. */
  intercepted(): boolean;
  stop(): void;
  running(): boolean;
}

export interface WatchOptions {
  emit(event: AgentEventName): void;
}

export function createWatch(win: AgentWindow, opts: WatchOptions): Watch {
  let controllerChanges = 0;
  let controllerReported = 0;
  let intercepted = false;
  let scanned = 0;
  let navChecked = false;
  let interval: number | null = null;
  const reported = new Set<AgentEventName>();

  function once(event: AgentEventName): void {
    if (reported.has(event)) return;
    reported.add(event);
    opts.emit(event);
  }

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

  function reportControllerChanges(): void {
    if (interval === null) return;
    while (controllerReported < controllerChanges) {
      controllerReported++;
      opts.emit('sw-controller-change');
    }
  }

  function tick(): void {
    if (hasStoryCandidate(win.document)) once('input-appeared');
    if (readAccount(win).handle !== null) once('account-appeared');
    reportControllerChanges();
    scanInterception();
    if (intercepted) once('sw-intercepted');
  }

  function halt(): void {
    if (interval !== null) win.clearInterval(interval);
    interval = null;
  }

  return {
    restart() {
      reported.clear();
      halt();
      interval = win.setInterval(tick, WATCH_TICK_MS);
      tick();
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
