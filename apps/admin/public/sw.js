// Minimal service worker — enables installability. Network-first, no aggressive
// caching (admin must always show fresh card data).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
