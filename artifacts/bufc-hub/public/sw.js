// Minimal service worker — exists so browsers treat the hub as an installable
// app (no browser badge on the icon). Network-first passthrough: we never
// serve stale cached content.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
