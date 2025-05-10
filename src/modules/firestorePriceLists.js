import { analytics, logEvent } from "./firebase.js";
import {
  fetchCategories,
  addMaterialApi,
  updateMaterialApi,
  deleteMaterialApi,
} from "./api.js";

/**
 * Логирует ошибки в Firestore для аналитики.
 * @param {string} action - Действие (например, getCategories, addMaterial).
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
 * Получает список категорий через manageMaterials.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<string[]>} Список категорий.
 */
async function getCategories(authToken, userId) {
  try {
    if (!authToken || typeof authToken !== "string") {
      throw new Error("Токен аутентификации отсутствует или недействителен");
    }

    let page = 0;
    const itemsPerPage = 200;
    let allCategories = [];
    let hasMore = true;

    while (hasMore) {
      const result = await fetchCategories(
        page,
        itemsPerPage,
        authToken,
        userId,
      );
      if (!result.success) {
        throw new Error(result.error || "Не удалось загрузить категории");
      }

      const categories = result.categories || [];
      allCategories = allCategories.concat(categories);
      hasMore = categories.length === itemsPerPage;
      page++;
    }

    const uniqueCategories = [...new Set(allCategories)].sort();
    logEvent(analytics, "categories_fetched", {
      categories_count: uniqueCategories.length,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
    return uniqueCategories;
  } catch (error) {
    logErrorToFirestore("getCategories", userId, error);
    throw error;
  }
}

/**
 * Добавляет материал через manageMaterials.
 * @param {Object} materialData - Данные материала для добавления.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<void>}
 */
async function addMaterial(materialData, authToken, showNotification, userId) {
  try {
    if (!authToken || typeof authToken !== "string") {
      throw new Error("Токен аутентификации отсутствует или недействителен");
    }
    if (typeof showNotification !== "function") {
      throw new Error("showNotification must be a function");
    }
    if (!materialData || typeof materialData !== "object") {
      throw new Error("materialData must be a non-empty object");
    }

    const result = await addMaterialApi(materialData, authToken, userId);
    if (!result.success) {
      throw new Error(result.error || "Не удалось добавить материал");
    }

    showNotification("Материал успешно добавлен", false);
    logEvent(analytics, "material_added", {
      material_name: materialData.name || "unknown",
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  } catch (error) {
    showNotification(`Ошибка добавления материала: ${error.message}`, true);
    logErrorToFirestore("addMaterial", userId, error, {
      material_data: materialData,
    });
    throw error;
  }
}

/**
 * Обновляет материал через manageMaterials.
 * @param {string} materialId - ID материала для обновления.
 * @param {Object} materialData - Новые данные материала.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<void>}
 */
async function updateMaterial(
  materialId,
  materialData,
  authToken,
  showNotification,
  userId,
) {
  try {
    if (!authToken || typeof authToken !== "string") {
      throw new Error("Токен аутентификации отсутствует или недействителен");
    }
    if (typeof showNotification !== "function") {
      throw new Error("showNotification must be a function");
    }
    if (!materialId || typeof materialId !== "string") {
      throw new Error("materialId must be a non-empty string");
    }
    if (!materialData || typeof materialData !== "object") {
      throw new Error("materialData must be a non-empty object");
    }

    const result = await updateMaterialApi(
      materialId,
      materialData,
      authToken,
      userId,
    );
    if (!result.success) {
      throw new Error(result.error || "Не удалось обновить материал");
    }

    showNotification("Материал успешно обновлён", false);
    logEvent(analytics, "material_updated", {
      material_id: materialId,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  } catch (error) {
    showNotification(`Ошибка обновления материала: ${error.message}`, true);
    logErrorToFirestore("updateMaterial", userId, error, {
      material_id: materialId,
      material_data: materialData,
    });
    throw error;
  }
}

/**
 * Удаляет материал через manageMaterials.
 * @param {string} materialId - ID материала для удаления.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<void>}
 */
async function deleteMaterial(materialId, authToken, showNotification, userId) {
  try {
    if (!authToken || typeof authToken !== "string") {
      throw new Error("Токен аутентификации отсутствует или недействителен");
    }
    if (typeof showNotification !== "function") {
      throw new Error("showNotification must be a function");
    }
    if (!materialId || typeof materialId !== "string") {
      throw new Error("materialId must be a non-empty string");
    }

    const result = await deleteMaterialApi(materialId, authToken, userId);
    if (!result.success) {
      throw new Error(result.error || "Не удалось удалить материал");
    }

    showNotification("Материал успешно удалён", false);
    logEvent(analytics, "material_deleted", {
      material_id: materialId,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  } catch (error) {
    showNotification(`Ошибка удаления материала: ${error.message}`, true);
    logErrorToFirestore("deleteMaterial", userId, error, {
      material_id: materialId,
    });
    throw error;
  }
}

export { getCategories, addMaterial, updateMaterial, deleteMaterial };
