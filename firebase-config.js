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

const firebaseConfig = {
  apiKey: "AIzaSyCmZvHjY3wol0ED6YDDaReNPGlNMGKello",
  authDomain: "syncroom-1c200.firebaseapp.com",
  databaseURL: "https://syncroom-1c200-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "syncroom-1c200",
  storageBucket: "syncroom-1c200.firebasestorage.app",
  messagingSenderId: "248664766695",
  appId: "1:248664766695:web:d636bcaa399206bfcd0a42"
};

const app = initializeApp(firebaseConfig);

const database = getDatabase(app);
const auth = getAuth(app);

export {
  app,
  database,
  auth,
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
