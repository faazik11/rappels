// Paroles du Tahsin : brochure de l'A.P.B.I.F. n°10 « Invocations et évocations rapportées du Messager de Allah ».
// Le texte (phonétique et arabe) est affiché tel quel, sous forme d'images découpées dans la brochure :
// rien n'est retapé, pour qu'il n'y ait aucune erreur.
// Chaque élément : identifiant (= nom des images dans public/tahsin/), libellé court (début de la phonétique),
// nombre de récitations, et si la parole est seulement pour le soir.

export interface TahsinItem {
  id: string;
  label: string;
  count: number;
  eveningOnly?: boolean;
}

export const TAHSIN: TahsinItem[] = [
  { id: "inna-rabbi", label: "'Inna rabbia l-Lahou l-ladhi la 'ilaha 'il-la houwa…", count: 1 },
  { id: "bismillah-alladhi", label: "Bismi l-Lahi l-ladhi la yadourrou…", count: 3 },
  { id: "raditou", label: "Raditou bi l-Lahi rabba…", count: 3 },
  { id: "hasbiya", label: "Hasbiya l-Lahou la 'ilaha 'il-la houwa…", count: 7 },
  { id: "ya-hayyou", label: "Ya Hayyou ya Qayyoum…", count: 3 },
  { id: "astaghfirou", label: "'Astaghfirou l-Laha l-ladhi la 'ilaha 'il-la houwa…", count: 3 },
  { id: "kalimat", label: "'A^oudhou bikalimati l-Lahi t-tammati…", count: 3 },
  { id: "soubhana", label: "Soubhana l-Lahi wa bihamdih…", count: 1 },
  { id: "taawwudh", label: "'A^oudhou bi l-Lahi mina ch-chaytani r-rajim", count: 1 },
  { id: "ayat-al-koursi", label: "Allahou la 'ilaha 'il-la houwa l-Hayyou l-Qayyoum… (255)", count: 1 },
  { id: "rabbana-atina", label: "Rabbana 'atina fi d-dounya haçanah…", count: 1 },
  { id: "amana-rrasoul", label: "'Amana r-raçoulou… (285-286)", count: 1, eveningOnly: true },
  { id: "aoudhou-samii", label: "'A^oudhou bi l-Lahi s-Sami^i l-^Alimi…", count: 3 },
  { id: "houwa-llah", label: "Houwa l-Lahou l-ladhi la 'ilaha 'il-la houwa… (22-24)", count: 1 },
  { id: "ikhlas", label: "Qoul houwa l-Lahou 'ahad", count: 3 },
  { id: "falaq", label: "Qoul 'a^oudhou birabbi l-falaq", count: 3 },
  { id: "nas", label: "Qoul 'a^oudhou birabbi n-nas", count: 3 },
];

export type TahsinSession = "matin" | "soir";

export function tahsinItems(session: TahsinSession) {
  return TAHSIN.filter((i) => session === "soir" || !i.eveningOnly);
}

export const tahsinKey = (session: TahsinSession, id: string) => `${session === "matin" ? "tm" : "ts"}:${id}`;
