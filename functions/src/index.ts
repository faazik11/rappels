import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

initializeApp();
const db = getFirestore();

const TZ = "Europe/Paris";
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Heure "HH:MM", jour ISO (1 = lundi) et date "AAAA-MM-JJ" à Paris */
function parisNow(at: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  );
  return {
    time: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAYS[parts.weekday],
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * Tourne chaque minute : cherche les rappels prévus à cette minute-ci
 * et envoie la notification à tous les téléphones de la personne.
 */
export const sendReminders = onSchedule(
  { schedule: "* * * * *", timeZone: TZ, region: "europe-west1", memory: "256MiB", maxInstances: 1, retryCount: 0 },
  async (event) => {
    const at = event.scheduleTime ? new Date(event.scheduleTime) : new Date();
    const { time, weekday, date } = parisNow(at);

    const snap = await db.collectionGroup("reminders").where("time", "==", time).get();
    if (snap.empty) return;

    let sent = 0;
    await Promise.all(
      snap.docs.map(async (remDoc) => {
        const r = remDoc.data();
        if (!r.enabled || !Array.isArray(r.days) || !r.days.includes(weekday)) return;

        const userRef = remDoc.ref.parent.parent;
        if (!userRef) return;

        let title = "🔔 Rappel";
        let body: string = r.text || "";

        // Rappel lié à une jauge : on affiche l'avancement du jour
        if (r.taskId) {
          const [taskSnap, progSnap] = await Promise.all([
            userRef.collection("tasks").doc(r.taskId).get(),
            userRef.collection("progress").doc(date).get(),
          ]);
          const task = taskSnap.data();
          if (task) {
            const n: number = progSnap.data()?.counts?.[r.taskId] || 0;
            if (r.skipIfDone && n >= task.goal) return;
            title = `${task.emoji} ${task.name} · ${n}/${task.goal}`;
            if (!body) body = n >= task.goal ? "Objectif atteint, bravo !" : `Encore ${task.goal - n} pour atteindre l'objectif`;
          }
        }

        const [tokensSnap, userSnap] = await Promise.all([userRef.collection("tokens").get(), userRef.get()]);
        const tokens = tokensSnap.docs.map((d) => d.id);
        if (!tokens.length) return;
        const link: string | undefined = userSnap.data()?.appUrl;

        const res = await getMessaging().sendEachForMulticast({
          tokens,
          notification: { title, body },
          webpush: {
            notification: { tag: remDoc.id, renotify: true, ...(link ? { icon: link + "icon-192.png", badge: link + "icon-192.png" } : {}) },
            ...(link ? { fcmOptions: { link } } : {}),
            headers: { Urgency: "high", TTL: "3600" },
          },
        });
        sent += res.successCount;

        // On retire les téléphones qui ne sont plus valides (appli désinstallée, etc.)
        await Promise.all(
          res.responses.map((resp, i) => {
            const code = resp.error?.code;
            if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
              return userRef.collection("tokens").doc(tokens[i]).delete();
            }
            return null;
          })
        );
      })
    );
    logger.info(`${time} : ${snap.size} rappel(s) trouvés, ${sent} notification(s) envoyées`);
  }
);
