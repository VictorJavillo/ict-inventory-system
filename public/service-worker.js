const CACHE_NAME = "ict-inventory-pwa-v5";

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

/* =========================
   INSTALL
========================= */
self.addEventListener("install", event => {

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
  );

  self.skipWaiting();
});

/* =========================
   ACTIVATE
========================= */
self.addEventListener("activate", event => {

  event.waitUntil(
    caches.keys().then(keys => {

      return Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );

    })
  );

  self.clients.claim();
});

/* =========================
   FETCH
========================= */
self.addEventListener("fetch", event => {

  const req = event.request;

  // ignore non GET
  if (req.method !== "GET") return;

  // ignore browser extensions
  if (req.url.startsWith("chrome-extension://")) return;

  // API REQUESTS
  if (req.url.includes("/api/")) {

    event.respondWith(

      fetch(req).catch(() => {

        return new Response(
          JSON.stringify({
            offline: true,
            message: "Offline mode active"
          }),
          {
            headers: {
              "Content-Type": "application/json"
            }
          }
        );

      })

    );

    return;
  }

  // NORMAL FILE CACHE
  event.respondWith(

    caches.match(req).then(cached => {

      return cached ||

        fetch(req)
          .then(res => {

            const copy = res.clone();

            caches.open(CACHE_NAME)
              .then(cache => cache.put(req, copy));

            return res;

          })
          .catch(() => caches.match("/dashboard.html"));

    })

  );

});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});