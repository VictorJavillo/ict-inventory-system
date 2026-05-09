const CACHE_NAME = "ict-inventory-v1";

const FILES_TO_CACHE = [
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
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});