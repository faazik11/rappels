import "./style.css";
import { store, uid, PRAYERS, at, addDays, TOTAL_DAY, type Reminder, type Goal, type PrayerKey } from "./store";
import { TAHSIN, TAHSIN_IMG, tahsinItems, tahsinKey, type TahsinSession } from "./tahsin";
import { icon, inl } from "./icons";
import { burst, confetti, floatText, ripple, buzz } from "./fx";
import { registerSW, notifState, enableNotifications, refreshSubscription, listenForeground, type NotifState } from "./notifications";

type Tab = "today" | "goals" | "times" | "reminders";
let tab: Tab = "today";
let notif: NotifState = "default";

const app = document.getElementById("app")!;
const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
const GOLD = "#a8873a";
const PRAYER_COLOR = "#1f5c45";
const TAHSIN_COLOR: Record<TahsinSession, string> = { matin: "#a8873a", soir: "#2c6e63" };
const FX_COLORS = ["#1f5c45", "#a8873a", "#2c6e63", "#d9b45a", "#0f3b2c"];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pulse = (el: Element | null | undefined, cls: string) => {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
};
const fmtDelay = (ms: number) => {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
};



// ------------------------------------------------------------ Squelette
app.innerHTML = `
  <main id="view"></main>
  <nav class="tabs" aria-label="Navigation principale">
    <button data-tab="today"><span class="ti">${icon("sunrise")}</span><span>Aujourd'hui</span></button>
    <button data-tab="goals"><span class="ti">${icon("target")}</span><span>Objectifs</span></button>
    <button data-tab="times"><span class="ti">${icon("mosque")}</span><span>Horaires</span></button>
    <button data-tab="reminders"><span class="ti">${icon("bell")}</span><span>Rappels</span></button>
  </nav>
  <div id="sheet-root"></div>
  <div id="toast" role="status" aria-live="polite"></div>
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
function toast(html: string, action?: { label: string; run: () => void }) {
  const t = document.getElementById("toast")!;
  t.innerHTML = `<span class="toast-msg">${html}</span>${action ? `<button class="toast-action">${action.label}</button>` : ""}`;
  if (action) {
    t.querySelector(".toast-action")!.addEventListener("click", () => {
      action.run();
      t.classList.remove("show");
    });
  }
  pulse(t, "show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), action ? 6000 : 3200);
}

// ------------------------------------------------------------ Calculs du jour
function dayState(now = new Date()) {
  const day = store.appDay(now);
  const times = store.timesFor(day);
  const prayers = PRAYERS.map((p) => {
    const time = times?.[p.key] || "";
    const open = !!time && now >= at(day, time);
    return { ...p, time, open, done: store.value(day, "p:" + p.key) > 0 };
  });
  const tahsin = (session: TahsinSession) => {
    const items = tahsinItems(session);
    const total = items.reduce((s, i) => s + i.count, 0);
    const done = items.reduce((s, i) => s + Math.min(i.count, store.value(day, tahsinKey(session, i.id))), 0);
    const opensAt = session === "matin" ? times?.fajr : times?.maghrib;
    const open = session === "matin" || (!!opensAt && now >= at(day, opensAt));
    return { session, items, total, done, pct: total ? done / total : 0, opensAt, open };
  };
  const tm = tahsin("matin");
  const ts = tahsin("soir");
  // Prochaine prière (y compris le Fajr de demain)
  let next: { name: string; time: string; date: Date } | null = null;
  for (const p of prayers) {
    if (p.time && !p.open) {
      next = { name: p.name, time: p.time, date: at(day, p.time) };
      break;
    }
  }
  if (!next) {
    const tomorrow = store.timesFor(addDays(day, 1));
    if (tomorrow) next = { name: "Fajr", time: tomorrow.fajr, date: at(addDays(day, 1), tomorrow.fajr) };
  }
  const prayersDone = prayers.filter((p) => p.done).length;
  const overall = (prayersDone / 5 + tm.pct + ts.pct) / 3;
  return { day, times, prayers, prayersDone, tm, ts, next, overall };
}

// ------------------------------------------------------------ Rendu
let lastSig = "";

function render() {
  app.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => {
    b.classList.toggle("on", b.dataset.tab === tab);
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (!store.ready) {
    view.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    return;
  }
  if (tab === "today") renderToday();
  else if (tab === "goals") renderGoals();
  else if (tab === "times") renderTimes();
  else renderReminders();
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
}

function renderToday() {
  const s = dayState();
  const sig = `today|${s.day}|${notif}|${!!s.times}|${goalsSig()}`;
  if (sig !== lastSig) {
    lastSig = sig;
    const [y, m, d] = s.day.split("-").map(Number);
    const date = new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    view.innerHTML = `
      <header class="hero">
        <div>
          <p class="date">${date}</p>
          <h1>${greeting()}&nbsp;!</h1>
          <p class="next" id="next"></p>
        </div>
        <div class="ring">
          <svg viewBox="0 0 120 120">
            <defs><linearGradient id="rg" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stop-color="#a78bfa"/><stop offset=".5" stop-color="#ffc93c"/><stop offset="1" stop-color="#5ef2b0"/>
            </linearGradient></defs>
            <circle cx="60" cy="60" r="50" class="ring-bg"/>
            <circle cx="60" cy="60" r="50" class="ring-fg" id="ring-fg"/>
          </svg>
          <span id="ring-pct">0%</span>
        </div>
      </header>
      ${banner()}
      ${
        s.times
          ? ""
          : `<div class="banner warn">Horaires indisponibles pour l'instant. Vérifie ta connexion, ou choisis ta ville dans l'onglet Horaires.</div>`
      }
      <section class="card prayers-card" id="prayers" style="--c:${PRAYER_COLOR}">
        <div class="card-head"><h3>${inl("mosque")} Prières</h3><span class="count"><span class="n" id="pr-n">0</span><span class="of">/5</span></span></div>
        <div class="prayer-row">
          ${s.prayers
            .map(
              (p) => `
            <button class="prayer" data-p="${p.key}">
              <span class="bubble"><span class="ck">${icon("check", 22, 3)}</span></span>
              <span class="pname">${p.name}</span>
              <span class="ptime">${p.time || "--:--"}</span>
            </button>`
            )
            .join("")}
        </div>
      </section>
      <section class="grid">
        ${tahsinCardHTML("matin")}
        ${tahsinCardHTML("soir")}
      </section>
      <section id="goals-today">${goalsTodayHTML(s)}</section>
      <div class="all-done" id="all-done">${inl("star")} Journée complète&nbsp;!</div>
    `;
    bindBanner();
    view.querySelectorAll<HTMLButtonElement>(".prayer").forEach(bindPrayer);
    (["matin", "soir"] as TahsinSession[]).forEach(bindTahsinCard);
    bindGoalsToday();
  }
  updateToday(s);
}

function tahsinCardHTML(session: TahsinSession) {
  return `
    <article class="card tahsin-card" data-session="${session}" style="--c:${TAHSIN_COLOR[session]}">
      <div class="card-top">
        <span class="emoji">${icon(session === "matin" ? "sunrise" : "moon", 26)}</span>
        <span class="check">${icon("check", 16, 3)}</span>
      </div>
      <h3 class="name"><button class="stretch open-tahsin">Tahsin du ${session}</button></h3>
      <div class="count"><span class="n">0</span><span class="of">%</span></div>
      <div class="bar"><b></b></div>
      <p class="hint"></p>
      <button class="mini-btn validate-all">Tout valider</button>
    </article>`;
}

function updateToday(s = dayState()) {
  // Prières
  const lastOpen = s.prayers.filter((x) => x.open).slice(-1)[0]?.key;
  view.querySelectorAll<HTMLElement>(".prayer").forEach((el) => {
    const p = s.prayers.find((x) => x.key === el.dataset.p)!;
    el.classList.toggle("done", p.done);
    el.classList.toggle("locked", !p.open);
    el.classList.toggle("current", p.open && !p.done && lastOpen === p.key);
    el.querySelector(".ptime")!.textContent = p.time || "--:--";
    el.setAttribute("aria-pressed", String(p.done));
    el.setAttribute("aria-label", `${p.name}, ${p.time}, ${p.done ? "faite" : p.open ? "à faire" : "pas encore entrée"}`);
  });
  const prN = view.querySelector("#pr-n");
  if (prN) prN.textContent = String(s.prayersDone);
  view.querySelector("#prayers")?.classList.toggle("done", s.prayersDone === 5);

  // Tahsin
  for (const t of [s.tm, s.ts]) {
    const card = view.querySelector<HTMLElement>(`.tahsin-card[data-session="${t.session}"]`);
    if (!card) continue;
    card.querySelector(".n")!.textContent = String(Math.round(t.pct * 100));
    (card.querySelector(".bar b") as HTMLElement).style.width = t.pct * 100 + "%";
    card.classList.toggle("done", t.pct >= 1);
    card.classList.toggle("locked", !t.open);
    const label = `Tahsin du ${t.session}, ${Math.round(t.pct * 100)} %` + (!t.open ? `, disponible à ${t.opensAt}` : "");
    card.querySelector(".open-tahsin")!.setAttribute("aria-label", label);
    card.querySelector(".hint")!.textContent = !t.open
      ? `Disponible à ${t.opensAt}`
      : t.pct >= 1
        ? "Validé"
        : `${t.done}/${t.total} récitations`;
    (card.querySelector(".validate-all") as HTMLElement).style.display = t.open && t.pct < 1 ? "" : "none";
  }

  updateGoalsToday(s);

  // Anneau + prochaine prière
  const fg = view.querySelector<SVGCircleElement>("#ring-fg");
  if (fg) {
    const c = 2 * Math.PI * 50;
    fg.style.strokeDasharray = `${c}`;
    fg.style.strokeDashoffset = `${c * (1 - s.overall)}`;
    view.querySelector("#ring-pct")!.textContent = Math.round(s.overall * 100) + "%";
  }
  view.querySelector("#all-done")?.classList.toggle("show", s.overall >= 1);
  const next = view.querySelector("#next");
  if (next) {
    next.innerHTML = s.next
      ? `${inl("mosque")} Prochaine prière : <b>${s.next.name} à ${s.next.time}</b> · dans ${fmtDelay(s.next.date.getTime() - Date.now())}`
      : "";
  }
}

function bindPrayer(el: HTMLButtonElement) {
  el.addEventListener("click", (e) => {
    const s = dayState();
    const p = s.prayers.find((x) => x.key === el.dataset.p)!;
    if (!p.open) {
      pulse(el, "shake");
      buzz(8);
      toast(`${inl("hourglass")} Le temps du ${p.name} n'est pas encore entré (${p.time})`);
      return;
    }
    if (p.done) {
      store.setValues(s.day, { ["p:" + p.key]: 0 });
      pulse(el, "shake");
      buzz(8);
      return;
    }
    const ev = e as MouseEvent;
    store.setValues(s.day, { ["p:" + p.key]: 1 });
    pulse(el, "squish");
    const r = el.querySelector(".bubble")!.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, PRAYER_COLOR, 18);
    floatText(ev.clientX, ev.clientY - 14, p.name, PRAYER_COLOR);
    buzz(14);
    if (s.prayersDone + 1 === 5) {
      buzz([30, 60, 30, 60, 80]);
      setTimeout(() => confetti([PRAYER_COLOR, ...FX_COLORS]), 150);
    }
  });
}

function bindTahsinCard(session: TahsinSession) {
  const card = view.querySelector<HTMLElement>(`.tahsin-card[data-session="${session}"]`)!;
  card.addEventListener("click", (e) => {
    const t = session === "matin" ? dayState().tm : dayState().ts;
    if (!t.open) {
      pulse(card, "shake");
      toast(`${inl("moon")} Le tahsin du soir commence au Maghrib (${t.opensAt})`);
      return;
    }
    if ((e.target as HTMLElement).closest(".validate-all")) {
      validateAll(session, card);
      return;
    }
    ripple(card, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
    openTahsinSheet(session);
  });
}

function validateAll(session: TahsinSession, anchor?: HTMLElement) {
  const day = dayState().day;
  const values: Record<string, number> = {};
  const before: Record<string, number> = {};
  tahsinItems(session).forEach((i) => {
    const k = tahsinKey(session, i.id);
    values[k] = i.count;
    before[k] = store.value(day, k);
  });
  store.setValues(day, values);
  celebrateTahsin(session, anchor);
  toast(`Tahsin du ${session} : tout coché`, {
    label: "Annuler",
    run: () => {
      store.setValues(day, before);
      buzz(10);
    },
  });
}

function celebrateTahsin(session: TahsinSession, anchor?: HTMLElement) {
  buzz([30, 60, 30, 60, 80]);
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, TAHSIN_COLOR[session], 28);
  }
  setTimeout(() => confetti([TAHSIN_COLOR[session], ...FX_COLORS]), 120);
}

// ------------------------------------------------------------ Feuille du Tahsin
function img(id: string, kind: "ph" | "ar", alt: string) {
  const [w, h] = TAHSIN_IMG[`${id}-${kind}`] || [700, 200];
  // Largeur proportionnelle à la brochure (700 px = toute la largeur) : même taille de texte partout
  return `<img class="${kind}" src="./tahsin/${id}-${kind}.webp" width="${w}" height="${h}" style="width:${Math.min(100, (w / 700) * 100).toFixed(1)}%" alt="${alt}" loading="lazy" decoding="async" />`;
}
let sheetUpdate: (() => void) | null = null;

function openTahsinSheet(session: TahsinSession) {
  const color = TAHSIN_COLOR[session];
  const viewMode = store.settings.tahsinView || "both";
  const items = tahsinItems(session);
  const stateOf = () => (session === "matin" ? dayState().tm : dayState().ts);
  openSheet(
    `Tahsin du ${session}`,
    `
    <div class="tahsin-head" style="--c:${color}">
      <div class="bar big"><b id="ts-bar"></b></div>
      <div class="tahsin-meta"><span id="ts-pct">0%</span><span id="ts-count"></span></div>
      <div class="tahsin-actions">
        <div class="seg-switch" id="ts-view">
          <button data-v="both">Les deux</button><button data-v="ph">Phonétique</button><button data-v="ar">Arabe</button>
        </div>
        <button class="btn" id="ts-all">Tout valider</button>
      </div>
    </div>
    <div class="tahsin-list view-${viewMode}" id="ts-list">
      ${items
        .map(
          (i, idx) => `
        <article class="parole" data-id="${i.id}" style="--c:${color}">
          <div class="parole-top">
            <span class="pnum" aria-hidden="true">${idx + 1}</span>
            <span class="plabel">${esc(i.label)}</span>
            <button class="minus" aria-label="Retirer une récitation"><span aria-hidden="true">−</span></button>
          </div>
          <button class="stretch parole-hit" aria-label="Parole ${idx + 1} : ${esc(i.label)}"></button>
          <div class="parole-text">
            ${img(i.id, "ph", esc(i.label))}
            ${img(i.id, "ar", "Texte en arabe de la parole " + (idx + 1))}
          </div>
          <div class="parole-foot">
            <div class="gauge">${Array.from({ length: i.count }, () => "<i></i>").join("")}</div>
            <span class="pcount"></span>
          </div>
          <span class="check">${icon("check", 16, 3)}</span>
        </article>`
        )
        .join("")}
      <p class="source">Texte : brochure de l'A.P.B.I.F. n°10, « Invocations et évocations rapportées du Messager de Allah ».</p>
    </div>`,
    (el, close) => {
      el.classList.add("tall");
      const update = () => {
        const day = dayState().day;
        const t = stateOf();
        (el.querySelector("#ts-bar") as HTMLElement).style.width = t.pct * 100 + "%";
        el.querySelector("#ts-pct")!.textContent = Math.round(t.pct * 100) + "%";
        el.querySelector("#ts-count")!.textContent = `${t.done}/${t.total} récitations`;
        (el.querySelector("#ts-all") as HTMLElement).style.visibility = t.pct >= 1 ? "hidden" : "visible";
        el.querySelectorAll<HTMLElement>(".parole").forEach((p) => {
          const item = TAHSIN.find((x) => x.id === p.dataset.id)!;
          const n = Math.min(item.count, store.value(day, tahsinKey(session, item.id)));
          p.querySelectorAll(".gauge i").forEach((g, k) => g.classList.toggle("on", k < n));
          p.querySelector(".pcount")!.textContent = item.count > 1 ? `${n}/${item.count}` : n ? "Dite" : "À dire";
          p.classList.toggle("done", n >= item.count);
          p.querySelector(".parole-hit")!.setAttribute(
            "aria-label",
            `${p.querySelector(".plabel")!.textContent} : ${n} sur ${item.count}${n >= item.count ? ", terminée" : ", toucher pour ajouter une récitation"}`
          );
        });
      };
      sheetUpdate = update;
      update();

      el.querySelectorAll<HTMLButtonElement>("#ts-view button").forEach((b) => {
        b.classList.toggle("on", b.dataset.v === viewMode);
        b.addEventListener("click", () => {
          const v = b.dataset.v as "both" | "ph" | "ar";
          store.setSettings({ ...store.settings, tahsinView: v });
          el.querySelectorAll("#ts-view button").forEach((x) => x.classList.toggle("on", x === b));
          const list = el.querySelector("#ts-list")!;
          list.classList.remove("view-both", "view-ph", "view-ar");
          list.classList.add("view-" + v);
        });
      });

      el.querySelector("#ts-all")!.addEventListener("click", () => {
        validateAll(session, el.querySelector("#ts-all") as HTMLElement);
        update();
        setTimeout(close, 1000);
      });

      el.querySelectorAll<HTMLElement>(".parole").forEach((p) => {
        const item = TAHSIN.find((x) => x.id === p.dataset.id)!;
        const key = tahsinKey(session, item.id);
        p.querySelector(".minus")!.addEventListener("click", (e) => {
          e.stopPropagation();
          store.bump(dayState().day, key, -1, item.count);
          pulse(p, "shake");
          buzz(8);
          update();
        });
        p.addEventListener("click", (e) => {
          const day = dayState().day;
          const before = store.value(day, key);
          if (before >= item.count) {
            pulse(p, "shake");
            return;
          }
          const wasComplete = stateOf().pct >= 1;
          const n = store.bump(day, key, 1, item.count);
          const ev = e as MouseEvent;
          ripple(p, ev.clientX, ev.clientY);
          const seg = p.querySelectorAll<HTMLElement>(".gauge i")[before];
          pulse(seg, "pop");
          const r = (seg || p).getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height / 2, color, 14);
          floatText(ev.clientX, ev.clientY - 10, item.count > 1 ? `${n}/${item.count}` : "+1", color);
          buzz(12);
          update();
          if (n >= item.count) {
            pulse(p, "squish");
            // On descend à la parole suivante pas encore finie
            const nextEl = [...el.querySelectorAll<HTMLElement>(".parole")].find((x) => !x.classList.contains("done"));
            if (nextEl) setTimeout(() => nextEl.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
          }
          if (stateOf().pct >= 1 && !wasComplete) {
            celebrateTahsin(session);
            setTimeout(close, 1500);
          }
        });
      });
    },
    () => (sheetUpdate = null)
  );
}

// ------------------------------------------------------------ Objectifs (rattrapage + paroles)
const GOAL_COLOR = "#2c6e63";
const isoOf = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getDay() || 7;
};
const prayerName = (k: PrayerKey | null) => PRAYERS.find((p) => p.key === k)?.name || "";
const goalKey = (g: Goal) => "g:" + g.id;
const goalDay = (g: Goal, s = dayState()) => (g.freq === "total" ? TOTAL_DAY : s.day);
const goalValue = (g: Goal, s = dayState()) => store.value(goalDay(g, s), goalKey(g));
const fmtN = (n: number) => n.toLocaleString("fr-FR");

function goalsSig() {
  return store.goals.map((g) => [g.id, g.kind, g.prayer, g.title, g.target, g.freq, g.days.join(""), g.startMode, g.startTime, g.startPrayer].join(",")).join("|");
}

/** Visible aujourd'hui ? (objectif quotidien limité à certains jours) */
function goalToday(g: Goal, s = dayState()) {
  return g.kind === "qada" || g.freq === "total" || g.days.includes(isoOf(s.day));
}

/** Ouvert maintenant ? + texte « à partir de… » */
function goalOpen(g: Goal, s = dayState()): { open: boolean; label: string } {
  if (g.startMode === "time" && g.startTime) {
    return { open: new Date() >= at(s.day, g.startTime), label: `À partir de ${g.startTime}` };
  }
  if (g.startMode === "prayer" && g.startPrayer) {
    const t = s.times?.[g.startPrayer];
    return { open: !!t && new Date() >= at(s.day, t), label: `Après le ${prayerName(g.startPrayer)}${t ? ` (${t})` : ""}` };
  }
  return { open: true, label: "" };
}

function goalsTodayHTML(s: ReturnType<typeof dayState>) {
  const qada = store.goals.filter((g) => g.kind === "qada");
  const dhikr = store.goals.filter((g) => g.kind === "dhikr" && goalToday(g, s));
  if (!qada.length && !dhikr.length) return "";
  return `
    <h2 class="section-title">Mes objectifs</h2>
    ${
      qada.length
        ? `<section class="card qada-card" style="--c:${PRAYER_COLOR}">
            <div class="card-head"><h3>${inl("mosque")} Rattrapage</h3><span class="qada-left" id="qada-left"></span></div>
            ${qada
              .map(
                (g) => `
              <div class="qrow" data-id="${g.id}">
                <div class="qrow-top"><b>${prayerName(g.prayer)}</b><span class="qcount"></span></div>
                <div class="bar"><b></b></div>
                <div class="qrow-actions">
                  <button class="minus" aria-label="Retirer une prière du ${prayerName(g.prayer)}"><span aria-hidden="true">−</span></button>
                  <button class="qplus" aria-label="Valider une prière du ${prayerName(g.prayer)} rattrapée">${icon("plus", 20, 2.4)} Rattrapée</button>
                </div>
              </div>`
              )
              .join("")}
          </section>`
        : ""
    }
    ${dhikr
      .map(
        (g) => `
      <article class="card dhikr-card" data-id="${g.id}" style="--c:${GOAL_COLOR}">
        <div class="card-top">
          <span class="emoji">${icon("beads", 24)}</span>
          <button class="minus" aria-label="Retirer une récitation"><span aria-hidden="true">−</span></button>
        </div>
        <p class="dhikr-text" dir="auto">${esc(g.title)}</p>
        <button class="stretch dhikr-hit" aria-label="${esc(g.title)}"></button>
        <div class="count"><span class="n">0</span><span class="of">/${fmtN(g.target)}</span></div>
        ${g.target <= 12 ? `<div class="gauge">${Array.from({ length: g.target }, () => "<i></i>").join("")}</div>` : `<div class="bar"><b></b></div>`}
        <p class="hint"></p>
        <span class="check">${icon("check", 16, 3)}</span>
      </article>`
      )
      .join("")}`;
}

function updateGoalsToday(s = dayState()) {
  let left = 0;
  view.querySelectorAll<HTMLElement>(".qrow").forEach((row) => {
    const g = store.goals.find((x) => x.id === row.dataset.id);
    if (!g) return;
    const n = Math.min(goalValue(g, s), g.target);
    left += g.target - n;
    row.querySelector(".qcount")!.textContent = `${fmtN(n)} / ${fmtN(g.target)}`;
    (row.querySelector(".bar b") as HTMLElement).style.width = (n / g.target) * 100 + "%";
    row.classList.toggle("done", n >= g.target);
  });
  const ql = view.querySelector("#qada-left");
  if (ql) ql.textContent = left ? `encore ${fmtN(left)}` : "terminé";
  view.querySelector(".qada-card")?.classList.toggle("done", !!ql && left === 0);

  view.querySelectorAll<HTMLElement>(".dhikr-card").forEach((card) => {
    const g = store.goals.find((x) => x.id === card.dataset.id);
    if (!g) return;
    const n = Math.min(goalValue(g, s), g.target);
    const o = goalOpen(g, s);
    card.querySelector(".n")!.textContent = fmtN(n);
    card.querySelectorAll(".gauge i").forEach((seg, i) => seg.classList.toggle("on", i < n));
    const bar = card.querySelector<HTMLElement>(".bar b");
    if (bar) bar.style.width = (n / g.target) * 100 + "%";
    card.classList.toggle("done", n >= g.target);
    card.classList.toggle("locked", !o.open);
    const what = g.freq === "daily" ? "aujourd'hui" : "au total";
    card.querySelector(".hint")!.textContent = !o.open ? o.label : n >= g.target ? `Objectif atteint ${what}` : `Encore ${fmtN(g.target - n)} ${what}`;
    card.querySelector(".dhikr-hit")!.setAttribute("aria-label", `${g.title} : ${n} sur ${g.target} ${what}`);
  });
}

function bindGoalsToday() {
  view.querySelectorAll<HTMLElement>(".qrow").forEach((row) => {
    const g = () => store.goals.find((x) => x.id === row.dataset.id)!;
    row.querySelector(".qplus")!.addEventListener("click", (e) => {
      const goal = g();
      const before = goalValue(goal);
      if (before >= goal.target) return pulse(row, "shake");
      const n = store.bump(goalDay(goal), goalKey(goal), 1, goal.target);
      const btn = e.currentTarget as HTMLElement;
      const r = btn.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, PRAYER_COLOR, 14);
      floatText((e as MouseEvent).clientX, (e as MouseEvent).clientY - 12, "+1", PRAYER_COLOR);
      pulse(btn, "squish");
      buzz(12);
      if (n >= goal.target) {
        buzz([30, 60, 30, 60, 80]);
        setTimeout(() => confetti([PRAYER_COLOR, ...FX_COLORS]), 120);
      }
    });
    row.querySelector(".minus")!.addEventListener("click", () => {
      const goal = g();
      store.bump(goalDay(goal), goalKey(goal), -1, goal.target);
      pulse(row, "shake");
      buzz(8);
    });
  });

  view.querySelectorAll<HTMLElement>(".dhikr-card").forEach((card) => {
    const g = () => store.goals.find((x) => x.id === card.dataset.id)!;
    card.querySelector(".minus")!.addEventListener("click", (e) => {
      e.stopPropagation();
      const goal = g();
      store.bump(goalDay(goal), goalKey(goal), -1, goal.target);
      pulse(card, "shake");
      buzz(8);
    });
    card.addEventListener("click", (e) => {
      const goal = g();
      const o = goalOpen(goal);
      if (!o.open) {
        pulse(card, "shake");
        return toast(`${inl("hourglass")} ${o.label}`);
      }
      const before = goalValue(goal);
      if (before >= goal.target) return pulse(card, "shake");
      const n = store.bump(goalDay(goal), goalKey(goal), 1, goal.target);
      const ev = e as MouseEvent;
      ripple(card, ev.clientX, ev.clientY);
      const seg = card.querySelectorAll<HTMLElement>(".gauge i")[before];
      pulse(seg, "pop");
      pulse(card.querySelector(".n"), "bump");
      const r = (seg || card.querySelector(".count")!).getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, GOAL_COLOR, 10);
      floatText(ev.clientX, ev.clientY - 10, "+1", GOAL_COLOR);
      buzz(10);
      if (n >= goal.target) {
        buzz([30, 60, 30, 60, 80]);
        setTimeout(() => confetti([GOAL_COLOR, ...FX_COLORS]), 120);
      }
    });
  });
}

// ---------- Onglet Objectifs
function renderGoals() {
  lastSig = "";
  const s = dayState();
  const qada = store.goals.filter((g) => g.kind === "qada");
  const dhikr = store.goals.filter((g) => g.kind === "dhikr");
  const dhikrMeta = (g: Goal) => {
    const parts = [g.freq === "daily" ? (g.days.length === 7 ? "Chaque jour" : "Certains jours") : "Objectif total"];
    const o = goalOpen(g, s);
    if (o.label) parts.push(o.label.toLowerCase());
    if (g.notify && g.startMode !== "any") parts.push("notification");
    return parts.join(" · ");
  };
  view.innerHTML = `
    <header class="page-head"><h1>Objectifs</h1><p>Tes prières à rattraper et les paroles que tu veux réciter. Leur progression s'affiche sur l'écran Aujourd'hui.</p></header>
    <h2 class="section-title">Rattrapage des prières</h2>
    <section class="list">
      ${
        qada
          .map((g) => {
            const n = Math.min(goalValue(g, s), g.target);
            return `<article class="rem goal-row" data-id="${g.id}" style="--c:${PRAYER_COLOR}">
              <div class="rem-body"><p class="rem-text">${prayerName(g.prayer)}</p><p class="sub">${fmtN(n)} / ${fmtN(g.target)} rattrapées</p>
              <div class="bar"><b style="width:${(n / g.target) * 100}%"></b></div></div>
            </article>`;
          })
          .join("") || `<p class="empty">Aucune prière à rattraper.</p>`
      }
    </section>
    <button class="btn wide" id="add-qada">${icon("plus", 18, 2.4)} Prière à rattraper</button>
    <h2 class="section-title">Paroles à réciter</h2>
    <section class="list">
      ${
        dhikr
          .map((g) => {
            const n = Math.min(goalValue(g, s), g.target);
            return `<article class="rem goal-row" data-id="${g.id}" style="--c:${GOAL_COLOR}">
              <div class="rem-body"><p class="rem-text" dir="auto">${esc(g.title)}</p><p class="sub">${fmtN(n)} / ${fmtN(g.target)} · ${dhikrMeta(g)}</p></div>
            </article>`;
          })
          .join("") || `<p class="empty">Aucune parole pour l'instant.</p>`
      }
    </section>
    <button class="btn wide" id="add-dhikr">${icon("plus", 18, 2.4)} Parole à réciter</button>
  `;
  view.querySelectorAll<HTMLElement>(".goal-row").forEach((el) =>
    el.addEventListener("click", () => {
      const g = store.goals.find((x) => x.id === el.dataset.id)!;
      g.kind === "qada" ? openQadaSheet(g) : openDhikrSheet(g);
    })
  );
  view.querySelector("#add-qada")!.addEventListener("click", () => openQadaSheet());
  view.querySelector("#add-dhikr")!.addEventListener("click", () => openDhikrSheet());
}

function newGoal(kind: Goal["kind"]): Goal {
  return {
    id: uid(), kind, prayer: kind === "qada" ? "fajr" : null, title: "", target: kind === "qada" ? 50 : 100, freq: kind === "qada" ? "total" : "daily",
    days: [1, 2, 3, 4, 5, 6, 7], startMode: "any", startTime: null, startPrayer: null, notify: false, order: store.goals.length,
  };
}

function deleteGoalWithUndo(g: Goal, close: () => void) {
  const day = goalDay(g);
  const done = store.value(day, goalKey(g));
  store.deleteGoal(g.id);
  close();
  toast(`Objectif supprimé`, {
    label: "Annuler",
    run: () => {
      store.saveGoal(g);
      if (done) store.setValues(day, { [goalKey(g)]: done });
    },
  });
}

function segHTML(name: string, options: [string, string][], value: string) {
  return `<div class="seg-switch full" data-seg="${name}">${options.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === value ? "on" : ""}">${l}</button>`).join("")}</div>`;
}
function bindSeg(el: HTMLElement, name: string, onChange: (v: string) => void) {
  el.querySelectorAll<HTMLButtonElement>(`[data-seg="${name}"] button`).forEach((b) =>
    b.addEventListener("click", () => {
      el.querySelectorAll(`[data-seg="${name}"] button`).forEach((x) => x.classList.toggle("on", x === b));
      onChange(b.dataset.v!);
    })
  );
}
const PRAYER_OPTS = PRAYERS.map((p) => [p.key, p.name] as [string, string]);

function openQadaSheet(goal?: Goal) {
  const g: Goal = goal ? { ...goal } : newGoal("qada");
  const done = goal ? goalValue(goal) : 0;
  openSheet(
    goal ? "Modifier le rattrapage" : "Prière à rattraper",
    `
    <div class="field"><span>Prière</span>${segHTML("prayer", PRAYER_OPTS, g.prayer || "fajr")}</div>
    <label class="field"><span>Nombre à rattraper</span><input id="f-target" type="number" inputmode="numeric" min="1" max="100000" value="${g.target}"/></label>
    ${goal ? `<label class="field"><span>Déjà rattrapées</span><input id="f-done" type="number" inputmode="numeric" min="0" value="${done}"/><small>Pour corriger le compteur si besoin.</small></label>` : ""}
    <div class="sheet-actions">
      ${goal ? `<button class="btn ghost danger" id="f-del">Supprimer</button>` : ""}
      <button class="btn" id="f-save">Enregistrer</button>
    </div>`,
    (el, close) => {
      bindSeg(el, "prayer", (v) => (g.prayer = v as PrayerKey));
      el.querySelector("#f-save")!.addEventListener("click", () => {
        const t = Number(el.querySelector<HTMLInputElement>("#f-target")!.value);
        if (!Number.isFinite(t) || t < 1) return pulse(el.querySelector("#f-target"), "err");
        g.target = Math.min(100000, Math.round(t));
        store.saveGoal(g);
        const doneInput = el.querySelector<HTMLInputElement>("#f-done");
        if (doneInput) store.setValues(TOTAL_DAY, { [goalKey(g)]: Math.max(0, Math.min(g.target, Math.round(Number(doneInput.value) || 0))) });
        close();
        toast(`${inl("check")} ${prayerName(g.prayer)} : ${fmtN(g.target)} à rattraper`);
      });
      el.querySelector("#f-del")?.addEventListener("click", () => deleteGoalWithUndo(goal!, close));
    }
  );
}

function openDhikrSheet(goal?: Goal) {
  const g: Goal = goal ? { ...goal, days: [...goal.days] } : newGoal("dhikr");
  openSheet(
    goal ? "Modifier la parole" : "Parole à réciter",
    `
    <label class="field"><span>Parole</span><textarea id="f-title" rows="3" dir="auto" maxlength="300" placeholder="Écris la parole que tu veux réciter">${esc(g.title)}</textarea></label>
    <label class="field"><span>Nombre de fois</span><input id="f-target" type="number" inputmode="numeric" min="1" max="100000" value="${g.target}"/></label>
    <div class="field"><span>Rythme</span>${segHTML("freq", [["daily", "Chaque jour"], ["total", "Objectif total"]], g.freq)}
      <small id="freq-help"></small></div>
    <div class="field" id="days-field"><span>Jours</span>
      <div class="day-pick">${DAYS.map((d, i) => `<button type="button" data-d="${i + 1}" class="${g.days.includes(i + 1) ? "on" : ""}">${d}</button>`).join("")}</div>
    </div>
    <div class="field"><span>À partir de quand</span>${segHTML("start", [["any", "Toute la journée"], ["time", "Une heure"], ["prayer", "Une prière"]], g.startMode)}
      <input id="f-time" type="time" value="${g.startTime || "21:00"}" class="time-input start-extra" data-for="time"/>
      <div class="start-extra" data-for="prayer">${segHTML("sprayer", PRAYER_OPTS, g.startPrayer || "fajr")}</div>
    </div>
    <label class="check-row" id="notify-row"><input type="checkbox" id="f-notify" ${g.notify ? "checked" : ""}/> M'envoyer une notification à ce moment-là</label>
    <div class="sheet-actions">
      ${goal ? `<button class="btn ghost danger" id="f-del">Supprimer</button>` : ""}
      <button class="btn" id="f-save">Enregistrer</button>
    </div>`,
    (el, close) => {
      const sync = () => {
        (el.querySelector("#days-field") as HTMLElement).style.display = g.freq === "daily" ? "" : "none";
        el.querySelector("#freq-help")!.textContent =
          g.freq === "daily" ? "Le compteur repart à zéro chaque jour (au Fajr)." : "Le compteur s'additionne de jour en jour jusqu'à l'objectif.";
        el.querySelectorAll<HTMLElement>(".start-extra").forEach((x) => (x.style.display = x.dataset.for === g.startMode ? "" : "none"));
        (el.querySelector("#notify-row") as HTMLElement).style.display = g.startMode === "any" ? "none" : "";
      };
      sync();
      bindSeg(el, "freq", (v) => ((g.freq = v as Goal["freq"]), sync()));
      bindSeg(el, "start", (v) => ((g.startMode = v as Goal["startMode"]), sync()));
      bindSeg(el, "sprayer", (v) => (g.startPrayer = v as PrayerKey));
      el.querySelectorAll<HTMLButtonElement>("[data-d]").forEach((b) =>
        b.addEventListener("click", () => {
          const d = Number(b.dataset.d);
          g.days = g.days.includes(d) ? g.days.filter((x) => x !== d) : [...g.days, d].sort();
          b.classList.toggle("on", g.days.includes(d));
        })
      );
      el.querySelector("#f-save")!.addEventListener("click", () => {
        g.title = el.querySelector<HTMLTextAreaElement>("#f-title")!.value.trim();
        if (!g.title) return pulse(el.querySelector("#f-title"), "err");
        const t = Number(el.querySelector<HTMLInputElement>("#f-target")!.value);
        if (!Number.isFinite(t) || t < 1) return pulse(el.querySelector("#f-target"), "err");
        g.target = Math.min(100000, Math.round(t));
        if (g.freq === "daily" && !g.days.length) return toast("Choisis au moins un jour");
        g.startTime = g.startMode === "time" ? el.querySelector<HTMLInputElement>("#f-time")!.value || "21:00" : null;
        if (g.startMode === "prayer") g.startPrayer = g.startPrayer || "fajr";
        else g.startPrayer = null;
        g.notify = g.startMode !== "any" && el.querySelector<HTMLInputElement>("#f-notify")!.checked;
        store.saveGoal(g);
        close();
        toast(`${inl("check")} Parole enregistrée`);
      });
      el.querySelector("#f-del")?.addEventListener("click", () => deleteGoalWithUndo(goal!, close));
    }
  );
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
      return `<div class="banner cta"><div><b>Active les notifications</b><br/>pour être prévenu à chaque prière.</div><button class="btn" id="enable-notif">Activer</button></div>`;
  }
}

function bindBanner() {
  view.querySelector("#enable-notif")?.addEventListener("click", async () => {
    try {
      notif = await enableNotifications();
      if (notif === "granted") toast(`${inl("bell")} Notifications activées&nbsp;!`);
    } catch (e) {
      console.error(e);
      toast(`${inl("alert")} Impossible d'activer les notifications`);
    }
    lastSig = "";
    render();
  });
}

// ------------------------------------------------------------ Onglet Horaires
function renderTimes() {
  lastSig = "";
  const s = dayState();
  const t = s.times;
  const n = (store.settings.notif || {}) as Record<string, boolean>;
  const rows = t
    ? [
        { key: "fajr", name: "Fajr", time: t.fajr, info: "" },
        { key: "shuruq", name: "Chourouq", time: t.shuruq, info: "lever du soleil" },
        { key: "dhuhr", name: "Dhouhr", time: t.dhuhr, info: "" },
        { key: "asr", name: "Asr", time: t.asr, info: "" },
        { key: "maghrib", name: "Maghrib", time: t.maghrib, info: "" },
        { key: "isha", name: "Icha", time: t.isha, info: "" },
      ]
    : [];
  const now = new Date();
  const currentIdx = rows.reduce((acc, r, i) => (now >= at(s.day, r.time) ? i : acc), -1);
  const cityName = store.cities.find((c) => c.id === store.cityId)?.name || "Narbonne";
  const cities = store.cities.length ? store.cities : [{ id: store.cityId, name: cityName }];
  view.innerHTML = `
    <header class="page-head"><h1>Horaires</h1><p>Calendrier de l'APBIF pour <b>${esc(cityName)}</b>.</p></header>
    ${banner()}
    <label class="field city-field"><span>Ville</span>
      <select id="city">${cities.map((c) => `<option value="${c.id}" ${c.id === store.cityId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
    </label>
    <section class="times">
      ${
        rows
          .map(
            (r, i) => `
        <div class="time-row ${i === currentIdx ? "current" : ""} ${r.key === "shuruq" ? "muted" : ""}">
          <div><b>${r.name}</b>${r.info ? `<small>${r.info}</small>` : ""}</div>
          <span class="t">${r.time}</span>
        </div>`
          )
          .join("") || `<p class="empty">Horaires indisponibles.</p>`
      }
    </section>
    ${t && !t.exact ? `<p class="note">Le calendrier de cette année n'est pas encore importé : ce sont les horaires du même jour l'an dernier (quelques minutes d'écart au maximum).</p>` : ""}
    <h2 class="section-title">Notifications</h2>
    <section class="list">
      ${[...PRAYERS.map((p) => ({ key: p.key as string, label: `Prière du ${p.name}` })), { key: "tahsin", label: "Tahsin (au Fajr et au Maghrib)" }]
        .map(
          (o) => `
        <label class="toggle-row" style="--c:${o.key === "tahsin" ? GOLD : PRAYER_COLOR}">
          <span>${o.label}</span>
          <span class="switch"><input type="checkbox" data-n="${o.key}" ${n[o.key] !== false ? "checked" : ""}/><span></span></span>
        </label>`
        )
        .join("")}
    </section>
    <p class="note">Les horaires de l'APBIF sont obtenus par le calcul. L'APBIF précise qu'ils sont donnés à titre indicatif et qu'il faut vérifier visuellement l'entrée du temps de chaque prière.</p>
  `;
  bindBanner();
  view.querySelector<HTMLSelectElement>("#city")!.addEventListener("change", (e) => {
    store.setCity(Number((e.target as HTMLSelectElement).value));
    toast(`${inl("pin")} Ville enregistrée`);
  });
  view.querySelectorAll<HTMLInputElement>("[data-n]").forEach((inp) =>
    inp.addEventListener("change", () => {
      store.setSettings({ ...store.settings, notif: { ...(store.settings.notif || {}), [inp.dataset.n!]: inp.checked } });
      buzz(10);
    })
  );
}

// ------------------------------------------------------------ Onglet Rappels perso
function renderReminders() {
  lastSig = "";
  const today = new Date().getDay() || 7;
  const list = store.reminders;
  view.innerHTML = `
    <header class="page-head"><h1>Rappels</h1><p>Tes rappels personnels, en plus des prières. Chacun t'envoie une notification à l'heure exacte.</p></header>
    ${banner()}
    <section class="list">
      ${
        list.length
          ? list
              .map(
                (r) => `
            <article class="rem ${r.enabled ? "" : "off"}" data-id="${r.id}">
              <div class="rem-time">${r.time}</div>
              <div class="rem-body">
                <p class="rem-text">${esc(r.text) || "<i>Sans texte</i>"}</p>
                <div class="rem-meta">
                  <span class="days">${DAYS.map((d, i) => `<b class="${r.days.includes(i + 1) ? "on" : ""} ${i + 1 === today ? "today" : ""}">${d}</b>`).join("")}</span>
                </div>
              </div>
              <label class="switch" data-stop><input type="checkbox" ${r.enabled ? "checked" : ""}/><span></span></label>
            </article>`
              )
              .join("")
          : `<p class="empty">Aucun rappel personnel pour l'instant.</p>`
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

// ------------------------------------------------------------ Feuilles
function openSheet(title: string, body: string, onMount: (el: HTMLElement, close: () => void) => void, onClose?: () => void) {
  sheetRoot.innerHTML = `
    <div class="scrim"></div>
    <div class="sheet" role="dialog" aria-label="${esc(title)}">
      <div class="grab"></div>
      <div class="sheet-title"><h2>${esc(title)}</h2><button class="close" aria-label="Fermer">${icon("close", 18, 2.2)}</button></div>
      ${body}
    </div>`;
  const el = sheetRoot.querySelector<HTMLElement>(".sheet")!;
  requestAnimationFrame(() => sheetRoot.classList.add("open"));
  const close = () => {
    sheetRoot.classList.remove("open");
    onClose?.();
    setTimeout(() => (sheetRoot.innerHTML = ""), 280);
  };
  sheetRoot.querySelector(".scrim")!.addEventListener("click", close);
  el.querySelector(".close")!.addEventListener("click", close);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      removeEventListener("keydown", onKey);
    }
  };
  addEventListener("keydown", onKey);
  // Glisser vers le bas depuis la poignée / le titre pour fermer
  const handle = el.querySelectorAll<HTMLElement>(".grab, .sheet-title");
  let startY = 0;
  let dy = 0;
  let dragging = false;
  handle.forEach((h) => {
    h.addEventListener("touchstart", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      dragging = true;
      startY = e.touches[0].clientY;
      dy = 0;
      el.style.transition = "none";
    }, { passive: true });
  });
  el.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    el.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  el.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    el.style.transition = "";
    el.style.transform = "";
    if (dy > 90) close();
  });
  onMount(el, close);
}

function openReminderSheet(rem?: Reminder) {
  const r: Reminder = rem
    ? { ...rem, days: [...rem.days] }
    : { id: uid(), time: "09:00", days: [1, 2, 3, 4, 5, 6, 7], text: "", taskId: null, skipIfDone: false, enabled: true };
  openSheet(
    rem ? "Modifier le rappel" : "Nouveau rappel",
    `
    <label class="field"><span>Heure</span><input id="f-time" type="time" value="${r.time}" class="time-input"/></label>
    <label class="field"><span>Message</span><input id="f-text" maxlength="80" placeholder="ex. Lire une page de Coran" value="${esc(r.text)}"/></label>
    <div class="field"><span>Jours</span>
      <div class="day-pick">${DAYS.map((d, i) => `<button data-d="${i + 1}" class="${r.days.includes(i + 1) ? "on" : ""}">${d}</button>`).join("")}</div>
      <div class="quick"><button data-q="all">Tous les jours</button><button data-q="week">Lun → ven</button><button data-q="we">Week-end</button></div>
    </div>
    <div class="sheet-actions">
      ${rem ? `<button class="btn ghost danger" id="f-del">Supprimer</button>` : ""}
      <button class="btn" id="f-save">Enregistrer</button>
    </div>`,
    (el, close) => {
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
        if (!r.days.length) return toast("Choisis au moins un jour");
        if (!r.text) return pulse(el.querySelector("#f-text"), "err");
        store.saveReminder(r);
        close();
        toast(`${inl("bell")} Rappel à <b>${r.time}</b> enregistré`);
      });
      el.querySelector("#f-del")?.addEventListener("click", () => {
        const removed = store.reminders.find((x) => x.id === r.id);
        store.deleteReminder(r.id);
        close();
        if (removed) toast(`${inl("bell")} Rappel de ${removed.time} supprimé`, { label: "Annuler", run: () => store.saveReminder(removed) });
      });
    }
  );
}

// ------------------------------------------------------------ iPhone : barre du bas collée au vrai bas de l'écran
// En appli installée, on vérifie où tombe le bas de la barre et on corrige l'écart éventuel avec le bas de l'écran.
function fixTabBar() {
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (!standalone) return;
  const bar = document.querySelector<HTMLElement>(".tabs")!;
  bar.style.marginTop = "";
  const portrait = innerHeight >= innerWidth;
  const screenH = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
  const gap = Math.round(screenH - bar.getBoundingClientRect().bottom);
  if (Math.abs(gap) > 1 && Math.abs(gap) < 160) bar.style.marginTop = gap + "px";
}
addEventListener("resize", () => setTimeout(fixTabBar, 50));
addEventListener("orientationchange", () => setTimeout(fixTabBar, 300));
setTimeout(fixTabBar, 0);
setTimeout(fixTabBar, 600);

// ------------------------------------------------------------ Démarrage
store.subscribe(() => {
  if (!store.ready) return;
  if (tab === "today") renderToday();
  else if (tab === "goals") renderGoals();
  else if (tab === "times") renderTimes();
  else renderReminders();
  sheetUpdate?.();
});

setInterval(() => {
  store.checkDay();
  if (tab === "today") renderToday();
}, 20_000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    if (!store.checkDay()) store.pull().catch(() => {});
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
  }
  notif = await notifState();
  lastSig = "";
  render();
  if (notif === "granted") refreshSubscription().catch(console.warn);
  listenForeground((title, body) => {
    buzz([20, 40, 20]);
    toast(`<b>${esc(title)}</b><br/>${esc(body)}`);
  });
})();
