// Données de l'appli : stockées dans Supabase (projet partagé avec le GDC, tables rappels_*).
// Chaque téléphone a une clé secrète ; une copie locale permet d'ouvrir l'appli instantanément, même hors ligne.

export const SUPABASE_URL = "https://mqeiqlqwmktrrgjzrshz.supabase.co";
const SUPABASE_KEY = "sb_publishable_0mt-3rvdmw0FUYRd8CZuUg_qyTkU0Ey";

export interface Task {
  id: string;
  name: string;
  emoji: string;
  color: string;
  goal: number;
  order: number;
}

export interface Reminder {
  id: string;
  time: string; // "HH:MM"
  days: number[]; // 1 = lundi … 7 = dimanche
  text: string;
  taskId: string | null;
  skipIfDone: boolean;
  enabled: boolean;
}

export const COLORS = ["#ff7a59", "#ffc93c", "#5ef2b0", "#4cc9ff", "#a78bfa", "#ff6bcb", "#f97316", "#84cc16"];

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function seed(): { tasks: Task[]; reminders: Reminder[] } {
  const venteId = uid();
  return {
    tasks: [{ id: venteId, name: "Vente", emoji: "💰", color: COLORS[0], goal: 5, order: 0 }],
    reminders: [
      { id: uid(), time: "09:00", days: [1, 2, 3, 4, 5], text: "C'est parti, objectif du jour !", taskId: venteId, skipIfDone: false, enabled: true },
      { id: uid(), time: "14:00", days: [1, 2, 3, 4, 5], text: "Point de mi-journée", taskId: venteId, skipIfDone: true, enabled: true },
      { id: uid(), time: "17:30", days: [1, 2, 3, 4, 5], text: "Dernière ligne droite 💪", taskId: venteId, skipIfDone: true, enabled: true },
    ],
  };
}

const LS = {
  key: "rappels:key",
  data: "rappels:data",
  progress: (d: string) => "rappels:progress:" + d,
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

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn} : ${res.status} ${await res.text()}`);
  const txt = await res.text();
  return (txt ? JSON.parse(txt) : null) as T;
}

type QueuedCall = { fn: string; args: Record<string, unknown> };
type Listener = () => void;

class Store {
  tasks: Task[] = [];
  reminders: Reminder[] = [];
  counts: Record<string, number> = {};
  date = todayKey();
  ready = false;
  vapidPublic = "";
  readonly key = deviceKey();
  private listeners = new Set<Listener>();
  private flushing = false;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  async init() {
    // 1. Affichage immédiat depuis la copie locale
    const cached = readJSON<{ tasks: Task[]; reminders: Reminder[]; vapidPublic?: string } | null>(LS.data, null);
    if (cached) {
      this.tasks = cached.tasks;
      this.reminders = cached.reminders;
      this.vapidPublic = cached.vapidPublic || "";
      this.counts = readJSON(LS.progress(this.date), {});
      this.ready = true;
      this.emit();
    }
    // 2. Synchronisation avec le serveur
    try {
      await this.flush();
      await this.pull();
    } catch (e) {
      console.warn("Hors ligne, on garde la copie locale", e);
      if (!this.ready) {
        const s = seed();
        this.tasks = s.tasks;
        this.reminders = s.reminders;
        this.ready = true;
        this.saveLocal();
        this.emit();
      }
    }
    addEventListener("online", () => this.flush().then(() => this.pull()).catch(() => {}));
  }

  /** Recharge depuis le serveur */
  async pull() {
    const d = await rpc<{ isNew: boolean; vapidPublic: string; tasks: Task[]; reminders: Reminder[]; counts: Record<string, number> }>(
      "rappels_load",
      { p_key: this.key, p_day: this.date }
    );
    this.vapidPublic = d.vapidPublic;
    if (d.isNew && !d.tasks.length && !readJSON(LS.data, null)) {
      // Premier lancement : tâche et rappels d'exemple
      const s = seed();
      this.tasks = s.tasks;
      this.reminders = s.reminders;
      s.tasks.forEach((t) => this.call("rappels_save_task", { p: t }));
      s.reminders.forEach((r) => this.call("rappels_save_reminder", { p: r }));
    } else {
      this.tasks = d.tasks;
      this.reminders = d.reminders;
      this.counts = d.counts;
      writeJSON(LS.progress(this.date), this.counts);
    }
    this.ready = true;
    this.saveLocal();
    this.emit();
  }

  private saveLocal() {
    writeJSON(LS.data, { tasks: this.tasks, reminders: this.reminders, vapidPublic: this.vapidPublic });
  }

  /** Envoie une modification au serveur ; si pas de réseau, elle est gardée et renvoyée plus tard */
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

  /** À appeler régulièrement : remet les jauges à zéro quand on change de jour */
  checkDay() {
    const k = todayKey();
    if (k === this.date) return false;
    this.date = k;
    this.counts = readJSON(LS.progress(k), {});
    this.emit();
    this.pull().catch(() => {});
    return true;
  }

  // ---------- Actions ----------
  count(taskId: string) {
    return this.counts[taskId] || 0;
  }

  bump(taskId: string, delta: 1 | -1) {
    const cur = this.count(taskId);
    if (delta < 0 && cur <= 0) return;
    this.counts = { ...this.counts, [taskId]: cur + delta };
    writeJSON(LS.progress(this.date), this.counts);
    this.emit();
    this.call("rappels_bump", { p_day: this.date, p_task: taskId, p_delta: delta });
  }

  saveTask(t: Task) {
    const i = this.tasks.findIndex((x) => x.id === t.id);
    if (i >= 0) this.tasks[i] = t;
    else this.tasks.push(t);
    this.tasks.sort((a, b) => a.order - b.order);
    this.saveLocal();
    this.emit();
    this.call("rappels_save_task", { p: t });
  }

  deleteTask(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    this.reminders = this.reminders.map((r) => (r.taskId === id ? { ...r, taskId: null, skipIfDone: false } : r));
    this.saveLocal();
    this.emit();
    this.call("rappels_delete_task", { p_id: id });
  }

  saveReminder(r: Reminder) {
    const i = this.reminders.findIndex((x) => x.id === r.id);
    if (i >= 0) this.reminders[i] = r;
    else this.reminders.push(r);
    this.reminders.sort((a, b) => a.time.localeCompare(b.time));
    this.saveLocal();
    this.emit();
    this.call("rappels_save_reminder", { p: r });
  }

  deleteReminder(id: string) {
    this.reminders = this.reminders.filter((r) => r.id !== id);
    this.saveLocal();
    this.emit();
    this.call("rappels_delete_reminder", { p_id: id });
  }

  async savePush(sub: PushSubscription) {
    const j = sub.toJSON();
    await rpc("rappels_save_push", { p_key: this.key, p_endpoint: j.endpoint, p_p256dh: j.keys!.p256dh, p_auth: j.keys!.auth });
  }

  async testPush() {
    await rpc("rappels_test_push", { p_key: this.key });
  }
}

export const store = new Store();
