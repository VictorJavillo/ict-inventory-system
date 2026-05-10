const CACHE_NAME = "ict-inventory-pwa-v1";

const APP_SHELL = [
  "/",
  "/login.html",
  "/dashboard.html",
  "/inventory.html",
  "/borrow.html",
  "/users.html",
  "/logs.html",
  "/backup.html",
  "/settings.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/images/paf-logo-left.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const req = event.request;

  if (req.method !== "GET") return;

  if (req.url.includes("/api/")) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ offline: true, message: "Offline mode active" }), {
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      return cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return res;
      }).catch(() => caches.match("/dashboard.html"));
    })
  );
});