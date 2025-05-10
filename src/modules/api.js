import { analytics, logEvent } from './firebase.js';

const MANAGE_MATERIALS_URL = 'https://us-central1-balconycalculator-15c42.cloudfunctions.net/manageMaterials';

/**
 * Логирует ошибки в Firestore для аналитики.
 * @param {string} action - Действие (например, getMaterials).
 * @param {string} userId - ID пользователя.
 * @param {Error} error - Объект ошибки.
 * @param {Object} [extra] - Дополнительные данные для лога.
 */
async function logErrorToFirestore(action, userId, error, extra = {}) {
  try {
    await logEvent(analytics, `${action}_failed`, {
      action,
      message: error.message,
      userId: userId || 'unauthenticated',
      page_title: 'Balcony Calculator',
      ...extra,
    });
  } catch (logError) {
    await logEvent(analytics, 'log_error_failed', {
      action,
      message: logError.message,
      userId: userId || 'unauthenticated',
      page_title: 'Balcony Calculator',
    });
  }
}

/**
 * Выполняет запрос к API manageMaterials.
 * @param {string} action - Действие для API (например, 'getMaterials').
 * @param {Object} body - Тело запроса.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<Object>} Результат запроса.
 * @throws {Error} Если запрос не удался.
 */
async function makeApiRequest(action, body, authToken, userId) {
  logEvent(analytics, `${action}_initiated`, {
    action,
    userId: userId || 'unauthenticated',
    body,
    page_title: 'Balcony Calculator',
  });

  try {
    if (!authToken || typeof authToken !== 'string') {
      throw new Error('authToken must be a non-empty string');
    }
    if (!action || typeof action !== 'string') {
      throw new Error('action must be a non-empty string');
    }
    let effectiveUserId = userId;
    if (!userId || typeof userId !== 'string') {
      effectiveUserId = 'unauthenticated';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут

    try {
      const response = await fetch(MANAGE_MATERIALS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          action,
          ...body,
          userId: effectiveUserId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      logEvent(analytics, `${action}_completed`, {
        action,
        userId: effectiveUserId,
        result,
        page_title: 'Balcony Calculator',
      });

      return result;
    } catch (fetchError) {
      if (fetchError.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw fetchError;
    }
  } catch (error) {
    await logErrorToFirestore(action, userId, error, {
      body,
      authToken: authToken ? '[provided]' : '[missing]',
    });
    throw error;
  }
}

/**
 * Получает список материалов.
 * @param {string|null} category - Категория материалов (опционально).
 * @param {number} page - Номер страницы.
 * @param {number} itemsPerPage - Количество элементов на страницу.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<Object>} Результат запроса.
 * @throws {Error} Если запрос не удался.
 */
export async function getMaterials(category, page, itemsPerPage, authToken, userId) {
  if (page < 0 || itemsPerPage <= 0) {
    throw new Error('page must be non-negative and itemsPerPage must be positive');
  }
  return makeApiRequest(
    'getMaterials',
    {
      category: category || null,
      page: page || 0,
      itemsPerPage: itemsPerPage || 10,
    },
    authToken,
    userId,
  );
}

/**
 * Получает список категорий.
 * @param {number} page - Номер страницы.
 * @param {number} itemsPerPage - Количество элементов на страницу.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<Object>} Результат запроса.
 * @throws {Error} Если запрос не удался.
 */
export async function getCategories(page, itemsPerPage, authToken, userId) {
  if (page < 0 || itemsPerPage <= 0) {
    throw new Error('page must be non-negative and itemsPerPage must be positive');
  }
  return makeApiRequest(
    'getCategories',
    {
      page: page || 0,
      itemsPerPage: itemsPerPage || 50,
    },
    authToken,
    userId,
  );
}

/**
 * Добавляет новый материал.
 * @param {Object} data - Данные материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<Object>} Результат запроса.
 * @throws {Error} Если запрос не удался.
 */
export async function addMaterial(data, authToken, userId) {
  if (!data || typeof data !== 'object') {
    throw new Error('data must be a non-empty object');
  }
  return makeApiRequest('addMaterial', { data }, authToken, userId);
}

/**
 * Обновляет существующий материал.
 * @param {string} materialId - ID материала.
 * @param {Object} data - Данные материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<Object>} Результат запроса.
 * @throws {Error} Если запрос не удался.
 */
export async function updateMaterial(materialId, data, authToken, userId) {
  if (!materialId || typeof materialId !== 'string') {
    throw new Error('materialId must be a non-empty string');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('data must be a non-empty object');
  }
  return makeApiRequest(
    'editMaterial',
    {
      data: { key: materialId, ...data },
    },
    authToken,
    userId,
  );
}

/**
 * Удаляет материал.
 * @param {string} materialId - ID материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<Object>} Результат запроса.
 * @throws {Error} Если запрос не удался.
 */
export async function deleteMaterial(materialId, authToken, userId) {
  if (!materialId || typeof materialId !== 'string') {
    throw new Error('materialId must be a non-empty string');
  }
  return makeApiRequest('deleteMaterial', { key: materialId }, authToken, userId);
}