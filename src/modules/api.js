/**
 * Выполняет запрос к API manageMaterials с указанным действием и данными.
 * @param {string} action - Действие для API (например, 'getMaterials').
 * @param {Object} body - Тело запроса.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Результат запроса.
 * @throws {Error} Если запрос не удался.
 */
async function makeApiRequest(action, body, authToken, userId) {
  console.log(`${action}: Initiating request`, { action, userId, body });
  try {
    // Валидация входных параметров
    if (!authToken || typeof authToken !== 'string') {
      throw new Error('authToken must be a non-empty string');
    }

    const response = await fetch('https://us-central1-balconycalculator-15c42.cloudfunctions.net/manageMaterials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        action,
        ...body,
        userId: userId || 'unknown' // Передаём userId в тело запроса
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ошибка: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    console.log(`${action}: Response:`, result);
    return result;
  } catch (error) {
    console.error(`${action}: Error:`, {
      message: error.message,
      stack: error.stack,
      authToken: authToken ? '[provided]' : '[missing]',
      body,
      userId
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
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Результат запроса.
 */
export async function getMaterials(category, page, itemsPerPage, authToken, userId) {
  return makeApiRequest('getMaterials', {
    category: category || null,
    page: page || 0,
    itemsPerPage: itemsPerPage || 10
  }, authToken, userId);
}

/**
 * Получает список категорий.
 * @param {number} page - Номер страницы.
 * @param {number} itemsPerPage - Количество элементов на страницу.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Результат запроса.
 */
export async function getCategories(page, itemsPerPage, authToken, userId) {
  return makeApiRequest('getCategories', {
    page: page || 0,
    itemsPerPage: itemsPerPage || 50
  }, authToken, userId);
}

/**
 * Добавляет новый материал.
 * @param {Object} data - Данные материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Результат запроса.
 */
export async function addMaterial(data, authToken, userId) {
  return makeApiRequest('addMaterial', { data }, authToken, userId);
}

/**
 * Обновляет существующий материал.
 * @param {string} materialId - ID материала.
 * @param {Object} data - Данные материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Результат запроса.
 */
export async function updateMaterial(materialId, data, authToken, userId) {
  return makeApiRequest('editMaterial', {
    data: { key: materialId, ...data }
  }, authToken, userId);
}

/**
 * Удаляет материал.
 * @param {string} materialId - ID материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Результат запроса.
 */
export async function deleteMaterial(materialId, authToken, userId) {
  return makeApiRequest('deleteMaterial', { key: materialId }, authToken, userId);
}