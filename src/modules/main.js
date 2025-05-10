import { initializeMaterialActions, loadMaterialsTable, populateSelects } from './materials.js';
import { initializeTabs } from './tabs.js';
import { validateForm } from './validation.js';
import { initializeCalculation } from './calculation.js';
import { analytics, logEvent, auth, onAuthStateChanged } from './firebase.js';

// Функция для отображения уведомлений
function showNotification(message, isError = false) {
  const notification = document.getElementById('notification');
  if (!notification) {
    console.error('showNotification: Notification element not found in DOM');
    return;
  }
  notification.textContent = message;
  notification.className = isError
    ? 'notification notification--error'
    : 'notification notification--success';
  notification.style.display = 'block';
  setTimeout(() => {
    notification.style.display = 'none';
  }, 5000);
}

// Основная функция инициализации
async function initialize() {
  console.log('initialize: Starting initialization');

  try {
    // Проверяем статус аутентификации
    await new Promise((resolve, reject) => {
      onAuthStateChanged(auth, async (user) => {
        try {
          if (!user) {
            const errorMsg = 'Пользователь не аутентифицирован';
            console.error('initialize:', errorMsg);
            showNotification(errorMsg, true);
            reject(new Error(errorMsg));
            return;
          }

          const token = await user.getIdToken();
          const userId = user.uid;
          const idTokenResult = await user.getIdTokenResult();
          const isAdmin = idTokenResult.claims.admin === true;

          console.log('initialize: User authenticated', { userId, isAdmin });

          // Логируем событие входа в аналитику
          if (analytics && typeof logEvent === 'function') {
            logEvent(analytics, 'sign_in', {
              user_id: userId,
              page_title: 'Balcony Calculator',
            });

            // Записываем событие в Firestore
            try {
              const { db } = await import('./firebase.js');
              await db.collection('analytics').add({
                event: 'sign_in',
                userId,
                page_title: 'Balcony Calculator',
                timestamp: new Date().toISOString(),
              });
            } catch (firestoreError) {
              console.warn('initialize: Failed to log sign_in to Firestore', {
                error: firestoreError.message,
                userId,
              });
            }
          }

          // Инициализация вкладок
          console.log('initialize: Initializing tabs', { userId });
          await initializeTabs(showNotification);

          // Заполняем выпадающие списки (для всех пользователей)
          console.log('initialize: Populating selects', { userId });
          await populateSelects(showNotification, token, userId);

          // Инициализация управления материалами (только для администратора)
          if (isAdmin) {
            console.log('initialize: Initializing material actions', { userId });
            await initializeMaterialActions(
              showNotification,
              validateForm,
              loadMaterialsTable,
              populateSelects,
              token,
              userId,
            );

            // Логируем событие администраторского доступа
            if (analytics && typeof logEvent === 'function') {
              logEvent(analytics, 'admin_access_granted', {
                page_title: 'Balcony Calculator - Admin Mode',
                user_id: userId,
              });

              // Записываем событие в Firestore
              try {
                const { db } = await import('./firebase.js');
                await db.collection('analytics').add({
                  event: 'admin_access_granted',
                  userId,
                  page_title: 'Balcony Calculator - Admin Mode',
                  timestamp: new Date().toISOString(),
                });
              } catch (firestoreError) {
                console.warn('initialize: Failed to log admin_access_granted to Firestore', {
                  error: firestoreError.message,
                  userId,
                });
              }
            }

            // Загружаем таблицу материалов только если активна вкладка "Управление материалами"
            const activeTab = document
              .querySelector('.tab__button--active')
              ?.getAttribute('data-tab');
            if (activeTab === 'tab12') {
              console.log('initialize: Loading materials table', { userId });
              await loadMaterialsTable(1, showNotification, token, userId);
            } else {
              console.log('initialize: Skipping materials table load (admin tab not active)', {
                userId,
              });
            }
          } else {
            console.log('initialize: Skipping material actions initialization (admin access not granted)', {
              userId,
            });
          }

          // Инициализация расчётов
          console.log('initialize: Initializing calculation', { userId });
          await initializeCalculation(showNotification, validateForm, token, userId);

          // Логируем событие page_view
          if (analytics && typeof logEvent === 'function') {
            logEvent(analytics, 'page_view', {
              page_title: 'Balcony Calculator',
              user_id: userId,
            });

            // Записываем событие в Firestore
            try {
              const { db } = await import('./firebase.js');
              await db.collection('analytics').add({
                event: 'page_view',
                userId,
                page_title: 'Balcony Calculator',
                timestamp: new Date().toISOString(),
              });
            } catch (firestoreError) {
              console.warn('initialize: Failed to log page_view to Firestore', {
                error: firestoreError.message,
                userId,
              });
            }
          } else {
            console.warn('initialize: Analytics or logEvent not available', { userId });
          }

          console.log('initialize: Initialization completed', { userId });
          resolve();
        } catch (error) {
          console.error('initialize: Error during auth state check:', {
            message: error.message,
            stack: error.stack,
            userId: user?.uid || 'unauthenticated',
          });
          showNotification(`Ошибка аутентификации: ${error.message}`, true);
          reject(error);
        }
      });
    });
  } catch (error) {
    console.error('initialize: Critical error during initialization:', {
      message: error.message,
      stack: error.stack,
      userId: 'unauthenticated',
    });
    showNotification(
      `Критическая ошибка инициализации: ${error.message}. Проверьте консоль для деталей.`,
      true,
    );
    throw error;
  }
}

// Запускаем инициализацию после загрузки DOM
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM fully loaded and parsed');
  await initialize();
});