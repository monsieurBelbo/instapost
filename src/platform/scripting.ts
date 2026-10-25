/**
 * Thin wrapper over scripting.executeScript for the composer tab (strategy §3.6 step 6, §11 AM37):
 * the isolated-world composer agent and, before it, the MAIN-world portrait shim. Both target one frame of
 * the one tab the caller names: the top frame (0) for the window lane's popup (the runner, for the
 * registered composer tab only), or the in-page engine frame's id (docs/inpage.md §3.11, the in-page driver,
 * for the run's tab and the frame webRequest named).
 *
 * Plus `injectPageScript` (FX14, RL-2): the in-page content script, from its packaged file, into the top frame
 * of an Instagram tab that was open before the extension was installed or updated (Chrome injects declared
 * content scripts on new page loads only). Isolated world; its sentinel keeps it to one instance.
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
  injectComposerAgent(tabId: number, frameId?: number): Promise<{ fresh: boolean; documentId?: string }>;
  /**
   * AM37: runs the portrait shim in the top frame of `tabId`, in the page's MAIN world, at once
   * (`injectImmediately`), and returns what the page reads for `screen.orientation.type` afterwards with
   * the shim's state. `install: false` (a guarded build's E2E flag) only reads it. The result comes
   * from the page's world, so it is validated (toPageOrientation): a malformed one reads `failed`.
   * `frameId` (default 0, the top frame): the in-page engine frame (docs/inpage.md §3.11).
   */
  injectPortraitShim(tabId: number, install: boolean, frameId?: number): Promise<PageOrientation>;
}

export const scripting: ScriptingPort = {
  async injectComposerAgent(tabId, frameId = 0) {
    const results = await browser.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ['/composer-agent.js'],
    });
    const first = results?.[0] as { result?: unknown; documentId?: string } | undefined;
    return {
      fresh: first?.result !== false,
      ...(typeof first?.documentId === 'string' ? { documentId: first.documentId } : {}),
    };
  },
  async injectPortraitShim(tabId, install, frameId = 0) {
    // check-bundle T3: the only MAIN-world call in any bundle, in background.js, with this shape (one frame).
    const results = await browser.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      injectImmediately: true,
      func: portraitShim,
      args: [install],
    });
    return toPageOrientation(results?.[0]?.result);
  },
};

/** The in-page content script's packaged file (wxt.config.ts CONTENT_SCRIPT). */
export const PAGE_SCRIPT_FILE = '/instagram-page.js';

/** FX14: the in-page content script into the top frame of `tabId` (isolated world, from its file). */
export async function injectPageScript(tabId: number): Promise<void> {
  await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [PAGE_SCRIPT_FILE] });
}
