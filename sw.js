/* =========================================================================
   Service worker — Galerie Pascal Sun (PWA)
   - Pages & catalogue : réseau d'abord (contenu toujours frais),
     repli sur le cache hors-ligne.
   - Assets (css/js/img/polices) : cache d'abord, mise à jour en fond.
   Les vidéos et l'admin ne sont jamais mis en cache.
   ========================================================================= */

const VERSION = "ps-v1";
const CORE = [
  "/", "/galerie.html", "/expositions.html", "/artiste.html",
  "/panier.html", "/contact.html", "/oeuvre.html",
  "/css/style.css", "/css/effects.css", "/css/viewer.css",
  "/js/data.js", "/js/app.js", "/js/effects.js", "/js/viewer.js",
  "/manifest.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/videos/")) return;
  if (url.pathname.startsWith("/api/") && url.pathname !== "/api/catalogue") return;

  const isPage = e.request.mode === "navigate" || url.pathname === "/api/catalogue";

  if (isPage) {
    // réseau d'abord, cache en secours
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copy = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return r;
        })
        .catch(() => caches.match(e.request).then((m) => m || caches.match("/")))
    );
  } else {
    // cache d'abord, rafraîchi en arrière-plan
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const refresh = fetch(e.request)
          .then((r) => {
            const copy = r.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
            return r;
          })
          .catch(() => cached);
        return cached || refresh;
      })
    );
  }
});
