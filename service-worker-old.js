const CACHE_NAME = "ict-inventory-v1";

const urlsToCache = [
  "/",
  "/login.html",
  "/dashboard.html",
  "/inventory.html",
  "/borrow.html",
  "/users.html",
  "/logs.html",
  "/settings.html",
  "/style.css",
  "/app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});