/* Service worker : affiche les notifications envoyées par Firebase + garde l'appli dispo hors ligne */
importScripts("./firebase-config.js");

if (self.FIREBASE_CONFIG && self.FIREBASE_CONFIG.apiKey) {
  importScripts("./vendor/firebase-app-compat.js", "./vendor/firebase-messaging-compat.js");
  firebase.initializeApp(self.FIREBASE_CONFIG);
  // Les messages avec un bloc "notification" sont affichés automatiquement par le SDK.
  firebase.messaging();
}

const CACHE = "rappels-v1";

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
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        throw new Error("hors ligne");
      }
    })()
  );
});

// Clic sur une notif : ouvre (ou ramène au premier plan) l'appli
self.addEventListener("notificationclick", (event) => {
  // Les notifs Firebase sont déjà gérées par le SDK (lien fcmOptions.link)
  if (event.notification.data && event.notification.data.FCM_MSG) return;
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
