import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDo1mG2qucaWeD-rmtLhSgk2DddBz1yP4c",
  authDomain: "mg-executive.firebaseapp.com",
  projectId: "mg-executive",
  storageBucket: "mg-executive.firebasestorage.app",
  messagingSenderId: "344679740633",
  appId: "1:344679740633:web:d2488b87d5a5abc9363ac8",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
