// P3 fixture: a worker WITHOUT a fetch handler, like Instagram's root worker (F2).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
