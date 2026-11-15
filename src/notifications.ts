// Notifications Web Push (même principe que l'appli GDC)
import { store } from "./store";

let swReg: ServiceWorkerRegistration | null = null;

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    swReg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    return swReg;
  } catch (e) {
    console.warn("SW non enregistré", e);
    return null;
  }
}

export const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export type NotifState = "ios-install" | "unsupported" | "default" | "granted" | "denied";

export async function notifState(): Promise<NotifState> {
  if (isIOS && !isStandalone) return "ios-install";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  return Notification.permission as NotifState;
}

function b64ToBytes(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscribe() {
  const reg = swReg || (await navigator.serviceWorker.ready);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    if (!store.vapidPublic) await store.pull();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(store.vapidPublic) });
  }
  await store.savePush(sub);
}

/** Doit être appelé suite à un clic (obligatoire sur iPhone) */
export async function enableNotifications(): Promise<NotifState> {
  const state = await notifState();
  if (state !== "default" && state !== "granted") return state;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm as NotifState;
  await subscribe();
  await store.testPush().catch(() => {});
  return "granted";
}

/** À chaque ouverture : on renvoie l'abonnement (il peut changer) */
export async function refreshSubscription() {
  if ((await notifState()) !== "granted") return;
  await subscribe();
}

/** Appli ouverte au moment d'une notif : on montre aussi un toast */
export function listenForeground(onNotif: (title: string, body: string) => void) {
  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data?.type === "push") onNotif(e.data.title, e.data.body);
  });
}
