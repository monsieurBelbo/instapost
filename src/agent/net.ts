/**
 * The evidence after Share (ux.md §6.2, IA4): every XHR/fetch resource timing entry that starts after the
 * Share click, reported in batches every 250 ms with a heartbeat (`elapsedMs`) every 2 s, plus the UI facts
 * that only corroborate (Instagram's progress, a new toast, going home).
 *
 * A PerformanceObserver (`buffered: true`) runs from the agent's start in the document: Instagram clears
 * its own resource-timing buffer, so the timeline is never polled. An entry is added when its request ends,
 * so a request still running is invisible (that is why "nothing was sent" can never be proven). Each entry
 * carries the host class, the pathname (query dropped), responseStatus, contentType, whether it was
 * redirected and its offsets from the click; a blocked or failed request still produces an entry, with
 * status 0. The agent never classifies them: the write-endpoint strings live in the background (T3).
 */
import type { NetEntry } from '../core/handoff/state.ts';
import { alertsNow, newToast, progressShown } from './locators.ts';
import type { AgentWindow } from './probes.ts';

export const NET_TICK_MS = 250;
export const NET_HEARTBEAT_MS = 2000;
/** Entries remembered before Share (the observer's buffered ones included). */
const MAX_SEEN = 400;

interface Timing {
  name: string;
  initiatorType?: string;
  startTime: number;
  responseEnd: number;
  responseStatus?: number;
  contentType?: string;
  redirectStart?: number;
  redirectEnd?: number;
}

export interface NetEmit {
  net(entries: NetEntry[], elapsedMs: number): void;
  ui(f: { progressSeen: boolean; toast: 'none' | 'plain' | 'action'; wentHome: boolean }): void;
}

export interface NetReporter {
  /** Starts (or re-bases) the report at `t0` (performance.now() of the click). */
  start(t0: number): void;
  running(): boolean;
  stop(): void;
}

function hostClass(url: string): NetEntry['host'] {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  const host = (m?.[1] ?? '').toLowerCase();
  if (host === 'www.instagram.com') return 'www';
  if (host === 'i.instagram.com') return 'i';
  return 'other';
}

function pathOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(url);
  const path = m ? m[1] || '/' : '';
  return path.slice(0, 200);
}

/** One resource entry as the background gets it (offsets from `t0`). */
export function toNet(e: Timing, t0: number): NetEntry {
  const status = typeof e.responseStatus === 'number' && Number.isInteger(e.responseStatus) ? e.responseStatus : 0;
  return {
    host: hostClass(e.name),
    path: pathOf(e.name),
    status: status >= 0 && status <= 599 ? status : 0,
    type: typeof e.contentType === 'string' ? e.contentType.slice(0, 64) : '',
    redirected: (e.redirectStart ?? 0) > 0 || (e.redirectEnd ?? 0) > 0,
    start: Math.round(e.startTime - t0),
    end: Math.round(e.responseEnd - t0),
  };
}

const isRequest = (e: Timing): boolean => e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'fetch';

export function createNetReporter(win: AgentWindow, emit: NetEmit, now: () => number): NetReporter {
  const seen: Timing[] = [];
  const reported = new Set<Timing>();
  let t0: number | null = null;
  let tick: number | null = null;
  let lastBeat = 0;
  let toastsBefore = new Set<Element>();
  let ui = { progressSeen: false, toast: 'none' as 'none' | 'plain' | 'action', wentHome: false };

  const Observer = (win as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
  if (typeof Observer === 'function') {
    try {
      new Observer((list) => {
        for (const e of list.getEntries() as unknown as Timing[]) {
          if (!isRequest(e)) continue;
          seen.push(e);
          if (seen.length > MAX_SEEN) {
            const old = seen.shift();
            if (old) reported.delete(old);
          }
        }
      }).observe({ type: 'resource', buffered: true });
    } catch {
      // No observer: nothing can be reported, and the outcome rules decide Couldn't confirm.
    }
  }

  function flush(force: boolean): void {
    if (t0 === null) return;
    const base = t0;
    const fresh = seen.filter((e) => !reported.has(e) && e.startTime >= base);
    for (const e of fresh) reported.add(e);
    const t = now();
    if (fresh.length > 0 || force || t - lastBeat >= NET_HEARTBEAT_MS) {
      lastBeat = t;
      for (let i = 0; i < fresh.length || i === 0; i += 64) {
        emit.net(
          fresh.slice(i, i + 64).map((e) => toNet(e, base)),
          Math.max(0, Math.round(t - base)),
        );
        if (fresh.length === 0) break;
      }
    }
    const next = {
      progressSeen: ui.progressSeen || progressShown(win),
      toast: (() => {
        const now2 = newToast(win, toastsBefore);
        const rank = { none: 0, plain: 1, action: 2 } as const;
        return rank[now2] > rank[ui.toast] ? now2 : ui.toast;
      })(),
      wentHome: ui.wentHome || win.location.pathname === '/',
    };
    if (next.progressSeen !== ui.progressSeen || next.toast !== ui.toast || next.wentHome !== ui.wentHome) {
      ui = next;
      emit.ui(ui);
    }
  }

  return {
    start(at) {
      t0 = at;
      toastsBefore = alertsNow(win);
      ui = { progressSeen: false, toast: 'none', wentHome: false };
      // Entries from before the (re-based) click never count.
      for (const e of seen) if (e.startTime < at) reported.add(e);
      lastBeat = now();
      if (tick === null) tick = win.setInterval(() => flush(false), NET_TICK_MS);
    },
    running: () => tick !== null,
    stop() {
      if (tick !== null) win.clearInterval(tick);
      tick = null;
      flush(true);
    },
  };
}
