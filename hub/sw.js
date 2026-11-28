// KWS Hub service worker: lets the app install to a phone's home screen and open without a
// connection. App files are network-first (always fresh when online); data calls are never cached.
// Paths are relative to this file, so the same worker serves any install's folder.
const CACHE = "kws-hub-14";
const HOME = new URL("./", self.location).href;
const SHELL = ["./", "hub.css?v=14", "hub.js?v=14", "crest.svg"].map((p) => new URL(p, self.location).href);
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match(HOME))));
});
