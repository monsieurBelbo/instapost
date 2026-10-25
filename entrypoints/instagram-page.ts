/**
 * The in-page content script (inpage-ui-spec.md FI1; docs/inpage.md §8.4, §10.4; src/inpage/page-script.ts).
 * Every build: wxt.config.ts declares it as a `content_scripts` entry for `https://www.instagram.com/*`, top
 * frame only, at document_idle.
 *
 * It is an unlisted script, not a WXT `*.content.ts`: WXT's content-script context announces itself to the
 * page with a `window.postMessage` (`wxt:content-script-started`), which Instagram's own scripts would see
 * (R25). This one runs once per document behind its isolated-world sentinel and says nothing to the page.
 * The sentinel holds the running instance: a new injection replaces an orphan (its extension was reloaded)
 * instead of stepping aside for it (FX14).
 *
 * Before it touches the page it asks the background (`inpage/attach`): the window lane's composer window is
 * an Instagram tab too, and that lane stays exactly as it was, so there the script does nothing at all.
 */
import { browser } from 'wxt/browser';
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { isAttachReply } from '../src/inpage/messages.ts';
import { startPageScript } from '../src/inpage/page-script.ts';

interface Instance {
  alive(): boolean;
  dispose(): void;
}

export default defineUnlistedScript(() => {
  const g = globalThis as { __instapostInpageV2?: Instance };
  const prior = g.__instapostInpageV2;
  if (prior?.alive()) return;
  prior?.dispose();
  const alive = (): boolean => {
    try {
      return typeof browser.runtime?.id === 'string';
    } catch {
      return false;
    }
  };
  let started: { dispose(): void } | null = null;
  let disposed = false;
  g.__instapostInpageV2 = {
    alive,
    dispose: () => {
      disposed = true;
      started?.dispose();
    },
  };
  const start = () => {
    if (disposed || !alive()) return;
    started = startPageScript(window, {
      id: browser.runtime.id,
      alive,
      // No leading slash: only the manifest's own spelling gets the dynamic URL (`use_dynamic_url`, N3; seen
      // in the sealed browser 2026-10-14: `/composer.html` gives the fixed extension-id URL).
      panelUrl: () => (browser.runtime.getURL as (path: string) => string)('composer.html'),
      send: (msg) => {
        if (!alive()) return;
        void browser.runtime.sendMessage(msg).catch(() => undefined);
      },
      request: (msg) => (alive() ? browser.runtime.sendMessage(msg) : Promise.reject(new Error('orphaned'))),
      listen: (listener) => browser.runtime.onMessage.addListener(listener),
      connect: (name) => {
        const port = browser.runtime.connect({ name });
        return {
          disconnect: () => port.disconnect(),
          onDisconnect: (cb) => port.onDisconnect.addListener(() => cb()),
        };
      },
    });
  };
  browser.runtime.sendMessage({ v: 1, type: 'inpage/attach' }).then(
    (reply: unknown) => {
      if (isAttachReply(reply) && reply.attach) start();
    },
    () => undefined,
  );
});
