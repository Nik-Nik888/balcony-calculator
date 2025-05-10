import { getMaterials, getCategories as fetchCategories, addMaterial as addMaterialApi, updateMaterial as updateMaterialApi, deleteMaterial as deleteMaterialApi } from './api.js';
import { validCategories } from './categories.js';

/**
 * Получает список категорий через manageMaterials.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<string[]>} Список категорий.
 */
async function getCategories(authToken, userId) {
  console.log('getCategories: Fetching categories', { userId });
  if (!authToken || typeof authToken !== 'string') {
    throw new Error('Токен аутентификации отсутствует или недействителен');
  }

  let page = 0;
  const itemsPerPage = 200;
  let allCategories = [];
  let hasMore = true;

  while (hasMore) {
    const result = await fetchCategories(page, itemsPerPage, authToken, userId);
    if (!result.success) {
      throw new Error(result.error || 'Не удалось загрузить категории');
    }

    const categories = result.categories || [];
    allCategories = allCategories.concat(categories);

    hasMore = categories.length === itemsPerPage;
    page++;
  }

  const uniqueCategories = [...new Set(allCategories)].sort();
  console.log('getCategories: Successfully fetched categories:', uniqueCategories, { userId });
  return uniqueCategories;
}

/**
 * Добавляет материал через manageMaterials.
 * @param {Object} materialData - Данные материала для добавления.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<void>}
 */
async function addMaterial(materialData, authToken, showNotification, userId) {
  console.log('addMaterial: Starting to add material', { materialData, userId });
  try {
    if (!authToken || typeof authToken !== 'string') {
      throw new Error('Токен аутентификации отсутствует или недействителен');
    }
    if (typeof showNotification !== 'function') {
      throw new Error('showNotification must be a function');
    }

    const result = await addMaterialApi(materialData, authToken, userId);
    if (!result.success) {
      throw new Error(result.error || 'Не удалось добавить материал');
    }

    console.log('addMaterial: Material added successfully', { userId });
    showNotification('Материал успешно добавлен', false);
  } catch (error) {
    console.error('addMaterial: Error adding material:', {
      message: error.message,
      stack: error.stack,
      userId,
      materialData
    });
    showNotification(`Ошибка добавления материала: ${error.message}`, true);
    throw error;
  }
}

/**
 * Обновляет материал через manageMaterials.
 * @param {string} materialId - ID материала для обновления.
 * @param {Object} materialData - Новые данные материала.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<void>}
 */
async function updateMaterial(materialId, materialData, authToken, showNotification, userId) {
  console.log(`updateMaterial: Starting to update material with ID ${materialId}`, { materialData, userId });
  try {
    if (!authToken || typeof authToken !== 'string') {
      throw new Error('Токен аутентификации отсутствует или недействителен');
    }
    if (typeof showNotification !== 'function') {
      throw new Error('showNotification must be a function');
    }

    const result = await updateMaterialApi(materialId, materialData, authToken, userId);
    if (!result.success) {
      throw new Error(result.error || 'Не удалось обновить материал');
    }

    console.log('updateMaterial: Material updated successfully', { materialId, userId });
    showNotification('Материал успешно обновлён', false);
  } catch (error) {
    console.error('updateMaterial: Error updating material:', {
      message: error.message,
      stack: error.stack,
      materialId,
      userId,
      materialData
    });
    showNotification(`Ошибка обновления материала: ${error.message}`, true);
    throw error;
  }
}

/**
 * Удаляет материал через manageMaterials.
 * @param {string} materialId - ID материала для удаления.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<void>}
 */
async function deleteMaterial(materialId, authToken, showNotification, userId) {
  console.log(`deleteMaterial: Starting to delete material with ID ${materialId}`, { userId });
  try {
    if (!authToken || typeof authToken !== 'string') {
      throw new Error('Токен аутентификации отсутствует или недействителен');
    }
    if (typeof showNotification !== 'function') {
      throw new Error('showNotification must be a function');
    }

    const result = await deleteMaterialApi(materialId, authToken, userId);
    if (!result.success) {
      throw new Error(result.error || 'Не удалось удалить материал');
    }

    console.log('deleteMaterial: Material deleted successfully', { materialId, userId });
    showNotification('Материал успешно удалён', false);
  } catch (error) {
    console.error('deleteMaterial: Error deleting material:', {
      message: error.message,
      stack: error.stack,
      materialId,
      userId
    });
    showNotification(`Ошибка удаления материала: ${error.message}`, true);
    throw error;
  }
}

// Экспортируем функции
export { getCategories, addMaterial, updateMaterial, deleteMaterial };