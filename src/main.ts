import "./style.css";
import { store, uid, COLORS, type Task, type Reminder } from "./store";
import { burst, confetti, floatText, ripple, buzz } from "./fx";
import { registerSW, notifState, enableNotifications, refreshSubscription, listenForeground, type NotifState } from "./notifications";

type Tab = "today" | "reminders" | "tasks";
let tab: Tab = "today";
let notif: NotifState = "default";

const app = document.getElementById("app")!;
const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const EMOJIS = ["💰", "📞", "📦", "✉️", "🤝", "📸", "💧", "🏃", "📚", "🧾", "⭐", "🔥", "🎯", "🛒", "🧹", "💪"];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const isoDay = (d = new Date()) => d.getDay() || 7;

// ------------------------------------------------------------ Squelette
app.innerHTML = `
  <main id="view"></main>
  <nav class="tabs">
    <button data-tab="today"><span class="ti">◉</span><span>Aujourd'hui</span></button>
    <button data-tab="reminders"><span class="ti">🔔</span><span>Rappels</span></button>
    <button data-tab="tasks"><span class="ti">☰</span><span>Tâches</span></button>
  </nav>
  <div id="sheet-root"></div>
  <div id="toast"></div>
`;
const view = document.getElementById("view")!;
const sheetRoot = document.getElementById("sheet-root")!;

app.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    tab = b.dataset.tab as Tab;
    lastSig = "";
    render();
    view.scrollTo({ top: 0 });
  })
);

let toastTimer = 0;
function toast(html: string) {
  const t = document.getElementById("toast")!;
  t.innerHTML = html;
  t.classList.remove("show");
  void t.offsetWidth;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3200);
}

// ------------------------------------------------------------ Rendu
let lastSig = "";

function render() {
  app.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (!store.ready) {
    view.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    return;
  }
  if (tab === "today") renderToday();
  else if (tab === "reminders") renderReminders();
  else renderTasks();
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
}

function nextReminder(): { r: Reminder; when: string } | null {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset < 8; offset++) {
    const day = ((isoDay(now) - 1 + offset) % 7) + 1;
    const list = store.reminders
      .filter((r) => r.enabled && r.days.includes(day))
      .filter((r) => {
        if (offset > 0) return true;
        const [h, m] = r.time.split(":").map(Number);
        return h * 60 + m > nowMin;
      })
      .sort((a, b) => a.time.localeCompare(b.time));
    if (list.length) {
      const when = offset === 0 ? "" : offset === 1 ? "demain " : DAY_NAMES[day - 1] + " ";
      return { r: list[0], when };
    }
  }
  return null;
}

function dayProgress() {
  let done = 0,
    total = 0;
  for (const t of store.tasks) {
    total += t.goal;
    done += Math.min(store.count(t.id), t.goal);
  }
  return total ? done / total : 0;
}

function renderToday() {
  const sig = "today|" + store.tasks.map((t) => [t.id, t.name, t.emoji, t.color, t.goal].join(",")).join(";");
  if (sig !== lastSig) {
    lastSig = sig;
    const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    view.innerHTML = `
      <header class="hero">
        <div>
          <p class="date">${date}</p>
          <h1>${greeting()}&nbsp;!</h1>
          <p class="next" id="next"></p>
        </div>
        <div class="ring" id="ring">
          <svg viewBox="0 0 120 120">
            <defs><linearGradient id="rg" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stop-color="#ff7a59"/><stop offset=".5" stop-color="#ffc93c"/><stop offset="1" stop-color="#5ef2b0"/>
            </linearGradient></defs>
            <circle cx="60" cy="60" r="50" class="ring-bg"/>
            <circle cx="60" cy="60" r="50" class="ring-fg" id="ring-fg"/>
          </svg>
          <span id="ring-pct">0%</span>
        </div>
      </header>
      ${banner()}
      <section class="grid" id="grid">
        ${store.tasks.map(cardHTML).join("")}
        <button class="card add-card" id="add-task"><span>＋</span>Ajouter une jauge</button>
      </section>
      <div class="all-done" id="all-done">🎉 Journée bouclée, bravo&nbsp;!</div>
    `;
    bindBanner();
    view.querySelector("#add-task")!.addEventListener("click", () => openTaskSheet());
    view.querySelectorAll<HTMLElement>(".card[data-id]").forEach(bindCard);
  }
  updateToday();
}

function cardHTML(t: Task) {
  const segs = t.goal <= 12;
  return `
    <article class="card" data-id="${t.id}" style="--c:${t.color}">
      <div class="card-top">
        <span class="emoji">${esc(t.emoji)}</span>
        <button class="minus" aria-label="Retirer une validation">−</button>
      </div>
      <h3 class="name">${esc(t.name)}</h3>
      <div class="count"><span class="n">0</span><span class="of">/${t.goal}</span></div>
      ${
        segs
          ? `<div class="gauge">${Array.from({ length: t.goal }, () => "<i></i>").join("")}</div>`
          : `<div class="bar"><b></b></div>`
      }
      <p class="hint">Touche pour valider</p>
      <span class="check">✓</span>
    </article>`;
}

function updateToday() {
  for (const t of store.tasks) {
    const card = view.querySelector<HTMLElement>(`.card[data-id="${t.id}"]`);
    if (!card) continue;
    const n = store.count(t.id);
    card.querySelector(".n")!.textContent = String(n);
    card.querySelectorAll(".gauge i").forEach((seg, i) => seg.classList.toggle("on", i < n));
    const bar = card.querySelector<HTMLElement>(".bar b");
    if (bar) bar.style.width = Math.min(100, (n / t.goal) * 100) + "%";
    card.classList.toggle("done", n >= t.goal);
    const hint = card.querySelector(".hint")!;
    hint.textContent = n > t.goal ? `Objectif dépassé · +${n - t.goal} bonus` : n === t.goal ? "Objectif atteint" : n === 0 ? "Touche pour valider" : `Encore ${t.goal - n}`;
  }
  const p = dayProgress();
  const fg = view.querySelector<SVGCircleElement>("#ring-fg");
  if (fg) {
    const c = 2 * Math.PI * 50;
    fg.style.strokeDasharray = `${c}`;
    fg.style.strokeDashoffset = `${c * (1 - p)}`;
    view.querySelector("#ring-pct")!.textContent = Math.round(p * 100) + "%";
  }
  view.querySelector("#all-done")?.classList.toggle("show", store.tasks.length > 0 && p >= 1);
  const next = view.querySelector("#next");
  if (next) {
    const nr = nextReminder();
    next.innerHTML = nr ? `🔔 Prochain rappel <b>${nr.when}${nr.r.time}</b> · ${esc(nr.r.text)}` : "Aucun rappel prévu";
  }
}

function bindCard(card: HTMLElement) {
  const id = card.dataset.id!;
  card.addEventListener("click", (e) => {
    const t = store.tasks.find((x) => x.id === id);
    if (!t) return;
    const before = store.count(id);
    const ev = e as MouseEvent;
    ripple(card, ev.clientX, ev.clientY);
    store.bump(id, 1);
    const n = before + 1;

    // Animation de la carte et du segment qui se remplit
    card.classList.remove("squish");
    void card.offsetWidth;
    card.classList.add("squish");
    const seg = card.querySelectorAll<HTMLElement>(".gauge i")[before];
    const anchor = (seg || card.querySelector(".count")!) as HTMLElement;
    if (seg) {
      seg.classList.remove("pop");
      void seg.offsetWidth;
      seg.classList.add("pop");
    }
    const num = card.querySelector<HTMLElement>(".n")!;
    num.classList.remove("bump");
    void num.offsetWidth;
    num.classList.add("bump");

    const r = anchor.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, t.color, 16);
    floatText(ev.clientX, ev.clientY - 10, "+1", t.color);
    buzz(12);

    if (n === t.goal) {
      buzz([30, 60, 30, 60, 80]);
      setTimeout(() => {
        confetti([t.color, "#ffffff", "#ffc93c", "#5ef2b0", "#a78bfa"]);
        toast(`${esc(t.emoji)} <b>${esc(t.name)}</b> : objectif atteint&nbsp;!`);
        if (dayProgress() >= 1) setTimeout(() => confetti(COLORS, 220), 700);
      }, 120);
    }
  });

  card.querySelector(".minus")!.addEventListener("click", (e) => {
    e.stopPropagation();
    if (store.count(id) <= 0) return;
    store.bump(id, -1);
    buzz(8);
    card.classList.remove("shake");
    void card.offsetWidth;
    card.classList.add("shake");
  });
}

// ------------------------------------------------------------ Bandeau notifications
function banner() {
  switch (notif) {
    case "granted":
      return "";
    case "ios-install":
      return `<div class="banner"><b>Pour recevoir les rappels sur iPhone</b> : touche <span class="kbd">Partager ⎋</span> puis <span class="kbd">Sur l'écran d'accueil</span>, et ouvre l'appli depuis l'icône.</div>`;
    case "unsupported":
      return `<div class="banner warn">Ce navigateur ne gère pas les notifications. Sur Android, ouvre l'appli avec Chrome.</div>`;
    case "denied":
      return `<div class="banner warn">Notifications bloquées. Autorise-les dans les réglages du téléphone pour cette appli.</div>`;
    default:
      return `<div class="banner cta"><div><b>Active les notifications</b><br/>pour recevoir tes rappels pile à l'heure.</div><button class="btn" id="enable-notif">Activer</button></div>`;
  }
}

function bindBanner() {
  view.querySelector("#enable-notif")?.addEventListener("click", async () => {
    try {
      notif = await enableNotifications();
      if (notif === "granted") toast("🔔 Notifications activées&nbsp;!");
    } catch (e) {
      console.error(e);
      toast("Impossible d'activer les notifications 😕");
    }
    lastSig = "";
    render();
  });
}

// ------------------------------------------------------------ Onglet Rappels
function renderReminders() {
  lastSig = "";
  const today = isoDay();
  view.innerHTML = `
    <header class="page-head"><h1>Rappels</h1><p>Chaque rappel t'envoie une notification à l'heure exacte.</p></header>
    ${banner()}
    <section class="list">
      ${
        store.reminders.length
          ? store.reminders
              .map((r) => {
                const t = store.tasks.find((x) => x.id === r.taskId);
                return `
            <article class="rem ${r.enabled ? "" : "off"}" data-id="${r.id}" style="--c:${t?.color || "#a78bfa"}">
              <div class="rem-time">${r.time}</div>
              <div class="rem-body">
                <p class="rem-text">${esc(r.text) || "<i>Sans texte</i>"}</p>
                <div class="rem-meta">
                  <span class="days">${DAYS.map((d, i) => `<b class="${r.days.includes(i + 1) ? "on" : ""} ${i + 1 === today ? "today" : ""}">${d}</b>`).join("")}</span>
                  ${t ? `<span class="tag">${esc(t.emoji)} ${esc(t.name)}${r.skipIfDone ? " · sauté si fini" : ""}</span>` : ""}
                </div>
              </div>
              <label class="switch" data-stop><input type="checkbox" ${r.enabled ? "checked" : ""}/><span></span></label>
            </article>`;
              })
              .join("")
          : `<p class="empty">Aucun rappel pour l'instant.</p>`
      }
    </section>
    <button class="fab" id="add-rem">＋ Nouveau rappel</button>
  `;
  bindBanner();
  view.querySelectorAll<HTMLElement>(".rem").forEach((el) => {
    const r = store.reminders.find((x) => x.id === el.dataset.id)!;
    el.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-stop]")) return;
      openReminderSheet(r);
    });
    el.querySelector("input")!.addEventListener("change", (e) => {
      store.saveReminder({ ...r, enabled: (e.target as HTMLInputElement).checked });
      buzz(10);
    });
  });
  view.querySelector("#add-rem")!.addEventListener("click", () => openReminderSheet());
}

// ------------------------------------------------------------ Onglet Tâches
function renderTasks() {
  lastSig = "";
  view.innerHTML = `
    <header class="page-head"><h1>Tâches</h1><p>Chaque tâche a une jauge et un objectif par jour. Les jauges repartent à zéro chaque matin.</p></header>
    <section class="list">
      ${
        store.tasks.length
          ? store.tasks
              .map(
                (t, i) => `
          <article class="task-row" data-id="${t.id}" style="--c:${t.color}">
            <span class="emoji big">${esc(t.emoji)}</span>
            <div class="rem-body"><p class="rem-text">${esc(t.name)}</p><p class="sub">Objectif : ${t.goal} par jour</p></div>
            <div class="order" data-stop>
              <button data-move="-1" ${i === 0 ? "disabled" : ""} aria-label="Monter">▲</button>
              <button data-move="1" ${i === store.tasks.length - 1 ? "disabled" : ""} aria-label="Descendre">▼</button>
            </div>
          </article>`
              )
              .join("")
          : `<p class="empty">Aucune tâche. Ajoute ta première jauge&nbsp;!</p>`
      }
    </section>
    <button class="fab" id="add-task2">＋ Nouvelle tâche</button>
  `;
  view.querySelectorAll<HTMLElement>(".task-row").forEach((el) => {
    const id = el.dataset.id!;
    el.addEventListener("click", (e) => {
      const mv = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-move]");
      if (mv) {
        move(id, Number(mv.dataset.move));
        return;
      }
      if ((e.target as HTMLElement).closest("[data-stop]")) return;
      openTaskSheet(store.tasks.find((t) => t.id === id));
    });
  });
  view.querySelector("#add-task2")!.addEventListener("click", () => openTaskSheet());
}

function move(id: string, dir: number) {
  const list = [...store.tasks];
  const i = list.findIndex((t) => t.id === id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((t, k) => t.order !== k && store.saveTask({ ...t, order: k }));
}

// ------------------------------------------------------------ Feuilles d'édition
function openSheet(title: string, body: string, onMount: (el: HTMLElement, close: () => void) => void) {
  sheetRoot.innerHTML = `
    <div class="scrim"></div>
    <div class="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="grab"></div>
      <h2>${esc(title)}</h2>
      ${body}
    </div>`;
  const el = sheetRoot.querySelector<HTMLElement>(".sheet")!;
  requestAnimationFrame(() => sheetRoot.classList.add("open"));
  const close = () => {
    sheetRoot.classList.remove("open");
    setTimeout(() => (sheetRoot.innerHTML = ""), 280);
  };
  sheetRoot.querySelector(".scrim")!.addEventListener("click", close);
  onMount(el, close);
}

function openTaskSheet(task?: Task) {
  const t: Task = task
    ? { ...task }
    : { id: uid(), name: "", emoji: EMOJIS[store.tasks.length % EMOJIS.length], color: COLORS[store.tasks.length % COLORS.length], goal: 5, order: store.tasks.length };
  openSheet(
    task ? "Modifier la tâche" : "Nouvelle tâche",
    `
    <label class="field"><span>Nom</span><input id="f-name" maxlength="30" placeholder="ex. Vente, Appels, Posts…" value="${esc(t.name)}"/></label>
    <div class="field"><span>Objectif par jour</span>
      <div class="stepper"><button id="g-minus">−</button><output id="g-val">${t.goal}</output><button id="g-plus">＋</button></div>
    </div>
    <div class="field"><span>Icône</span>
      <div class="emoji-pick">${EMOJIS.map((e) => `<button data-e="${e}" class="${e === t.emoji ? "on" : ""}">${e}</button>`).join("")}</div>
    </div>
    <div class="field"><span>Couleur</span>
      <div class="colors">${COLORS.map((c) => `<button data-c="${c}" style="--c:${c}" class="${c === t.color ? "on" : ""}"></button>`).join("")}</div>
    </div>
    <div class="sheet-actions">
      ${task ? `<button class="btn ghost danger" id="f-del">Supprimer</button>` : ""}
      <button class="btn" id="f-save">Enregistrer</button>
    </div>`,
    (el, close) => {
      const name = el.querySelector<HTMLInputElement>("#f-name")!;
      const out = el.querySelector("#g-val")!;
      const setGoal = (g: number) => {
        t.goal = Math.max(1, Math.min(50, g));
        out.textContent = String(t.goal);
      };
      el.querySelector("#g-minus")!.addEventListener("click", () => setGoal(t.goal - 1));
      el.querySelector("#g-plus")!.addEventListener("click", () => setGoal(t.goal + 1));
      el.querySelectorAll<HTMLButtonElement>("[data-e]").forEach((b) =>
        b.addEventListener("click", () => {
          t.emoji = b.dataset.e!;
          el.querySelectorAll("[data-e]").forEach((x) => x.classList.toggle("on", x === b));
        })
      );
      el.querySelectorAll<HTMLButtonElement>("[data-c]").forEach((b) =>
        b.addEventListener("click", () => {
          t.color = b.dataset.c!;
          el.querySelectorAll("[data-c]").forEach((x) => x.classList.toggle("on", x === b));
        })
      );
      el.querySelector("#f-save")!.addEventListener("click", () => {
        t.name = name.value.trim();
        if (!t.name) {
          name.classList.add("err");
          name.focus();
          return;
        }
        store.saveTask(t);
        close();
        toast(`${esc(t.emoji)} <b>${esc(t.name)}</b> enregistrée`);
      });
      el.querySelector("#f-del")?.addEventListener("click", () => {
        if (!confirm(`Supprimer « ${t.name} » ?`)) return;
        store.deleteTask(t.id);
        close();
      });
      if (!task) setTimeout(() => name.focus(), 300);
    }
  );
}

function openReminderSheet(rem?: Reminder) {
  const r: Reminder = rem
    ? { ...rem, days: [...rem.days] }
    : { id: uid(), time: "09:00", days: [1, 2, 3, 4, 5], text: "", taskId: null, skipIfDone: false, enabled: true };
  openSheet(
    rem ? "Modifier le rappel" : "Nouveau rappel",
    `
    <label class="field"><span>Heure</span><input id="f-time" type="time" value="${r.time}" class="time-input"/></label>
    <label class="field"><span>Message</span><input id="f-text" maxlength="80" placeholder="ex. Pense à relancer tes clients" value="${esc(r.text)}"/></label>
    <div class="field"><span>Jours</span>
      <div class="day-pick">${DAYS.map((d, i) => `<button data-d="${i + 1}" class="${r.days.includes(i + 1) ? "on" : ""}">${d}</button>`).join("")}</div>
      <div class="quick"><button data-q="all">Tous les jours</button><button data-q="week">Lun → ven</button><button data-q="we">Week-end</button></div>
    </div>
    <label class="field"><span>Lier à une jauge</span>
      <select id="f-task"><option value="">Aucune</option>${store.tasks.map((t) => `<option value="${t.id}" ${t.id === r.taskId ? "selected" : ""}>${esc(t.emoji)} ${esc(t.name)}</option>`).join("")}</select>
      <small>La notif affichera ton avancement (ex. « Vente 2/5 »).</small>
    </label>
    <label class="check-row" id="skip-row"><input type="checkbox" id="f-skip" ${r.skipIfDone ? "checked" : ""}/> Ne pas envoyer si l'objectif est déjà atteint</label>
    <div class="sheet-actions">
      ${rem ? `<button class="btn ghost danger" id="f-del">Supprimer</button>` : ""}
      <button class="btn" id="f-save">Enregistrer</button>
    </div>`,
    (el, close) => {
      const sel = el.querySelector<HTMLSelectElement>("#f-task")!;
      const skipRow = el.querySelector<HTMLElement>("#skip-row")!;
      const syncSkip = () => (skipRow.style.display = sel.value ? "" : "none");
      syncSkip();
      sel.addEventListener("change", syncSkip);
      const paintDays = () => el.querySelectorAll<HTMLElement>("[data-d]").forEach((b) => b.classList.toggle("on", r.days.includes(Number(b.dataset.d))));
      el.querySelectorAll<HTMLButtonElement>("[data-d]").forEach((b) =>
        b.addEventListener("click", () => {
          const d = Number(b.dataset.d);
          r.days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d].sort();
          paintDays();
        })
      );
      el.querySelectorAll<HTMLButtonElement>("[data-q]").forEach((b) =>
        b.addEventListener("click", () => {
          r.days = b.dataset.q === "all" ? [1, 2, 3, 4, 5, 6, 7] : b.dataset.q === "week" ? [1, 2, 3, 4, 5] : [6, 7];
          paintDays();
        })
      );
      el.querySelector("#f-save")!.addEventListener("click", () => {
        r.time = el.querySelector<HTMLInputElement>("#f-time")!.value || "09:00";
        r.text = el.querySelector<HTMLInputElement>("#f-text")!.value.trim();
        r.taskId = sel.value || null;
        r.skipIfDone = !!r.taskId && el.querySelector<HTMLInputElement>("#f-skip")!.checked;
        if (!r.days.length) {
          toast("Choisis au moins un jour");
          return;
        }
        if (!r.text && !r.taskId) {
          el.querySelector("#f-text")!.classList.add("err");
          return;
        }
        store.saveReminder(r);
        close();
        toast(`🔔 Rappel à <b>${r.time}</b> enregistré`);
      });
      el.querySelector("#f-del")?.addEventListener("click", () => {
        store.deleteReminder(r.id);
        close();
      });
    }
  );
}

// ------------------------------------------------------------ Démarrage
store.subscribe(() => {
  if (tab === "today" && store.ready) {
    // Si les tâches n'ont pas changé, on met juste à jour les jauges (les animations ne sont pas coupées)
    renderToday();
  } else render();
});

setInterval(() => {
  if (store.checkDay()) lastSig = "";
  if (tab === "today") updateToday();
}, 30_000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (store.checkDay()) lastSig = "";
    render();
  }
});

(async () => {
  render();
  await registerSW();
  try {
    await store.init();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="loading"><p>Connexion impossible 😕<br/><small>${esc(String(e))}</small></p></div>`;
    return;
  }
  notif = await notifState();
  lastSig = "";
  render();
  if (notif === "granted") refreshSubscription().catch(console.warn);
  listenForeground((title, body) => {
    buzz([20, 40, 20]);
    toast(`🔔 <b>${esc(title)}</b><br/>${esc(body)}`);
  });
})();
