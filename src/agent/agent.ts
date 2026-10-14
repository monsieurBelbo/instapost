/**
 * The composer agent's controller (strategy §3.5, ux.md §10, IA6): one per document, installed once behind
 * the `__instapostAgentV1` sentinel (entrypoints/composer-agent.ts).
 *
 * - Commands come from the background through tabs.sendMessage (frame 0) and are acked at once with
 *   `{ok: true}`; results travel as agent/report, agent/event and agent/fact.
 * - The first valid command pins the hand-off's id and nonce; later commands for another hand-off are
 *   refused (`{ok: false}`), and every outgoing message carries the pinned pair.
 * - Local guards (IA6): one open-entry, one insert and one Share per handoffId, whatever the background
 *   sends; none at all once Finish by hand began (`agent/observe`): from then on the agent only observes.
 *
 * It reads the DOM, assigns the photo to the story input Instagram armed, and taps Instagram's own +, Story
 * and Share through tap.ts, the one audited helper. Nothing else: no page scripts, no network, no
 * extension storage (check-bundle T3 scans the bundle).
 */
import type { AgentEventName, AgentFact, MenuFingerprint } from '../core/handoff/state.ts';
import type { HandoffId, Nonce } from '../core/model/ids.ts';
import { b64ToBytes } from '../shared/b64.ts';
import {
  type AgentAck,
  type AgentToBackground,
  type BackgroundToAgent,
  isBackgroundToAgent,
  type ProbeReport,
} from '../shared/protocol.ts';
import { type DriveDeps, insert, openEntry, sampleOf, sampleScore, share, watchCompose } from './drive.ts';
import { composerState, findEntry, readAccount } from './locators.ts';
import { createNetReporter } from './net.ts';
import { type AgentWindow, probeComposer } from './probes.ts';
import { newBudget, observeClick, type ShareToken } from './tap.ts';
import { createWatch, type Watch } from './watch.ts';

/** The slice of runtime messaging the agent uses (injectable for tests). */
export interface AgentRuntime {
  /** runtime.id, to check that commands come from this extension. */
  id: string;
  send(msg: AgentToBackground): Promise<unknown>;
  listen(
    listener: (msg: unknown, sender: { id?: string }, sendResponse: (ack: AgentAck) => void) => boolean | undefined,
  ): void;
}

interface Address {
  handoffId: HandoffId;
  nonce: Nonce;
}

type Outgoing =
  | { type: 'agent/report'; probe: ProbeReport }
  | { type: 'agent/get-file' }
  | { type: 'agent/event'; event: AgentEventName }
  | { type: 'agent/fact'; fact: AgentFact };

export interface AgentHandle {
  watch: Watch;
  /** The pinned hand-off, once a command arrived. */
  address(): Address | null;
}

export interface AgentOptions {
  /** Test seam: shrinks the drive's waits (0 < scale ≤ 1). */
  scale?: number;
  random?: () => number;
}

/** Finish by hand: how long the owner's Share click is watched for (the background's own deadline is 5 min). */
const OBSERVE_MS = 6 * 60 * 1000;

export function startAgent(win: AgentWindow, runtime: AgentRuntime, opts: AgentOptions = {}): AgentHandle {
  let address: Address | null = null;
  const budget = newBudget();
  const done = new Set<string>();
  let observing = false;
  /** The story input the Story item armed in this document (the only input the insert may fill). */
  let armed: HTMLInputElement | null = null;

  function send(out: Outgoing): Promise<unknown> {
    if (!address) return Promise.reject(new Error('no hand-off yet'));
    return runtime.send({ v: 1, ...out, ...address } as AgentToBackground);
  }
  const emit = (event: AgentEventName): void => void send({ type: 'agent/event', event }).catch(() => undefined);
  const fact = (f: AgentFact): void => void send({ type: 'agent/fact', fact: f }).catch(() => undefined);

  const watch = createWatch(win, { emit });
  win.navigator.serviceWorker?.addEventListener('controllerchange', () => watch.controllerChanged());

  const now = () => win.performance.now();
  const net = createNetReporter(
    win,
    {
      net: (entries, elapsedMs) => fact({ kind: 'net', entries, elapsedMs }),
      ui: (u) => fact({ kind: 'ui', ...u }),
    },
    now,
  );

  win.document.addEventListener('visibilitychange', () => {
    if (address) fact({ kind: 'visibility', hidden: win.document.visibilityState === 'hidden' });
  });

  const deps: DriveDeps = {
    win,
    budget,
    now,
    sleep: (ms) => new Promise((resolve) => void win.setTimeout(resolve, ms)),
    random: opts.random ?? (() => Math.random()),
    ...(opts.scale !== undefined ? { scale: opts.scale } : {}),
  };

  /** Runs `step` once per hand-off, never after Finish by hand began. */
  function once(step: string, run: () => Promise<void>): void {
    if (!address || observing) return;
    const key = `${address.handoffId}:${step}`;
    if (done.has(key)) return;
    done.add(key);
    void run().catch(() => undefined);
  }

  async function doOpenEntry(fp: MenuFingerprint | null): Promise<void> {
    const before = findEntry(win);
    const out = await openEntry(deps, fp);
    if (out.result === 'armed' && before.ok) armed = before.parts.storyInput;
    fact({ kind: 'entry', ...out });
  }

  async function doInsert(): Promise<void> {
    const r = await insert(deps, armed ?? null, () => send({ type: 'agent/get-file' }));
    fact(r.ok ? { kind: 'inserted' } : { kind: 'insert-failed', why: r.why });
  }

  async function doCompose(sample: string | null): Promise<void> {
    const want = sample ? b64ToBytes(sample) : null;
    const score = want
      ? async (canvas: HTMLCanvasElement) => {
          const got = await sampleOf(win, canvas);
          return got ? sampleScore(got, want) : null;
        }
      : null;
    fact(await watchCompose(deps, score));
  }

  async function doShare(token: ShareToken): Promise<void> {
    const r = await share(deps, token, (t0) => net.start(t0));
    fact(r.ok ? { kind: 'share-done', t0Wall: r.t0Wall } : { kind: 'share-refused', why: r.why });
  }

  /** Finish by hand: report the requests from now on, and the owner's own click on Share. */
  async function doObserve(): Promise<void> {
    net.start(now());
    const end = now() + OBSERVE_MS;
    while (now() < end) {
      const click = await observeClick(win, win.document, Math.max(1, end - now()));
      if (!click) return;
      const st = composerState(win);
      const target = click.target as Node | null;
      if (click.trusted && target && st.controls.some((c) => c.contains(target))) {
        net.start(click.at);
        fact({ kind: 'owner-share', t0Wall: Date.now() });
        return;
      }
    }
  }

  function handle(msg: BackgroundToAgent): void {
    switch (msg.type) {
      case 'agent/probe': {
        // P3: the watch's observer also sees entries past the page's full resource-timing buffer.
        const entry = findEntry(win);
        const probe = probeComposer(win, { account: readAccount(win), entryFound: entry.ok });
        const report = probe.swIntercepted !== true && watch.intercepted() ? { ...probe, swIntercepted: true } : probe;
        void send({ type: 'agent/report', probe: report }).catch(() => undefined);
        return;
      }
      case 'agent/watch':
        watch.restart();
        return;
      case 'agent/drive':
        // P3: the tripwire keeps watching while the autopilot works.
        if (!watch.running()) watch.restart();
        switch (msg.step) {
          case 'open-entry':
            once('open-entry', () => doOpenEntry(msg.fingerprint));
            return;
          case 'insert':
            once('insert', doInsert);
            return;
          case 'compose':
            once('compose', () => doCompose(msg.sample));
            return;
          case 'share': {
            const token: ShareToken = { share: true, handoffId: msg.handoffId };
            once('share', () => doShare(token));
            return;
          }
        }
        return;
      case 'agent/observe':
        if (!address || observing) return;
        observing = true;
        if (!watch.running()) watch.restart();
        void doObserve().catch(() => undefined);
        return;
    }
  }

  runtime.listen((msg, sender, sendResponse) => {
    if (sender.id !== runtime.id) return undefined;
    if (!isBackgroundToAgent(msg)) {
      sendResponse({ ok: false });
      return undefined;
    }
    if (address && (address.handoffId !== msg.handoffId || address.nonce !== msg.nonce)) {
      sendResponse({ ok: false });
      return undefined;
    }
    address ??= { handoffId: msg.handoffId, nonce: msg.nonce };
    sendResponse({ ok: true });
    handle(msg);
    return undefined;
  });

  return { watch, address: () => address };
}
