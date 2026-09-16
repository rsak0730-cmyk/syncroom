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
  apiKey: "AIzaSyA04zCMzeXMPihK5kx2tzCftFrbBpnHCW4",
  authDomain: "syncroom-new.firebaseapp.com",
  databaseURL: "https://syncroom-new-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "syncroom-new",
  storageBucket: "syncroom-new.firebasestorage.app",
  messagingSenderId: "923178266794",
  appId: "1:923178266794:web:ad07d1e4841b5ddff820d3"
};

const app = initializeApp(firebaseConfig);

export const database = getDatabase(app);
export const auth = getAuth(app);

export {
  app,
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
