import {
  initializeMaterialActions,
  loadMaterialsTable,
  populateSelects,
} from "./materials.js";
import { initializeTabs } from "./tabs.js";
import { validateForm } from "./validation.js";
import { initializeCalculation } from "./calculation.js";
import { analytics, logEvent, auth, onAuthStateChanged } from "./firebase.js";

/**
 * Логирует ошибки в Firestore для аналитики.
 * @param {string} action - Действие (например, initialize).
 * @param {string} userId - ID пользователя.
 * @param {Error} error - Объект ошибки.
 * @param {Object} [extra] - Дополнительные данные для лога.
 */
async function logErrorToFirestore(action, userId, error, extra = {}) {
  await logEvent(analytics, `${action}_failed`, {
    reason: error.message,
    page_title: "Balcony Calculator",
    user_id: userId || "unknown",
    ...extra,
  });
}

/**
 * Логирует событие в Firestore.
 * @param {Object} db - Инстанс Firestore.
 * @param {string} event - Название события.
 * @param {string} userId - ID пользователя.
 * @param {string} pageTitle - Заголовок страницы.
 */
async function logToFirestore(db, event, userId, pageTitle) {
  try {
    await db.collection("analytics").add({
      event,
      userId,
      page_title: pageTitle,
      timestamp: new Date().toISOString(),
    });
  } catch (firestoreError) {
    logEvent(analytics, "firestore_log_failed", {
      event,
      reason: firestoreError.message,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  }
}

/**
 * Отображает уведомления пользователю.
 * @param {string} message - Сообщение уведомления.
 * @param {boolean} [isError=false] - Является ли уведомление ошибкой.
 */
function showNotification(message, isError = false) {
  const notification = document.getElementById("notification");
  if (!notification) {
    logEvent(analytics, "notification_failed", {
      reason: "Notification element not found",
      page_title: "Balcony Calculator",
      user_id: "unknown",
    });
    return;
  }
  notification.textContent = message;
  notification.className = isError
    ? "notification notification--error"
    : "notification notification--success";
  notification.style.display = "block";
  setTimeout(() => {
    notification.style.display = "none";
  }, 5000);
}

/**
 * Инициализирует приложение.
 * @returns {Promise<void>}
 */
async function initialize() {
  logEvent(analytics, "initialization_initiated", {
    page_title: "Balcony Calculator",
    user_id: "unknown",
  });

  try {
    await new Promise((resolve, reject) => {
      onAuthStateChanged(auth, async (user) => {
        try {
          if (!user) {
            const errorMsg = "Пользователь не аутентифицирован";
            showNotification(errorMsg, true);
            logErrorToFirestore(
              "initialize",
              "unauthenticated",
              new Error(errorMsg),
            );
            reject(new Error(errorMsg));
            return;
          }

          const token = await user.getIdToken();
          const userId = user.uid;
          const idTokenResult = await user.getIdTokenResult();
          const isAdmin = idTokenResult.claims.admin === true;

          logEvent(analytics, "sign_in", {
            user_id: userId,
            page_title: "Balcony Calculator",
          });
          const { db } = await import("./firebase.js");
          await logToFirestore(db, "sign_in", userId, "Balcony Calculator");

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
            logEvent(analytics, "admin_access_granted", {
              page_title: "Balcony Calculator - Admin Mode",
              user_id: userId,
            });
            await logToFirestore(
              db,
              "admin_access_granted",
              userId,
              "Balcony Calculator - Admin Mode",
            );

            const activeTab = document
              .querySelector(".tab__button--active")
              ?.getAttribute("data-tab");
            if (activeTab === "tab12") {
              await loadMaterialsTable(1, showNotification, token, userId);
            }
          }

          await initializeCalculation(
            showNotification,
            validateForm,
            token,
            userId,
          );

          logEvent(analytics, "page_view", {
            page_title: "Balcony Calculator",
            user_id: userId,
          });
          await logToFirestore(db, "page_view", userId, "Balcony Calculator");

          logEvent(analytics, "initialization_completed", {
            page_title: "Balcony Calculator",
            user_id: userId,
          });
          resolve();
        } catch (error) {
          showNotification(`Ошибка аутентификации: ${error.message}`, true);
          logErrorToFirestore(
            "initialize",
            user?.uid || "unauthenticated",
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
    logErrorToFirestore("initialize", "unauthenticated", error);
    throw error;
  }
}

// Запускаем инициализацию после загрузки DOM
document.addEventListener("DOMContentLoaded", async () => {
  logEvent(analytics, "dom_loaded", {
    page_title: "Balcony Calculator",
    user_id: "unknown",
  });
  await initialize();
});
