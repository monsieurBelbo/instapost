// Fake Instagram service worker for the knob `sw=claimLate` (strategy §6.1; P2 since 2026-10-12).
//
// The composer registers this worker 2 s after it is ready. It activates at once and claims every
// open client, so the composer page fires `controllerchange` mid-session. Since P2 that is only
// counted on the record (Instagram's own worker claims every page, F2), never fatal.
// It has no fetch handler: once in control it lets every request go to the network.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
