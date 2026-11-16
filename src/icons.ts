// Icônes dessinées (traits), elles prennent la couleur du texte autour.
const svg = (d: string, size = 24, sw = 1.9) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const PATHS = {
  // Soleil levant
  sunrise: '<path d="M3 18h18"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 4v3"/><path d="M4.9 9.9l2.1 2.1"/><path d="M19.1 9.9L17 12"/><path d="M9 21h6"/>',
  // Mosquée : coupole, croissant, minarets
  mosque: '<path d="M12 2.5c.9.6 1.2 1.6.8 2.4"/><path d="M6.5 13a5.5 5.5 0 0 1 11 0"/><path d="M5 13h14v8H5z"/><path d="M10.5 21v-3a1.5 1.5 0 0 1 3 0v3"/><path d="M2.5 21V11l1-1.5 1 1.5v10"/><path d="M19.5 21V11l1-1.5 1 1.5v10"/><path d="M12 5v2.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  hourglass: '<path d="M6 3h12"/><path d="M6 21h12"/><path d="M7 3c0 5 10 5 10 9s-10 4-10 9"/><path d="M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5v.01"/>',
  // Étoile à 8 branches : journée complète
  star: '<path d="M12 2.5l2.3 4.4 4.4-2.3-1.5 4.8 4.8 1.5-4.4 2.3 2.3 4.4-4.8-1.5L12 21.5l-1.5-4.8-4.8 1.5 2.3-4.4-4.4-2.3 4.8-1.5L6.9 4.6l4.4 2.3z"/>',
};

export type IconName = keyof typeof PATHS;
export const icon = (name: IconName, size = 24, sw = 1.9) => svg(PATHS[name], size, sw);
/** Petite icône dans une ligne de texte (messages, titres) */
export const inl = (name: IconName) => `<span class="i-inl">${icon(name, 18, 2)}</span>`;
