/**
 * Composer agent: isolated world, injected with scripting.executeScript into the registered
 * composer tab only (strategy §3.1, §3.8). Probes, H1 insert and watch live in src/agent/*.
 *
 * The sentinel keeps it to one install per document: a repeated injection into the same
 * document (an AM2 re-probe that turned out not to be a new document) reuses the first one.
 * The script's result tells the background which it was (§11 AM16): `true` when it installed
 * itself (a new document), `false` when the sentinel was already set (the same document).
 *
 * Never: clicks, synthetic pointer/keyboard/drag events, network calls, extension storage (T3).
 */
import { browser } from 'wxt/browser';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { startAgent } from '../src/agent/agent.ts';
import type { AgentWindow } from '../src/agent/probes.ts';

export default defineUnlistedScript((): boolean => {
  const g = globalThis as { __instapostAgentV1?: true };
  if (g.__instapostAgentV1) return false;
  g.__instapostAgentV1 = true;
  startAgent(window as AgentWindow, {
    id: browser.runtime.id,
    send: (msg) => browser.runtime.sendMessage(msg),
    listen: (listener) => browser.runtime.onMessage.addListener(listener),
  });
  return true;
});
