/** @jsxImportSource react */
/**
 * Service-worker side of the `sw` knob (strategy §6.1, §11 AM30):
 *
 * - `claimOnRegister` (default, F2): every load registers the claim-on-register worker at a URL
 *   that changes per load (`enableAddToHomeScreen=<is_mobile>&zenon_device_id=<per-load id>`), as
 *   Instagram re-registers its root worker on every logged-in load; the new worker claims the page.
 * - `desktopShell` (hypothetical): registers the intercepting worker at its stable URL and asks it
 *   to claim this page.
 * - `claimLate`: the composer registers a claiming worker 2 s after it is ready (registerClaimLate).
 * - `none`: removes the fake's workers.
 *
 * Whatever the mode, a page that a worker takes control of sends one request (the beacon), as
 * Instagram's pages keep requesting: its timing shows whether the worker handled it (P3).
 * All best effort: a failure only shows up as a console warning.
 */
import type { Knobs } from '../knobs.ts';
import { FAKE_PATHS } from '../protocol.ts';

export const CLAIM_LATE_DELAY_MS = 2000;

const isFakeWorker = (r: ServiceWorkerRegistration) =>
  [r.active, r.waiting, r.installing].some((w) => w?.scriptURL.includes('/fake-sw/'));

/** A fresh id per page load, so each load registers a new worker URL (F2's zenon_device_id). */
const perLoadId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** The claim-on-register worker's URL for this load. */
export function claimOnRegisterUrl(isMobile: boolean, id: string = perLoadId()): string {
  const q = new URLSearchParams({ enableAddToHomeScreen: String(isMobile), zenon_device_id: id });
  return `${FAKE_PATHS.swClaimOnRegister}?${q}`;
}

function beaconOnControl(): void {
  let n = 0;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    n++;
    void fetch(`${FAKE_PATHS.beacon}?controller=${n}`, { cache: 'no-store', credentials: 'include' }).catch(
      () => undefined,
    );
  });
}

export async function syncServiceWorker(mode: Knobs['sw'], isMobile: boolean): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    beaconOnControl();
    if (mode === 'claimOnRegister') {
      await navigator.serviceWorker.register(claimOnRegisterUrl(isMobile), { scope: '/' });
    } else if (mode === 'desktopShell') {
      await navigator.serviceWorker.register(FAKE_PATHS.swDesktopShell, { scope: '/' });
      const ready = await navigator.serviceWorker.ready;
      ready.active?.postMessage('claim');
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
