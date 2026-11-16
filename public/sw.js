/* Service worker : affiche les rappels (Web Push) + garde l'appli dispo hors ligne */
const CACHE = "rappels-v2";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// Réseau d'abord, cache en secours (pour ouvrir l'appli sans connexion)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell = await caches.match("./index.html") || await caches.match("./");
          if (shell) return shell;
        }
        throw new Error("hors ligne");
      }
    })()
  );
});

self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(msg.title || "Rappel", {
        body: msg.body || "",
        icon: "icon-192.png",
        badge: "icon-192.png",
        tag: msg.tag,
        renotify: true,
        vibrate: [80, 40, 80],
        data: { url: msg.url || "./" },
      });
      const all = await self.clients.matchAll({ type: "window" });
      all.forEach((c) => c.postMessage({ type: "push", title: msg.title, body: msg.body }));
    })()
  );
});

// Clic sur une notif : ouvre (ou ramène au premier plan) l'appli
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("./", self.location.href).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (c.url.startsWith(target) && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })()
  );
});
