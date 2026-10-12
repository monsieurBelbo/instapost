/** Thin wrapper over scripting.executeScript for the composer agent (strategy §3.6 step 6). */
import { browser } from 'wxt/browser';

export interface ScriptingPort {
  /**
   * Injects the packaged agent into the top frame of `tabId` (isolated world). `fresh` (§11 AM16):
   * the agent installed itself; false when this document already had it (its sentinel was set),
   * i.e. the `loading` that triggered the injection was a same-document navigation. Anything but an
   * explicit `false` from the script counts as fresh, which errs towards a strict re-probe.
   */
  injectComposerAgent(tabId: number): Promise<{ fresh: boolean }>;
}

export const scripting: ScriptingPort = {
  async injectComposerAgent(tabId) {
    const results = await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['/composer-agent.js'],
    });
    return { fresh: results?.[0]?.result !== false };
  },
};
