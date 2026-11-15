import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  increment,
  serverTimestamp,
  getDocs,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";

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

declare global {
  interface Window {
    FIREBASE_CONFIG?: Record<string, string>;
    FIREBASE_VAPID_KEY?: string;
  }
}

export const firebaseConfig = window.FIREBASE_CONFIG;
export const isDemo = !firebaseConfig || !firebaseConfig.apiKey;

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

type Listener = () => void;

class Store {
  tasks: Task[] = [];
  reminders: Reminder[] = [];
  counts: Record<string, number> = {};
  date = todayKey();
  ready = false;
  user: string | null = null;
  app: FirebaseApp | null = null;
  private db: Firestore | null = null;
  private listeners = new Set<Listener>();
  private unsubs: Unsubscribe[] = [];
  private progressUnsub: Unsubscribe | null = null;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  async init() {
    if (isDemo) return this.initLocal();
    this.app = initializeApp(firebaseConfig!);
    this.db = initializeFirestore(this.app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    const auth = getAuth(this.app);
    await new Promise<void>((resolve, reject) => {
      const off = onAuthStateChanged(auth, async (u) => {
        if (u) {
          off();
          this.user = u.uid;
          resolve();
        } else {
          signInAnonymously(auth).catch(reject);
        }
      });
    });
    await this.initRemote();
  }

  // ---------- Mode démo (localStorage) ----------
  private initLocal() {
    const raw = localStorage.getItem("rappels:data");
    if (raw) {
      const d = JSON.parse(raw);
      this.tasks = d.tasks;
      this.reminders = d.reminders;
    } else {
      const s = seed();
      this.tasks = s.tasks;
      this.reminders = s.reminders;
      this.saveLocal();
    }
    this.loadLocalProgress();
    this.ready = true;
    this.emit();
  }
  private saveLocal() {
    localStorage.setItem("rappels:data", JSON.stringify({ tasks: this.tasks, reminders: this.reminders }));
  }
  private loadLocalProgress() {
    this.counts = JSON.parse(localStorage.getItem("rappels:progress:" + this.date) || "{}");
  }

  // ---------- Mode Firebase ----------
  private userPath() {
    return `users/${this.user}`;
  }

  private async initRemote() {
    const db = this.db!;
    const base = this.userPath();
    await setDoc(
      doc(db, base),
      { lastSeen: serverTimestamp(), appUrl: new URL("./", location.href).href, tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
      { merge: true }
    );

    // Premier lancement : on crée la tâche et les rappels d'exemple
    const existing = await getDocs(collection(db, base, "tasks"));
    if (existing.empty && !localStorage.getItem("rappels:seeded:" + this.user)) {
      const s = seed();
      const batch = writeBatch(db);
      s.tasks.forEach((t) => batch.set(doc(db, base, "tasks", t.id), t));
      s.reminders.forEach((r) => batch.set(doc(db, base, "reminders", r.id), { ...r, uid: this.user }));
      await batch.commit();
      localStorage.setItem("rappels:seeded:" + this.user, "1");
    }

    let gotTasks = false;
    let gotReminders = false;
    const markReady = () => {
      if (gotTasks && gotReminders && !this.ready) this.ready = true;
      this.emit();
    };
    this.unsubs.push(
      onSnapshot(collection(db, base, "tasks"), (snap) => {
        this.tasks = snap.docs.map((d) => d.data() as Task).sort((a, b) => a.order - b.order);
        gotTasks = true;
        markReady();
      })
    );
    this.unsubs.push(
      onSnapshot(collection(db, base, "reminders"), (snap) => {
        this.reminders = snap.docs.map((d) => d.data() as Reminder).sort((a, b) => a.time.localeCompare(b.time));
        gotReminders = true;
        markReady();
      })
    );
    this.watchProgress();
  }

  private watchProgress() {
    if (isDemo) return;
    this.progressUnsub?.();
    this.progressUnsub = onSnapshot(doc(this.db!, this.userPath(), "progress", this.date), (snap) => {
      this.counts = (snap.data()?.counts as Record<string, number>) || {};
      this.emit();
    });
  }

  /** À appeler régulièrement : remet les jauges à zéro quand on change de jour */
  checkDay() {
    const k = todayKey();
    if (k === this.date) return false;
    this.date = k;
    this.counts = {};
    if (isDemo) this.loadLocalProgress();
    else this.watchProgress();
    this.emit();
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
    this.emit();
    if (isDemo) {
      localStorage.setItem("rappels:progress:" + this.date, JSON.stringify(this.counts));
    } else {
      setDoc(
        doc(this.db!, this.userPath(), "progress", this.date),
        { counts: { [taskId]: increment(delta) }, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }
  }

  saveTask(t: Task) {
    const i = this.tasks.findIndex((x) => x.id === t.id);
    if (i >= 0) this.tasks[i] = t;
    else this.tasks.push(t);
    this.tasks.sort((a, b) => a.order - b.order);
    this.emit();
    if (isDemo) this.saveLocal();
    else setDoc(doc(this.db!, this.userPath(), "tasks", t.id), t);
  }

  deleteTask(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    // Les rappels liés deviennent de simples rappels
    this.reminders.filter((r) => r.taskId === id).forEach((r) => this.saveReminder({ ...r, taskId: null, skipIfDone: false }));
    this.emit();
    if (isDemo) this.saveLocal();
    else deleteDoc(doc(this.db!, this.userPath(), "tasks", id));
  }

  saveReminder(r: Reminder) {
    const i = this.reminders.findIndex((x) => x.id === r.id);
    if (i >= 0) this.reminders[i] = r;
    else this.reminders.push(r);
    this.reminders.sort((a, b) => a.time.localeCompare(b.time));
    this.emit();
    if (isDemo) this.saveLocal();
    else setDoc(doc(this.db!, this.userPath(), "reminders", r.id), { ...r, uid: this.user });
  }

  deleteReminder(id: string) {
    this.reminders = this.reminders.filter((r) => r.id !== id);
    this.emit();
    if (isDemo) this.saveLocal();
    else deleteDoc(doc(this.db!, this.userPath(), "reminders", id));
  }

  async addPushToken(token: string) {
    if (isDemo || !this.db) return;
    await setDoc(doc(this.db, this.userPath(), "tokens", token), { token, createdAt: serverTimestamp(), ua: navigator.userAgent });
  }
}

export const store = new Store();
