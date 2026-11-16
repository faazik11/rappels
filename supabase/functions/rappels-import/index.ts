// Import des horaires de prière depuis les calendriers APBIF (apbif.fr/horaires-des-prieres).
// Appelé par la base (pg_net) : { cities: [cityId, ...] } ou { all: true }.
// Relancé automatiquement chaque année (cron) pour récupérer le nouveau calendrier.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BASE = "https://apbif.fr/horaires-des-prieres";

const clean = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const isTime = (s: string) => /^\d{1,2}:\d{2}$/.test(s);

async function importCity(cityId: number) {
  const rows: Record<string, unknown>[] = [];
  let year = 0;
  const problems: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const res = await fetch(`${BASE}?cityId=${cityId}&month=${m}`, { headers: { "User-Agent": "Mozilla/5.0 (rappels; usage personnel)" } });
    if (!res.ok) throw new Error(`mois ${m} : HTTP ${res.status}`);
    const html = await res.text();
    if (!year) year = Number((clean(html).match(/ann[ée]e (\d{4})/) || [])[1]) || new Date().getFullYear();
    const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0];
    if (!table) throw new Error(`mois ${m} : pas de tableau`);
    const trs = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
      .map((t) => [...t[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => clean(c[1])))
      .filter((c) => c.length >= 8 && isTime(c[2]));
    const days = new Date(year, m, 0).getDate();
    if (trs.length !== days) problems.push(`mois ${m} : ${trs.length} lignes au lieu de ${days}`);
    // Le n° du jour affiché est parfois faux sur le site : on se fie à l'ordre des lignes
    trs.slice(0, days).forEach((c, i) => {
      const [, , fajr, shuruq, dhuhr, asr, maghrib, isha] = c;
      rows.push({
        city_id: cityId,
        day: `${year}-${String(m).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
        fajr: fajr.padStart(5, "0"), shuruq: shuruq.padStart(5, "0"), dhuhr: dhuhr.padStart(5, "0"),
        asr: asr.padStart(5, "0"), maghrib: maghrib.padStart(5, "0"), isha: isha.padStart(5, "0"),
      });
    });
    await new Promise((r) => setTimeout(r, 250));
  }
  const { error } = await db.from("rappels_prayer_times").upsert(rows);
  if (error) throw new Error(error.message);
  return { cityId, year, days: rows.length, problems };
}

Deno.serve(async (req) => {
  const { data } = await db.from("rappels_secrets").select("value").eq("name", "notify_token").single();
  if (req.headers.get("x-rappels-token") !== data?.value) return new Response("interdit", { status: 403 });
  const payload = await req.json().catch(() => ({}));
  let ids: number[] = payload.cities ?? [];
  if (payload.all) {
    const { data: cities } = await db.from("rappels_cities").select("id");
    ids = (cities ?? []).map((c) => c.id);
  }
  const results = [];
  for (const id of ids) {
    try {
      results.push(await importCity(id));
    } catch (e) {
      results.push({ cityId: id, error: String(e) });
    }
  }
  console.log(JSON.stringify(results));
  return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
});
