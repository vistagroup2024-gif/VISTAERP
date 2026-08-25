const CACHE = "vista-erp-v3";
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

// ── Web Push ────────────────────────────────────────────────
// Show the notification (works when the app/tab is closed or the phone is locked).
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Vista ERP", body: e.data && e.data.text() }; }
  const title = d.title || "Vista ERP";
  const options = {
    body: d.body || "",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-96x96.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    vibrate: [80, 40, 80],
    data: { link: d.link || "/dashboard" },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a notification opens the exact ERP page (focus an existing tab if possible).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "/dashboard";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cls) => {
      for (const c of cls) {
        if ("focus" in c) { c.focus(); if ("navigate" in c) c.navigate(link); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
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
