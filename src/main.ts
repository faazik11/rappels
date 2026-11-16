import "./style.css";
import { store, uid, PRAYERS, at, addDays, type Reminder } from "./store";
import { TAHSIN, tahsinItems, tahsinKey, type TahsinSession } from "./tahsin";
import { burst, confetti, floatText, ripple, buzz } from "./fx";
import { registerSW, notifState, enableNotifications, refreshSubscription, listenForeground, type NotifState } from "./notifications";

type Tab = "today" | "times" | "reminders";
let tab: Tab = "today";
let notif: NotifState = "default";

const app = document.getElementById("app")!;
const DAYS = ["L", "M", "M", "J", "V", "S", "D"];
const GOLD = "#ffc93c";
const PRAYER_COLOR = "#5ef2b0";
const TAHSIN_COLOR: Record<TahsinSession, string> = { matin: "#ffc93c", soir: "#a78bfa" };
const FX_COLORS = ["#ffc93c", "#5ef2b0", "#a78bfa", "#ffffff", "#4cc9ff"];

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


// Icônes de la barre du bas (traits, couleur du texte)
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  // Soleil levant : la journée en cours
  today: svg('<path d="M3 18h18"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 4v3"/><path d="M4.9 9.9l2.1 2.1"/><path d="M19.1 9.9L17 12"/><path d="M9 21h6"/>'),
  // Mosquée : coupole, croissant et minarets
  times: svg('<path d="M12 2.5c.9.6 1.2 1.6.8 2.4"/><path d="M6.5 13a5.5 5.5 0 0 1 11 0"/><path d="M5 13h14v8H5z"/><path d="M10.5 21v-3a1.5 1.5 0 0 1 3 0v3"/><path d="M2.5 21V11l1-1.5 1 1.5v10"/><path d="M19.5 21V11l1-1.5 1 1.5v10"/><path d="M12 5v2.5"/>'),
  // Cloche
  reminders: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
};

// ------------------------------------------------------------ Squelette
app.innerHTML = `
  <main id="view"></main>
  <nav class="tabs">
    <button data-tab="today"><span class="ti">${ICONS.today}</span><span>Aujourd'hui</span></button>
    <button data-tab="times"><span class="ti">${ICONS.times}</span><span>Horaires</span></button>
    <button data-tab="reminders"><span class="ti">${ICONS.reminders}</span><span>Rappels</span></button>
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
  pulse(t, "show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3200);
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
  app.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (!store.ready) {
    view.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    return;
  }
  if (tab === "today") renderToday();
  else if (tab === "times") renderTimes();
  else renderReminders();
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
}

function renderToday() {
  const s = dayState();
  const sig = `today|${s.day}|${notif}|${!!s.times}`;
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
        <div class="card-head"><h3>🕌 Prières</h3><span class="count"><span class="n" id="pr-n">0</span><span class="of">/5</span></span></div>
        <div class="prayer-row">
          ${s.prayers
            .map(
              (p) => `
            <button class="prayer" data-p="${p.key}">
              <span class="bubble"><span class="ck">✓</span></span>
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
      <div class="all-done" id="all-done">🎉 Journée complète&nbsp;!</div>
    `;
    bindBanner();
    view.querySelectorAll<HTMLButtonElement>(".prayer").forEach(bindPrayer);
    (["matin", "soir"] as TahsinSession[]).forEach(bindTahsinCard);
  }
  updateToday(s);
}

function tahsinCardHTML(session: TahsinSession) {
  return `
    <article class="card tahsin-card" data-session="${session}" style="--c:${TAHSIN_COLOR[session]}">
      <div class="card-top">
        <span class="emoji">${session === "matin" ? "🌅" : "🌙"}</span>
        <span class="check">✓</span>
      </div>
      <h3 class="name">Tahsin du ${session}</h3>
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
    card.querySelector(".hint")!.textContent = !t.open
      ? `Disponible à ${t.opensAt}`
      : t.pct >= 1
        ? "Validé"
        : `${t.done}/${t.total} récitations`;
    (card.querySelector(".validate-all") as HTMLElement).style.display = t.open && t.pct < 1 ? "" : "none";
  }

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
      ? `🕌 Prochaine prière : <b>${s.next.name} à ${s.next.time}</b> · dans ${fmtDelay(s.next.date.getTime() - Date.now())}`
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
      toast(`⏳ Le temps du ${p.name} n'est pas encore entré (${p.time})`);
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
      toast(`🌙 Le tahsin du soir commence au Maghrib (${t.opensAt})`);
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
  const values: Record<string, number> = {};
  tahsinItems(session).forEach((i) => (values[tahsinKey(session, i.id)] = i.count));
  store.setValues(dayState().day, values);
  celebrateTahsin(session, anchor);
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
            <span class="pnum">${idx + 1}</span>
            <span class="plabel">${esc(i.label)}</span>
            <button class="minus" aria-label="Retirer une récitation">−</button>
          </div>
          <div class="parole-text">
            <img class="ph" src="./tahsin/${i.id}-ph.png" alt="${esc(i.label)}" loading="lazy" />
            <img class="ar" src="./tahsin/${i.id}-ar.png" alt="Texte arabe" loading="lazy" />
          </div>
          <div class="parole-foot">
            <div class="gauge">${Array.from({ length: i.count }, () => "<i></i>").join("")}</div>
            <span class="pcount"></span>
          </div>
          <span class="check">✓</span>
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
          floatText(ev.clientX, ev.clientY - 10, item.count > 1 ? `${n}/${item.count}` : "✓", color);
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
      if (notif === "granted") toast("🔔 Notifications activées&nbsp;!");
    } catch (e) {
      console.error(e);
      toast("Impossible d'activer les notifications 😕");
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
    toast("📍 Ville enregistrée");
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
      <div class="sheet-title"><h2>${esc(title)}</h2><button class="close" aria-label="Fermer">✕</button></div>
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
  if (!store.ready) return;
  if (tab === "today") renderToday();
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
