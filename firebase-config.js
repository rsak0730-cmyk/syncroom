import { initializeApp } from
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getDatabase,
  ref,
  set,
  get,
  update,
  push,
  onValue,
  onDisconnect,
  remove,
  serverTimestamp
} from
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

import {
  getAuth,
  signInAnonymously
} from
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCmZvHjY3wol0ED6YDDaReNPGlNMGKello",
  authDomain: "syncroom-1c200.firebaseapp.com",
  projectId: "syncroom-1c200",
  storageBucket: "syncroom-1c200.firebasestorage.app",
  messagingSenderId: "248664766695",
  appId: "1:248664766695:web:f873e5c3f690dcc2cd0a42",
  measurementId: "G-SJMV75FS95"
};

const app = initializeApp(firebaseConfig);

export const database = getDatabase(app);
export const auth = getAuth(app);

export {
  ref,
  set,
  get,
  update,
  push,
  onValue,
  onDisconnect,
  remove,
  serverTimestamp,
  signInAnonymously
};
