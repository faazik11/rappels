// Données de l'appli : stockées dans Supabase (projet partagé avec le GDC, tables rappels_*).
// Chaque téléphone a une clé secrète ; une copie locale permet d'ouvrir l'appli instantanément, même hors ligne.

export const SUPABASE_URL = "https://mqeiqlqwmktrrgjzrshz.supabase.co";
const SUPABASE_KEY = "sb_publishable_0mt-3rvdmw0FUYRd8CZuUg_qyTkU0Ey";

export interface Reminder {
  id: string;
  time: string; // "HH:MM"
  days: number[]; // 1 = lundi … 7 = dimanche
  text: string;
  taskId: string | null;
  skipIfDone: boolean;
  enabled: boolean;
}

export interface DayTimes {
  day: string;
  fajr: string;
  shuruq: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  exact: boolean;
}

export interface Settings {
  notif?: Partial<Record<PrayerKey | "tahsin", boolean>>;
  tahsinView?: "both" | "ph" | "ar";
}

export interface City {
  id: number;
  name: string;
}

export type PrayerKey = "fajr" | "dhuhr" | "asr" | "maghrib" | "isha";
export const PRAYERS: { key: PrayerKey; name: string }[] = [
  { key: "fajr", name: "Fajr" },
  { key: "dhuhr", name: "Dhouhr" },
  { key: "asr", name: "Asr" },
  { key: "maghrib", name: "Maghrib" },
  { key: "isha", name: "Icha" },
];

export function dateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function addDays(key: string, n: number) {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + n));
}
/** "HH:MM" du jour `day` → Date locale */
export function at(day: string, hhmm: string) {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const LS = {
  key: "rappels:key",
  state: "rappels:state2",
  cities: "rappels:cities",
  queue: "rappels:queue",
};

function readJSON<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* stockage plein ou indisponible */
  }
}

function deviceKey(): string {
  let k = localStorage.getItem(LS.key);
  if (!k) {
    k = crypto.randomUUID();
    localStorage.setItem(LS.key, k);
  }
  return k;
}

const HEADERS = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: HEADERS, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`${fn} : ${res.status} ${await res.text()}`);
  const txt = await res.text();
  return (txt ? JSON.parse(txt) : null) as T;
}

type QueuedCall = { fn: string; args: Record<string, unknown> };
type Listener = () => void;

interface Saved {
  loadedFor: string;
  cityId: number;
  settings: Settings;
  times: (DayTimes | null)[];
  reminders: Reminder[];
  progress: Record<string, Record<string, number>>;
  vapidPublic: string;
}

class Store {
  ready = false;
  loadedFor = ""; // jour local pour lequel les horaires ont été chargés
  cityId = 54;
  settings: Settings = {};
  times: (DayTimes | null)[] = [null, null, null]; // hier, aujourd'hui, demain
  reminders: Reminder[] = [];
  progress: Record<string, Record<string, number>> = {};
  cities: City[] = readJSON(LS.cities, []);
  vapidPublic = "";
  readonly key = deviceKey();
  private listeners = new Set<Listener>();
  private flushing = false;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.listeners.forEach((fn) => fn());
  }

  async init() {
    const saved = readJSON<Saved | null>(LS.state, null);
    if (saved) {
      Object.assign(this, saved);
      this.ready = true;
      this.emit();
    }
    try {
      await this.flush();
      await this.pull();
    } catch (e) {
      console.warn("Hors ligne, on garde la copie locale", e);
    }
    this.loadCities().catch(() => {});
    addEventListener("online", () => this.flush().then(() => this.pull()).catch(() => {}));
  }

  async pull() {
    const today = dateKey();
    const d = await rpc<Saved & { isNew: boolean }>("rappels_load", { p_key: this.key, p_day: today });
    this.loadedFor = today;
    this.cityId = d.cityId;
    this.settings = d.settings || {};
    this.times = d.times;
    this.reminders = d.reminders;
    // On garde les validations locales pas encore envoyées
    const pending = readJSON<QueuedCall[]>(LS.queue, []);
    this.progress = pending.length ? { ...d.progress, ...this.progress } : d.progress || {};
    this.vapidPublic = d.vapidPublic;
    this.ready = true;
    this.save();
    this.emit();
  }

  async loadCities() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rappels_cities?select=id,name&order=name`, { headers: HEADERS });
    if (res.ok) {
      this.cities = await res.json();
      writeJSON(LS.cities, this.cities);
      this.emit();
    }
  }

  private save() {
    const s: Saved = {
      loadedFor: this.loadedFor,
      cityId: this.cityId,
      settings: this.settings,
      times: this.times,
      reminders: this.reminders,
      progress: this.progress,
      vapidPublic: this.vapidPublic,
    };
    writeJSON(LS.state, s);
  }

  /** Envoie une modification au serveur ; sans réseau, elle est gardée et renvoyée plus tard */
  private call(fn: string, args: Record<string, unknown>) {
    const q = readJSON<QueuedCall[]>(LS.queue, []);
    q.push({ fn, args: { p_key: this.key, ...args } });
    writeJSON(LS.queue, q);
    this.flush().catch(() => {});
  }

  private async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let q = readJSON<QueuedCall[]>(LS.queue, []);
      while (q.length) {
        await rpc(q[0].fn, q[0].args);
        q = readJSON<QueuedCall[]>(LS.queue, []).slice(1);
        writeJSON(LS.queue, q);
      }
    } finally {
      this.flushing = false;
    }
  }

  // ---------- Journée de prière ----------
  /** Horaires d'un jour (si chargés) */
  timesFor(day: string): DayTimes | null {
    return this.times.find((t) => t && t.day === day) || null;
  }

  /** La « journée » commence au Fajr : avant le Fajr, on est encore dans la journée d'hier */
  appDay(now = new Date()): string {
    const today = dateKey(now);
    const t = this.timesFor(today);
    if (t && now < at(today, t.fajr)) return addDays(today, -1);
    return today;
  }

  /** À appeler régulièrement : recharge quand on change de jour */
  checkDay() {
    if (this.loadedFor && this.loadedFor !== dateKey()) {
      this.pull().catch(() => {});
      return true;
    }
    return false;
  }

  // ---------- Progression ----------
  value(day: string, key: string) {
    return this.progress[day]?.[key] || 0;
  }

  bump(day: string, key: string, delta: number, max: number) {
    const cur = this.value(day, key);
    const next = Math.max(0, Math.min(max, cur + delta));
    if (next === cur) return cur;
    this.progress = { ...this.progress, [day]: { ...(this.progress[day] || {}), [key]: next } };
    this.save();
    this.emit();
    this.call("rappels_bump", { p_day: day, p_task: key, p_delta: next - cur });
    return next;
  }

  setValues(day: string, values: Record<string, number>) {
    this.progress = { ...this.progress, [day]: { ...(this.progress[day] || {}), ...values } };
    this.save();
    this.emit();
    this.call("rappels_set_progress", { p_day: day, p_values: values });
  }

  // ---------- Réglages ----------
  setCity(id: number) {
    this.cityId = id;
    this.save();
    this.emit();
    this.call("rappels_set_city", { p_city: id });
    this.flush().then(() => this.pull()).catch(() => {});
  }

  setSettings(s: Settings) {
    this.settings = s;
    this.save();
    this.emit();
    this.call("rappels_set_settings", { p_settings: s });
  }

  // ---------- Rappels personnels ----------
  saveReminder(r: Reminder) {
    const i = this.reminders.findIndex((x) => x.id === r.id);
    if (i >= 0) this.reminders[i] = r;
    else this.reminders.push(r);
    this.reminders.sort((a, b) => a.time.localeCompare(b.time));
    this.save();
    this.emit();
    this.call("rappels_save_reminder", { p: r });
  }

  deleteReminder(id: string) {
    this.reminders = this.reminders.filter((r) => r.id !== id);
    this.save();
    this.emit();
    this.call("rappels_delete_reminder", { p_id: id });
  }

  // ---------- Notifications ----------
  async savePush(sub: PushSubscription) {
    const j = sub.toJSON();
    await rpc("rappels_save_push", { p_key: this.key, p_endpoint: j.endpoint, p_p256dh: j.keys!.p256dh, p_auth: j.keys!.auth });
  }

  async testPush() {
    await rpc("rappels_test_push", { p_key: this.key });
  }
}

export const store = new Store();
