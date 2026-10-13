/**
 * The active hand-off in chrome.storage.session (strategy §3.1, §3.3): the reducer state and
 * the pending timer deadlines. The runner writes the state after every transition, so a
 * service worker that Chrome stopped mid-flow resumes from here on its next event.
 *
 * storage.session keeps the default access level (trusted contexts only), so the composer
 * agent never sees it. Anything unreadable loads as IDLE: the startup cleanup then removes
 * the session rules, which is always safe.
 */
import { type HandoffState, type HandoffTimer, IDLE } from '../core/handoff/state.ts';
import { type Area, type SessionSchema, session } from '../platform/storage.ts';
import { HANDOFF_PHASES } from '../shared/protocol.ts';

export type TimerDeadlines = Partial<Record<HandoffTimer, number>>;

export interface StoredSession {
  state: HandoffState;
  timers: TimerDeadlines;
}

export interface SessionStore {
  load(): Promise<StoredSession>;
  saveState(state: HandoffState): Promise<void>;
  saveTimers(timers: TimerDeadlines): Promise<void>;
}

/** Every reducer timer: one left out here would be lost with a service-worker restart (AM20's `navigation`). */
const TIMER_NAMES = [
  'closeDelay',
  'inactivity',
  'navigation',
  'fitRetry',
  'resizeDeadline',
  'resizePoll',
  'inputWait',
] as const satisfies readonly HandoffTimer[];
const _timersComplete: [Exclude<HandoffTimer, (typeof TIMER_NAMES)[number]>] extends [never] ? true : never = true;
void _timersComplete;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Enough of a HandoffState to resume: a known phase, and the session ids once active. */
export function isStoredState(x: unknown): x is HandoffState {
  if (!isObj(x) || !HANDOFF_PHASES.includes(x.phase as never)) return false;
  if (x.phase === 'idle') return x.last === null || isObj(x.last);
  return (
    typeof x.handoffId === 'string' &&
    typeof x.nonce === 'string' &&
    Array.isArray(x.phaseLog) &&
    typeof x.lastEventAt === 'number'
  );
}

function timersOf(x: unknown): TimerDeadlines {
  const out: TimerDeadlines = {};
  if (!isObj(x)) return out;
  for (const name of TIMER_NAMES) {
    const t = x[name];
    if (typeof t === 'number' && Number.isFinite(t)) out[name] = t;
  }
  return out;
}

export function sessionStore(area: Area<SessionSchema> = session): SessionStore {
  return {
    async load() {
      const [state, timers] = await Promise.all([area.get('handoff'), area.get('timers')]);
      return { state: isStoredState(state) ? state : IDLE, timers: timersOf(timers) };
    },
    async saveState(state) {
      await area.set('handoff', state);
    },
    async saveTimers(timers) {
      await area.set('timers', timers);
    },
  };
}
