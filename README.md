# Rappels

Appli web de rappels à heure précise, avec des jauges d'objectifs du jour (ex. « Vente 0/5 »).
Chaque personne (chaque téléphone) a ses propres tâches, objectifs et horaires ; ses jauges sont privées et repartent à zéro chaque jour.

**En ligne :** https://faazik11.github.io/rappels/

## Comment ça marche
- **Appli** : TypeScript + Vite, publiée sur GitHub Pages à chaque push sur `main`, installable sur l'écran d'accueil.
- **Données** : projet Supabase « Appli GDC », tables à part préfixées `rappels_` (aucun lien avec les données du GDC).
  Chaque téléphone a une clé secrète (stockée sur le téléphone) ; l'appli passe uniquement par des fonctions `rappels_*` qui vérifient cette clé.
- **Notifications** : `pg_cron` appelle chaque minute l'Edge Function `rappels-notify`, qui envoie en Web Push les rappels prévus à cette minute (heure de Paris). Même principe que l'appli GDC, 100 % gratuit.
- Les clés VAPID et le jeton d'appel sont dans la table `rappels_secrets` (jamais dans ce dépôt).

## Sur le téléphone
- **Android (Chrome)** : ouvre le lien, touche **Activer**, puis ⋮ > **Ajouter à l'écran d'accueil**.
- **iPhone (iOS 16.4+)** : Safari > **Partager** > **Sur l'écran d'accueil**, ouvre l'appli **depuis l'icône**, puis touche **Activer**.

## Développement
```bash
npm install
npm run dev
```
Edge Function : `supabase/functions/rappels-notify/index.ts`. Schéma : `supabase/migrations/`.
