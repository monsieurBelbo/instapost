/**
 * The composer agent's controller (strategy §3.5, §3.8): one per document, installed once
 * behind the `__instapostAgentV1` sentinel (entrypoints/composer-agent.ts).
 *
 * - Commands come from the background through tabs.sendMessage (frame 0) and are acked at once
 *   with `{ok: true}`; results travel as agent/report and agent/event.
 * - The first valid command pins the hand-off's id and nonce; later commands for another
 *   hand-off are refused (`{ok: false}`), and every outgoing message carries the pinned pair.
 * - `agent/inject` runs at most once per handoffId, even if the command repeats.
 *
 * It reads the DOM and nothing else: no page scripts, no network, no extension storage, and it
 * never activates anything on the page (T3 scans the bundle).
 */
import type { AgentEventName } from '../core/handoff/state.ts';
import type { HandoffId, Nonce } from '../core/model/ids.ts';
import {
  type AgentAck,
  type AgentToBackground,
  type BackgroundToAgent,
  isBackgroundToAgent,
  isGetFileReply,
  type ProbeReport,
} from '../shared/protocol.ts';
import { fileFromPayload, setInputFile } from './inject.ts';
import { type AgentWindow, findStoryInput, probeComposer } from './probes.ts';
import { createWatch, type Watch } from './watch.ts';

/** The slice of runtime messaging the agent uses (injectable for B6). */
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
  | { type: 'agent/event'; event: AgentEventName };

export interface AgentHandle {
  watch: Watch;
  /** The pinned hand-off, once a command arrived. */
  address(): Address | null;
}

export function startAgent(win: AgentWindow, runtime: AgentRuntime): AgentHandle {
  let address: Address | null = null;
  const injectedFor = new Set<HandoffId>();

  function send(out: Outgoing): Promise<unknown> {
    if (!address) return Promise.reject(new Error('no hand-off yet'));
    return runtime.send({ v: 1, ...out, ...address } as AgentToBackground);
  }

  const emit = (event: AgentEventName): void => void send({ type: 'agent/event', event }).catch(() => undefined);
  const watch = createWatch(win, { emit });

  win.navigator.serviceWorker?.addEventListener('controllerchange', () => watch.controllerChanged());

  async function inject(): Promise<void> {
    if (!address || injectedFor.has(address.handoffId)) return;
    injectedFor.add(address.handoffId);
    const input = findStoryInput(win.document);
    if (!input) return watch.injectFailed();
    let reply: unknown;
    try {
      reply = await send({ type: 'agent/get-file' });
    } catch {
      return watch.injectFailed();
    }
    if (!isGetFileReply(reply) || !reply.ok || !reply.mime.startsWith('image/')) return watch.injectFailed();
    try {
      setInputFile(win, input, fileFromPayload(win, reply));
    } catch {
      return watch.injectFailed();
    }
    watch.expectReady();
  }

  function handle(msg: BackgroundToAgent): void {
    switch (msg.type) {
      case 'agent/probe':
        void send({ type: 'agent/report', probe: probeComposer(win) }).catch(() => undefined);
        return;
      case 'agent/watch':
        watch.restart(msg.readyTimeoutMs);
        return;
      case 'agent/inject':
        void inject();
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
