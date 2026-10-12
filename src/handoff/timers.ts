/**
 * Hand-off timers for an MV3 service worker (strategy §3.6; reducer `armTimer`/`clearTimer`).
 *
 * Why setTimeout plus persisted deadlines, not chrome.alarms:
 * - the manifest has no `alarms` permission (§5 lists every permission; T1 snapshots them);
 * - `closeDelay` is 3 s, below the alarms API's 30 s minimum anyway.
 *
 * MV3 safety:
 * - Every deadline is written to storage.session before it is relied on. A worker that Chrome
 *   stopped re-arms the pending ones on its next start (`restore`), and fires overdue ones at
 *   once, before any other event, because they fell due while it was stopped.
 * - While a deadline is pending (that is, during a hand-off, since `inactivity` is armed at
 *   start), a keep-alive pings a cheap extension API every 20 s: since Chrome 110 extension API
 *   calls reset the worker's 30 s idle timer, so the 15-minute inactivity close fires on time
 *   even when the owner leaves the popup untouched. Outside a hand-off nothing runs.
 */
import type { HandoffTimer } from '../core/handoff/state.ts';
import type { TimerDeadlines } from './session-store.ts';

/** Below the service worker's 30 s idle timeout. */
export const KEEPALIVE_MS = 20_000;

/** Time and timers, injected so tests can drive them. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
};

export interface TimerOptions {
  clock: Clock;
  /** Persists the full set of deadlines (storage.session). */
  save(deadlines: TimerDeadlines): Promise<void>;
  /** A deadline elapsed; the runner queues a `take` and the `timer` event. */
  onDue(name: HandoffTimer): void;
  /** A cheap extension API call; omitted in tests. */
  keepAlive?: () => void;
}

export interface HandoffTimers {
  /** Replaces any pending timer of the same name. */
  arm(name: HandoffTimer, ms: number): Promise<void>;
  /** No-op when none is pending. */
  clear(name: HandoffTimer): Promise<void>;
  /** After a restart: schedules future deadlines and returns the overdue ones (not yet taken). */
  restore(deadlines: TimerDeadlines): HandoffTimer[];
  /**
   * Consumes a due deadline: true when it is pending and has elapsed (it is then removed and
   * saved); a deadline still in the future is rescheduled; false otherwise.
   */
  take(name: HandoffTimer): Promise<boolean>;
  pending(): TimerDeadlines;
}

export function createTimers(opts: TimerOptions): HandoffTimers {
  const { clock } = opts;
  const deadlines: TimerDeadlines = {};
  const handles = new Map<HandoffTimer, unknown>();
  let keepAlive: unknown = null;

  const names = (): HandoffTimer[] => Object.keys(deadlines) as HandoffTimer[];

  function syncKeepAlive(): void {
    if (!opts.keepAlive) return;
    const want = names().length > 0;
    if (want && keepAlive === null) keepAlive = clock.setInterval(opts.keepAlive, KEEPALIVE_MS);
    if (!want && keepAlive !== null) {
      clock.clearInterval(keepAlive);
      keepAlive = null;
    }
  }

  function cancel(name: HandoffTimer): void {
    const h = handles.get(name);
    if (h !== undefined) clock.clearTimeout(h);
    handles.delete(name);
  }

  function schedule(name: HandoffTimer, ms: number): void {
    cancel(name);
    handles.set(
      name,
      clock.setTimeout(
        () => {
          handles.delete(name);
          opts.onDue(name);
        },
        Math.max(0, ms),
      ),
    );
  }

  const save = () => opts.save({ ...deadlines });

  return {
    async arm(name, ms) {
      deadlines[name] = clock.now() + Math.max(0, ms);
      schedule(name, ms);
      syncKeepAlive();
      await save();
    },
    async clear(name) {
      if (deadlines[name] === undefined) return;
      delete deadlines[name];
      cancel(name);
      syncKeepAlive();
      await save();
    },
    restore(stored) {
      const now = clock.now();
      const overdue: HandoffTimer[] = [];
      for (const [name, at] of Object.entries(stored) as [HandoffTimer, number][]) {
        deadlines[name] = at;
        if (at <= now) overdue.push(name);
        else schedule(name, at - now);
      }
      syncKeepAlive();
      return overdue;
    },
    async take(name) {
      const at = deadlines[name];
      if (at === undefined) return false;
      const left = at - clock.now();
      if (left > 0) {
        schedule(name, left);
        return false;
      }
      delete deadlines[name];
      cancel(name);
      syncKeepAlive();
      await save();
      return true;
    },
    pending: () => ({ ...deadlines }),
  };
}
