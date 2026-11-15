import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { store, isDemo } from "./store";

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

export type NotifState = "demo" | "ios-install" | "unsupported" | "default" | "granted" | "denied";

export async function notifState(): Promise<NotifState> {
  if (isDemo) return "demo";
  if (isIOS && !isStandalone) return "ios-install";
  if (!("Notification" in window) || !(await isSupported())) return "unsupported";
  return Notification.permission as NotifState;
}

/** Doit être appelé suite à un clic (obligatoire sur iPhone) */
export async function enableNotifications(): Promise<NotifState> {
  const state = await notifState();
  if (state !== "default" && state !== "granted") return state;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm as NotifState;
  await refreshToken();
  return "granted";
}

/** Récupère le jeton du téléphone et l'enregistre (à refaire à chaque ouverture) */
export async function refreshToken() {
  if (isDemo || !store.app || Notification.permission !== "granted") return;
  if (!(await isSupported())) return;
  const reg = swReg || (await navigator.serviceWorker.ready);
  const messaging = getMessaging(store.app);
  const token = await getToken(messaging, { vapidKey: window.FIREBASE_VAPID_KEY || undefined, serviceWorkerRegistration: reg });
  if (token) await store.addPushToken(token);
}

/** Quand l'appli est ouverte, la notif n'est pas affichée par le système : on montre un toast */
export async function listenForeground(onNotif: (title: string, body: string) => void) {
  if (isDemo || !store.app || !(await isSupported())) return;
  onMessage(getMessaging(store.app), (payload) => {
    onNotif(payload.notification?.title || "Rappel", payload.notification?.body || "");
  });
}
