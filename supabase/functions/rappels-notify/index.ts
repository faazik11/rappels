// Envoi des rappels de l'appli « Rappels » (Web Push).
// Appelé chaque minute par pg_cron (type "tick") et juste après l'activation des notifs (type "test").
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const APP_URL = "https://faazik11.github.io/rappels/";
const TZ = "Europe/Paris";
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

type Msg = { title: string; body: string; tag?: string };

let secretsCache: Record<string, string> | null = null;
async function secrets() {
  if (!secretsCache) {
    const { data } = await db.from("rappels_secrets").select("name, value");
    secretsCache = Object.fromEntries((data ?? []).map((r) => [r.name, r.value]));
  }
  return secretsCache;
}

/** Heure "HH:MM", jour ISO (1 = lundi) et date "AAAA-MM-JJ" à Paris */
function paris(at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  return { time: `${p.hour}:${p.minute}`, weekday: WEEKDAYS[p.weekday], day: `${p.year}-${p.month}-${p.day}` };
}

async function send(devices: string[], msgFor: (device: string) => Msg) {
  if (!devices.length) return 0;
  const { data: subs } = await db.from("rappels_push").select("endpoint, device, p256dh, auth").in("device", devices);
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...msgFor(s.device), url: APP_URL }),
        { TTL: 60 * 30, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      // Abonnement expiré (appli supprimée, notifications coupées) : on l'oublie.
      if (code === 404 || code === 410) await db.from("rappels_push").delete().eq("endpoint", s.endpoint);
      else console.error("envoi impossible", code, String(e));
    }
  }));
  return sent;
}

const PRAYERS = [
  { key: "fajr", name: "Fajr", tahsin: "matin" },
  { key: "dhuhr", name: "Dhouhr" },
  { key: "asr", name: "Asr" },
  { key: "maghrib", name: "Maghrib", tahsin: "soir" },
  { key: "isha", name: "Icha" },
] as const;

/** Notifs des prières (+ Tahsin au Fajr et au Maghrib), selon la ville de chaque téléphone */
async function prayerTick(time: string, day: string) {
  const { data: subs } = await db.from("rappels_push").select("device");
  const devices = [...new Set((subs ?? []).map((s) => s.device))];
  if (!devices.length) return 0;
  const { data: devs } = await db.from("rappels_devices").select("key, city_id, settings").in("key", devices);
  const byCity = new Map<number, { key: string; settings: Record<string, unknown> }[]>();
  for (const d of devs ?? []) {
    if (!byCity.has(d.city_id)) byCity.set(d.city_id, []);
    byCity.get(d.city_id)!.push({ key: d.key, settings: d.settings ?? {} });
  }
  let sent = 0;
  for (const [city, list] of byCity) {
    const { data: t } = await db.rpc("rappels_day_times", { p_city: city, p_day: day });
    if (!t) continue;
    for (const p of PRAYERS) {
      if (t[p.key] !== time) continue;
      for (const d of list) {
        const notif = (d.settings.notif ?? {}) as Record<string, boolean>;
        if (notif[p.key] !== false) {
          sent += await send([d.key], () => ({ title: `🕌 ${p.name} · ${time}`, body: `C'est l'heure de la prière du ${p.name}.`, tag: `prayer-${p.key}` }));
        }
        if ("tahsin" in p && notif.tahsin !== false) {
          sent += await send([d.key], () => ({ title: `📿 Tahsin du ${p.tahsin}`, body: `Pense à réciter ton tahsin du ${p.tahsin}.`, tag: `tahsin-${p.tahsin}` }));
        }
      }
    }
  }
  return sent;
}

async function tick() {
  const { time, weekday, day } = paris(new Date());
  const prayersSent = await prayerTick(time, day).catch((e) => (console.error("prières", String(e)), 0));
  return { ...(await customTick(time, weekday, day)), prayersSent };
}

async function customTick(time: string, weekday: number, day: string) {
  const { data: rems } = await db
    .from("rappels_reminders")
    .select("device, id, text, task_id, skip_if_done, days")
    .eq("time", time)
    .eq("enabled", true);
  const due = (rems ?? []).filter((r) => (r.days as number[]).includes(weekday));
  if (!due.length) return { time, sent: 0 };

  // Avancement du jour pour les rappels liés à une jauge
  const devices = [...new Set(due.map((r) => r.device))];
  const [{ data: tasks }, { data: prog }] = await Promise.all([
    db.from("rappels_tasks").select("device, id, name, emoji, goal").in("device", devices),
    db.from("rappels_progress").select("device, task_id, n").eq("day", day).in("device", devices),
  ]);
  const taskOf = (d: string, id: string) => tasks?.find((t) => t.device === d && t.id === id);
  const countOf = (d: string, id: string) => prog?.find((p) => p.device === d && p.task_id === id)?.n ?? 0;

  let sent = 0;
  for (const r of due) {
    let msg: Msg = { title: "🔔 Rappel", body: r.text, tag: r.id };
    if (r.task_id) {
      const t = taskOf(r.device, r.task_id);
      if (t) {
        const n = countOf(r.device, r.task_id);
        if (r.skip_if_done && n >= t.goal) continue;
        msg = {
          title: `${t.emoji} ${t.name} · ${n}/${t.goal}`,
          body: r.text || (n >= t.goal ? "Objectif atteint, bravo !" : `Encore ${t.goal - n} pour atteindre l'objectif`),
          tag: r.id,
        };
      }
    }
    sent += await send([r.device], () => msg);
  }
  return { time, due: due.length, sent };
}

Deno.serve(async (req) => {
  const s = await secrets();
  if (req.headers.get("x-rappels-token") !== s.notify_token) return new Response("interdit", { status: 403 });
  webpush.setVapidDetails("mailto:rappels@faazik11.github.io", s.vapid_public, s.vapid_private);

  const payload = await req.json().catch(() => ({}));
  let result: unknown;
  if (payload.type === "test" && payload.device) {
    result = { sent: await send([payload.device], () => ({ title: "🔔 Notifications activées", body: "Tes rappels arriveront pile à l'heure !", tag: "test" })) };
  } else {
    result = await tick();
  }
  return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
});
