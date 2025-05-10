import { initializeApp } from 'firebase/app';
import { getAnalytics, logEvent } from 'firebase/analytics';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';

// Логируем переменные окружения для отладки (чувствительные данные замаскированы)
console.log('Environment Variables in firebase.js:', {
  VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY ? '[provided]' : '[missing]',
  VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID || '[missing]'
});

// Конфигурация Firebase
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// Логируем конфигурацию для отладки (чувствительные данные замаскированы)
console.log('Firebase Config:', {
  apiKey: firebaseConfig.apiKey ? '[provided]' : '[missing]',
  authDomain: firebaseConfig.authDomain || '[missing]',
  projectId: firebaseConfig.projectId || '[missing]',
  appId: firebaseConfig.appId || '[missing]'
});

// Проверяем наличие всех обязательных параметров конфигурации
const requiredConfigFields = ['apiKey', 'authDomain', 'projectId', 'appId'];
for (const field of requiredConfigFields) {
  if (!firebaseConfig[field]) {
    console.error(`Firebase configuration error: Missing required field "${field}"`);
    throw new Error(`Firebase configuration error: Missing required field "${field}"`);
  }
}

// Инициализация Firebase приложения
let app;
try {
  app = initializeApp(firebaseConfig);
  console.log('Firebase app initialized successfully');
} catch (error) {
  console.error('Firebase initialization failed:', {
    message: error.message,
    stack: error.stack
  });
  throw new Error(`Firebase initialization failed: ${error.message}`);
}

// Инициализация аналитики
let analytics;
try {
  analytics = getAnalytics(app);
  console.log('Firebase Analytics initialized successfully');
} catch (error) {
  console.error('Firebase Analytics initialization failed:', {
    message: error.message,
    stack: error.stack
  });
  throw new Error(`Firebase Analytics initialization failed: ${error.message}`);
}

// Инициализация авторизации
const auth = getAuth(app);

// Экспорт модулей для использования в приложении
export {
  analytics, // Аналитика Firebase для логирования событий
  logEvent,  // Функция для логирования событий в аналитике
  auth,      // Модуль авторизации Firebase
  onAuthStateChanged, // Функция для отслеживания изменений состояния авторизации
  signInWithEmailAndPassword // Функция для входа с использованием email и пароля
};