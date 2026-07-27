const CACHE = "vista-erp-v2";
const OFFLINE_URL = "/login";

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(["/login", "/manifest.json", "/icon.svg", "/logo.svg"])
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never cache HTML navigations or API/auth traffic — always hit the network so
  // authentication state (login/logout, which now differs per device) is never
  // served from a stale cache. Only static assets fall back to cache offline.
  const isNavigation = req.mode === "navigate";
  const isApi = url.pathname.startsWith("/api") || url.pathname.startsWith("/auth");
  if (isNavigation || isApi) {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(req, clone));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match(OFFLINE_URL)))
  );
});
