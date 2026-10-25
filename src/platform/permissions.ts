/**
 * The image-CDN host permissions (docs/repost.md RP-20, AM55): `optional_host_permissions` in the manifest,
 * requested only on the owner's click (Allow in the composer, or the editor's Settings row). The only
 * `permissions.request` in the extension; check-bundle T3 bans it in the background, the agent and the content
 * script, and the manifest's optional list holds exactly CDN_ORIGINS, so nothing else can be granted.
 */
import { browser } from 'wxt/browser';
import { CDN_ORIGINS } from '../core/repost/cdn-url.ts';

export async function cdnGranted(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [...CDN_ORIGINS] });
  } catch {
    return false;
  }
}

/**
 * Must run inside the owner's click (user activation). Throws when the browser refuses to ask (R40). The
 * argument's shape is pinned by check-bundle (`{origins:[...<the constant>]}`).
 */
export async function requestCdn(): Promise<boolean> {
  return await browser.permissions.request({ origins: [...CDN_ORIGINS] });
}

/** Calls `f` when the CDN permission is granted (here or in another extension page). */
export function onCdnGranted(f: () => void): () => void {
  const listener = (p: { origins?: string[] }) => {
    if ((p.origins ?? []).some((o) => CDN_ORIGINS.includes(o))) f();
  };
  try {
    browser.permissions.onAdded.addListener(listener);
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      browser.permissions.onAdded.removeListener(listener);
    } catch {
      // The extension went away.
    }
  };
}
