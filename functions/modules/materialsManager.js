const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

// Простой кэш в памяти для категорий
const categoryCache = {
  data: null,
  lastUpdated: 0,
  ttl: 5 * 60 * 1000, // 5 минут
};

/**
 * Логирует событие в Firestore.
 * @param {Object} db - Инстанс Firestore.
 * @param {string} event - Название события.
 * @param {string} userId - ID пользователя.
 * @param {Object} [extra] - Дополнительные данные для лога.
 */
async function logToFirestore(db, event, userId, extra = {}) {
  try {
    await db.collection('analytics').add({
      event,
      userId: userId || 'unauthenticated',
      page_title: 'Balcony Calculator',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ...extra,
    });
  } catch (firestoreError) {
    functions.logger.warn('Failed to log to Firestore', {
      event,
      message: firestoreError.message,
      stack: firestoreError.stack,
    });
  }
}

/**
 * Валидирует данные материала.
 * @param {Object} data - Данные материала.
 * @returns {{ success: boolean, error?: string }} Результат валидации.
 */
function validateMaterialData(data) {
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'Data must be a non-empty object' };
  }

  const requiredFields = ['name', 'categories', 'price', 'quantity', 'unit'];
  for (const field of requiredFields) {
    if (!(field in data)) {
      return { success: false, error: `Missing required field: ${field}` };
    }
  }

  if (typeof data.name !== 'string' || data.name.trim() === '') {
    return { success: false, error: 'Name must be a non-empty string' };
  }
  if (data.name.length > 100) {
    return { success: false, error: 'Name must not exceed 100 characters' };
  }

  if (!Array.isArray(data.categories) || data.categories.length === 0) {
    return { success: false, error: 'Categories must be a non-empty array' };
  }
  for (const category of data.categories) {
    if (typeof category !== 'string' || category.trim() === '') {
      return { success: false, error: 'Each category must be a non-empty string' };
    }
    if (category.length > 200) {
      return { success: false, error: 'Category name must not exceed 200 characters' };
    }
    const categoryFormat = /^[^:]+:[^:]+/;
    if (!categoryFormat.test(category)) {
      return {
        success: false,
        error: `Invalid category format: "${category}". Expected format: "TabName:SubCategory"`,
      };
    }
  }

  if (typeof data.price !== 'number' || data.price < 0) {
    return { success: false, error: 'Price must be a non-negative number' };
  }
  if (data.price > 1000000) {
    return { success: false, error: 'Price must not exceed 1,000,000' };
  }

  if (typeof data.quantity !== 'number' || data.quantity < 0) {
    return { success: false, error: 'Quantity must be a non-negative number' };
  }

  if (typeof data.unit !== 'string' || data.unit.trim() === '') {
    return { success: false, error: 'Unit must be a non-empty string' };
  }
  if (data.unit.length > 20) {
    return { success: false, error: 'Unit must not exceed 20 characters' };
  }

  if (data.dimensions && data.dimensions !== null) {
    if (typeof data.dimensions !== 'object') {
      return { success: false, error: 'Dimensions must be an object or null' };
    }
    const { length, width, height } = data.dimensions;
    if (
      typeof length !== 'number' ||
      length <= 0 ||
      typeof width !== 'number' ||
      width <= 0 ||
      (height !== undefined && (typeof height !== 'number' || height < 0))
    ) {
      return {
        success: false,
        error:
          'Invalid dimensions: length and width must be positive numbers, height (if provided) must be non-negative',
      };
    }
    if (length > 100000 || width > 100000 || (height && height > 100000)) {
      return { success: false, error: 'Dimensions must not exceed 100,000 mm' };
    }
  }

  if (data.color && (typeof data.color !== 'string' || data.color.length > 50)) {
    return { success: false, error: 'Color must be a string not exceeding 50 characters' };
  }

  return { success: true };
}

/**
 * Получает список категорий с использованием кэша.
 * @param {number} page - Номер страницы.
 * @param {number} itemsPerPage - Количество элементов на страницу.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<{ success: boolean, categories?: string[], total?: number, error?: string }>} Результат запроса.
 */
async function getCategories(page, itemsPerPage, authToken, userId) {
  const startTime = Date.now();
  functions.logger.info('Fetching categories', {
    page,
    itemsPerPage,
    userId,
    authToken: authToken ? '[provided]' : '[missing]',
  });

  try {
    if (
      typeof page !== 'number' ||
      page < 0 ||
      typeof itemsPerPage !== 'number' ||
      itemsPerPage <= 0
    ) {
      throw new Error(
        'Invalid pagination parameters: page and itemsPerPage must be positive numbers'
      );
    }
    let effectiveUserId = userId;
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('userId is missing or invalid, using default', { userId });
      effectiveUserId = 'unauthenticated';
    }

    if (categoryCache.data && Date.now() - categoryCache.lastUpdated < categoryCache.ttl) {
      functions.logger.info('Serving categories from cache', { userId: effectiveUserId });
      const start = page * itemsPerPage;
      const end = start + itemsPerPage;
      await logToFirestore(db, 'categories_fetched', effectiveUserId, {
        page,
        itemsPerPage,
        totalCategories: categoryCache.data.length,
        source: 'cache',
        duration: `${Date.now() - startTime}ms`,
      });
      return {
        success: true,
        categories: categoryCache.data.slice(start, end),
        total: categoryCache.data.length,
      };
    }

    const materialsSnapshot = await db.collection('materials').select('categories').get();
    const categoriesSet = new Set();
    materialsSnapshot.forEach(doc => {
      const data = doc.data();
      if (Array.isArray(data.categories)) {
        data.categories.forEach(cat => categoriesSet.add(cat));
      }
    });

    const categories = Array.from(categoriesSet).sort();
    categoryCache.data = categories;
    categoryCache.lastUpdated = Date.now();

    functions.logger.info('Categories fetched from Firestore', {
      page,
      itemsPerPage,
      totalCategories: categories.length,
      duration: `${Date.now() - startTime}ms`,
      userId: effectiveUserId,
    });

    await logToFirestore(db, 'categories_fetched', effectiveUserId, {
      page,
      itemsPerPage,
      totalCategories: categories.length,
      source: 'firestore',
      duration: `${Date.now() - startTime}ms`,
    });

    const start = page * itemsPerPage;
    const end = start + itemsPerPage;
    return { success: true, categories: categories.slice(start, end), total: categories.length };
  } catch (error) {
    categoryCache.data = null;
    categoryCache.lastUpdated = 0;
    functions.logger.error('Error fetching categories', {
      message: error.message,
      stack: error.stack,
      page,
      itemsPerPage,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]',
    });

    await logToFirestore(db, 'categories_fetch_failed', userId || 'unauthenticated', {
      error: error.message,
      page,
      itemsPerPage,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: false, error: error.message };
  }
}

/**
 * Получает список материалов с пагинацией.
 * @param {string|null} category - Категория материалов.
 * @param {number} page - Номер страницы.
 * @param {number} itemsPerPage - Количество элементов на страницу.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<{ success: boolean, materials?: Object[], total?: number, error?: string }>} Результат запроса.
 */
async function getMaterials(category, page, itemsPerPage, authToken, userId) {
  const startTime = Date.now();
  functions.logger.info('Fetching materials', {
    category,
    page,
    itemsPerPage,
    userId,
    authToken: authToken ? '[provided]' : '[missing]',
  });

  try {
    if (
      typeof page !== 'number' ||
      page < 0 ||
      typeof itemsPerPage !== 'number' ||
      itemsPerPage <= 0
    ) {
      throw new Error(
        'Invalid pagination parameters: page and itemsPerPage must be positive numbers'
      );
    }
    if (category && typeof category !== 'string') {
      throw new Error('Category must be a string');
    }
    let effectiveUserId = userId;
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('userId is missing or invalid, using default', { userId });
      effectiveUserId = 'unauthenticated';
    }

    let query = db.collection('materials');
    if (category) {
      query = query.where('categories', 'array-contains', category);
    }

    const totalSnapshot = await query.get();
    const total = totalSnapshot.size;

    const snapshot = await query
      .offset(page * itemsPerPage)
      .limit(itemsPerPage)
      .get();

    const materials = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    functions.logger.info('Materials fetched', {
      category,
      page,
      itemsPerPage,
      total,
      fetchedCount: materials.length,
      userId: effectiveUserId,
      duration: `${Date.now() - startTime}ms`,
    });

    await logToFirestore(db, 'materials_fetched', effectiveUserId, {
      category: category || 'all',
      page,
      itemsPerPage,
      total,
      fetchedCount: materials.length,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: true, materials, total };
  } catch (error) {
    functions.logger.error('Error fetching materials', {
      message: error.message,
      stack: error.stack,
      category,
      page,
      itemsPerPage,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]',
    });

    await logToFirestore(db, 'materials_fetch_failed', userId || 'unauthenticated', {
      error: error.message,
      category: category || 'all',
      page,
      itemsPerPage,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: false, error: error.message };
  }
}

/**
 * Получает материал по ключу.
 * @param {string} key - ID материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<{ success: boolean, material?: Object, error?: string }>} Результат запроса.
 */
async function getMaterial(key, authToken, userId) {
  const startTime = Date.now();
  functions.logger.info('Fetching material', {
    key,
    userId,
    authToken: authToken ? '[provided]' : '[missing]',
  });

  try {
    if (!key || typeof key !== 'string') {
      throw new Error('Key must be a non-empty string');
    }
    let effectiveUserId = userId;
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('userId is missing or invalid, using default', { userId });
      effectiveUserId = 'unauthenticated';
    }

    const docRef = db.collection('materials').doc(key);
    const doc = await docRef.get();
    if (!doc.exists) {
      functions.logger.warn('Material not found', {
        key,
        userId: effectiveUserId,
        duration: `${Date.now() - startTime}ms`,
      });
      return { success: false, error: 'Material not found' };
    }

    const material = { id: doc.id, ...doc.data() };

    functions.logger.info('Material fetched', {
      key,
      materialName: material.name,
      userId: effectiveUserId,
      duration: `${Date.now() - startTime}ms`,
    });

    await logToFirestore(db, 'material_fetched', effectiveUserId, {
      materialId: key,
      materialName: material.name,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: true, material };
  } catch (error) {
    functions.logger.error('Error fetching material', {
      message: error.message,
      stack: error.stack,
      key,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]',
    });

    await logToFirestore(db, 'material_fetch_failed', userId || 'unauthenticated', {
      error: error.message,
      materialId: key,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: false, error: error.message };
  }
}

/**
 * Добавляет новый материал.
 * @param {Object} data - Данные материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<{ success: boolean, materialId?: string, error?: string }>} Результат запроса.
 */
async function addMaterial(data, authToken, userId) {
  const startTime = Date.now();
  functions.logger.info('Adding new material', {
    name: data.name,
    userId,
    authToken: authToken ? '[provided]' : '[missing]',
  });

  try {
    let effectiveUserId = userId;
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('userId is missing or invalid, using default', { userId });
      effectiveUserId = 'unauthenticated';
    }

    const validation = validateMaterialData(data);
    if (!validation.success) {
      functions.logger.error('Invalid material data', {
        error: validation.error,
        data,
        userId: effectiveUserId,
        duration: `${Date.now() - startTime}ms`,
      });
      return { success: false, error: validation.error };
    }

    const docRef = db.collection('materials').doc();
    await docRef.set({
      id: docRef.id,
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    categoryCache.data = null;
    categoryCache.lastUpdated = 0;
    functions.logger.info('Categories cache invalidated', { userId: effectiveUserId });

    functions.logger.info('Material added', {
      materialId: docRef.id,
      materialName: data.name,
      userId: effectiveUserId,
      duration: `${Date.now() - startTime}ms`,
    });

    await logToFirestore(db, 'material_added', effectiveUserId, {
      materialId: docRef.id,
      materialName: data.name,
      categories: data.categories,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: true, materialId: docRef.id };
  } catch (error) {
    functions.logger.error('Error adding material', {
      message: error.message,
      stack: error.stack,
      materialName: data.name,
      data,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]',
    });

    await logToFirestore(db, 'material_add_failed', userId || 'unauthenticated', {
      error: error.message,
      materialName: data.name,
      data,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: false, error: error.message };
  }
}

/**
 * Удаляет материал.
 * @param {string} key - ID материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<{ success: boolean, error?: string }>} Результат запроса.
 */
async function deleteMaterial(key, authToken, userId) {
  const startTime = Date.now();
  functions.logger.info('Deleting material', {
    key,
    userId,
    authToken: authToken ? '[provided]' : '[missing]',
  });

  try {
    if (!key || typeof key !== 'string') {
      throw new Error('Key must be a non-empty string');
    }
    let effectiveUserId = userId;
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('userId is missing or invalid, using default', { userId });
      effectiveUserId = 'unauthenticated';
    }

    const docRef = db.collection('materials').doc(key);
    const doc = await docRef.get();
    if (!doc.exists) {
      functions.logger.warn('Material not found', {
        key,
        userId: effectiveUserId,
        duration: `${Date.now() - startTime}ms`,
      });
      return { success: false, error: 'Material not found' };
    }

    const materialData = doc.data();
    await docRef.delete();

    categoryCache.data = null;
    categoryCache.lastUpdated = 0;
    functions.logger.info('Categories cache invalidated', { userId: effectiveUserId });

    functions.logger.info('Material deleted', {
      materialId: key,
      materialName: materialData.name,
      userId: effectiveUserId,
      duration: `${Date.now() - startTime}ms`,
    });

    await logToFirestore(db, 'material_deleted', effectiveUserId, {
      materialId: key,
      materialName: materialData.name,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: true };
  } catch (error) {
    functions.logger.error('Error deleting material', {
      message: error.message,
      stack: error.stack,
      key,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]',
    });

    await logToFirestore(db, 'material_delete_failed', userId || 'unauthenticated', {
      error: error.message,
      materialId: key,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: false, error: error.message };
  }
}

/**
 * Обновляет материал.
 * @param {Object} data - Данные материала с id.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<{ success: boolean, error?: string }>} Результат запроса.
 */
async function editMaterial(data, authToken, userId) {
  const startTime = Date.now();
  functions.logger.info('Updating material', {
    id: data.id,
    userId,
    authToken: authToken ? '[provided]' : '[missing]',
  });

  try {
    const { id, ...updateData } = data;
    if (!id || typeof id !== 'string') {
      throw new Error('ID must be a non-empty string');
    }
    let effectiveUserId = userId;
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('userId is missing or invalid, using default', { userId });
      effectiveUserId = 'unauthenticated';
    }

    const validation = validateMaterialData(updateData);
    if (!validation.success) {
      functions.logger.error('Invalid material data', {
        error: validation.error,
        data,
        userId: effectiveUserId,
        duration: `${Date.now() - startTime}ms`,
      });
      return { success: false, error: validation.error };
    }

    const docRef = db.collection('materials').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      functions.logger.warn('Material not found', {
        id,
        userId: effectiveUserId,
        duration: `${Date.now() - startTime}ms`,
      });
      return { success: false, error: 'Material not found' };
    }

    await docRef.set(
      {
        ...updateData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    categoryCache.data = null;
    categoryCache.lastUpdated = 0;
    functions.logger.info('Categories cache invalidated', { userId: effectiveUserId });

    functions.logger.info('Material updated', {
      materialId: id,
      materialName: updateData.name,
      userId: effectiveUserId,
      duration: `${Date.now() - startTime}ms`,
    });

    await logToFirestore(db, 'material_updated', effectiveUserId, {
      materialId: id,
      materialName: updateData.name,
      categories: updateData.categories,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: true };
  } catch (error) {
    functions.logger.error('Error updating material', {
      message: error.message,
      stack: error.stack,
      id: data.id,
      data,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]',
    });

    await logToFirestore(db, 'material_update_failed', userId || 'unauthenticated', {
      error: error.message,
      materialId: data.id,
      data,
      duration: `${Date.now() - startTime}ms`,
    });

    return { success: false, error: error.message };
  }
}

module.exports = {
  getMaterials,
  getMaterial,
  getCategories,
  addMaterial,
  deleteMaterial,
  editMaterial,
  validateMaterialData,
};
