// Fake Instagram service worker for the knob `sw=claimOnRegister`, the default (strategy §11 AM30;
// F2, logged-out reading of production code on 2026-10-12).
//
// Every page load registers this script at a URL that changes
// (`?enableAddToHomeScreen=<is_mobile>&zenon_device_id=<per-load id>`), so each load installs a new
// worker. It activates at once and claims every open client: the composer becomes controlled
// within about a second on every hand-off, which fires `controllerchange` (counted, P2).
//
// It has NO fetch handler, like Instagram's root worker: the page's requests never go through it,
// so they keep their tab id (rule 1001 applies) and their PerformanceResourceTiming.workerStart is 0
// (the P3 tripwire stays quiet).
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      if (self.registration.navigationPreload) await self.registration.navigationPreload.disable();
      await self.clients.claim();
    })(),
  ),
);
