// Replace the old cache-first worker; never cache recordings or app assets.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await caches.delete('mvp-v1');
  await self.clients.claim();
})()));
