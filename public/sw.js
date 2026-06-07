// Service worker: caches the app shell so the portal loads offline.
// Static assets use stale-while-revalidate (fresh when online, available offline);
// navigations fall back to the cached shell; /api/* is left to the network
// (the app falls back to on-device saved tests in JS).
const CACHE = "eog-shell-v5";
const ASSETS = [
  "/", "/index.html", "/css/styles.css", "/manifest.webmanifest",
  "/js/app.js", "/js/api.js", "/js/runner.js", "/js/review.js", "/js/grade.js",
  "/js/diagrams.js", "/js/dict.js", "/js/timing.js", "/js/mathstrategy.js",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png", "/icons/icon.svg", "/icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // network; JS handles offline fallback

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/"))));
    return;
  }
  // static: stale-while-revalidate
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const cached = await c.match(req);
    const network = fetch(req).then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
    return cached || (await network) || new Response("offline", { status: 503 });
  }));
});
