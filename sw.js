/* =========================================================================
   Service worker — Galerie Pascal Sun (PWA)
   - Pages & catalogue : réseau d'abord (contenu toujours frais),
     repli sur le cache hors-ligne.
   - Assets (css/js/img/polices) : cache d'abord, mise à jour en fond.
   Les vidéos et l'admin ne sont jamais mis en cache.
   ========================================================================= */

const VERSION = "ps-v12";
const CORE = [
  "/", "/galerie.html", "/expositions.html", "/artiste.html",
  "/panier.html", "/contact.html", "/oeuvre.html", "/merci.html",
  "/css/style.css", "/css/effects.css", "/css/viewer.css",
  "/js/data.js", "/js/app.js", "/js/effects.js", "/js/viewer.js",
  "/manifest.webmanifest"
];

/* Notifications push (boîte à idées, commandes, portraits) */
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: "Galerie Pascal Sun", body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || "Galerie Pascal Sun", {
    body: data.body || "",
    icon: "/img/icon-192.png",
    badge: "/img/icon-192.png",
    data: { url: data.url || "/admin" }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/admin";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes("/admin") && "focus" in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});

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
  // les visuels des œuvres sont toujours pris sur le réseau (ils évoluent)
  if (url.pathname.startsWith("/img/oeuvres/") || url.pathname.startsWith("/img/atelier/")) return;
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
