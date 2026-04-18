import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDo1mG2qucaWeD-rmtLhSgk2DddBz1yP4c",
  authDomain: "mg-executive.firebaseapp.com",
  projectId: "mg-executive",
  storageBucket: "mg-executive.firebasestorage.app",
  messagingSenderId: "344679740633",
  appId: "1:344679740633:web:d2488b87d5a5abc9363ac8",
};

// Guard against re-initialization during Vite HMR
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const db      = getFirestore(app);
export const auth    = getAuth(app);
export const storage = getStorage(app);

// Offline persistence for technician depot use (patchy signal)
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
    console.error('Firestore offline persistence error:', err);
  }
});
