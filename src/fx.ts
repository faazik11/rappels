// Petits effets visuels : étincelles, confettis, "+1" qui s'envole, vibrations

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  shape: "dot" | "rect" | "star";
}

const canvas = document.getElementById("fx") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let parts: P[] = [];
let running = false;
let dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
}
resize();
addEventListener("resize", resize);

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function loop() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life < p.max);
  for (const p of parts) {
    p.life++;
    p.vy += p.g;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    const t = p.life / p.max;
    ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
    ctx.fillStyle = p.color;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.shape === "rect") ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    else if (p.shape === "star") star(p.size);
    else {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(loop);
  else {
    running = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.remove("on");
  }
}

function star(s: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? s * 0.25 : s * 0.6;
    const a = (i * Math.PI) / 5;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}

function start() {
  canvas.classList.add("on");
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

/** Éclat d'étincelles autour d'un point */
export function burst(x: number, y: number, color: string, n = 18) {
  if (reduced) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 4.5;
    parts.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 1.5,
      g: 0.12,
      life: 0,
      max: 34 + Math.random() * 22,
      size: 3 + Math.random() * 5,
      color: Math.random() < 0.25 ? "#ffffff" : color,
      rot: 0,
      vr: (Math.random() - 0.5) * 0.3,
      shape: Math.random() < 0.35 ? "star" : "dot",
    });
  }
  start();
}

/** Pluie de confettis (objectif atteint) */
export function confetti(colors: string[], n = 140) {
  if (reduced) return;
  for (let i = 0; i < n; i++) {
    const fromLeft = i % 2 === 0;
    parts.push({
      x: fromLeft ? -10 : innerWidth + 10,
      y: innerHeight * (0.55 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * (5 + Math.random() * 9),
      vy: -(9 + Math.random() * 9),
      g: 0.28,
      life: 0,
      max: 110 + Math.random() * 60,
      size: 7 + Math.random() * 7,
      color: colors[i % colors.length],
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.4,
      shape: Math.random() < 0.7 ? "rect" : "dot",
    });
  }
  start();
}

/** Texte qui s'envole ("+1") */
export function floatText(x: number, y: number, text: string, color: string) {
  const el = document.createElement("div");
  el.className = "float-text";
  el.textContent = text;
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.color = color;
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

/** Onde au point de contact dans un élément */
export function ripple(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  const s = document.createElement("span");
  s.className = "ripple";
  const size = Math.max(r.width, r.height) * 2.2;
  s.style.width = s.style.height = size + "px";
  s.style.left = clientX - r.left - size / 2 + "px";
  s.style.top = clientY - r.top - size / 2 + "px";
  el.appendChild(s);
  s.addEventListener("animationend", () => s.remove());
}

export function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* pas de vibreur */
  }
}
