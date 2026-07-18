// ============================================================
// RehoSprint — Firebase Configuration
// Project: rehoteq-sprint
// ============================================================
// Boss T: replace the placeholder values below with the config
// from your Firebase Console (Project Settings > General >
// "Your apps" > Web app). Also enable:
//   - Realtime Database (europe-west1, matches RSMS/R.OMNIFLUX)
//   - Authentication > Sign-in method > Email/Password
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyDX1QQFb9K2nm1LZpQNLRZpuhgGfWTiSjs",
  authDomain: "rehosprint.firebaseapp.com",
  // NOTE (Boss T): fill this in once Realtime Database is created —
  // Firebase Console > Build > Realtime Database > Create Database.
  // The URL shown there depends on the region you pick, e.g.:
  //   https://rehosprint-default-rtdb.europe-west1.firebasedatabase.app   (Europe)
  //   https://rehosprint-default-rtdb.firebaseio.com                     (US default)
  databaseURL: "https://rehosprint-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "rehosprint",
  storageBucket: "rehosprint.firebasestorage.app",
  messagingSenderId: "898391629712",
  appId: "1:898391629712:web:f1a49889ea5bf37a345d15"
};

// Initialize Firebase (compat SDK — matches RSMS/R.OMNIFLUX pattern
// for consistency and easy debugging without a build step)
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.database();

// Expose globally for other scripts (admin.js, display.js, participant.js)
window.auth = auth;
window.db = db;
