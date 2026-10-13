// Fake Instagram service worker for the knob `sw=desktopShell` (strategy §6.1, spike S4, §11 AM30).
// Hypothetical: Instagram's real worker has no fetch handler (F2, 2026-10-12). This one is what the
// P3 tripwire (SW_INTERCEPTS) exists for.
//
// - It answers every navigation with fetch() from its own context. dNR session rules are scoped to
//   the composer tab, and this fetch runs as tabId -1, so it carries the desktop UA and the server
//   answers with the desktop shell. A hard reload (bypassCache) skips the worker.
// - Every other request of a page it controls goes through it too (respondWith(fetch(request))), so
//   it also leaves without rule 1001 and its PerformanceResourceTiming.workerStart is > 0.
// - It is registered at a stable URL (an installed worker is not replaced by a later load), and it
//   claims every page that asks it to (the fake's client does on every load), as Instagram's
//   re-registration on every load would make a new worker do. So a hard-reloaded composer, served
//   mobile without it, is controlled again moments later and its next request trips the tripwire.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  if (event.data === 'claim') event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request.url, {
        credentials: 'include',
        // Navigations are `redirect: manual`; an opaque redirect lets the browser follow the
        // server's 302 (desktop UA on /create/story/ → /) itself.
        redirect: 'manual',
        headers: { 'x-fake-via-sw': '1' },
      }),
    );
    return;
  }
  // GET subresources only: a POST body (Share, control reports) would have to be re-streamed.
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request));
});
