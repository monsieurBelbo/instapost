/** @jsxImportSource react */
/**
 * Service-worker side of the `sw` knob (strategy §6.1). `desktopShell` registers a worker that
 * answers navigations from its own context (desktop UA); `claimLate` registers a worker that
 * claims every client, 2 s after the composer is ready; `none` removes the fake's workers.
 * All best effort: a failure only shows up as a console warning.
 */
import type { Knobs } from '../knobs.ts';
import { FAKE_PATHS } from '../protocol.ts';

export const CLAIM_LATE_DELAY_MS = 2000;

const isFakeWorker = (r: ServiceWorkerRegistration) =>
  [r.active, r.waiting, r.installing].some((w) => w?.scriptURL.includes('/fake-sw/'));

export async function syncServiceWorker(mode: Knobs['sw']): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    if (mode === 'desktopShell') {
      await navigator.serviceWorker.register(FAKE_PATHS.swDesktopShell, { scope: '/' });
    } else if (mode === 'none') {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.filter(isFakeWorker).map((r) => r.unregister()));
    }
  } catch (err) {
    console.warn('fake-ig: service worker sync failed', err);
  }
}

export function registerClaimLate(): void {
  navigator.serviceWorker
    ?.register(FAKE_PATHS.swClaimLate, { scope: '/' })
    .catch((err) => console.warn('fake-ig: claimLate registration failed', err));
}
