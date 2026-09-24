// Bei jeder Änderung an index.html oder den Icons die Versionsnummer erhöhen.
const VERSION = "v5";
const CACHE = "bindelinie-" + VERSION;
const FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest"
];

self.addEventListener("install", e => {
  // Jede Datei einzeln: fehlt eine, scheitert nicht gleich die ganze Installation.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(FILES.map(f => c.add(f))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => (k.startsWith("bindelinie-") || k.startsWith("umfangsbindungen-")) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  // Seite selbst: erst Netz (damit Updates ankommen), offline aus dem Cache.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); return res; })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  // Icons, Manifest: aus dem Cache, sonst Netz.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
