# Rappels

Appli web de rappels à heure précise, avec des jauges d'objectifs du jour (ex. « Vente 0/5 »).
Chaque personne a ses propres tâches, objectifs et horaires. Ses jauges sont privées et repartent à zéro chaque jour.

- **Appli** : TypeScript + Vite, hébergée sur GitHub Pages, installable sur l'écran d'accueil (Android et iPhone)
- **Données** : Firebase Auth (anonyme) + Firestore
- **Notifications** : Firebase Cloud Messaging, déclenchées par une Cloud Function qui tourne chaque minute (heure de Paris)

Tant que `public/firebase-config.js` est vide, l'appli tourne en **mode démo** : tout reste sur le téléphone, et il n'y a pas de notifications.

---

## Mise en route (une seule fois)

### 1. Projet Firebase
1. Sur https://console.firebase.google.com, clique sur **Ajouter un projet** (Analytics pas nécessaire).
2. **Build > Authentication > Commencer**, puis **Mode de connexion > Anonyme > Activer**.
3. **Build > Firestore Database > Créer une base de données**, emplacement `europe-west1`, mode production.
4. **Paramètres du projet** (roue dentée) **> Général > Vos applications > icône Web `</>`** : donne un nom à l'appli, puis copie l'objet `firebaseConfig` dans `public/firebase-config.js`.
5. **Paramètres du projet > Cloud Messaging > Certificats Web Push > Générer une paire de clés** : copie la clé dans `FIREBASE_VAPID_KEY` (même fichier).
6. **Passer au forfait Blaze** (en bas à gauche). Il faut une carte bancaire, mais avec cet usage on reste dans la partie gratuite. Tu peux ajouter une **alerte budget à 1 €** pour être tranquille.
7. Dans `.firebaserc`, remplace `REMPLACE-PAR-TON-ID-DE-PROJET` par l'ID du projet.

### 2. Mettre en ligne la fonction et les règles
```bash
npm i -g firebase-tools
firebase login
cd functions && npm install && cd ..
firebase deploy --only firestore,functions
```
La fonction `sendReminders` s'exécute chaque minute. Le premier déploiement peut prendre 2 ou 3 minutes, le temps que Google active les services nécessaires ; s'il échoue la première fois, relance-le.

### 3. Autoriser le domaine GitHub Pages
Va dans **Authentication > Paramètres > Domaines autorisés** et ajoute `faazik11.github.io`.

### 4. GitHub Pages
1. Pousse le dépôt sur GitHub (branche `main`).
2. Va dans **Settings > Pages > Source** et choisis **GitHub Actions**.
3. Chaque push sur `main` met l'appli en ligne : `https://faazik11.github.io/<nom-du-depot>/`

---

## Sur le téléphone
- **Android (Chrome)** : ouvre le lien, touche **Activer** pour les notifications, puis **⋮ > Ajouter à l'écran d'accueil**.
- **iPhone (iOS 16.4 ou plus récent)** : ouvre le lien dans Safari, touche **Partager**, puis **Sur l'écran d'accueil**. Ouvre l'appli **depuis l'icône**, puis touche **Activer**. Sur iPhone, les notifications ne marchent que de cette façon.

## Développement
```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Comment ça marche
```
users/{uid}                  appUrl, tz, lastSeen
  tasks/{id}                 name, emoji, color, goal, order
  reminders/{id}             time "HH:MM", days [1..7], text, taskId, skipIfDone, enabled, uid
  progress/{AAAA-MM-JJ}      counts { taskId: n }
  tokens/{jeton FCM}         un document par téléphone
```
Chaque minute, la fonction cherche les rappels dont `time` correspond à l'heure qu'il est à Paris et dont le jour de la semaine est coché. Si le rappel est lié à une jauge, le titre de la notif affiche l'avancement (« 💰 Vente · 2/5 »). Elle est sautée si « ne pas envoyer si l'objectif est atteint » est coché et que l'objectif est atteint.
