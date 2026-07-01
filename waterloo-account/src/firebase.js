import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB1E9t2PImQy-7HZTf6N8kbeyqDHjuYe1Y",
  authDomain: "waterloo-account.firebaseapp.com",
  projectId: "waterloo-account",
  storageBucket: "waterloo-account.firebasestorage.app",
  messagingSenderId: "479923497080",
  appId: "1:479923497080:web:a1c4aa896844faea7da58d"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);