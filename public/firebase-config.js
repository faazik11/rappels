// Config du projet Firebase "Rappels" (rappels-7bbca)
// Ces valeurs sont publiques par nature (elles identifient le projet) ; la sécurité vient des règles Firestore.
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDpvOJJxB1bfHBBvsf5IOIuHKpqqrsyixY",
  authDomain: "rappels-7bbca.firebaseapp.com",
  projectId: "rappels-7bbca",
  storageBucket: "rappels-7bbca.firebasestorage.app",
  messagingSenderId: "367118213787",
  appId: "1:367118213787:web:a913870ea365afe5d5dc3e",
};

// Clé Web Push (Console Firebase > Paramètres > Cloud Messaging > Certificats Web Push).
// Laissée vide : Firebase utilise alors sa clé par défaut, ce qui fonctionne.
self.FIREBASE_VAPID_KEY = "";
