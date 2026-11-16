# Rappels

Appli de rappels pour les 5 prières (horaires du calendrier APBIF de sa ville) et le Tahsin du matin et du soir.
Chaque téléphone a sa propre progression, privée, qui repart à zéro à chaque Fajr. On peut aussi ajouter des rappels personnels.

**En ligne :** https://faazik11.github.io/rappels/

## Comment ça marche
- **Appli** : TypeScript + Vite, publiée sur GitHub Pages à chaque push sur `main`, installable sur l'écran d'accueil.
- **Données** : projet Supabase « Appli GDC », tables à part préfixées `rappels_` (aucun lien avec les données du GDC).
  Chaque téléphone a une clé secrète (stockée sur le téléphone) ; l'appli passe uniquement par des fonctions `rappels_*` qui vérifient cette clé.
- **Notifications** : `pg_cron` appelle chaque minute l'Edge Function `rappels-notify`, qui envoie en Web Push les rappels prévus à cette minute (heure de Paris). Même principe que l'appli GDC, 100 % gratuit.
- Les clés VAPID et le jeton d'appel sont dans la table `rappels_secrets` (jamais dans ce dépôt).

## Prières et Tahsin
- **Horaires** : tables `rappels_cities` / `rappels_prayer_times`, importées depuis apbif.fr pour les 79 villes du site (2026).
  Tant que l'année suivante n'est pas importée, `rappels_day_times` reprend le même jour de la dernière année connue.
- **Notifs** : à l'heure de chaque prière, plus le Tahsin du matin au Fajr et celui du soir au Maghrib (réglables dans l'onglet Horaires).
- **Tahsin** : brochure APBIF n°10. Le texte est affiché sous forme d'images découpées dans la brochure (`public/tahsin/`),
  pour ne jamais retaper l'arabe ; la liste et le nombre de récitations sont dans `src/tahsin.ts`.

## Sur le téléphone
- **Android (Chrome)** : ouvre le lien, touche **Activer**, puis ⋮ > **Ajouter à l'écran d'accueil**.
- **iPhone (iOS 16.4+)** : Safari > **Partager** > **Sur l'écran d'accueil**, ouvre l'appli **depuis l'icône**, puis touche **Activer**.

## Développement
```bash
npm install
npm run dev
```
Edge Function : `supabase/functions/rappels-notify/index.ts`. Schéma : `supabase/migrations/`.
