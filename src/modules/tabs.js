import { analytics, logEvent } from "./firebase.js";

// Пароль для доступа к вкладке "Управление материалами"
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  throw new Error(
    "ADMIN_PASSWORD must be set in environment variables (VITE_ADMIN_PASSWORD)",
  );
}

/**
 * Логирует ошибки в Firestore для аналитики.
 * @param {string} action - Действие (например, initializeTabs).
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
 * Инициализирует переключение вкладок и доступ к вкладке "Управление материалами".
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<void>}
 */
export async function initializeTabs(showNotification, userId) {
  logEvent(analytics, "tabs_initialize_initiated", {
    page_title: "Balcony Calculator",
    user_id: userId || "unknown",
  });

  try {
    if (typeof showNotification !== "function") {
      throw new Error("showNotification function is required");
    }

    const tabs = document.querySelectorAll(".tab__button");
    const contents = document.querySelectorAll(".tab-content");
    const results = document.getElementById("results");

    if (!tabs.length || !contents.length || !results) {
      showNotification(
        "Ошибка: Не удалось найти элементы вкладок или результатов",
        true,
      );
      throw new Error("Required DOM elements not found");
    }

    const modal = document.getElementById("passwordModal");
    const passwordForm = document.getElementById("passwordForm");
    const passwordInput = document.getElementById("passwordInput");
    const submitBtn = document.getElementById("submitPasswordBtn");
    const cancelBtn = document.getElementById("cancelPasswordBtn");
    const errorMsg = document.getElementById("passwordError");
    const resetAdminAccessBtn = document.getElementById("resetAdminAccessBtn");
    const mainContainer = document.querySelector(".container");

    if (
      !modal ||
      !passwordForm ||
      !passwordInput ||
      !submitBtn ||
      !cancelBtn ||
      !errorMsg ||
      !mainContainer
    ) {
      showNotification(
        "Ошибка: Не удалось найти элементы модального окна",
        true,
      );
      throw new Error("Required modal DOM elements not found");
    }

    let isAdminUnlocked = localStorage.getItem("adminUnlocked") === "true";
    let triggeringElement = null;

    // Переключение вкладок
    const switchTab = (tabId) => {
      tabs.forEach((t) => {
        t.classList.remove("tab__button--active");
        t.setAttribute("aria-selected", "false");
      });
      contents.forEach((c) => c.classList.remove("tab-content--active"));
      results.classList.remove("tab-content--active");

      const tab = document.querySelector(`.tab__button[data-tab="${tabId}"]`);
      const content = document.getElementById(tabId);
      if (tab && content) {
        tab.classList.add("tab__button--active");
        tab.setAttribute("aria-selected", "true");
        content.classList.add("tab-content--active");
        logEvent(analytics, "tab_switch", {
          tab_id: tabId,
          tab_name: tab.textContent,
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
      } else {
        showNotification(
          `Ошибка: Контент для вкладки ${tabId} не найден`,
          true,
        );
        throw new Error(`Content for tab ${tabId} not found`);
      }
    };

    // Открытие модального окна
    const openModal = (triggerElement) => {
      triggeringElement = triggerElement;
      modal.style.display = "block";
      passwordInput.value = "";
      errorMsg.style.display = "none";
      passwordInput.focus();
      mainContainer.setAttribute("aria-hidden", "true");
      document.addEventListener("keydown", handleModalKeydown);
      logEvent(analytics, "modal_open", {
        modal_type: "admin_access",
        page_title: "Balcony Calculator",
        user_id: userId || "unknown",
      });
    };

    // Закрытие модального окна
    const closeModal = () => {
      modal.style.display = "none";
      mainContainer.removeAttribute("aria-hidden");
      if (triggeringElement) {
        triggeringElement.focus();
        triggeringElement = null;
      }
      document.removeEventListener("keydown", handleModalKeydown);
      logEvent(analytics, "modal_close", {
        modal_type: "admin_access",
        page_title: "Balcony Calculator",
        user_id: userId || "unknown",
      });
    };

    // Закрытие по Esc
    const handleModalKeydown = (event) => {
      if (event.key === "Escape") {
        closeModal();
        switchTab("tab1");
      }
    };

    // Обработчик клика по вкладкам
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const tabId = tab.getAttribute("data-tab");
        if (tabId === "tab12" && !isAdminUnlocked) {
          openModal(tab);
          return;
        }
        switchTab(tabId);
      });
    });

    // Обработчики модального окна
    submitBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const password = passwordInput.value.trim();
      if (password === ADMIN_PASSWORD) {
        localStorage.setItem("adminUnlocked", "true");
        isAdminUnlocked = true;
        closeModal();
        switchTab("tab12");
        showNotification("Доступ администратора разблокирован", false);
        logEvent(analytics, "admin_access_granted", {
          page_title: "Balcony Calculator - Admin Mode",
          user_id: userId || "unknown",
        });
      } else {
        errorMsg.style.display = "block";
        errorMsg.textContent = "Неверный пароль";
        passwordInput.focus();
        logEvent(analytics, "admin_access_failed", {
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
      }
    });

    cancelBtn.addEventListener("click", (event) => {
      event.preventDefault();
      closeModal();
      switchTab("tab1");
    });

    passwordForm.addEventListener("submit", (event) => {
      event.preventDefault();
      submitBtn.click();
    });

    if (resetAdminAccessBtn) {
      resetAdminAccessBtn.addEventListener("click", () => {
        localStorage.removeItem("adminUnlocked");
        isAdminUnlocked = false;
        showNotification("Доступ администратора сброшен", false);
        switchTab("tab1");
        logEvent(analytics, "admin_access_reset", {
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
      });
    }

    if (tabs.length > 0) {
      switchTab("tab1");
    } else {
      throw new Error("No tabs found to initialize");
    }

    logEvent(analytics, "tabs_initialized", {
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  } catch (error) {
    showNotification(`Ошибка инициализации вкладок: ${error.message}`, true);
    logErrorToFirestore("initializeTabs", userId, error);
    throw error;
  }
}
