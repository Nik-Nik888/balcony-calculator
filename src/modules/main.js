import {
  initializeMaterialActions,
  loadMaterialsTable,
  populateSelects,
} from './materials.js';
import { initializeTabs } from './tabs.js';
import { validateForm } from './validation.js';
import { initializeCalculation } from './calculation.js';
import {
  analytics,
  logEvent,
  auth,
  onAuthStateChanged,
  db,
} from './firebase.js';

/**
 * Логирует ошибки в Firestore для аналитики.
 * @param {string} action - Действие (например, initialize).
 * @param {string} userId - ID пользователя.
 * @param {Error} error - Объект ошибки.
 * @param {Object} [extra] - Дополнительные данные для лога.
 */
async function logErrorToFirestore(action, userId, error, extra = {}) {
  try {
    await logEvent(analytics, `${action}_failed`, {
      reason: error.message,
      page_title: 'Balcony Calculator',
      user_id: userId || 'unknown',
      ...extra,
    });
  } catch (logError) {
    await logEvent(analytics, 'log_error_failed', {
      reason: logError.message,
      page_title: 'Balcony Calculator',
      user_id: userId || 'unknown',
    });
  }
}

/**
 * Логирует событие в Firestore.
 * @param {string} event - Название события.
 * @param {string} userId - ID пользователя.
 * @param {string} pageTitle - Заголовок страницы.
 */
async function logToFirestore(event, userId, pageTitle) {
  try {
    await db.collection('analytics').add({
      event,
      userId,
      page_title: pageTitle,
      timestamp: new Date().toISOString(),
    });
  } catch (firestoreError) {
    await logEvent(analytics, 'firestore_log_failed', {
      event,
      reason: firestoreError.message,
      page_title: 'Balcony Calculator',
      user_id: userId || 'unknown',
    });
  }
}

/**
 * Отображает уведомления пользователю.
 * @param {string} message - Сообщение уведомления.
 * @param {boolean} [isError=false] - Является ли уведомление ошибкой.
 */
function showNotification(message, isError = false) {
  const notification = document.getElementById('notification');
  if (!notification) {
    logEvent(analytics, 'notification_failed', {
      reason: 'Notification element not found',
      page_title: 'Balcony Calculator',
      user_id: 'unknown',
    });
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

/**
 * Инициализирует приложение.
 * @returns {Promise<void>}
 */
async function initialize() {
  await logEvent(analytics, 'initialization_initiated', {
    page_title: 'Balcony Calculator',
    user_id: 'unknown',
  });

  try {
    await new Promise((resolve, reject) => {
      onAuthStateChanged(auth, async (user) => {
        try {
          if (!user) {
            const errorMsg = 'Пользователь не аутентифицирован';
            showNotification(errorMsg, true);
            await logErrorToFirestore(
              'initialize',
              'unauthenticated',
              new Error(errorMsg),
            );
            reject(new Error(errorMsg));
            return;
          }

          const token = await user.getIdToken();
          const userId = user.uid;
          const idTokenResult = await user.getIdTokenResult();
          const isAdmin = idTokenResult.claims.admin === true;

          await logEvent(analytics, 'sign_in', {
            user_id: userId,
            page_title: 'Balcony Calculator',
          });
          await logToFirestore(db, 'sign_in', userId, 'Balcony Calculator');

          await initializeTabs(showNotification, userId);
          await populateSelects(showNotification, token, userId);

          if (isAdmin) {
            await initializeMaterialActions(
              showNotification,
              validateForm,
              loadMaterialsTable,
              populateSelects,
              token,
              userId,
            );
            await logEvent(analytics, 'admin_access_granted', {
              page_title: 'Balcony Calculator - Admin Mode',
              user_id: userId,
            });
            await logToFirestore(
              db,
              'admin_access_granted',
              userId,
              'Balcony Calculator - Admin Mode',
            );

            const activeTab = document
              .querySelector('.tab__button--active')
              ?.getAttribute('data-tab');
            if (activeTab === 'tab12') {
              await loadMaterialsTable(1, showNotification, token, userId);
            }
          }

          await initializeCalculation(
            showNotification,
            validateForm,
            token,
            userId,
          );

          await logEvent(analytics, 'page_view', {
            page_title: 'Balcony Calculator',
            user_id: userId,
          });
          await logToFirestore(db, 'page_view', userId, 'Balcony Calculator');

          await logEvent(analytics, 'initialization_completed', {
            page_title: 'Balcony Calculator',
            user_id: userId,
          });
          resolve();
        } catch (error) {
          showNotification(`Ошибка аутентификации: ${error.message}`, true);
          await logErrorToFirestore(
            'initialize',
            user?.uid || 'unauthenticated',
            error,
          );
          reject(error);
        }
      });
    });
  } catch (error) {
    showNotification(
      `Критическая ошибка инициализации: ${error.message}`,
      true,
    );
    await logErrorToFirestore('initialize', 'unauthenticated', error);
    throw error;
  }
}

// Запускаем инициализацию после загрузки DOM
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await logEvent(analytics, 'dom_loaded', {
      page_title: 'Balcony Calculator',
      user_id: 'unknown',
    });
    await initialize();
  } catch (error) {
    await logEvent(analytics, 'initialization_failed', {
      reason: error.message,
      page_title: 'Balcony Calculator',
      user_id: 'unknown',
    });
  }
});
