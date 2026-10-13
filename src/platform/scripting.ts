/**
 * Thin wrapper over scripting.executeScript for the composer tab (strategy §3.6 step 6, §11 AM37):
 * the isolated-world composer agent and, before it, the MAIN-world portrait shim. Both target the one
 * tab the caller names, top frame only; the runner calls them for the registered composer tab only.
 */
import { browser } from 'wxt/browser';
import { portraitShim } from '../agent/portrait-shim.ts';
import type { PageOrientation } from '../core/ig-contract/contract.ts';
import { toPageOrientation } from '../shared/protocol.ts';

export interface ScriptingPort {
  /**
   * Injects the packaged agent into the top frame of `tabId` (isolated world). `fresh` (§11 AM16):
   * the agent installed itself; false when this document already had it (its sentinel was set),
   * i.e. the `loading` that triggered the injection was a same-document navigation. Anything but an
   * explicit `false` from the script counts as fresh, which errs towards a strict re-probe.
   */
  injectComposerAgent(tabId: number): Promise<{ fresh: boolean }>;
  /**
   * AM37: runs the portrait shim in the top frame of `tabId`, in the page's MAIN world, at once
   * (`injectImmediately`), and returns what the page reads for `screen.orientation.type` afterwards with
   * the shim's state. `install: false` (a guarded build's E2E flag) only reads it. The result comes
   * from the page's world, so it is validated (toPageOrientation): a malformed one reads `failed`.
   */
  injectPortraitShim(tabId: number, install: boolean): Promise<PageOrientation>;
}

export const scripting: ScriptingPort = {
  async injectComposerAgent(tabId) {
    const results = await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['/composer-agent.js'],
    });
    return { fresh: results?.[0]?.result !== false };
  },
  async injectPortraitShim(tabId, install) {
    // check-bundle T3: the only MAIN-world call in any bundle, in background.js, with this shape.
    const results = await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: 'MAIN',
      injectImmediately: true,
      func: portraitShim,
      args: [install],
    });
    return toPageOrientation(results?.[0]?.result);
  },
};
