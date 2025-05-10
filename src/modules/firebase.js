import { initializeApp } from "firebase/app";
import { getAnalytics, logEvent as firebaseLogEvent } from "firebase/analytics";
import {
  getAuth,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Конфигурация Firebase
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Проверка обязательных полей конфигурации
const requiredConfigFields = ["apiKey", "authDomain", "projectId", "appId"];
for (const field of requiredConfigFields) {
  if (!firebaseConfig[field]) {
    throw new Error(`Missing required field: ${field}`);
  }
}

// Инициализация Firebase приложения
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (error) {
  throw new Error(`Firebase initialization failed: ${error.message}`);
}

// Инициализация аналитики
let analytics;
try {
  analytics = getAnalytics(app);
  firebaseLogEvent(analytics, "firebase_initialized", {
    page_title: "Balcony Calculator",
    user_id: "unknown",
  });
} catch (error) {
  throw new Error(`Firebase Analytics initialization failed: ${error.message}`);
}

// Инициализация Firestore
const db = getFirestore(app);

// Инициализация авторизации
const auth = getAuth(app);

/**
 * Логирует событие в Firebase Analytics.
 * @param {Object} analyticsInstance - Инстанс аналитики Firebase.
 * @param {string} eventName - Название события.
 * @param {Object} params - Параметры события.
 */
function logEvent(analyticsInstance, eventName, params) {
  try {
    firebaseLogEvent(analyticsInstance, eventName, {
      ...params,
      page_title: params.page_title || "Balcony Calculator",
    });
  } catch (error) {
    firebaseLogEvent(analyticsInstance, "log_event_error", {
      event_name: eventName,
      message: error.message,
      page_title: "Balcony Calculator",
      user_id: params?.user_id || "unknown",
    });
  }
}

/**
 * Отслеживает изменения состояния авторизации.
 * @param {Object} authInstance - Инстанс авторизации Firebase.
 * @param {Function} callback - Функция обратного вызова.
 */
function onAuthStateChanged(authInstance, callback) {
  try {
    firebaseOnAuthStateChanged(authInstance, callback);
  } catch (error) {
    logEvent(analytics, "auth_state_change_error", {
      message: error.message,
      page_title: "Balcony Calculator",
      user_id: "unknown",
    });
  }
}

export {
  analytics, // Аналитика Firebase для логирования событий
  logEvent, // Функция для логирования событий в аналитике
  auth, // Модуль авторизации Firebase
  onAuthStateChanged, // Функция для отслеживания изменений состояния авторизации
  signInWithEmailAndPassword, // Функция для входа с использованием email и пароля
  db, // Инстанс Firestore для работы с базой данных
};
