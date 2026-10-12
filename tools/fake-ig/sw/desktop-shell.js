// Fake Instagram service worker for the knob `sw=desktopShell` (strategy §6.1, spike S4).
//
// Answers every navigation with fetch() from its own context. dNR session rules are scoped to the
// composer tab, and this fetch runs as tabId -1, so it carries the desktop UA and the server
// answers with the desktop shell. A hard reload (bypassCache) skips the worker, which is what the
// extension relies on.
//
// It never calls clients.claim(): a page that was loaded without it (e.g. the hard-reloaded
// composer) stays uncontrolled, like Instagram's own worker after a hard reload. Taking control
// mid-session is the separate `sw=claimLate` knob.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request.url, {
      credentials: 'include',
      // Navigations are `redirect: manual`; an opaque redirect lets the browser follow the
      // server's 302 (desktop UA on /create/story/ → /) itself.
      redirect: 'manual',
      headers: { 'x-fake-via-sw': '1' },
    }),
  );
});
