const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

// Простой кэш в памяти для категорий
const categoryCache = {
  data: null,
  lastUpdated: 0,
  ttl: 5 * 60 * 1000 // 5 минут
};

/**
 * Валидация данных материала.
 * @param {Object} data - Данные материала.
 * @returns {Object} Объект с результатом валидации: { success, error }.
 */
const validateMaterialData = (data) => {
  if (!data || typeof data !== 'object') {
    return { success: false, error: 'Data must be an object' };
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
    // Проверяем формат категории: "TabName:SubCategory"
    const categoryFormat = /^[^:]+:[^:]+/;
    if (!categoryFormat.test(category)) {
      return { success: false, error: `Invalid category format: "${category}". Expected format: "TabName:SubCategory"` };
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

  // Поле dimensions теперь необязательное (может быть null)
  if (data.dimensions && data.dimensions !== null) {
    if (typeof data.dimensions !== 'object') {
      return { success: false, error: 'Dimensions must be an object or null' };
    }
    const { length, width, height } = data.dimensions;
    if (
      typeof length !== 'number' || length <= 0 ||
      typeof width !== 'number' || width <= 0 ||
      (height !== undefined && (typeof height !== 'number' || height < 0))
    ) {
      return { success: false, error: 'Invalid dimensions: length and width must be positive numbers, height (if provided) must be non-negative' };
    }
    if (length > 100000 || width > 100000 || (height && height > 100000)) {
      return { success: false, error: 'Dimensions must not exceed 100,000 mm' };
    }
  }

  if (data.color && (typeof data.color !== 'string' || data.color.length > 50)) {
    return { success: false, error: 'Color must be a string not exceeding 50 characters' };
  }

  return { success: true };
};

/**
 * Получает список категорий с использованием кэша.
 * @param {number} page - Номер страницы.
 * @param {number} itemsPerPage - Количество элементов на страницу.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Объект с результатом: { success, categories } или { success, error }.
 */
async function getCategories(page, itemsPerPage, authToken, userId) {
  const startTime = Date.now();
  console.log('getCategories: Fetching categories', { page, itemsPerPage, userId, authToken: authToken ? '[provided]' : '[missing]' });

  try {
    // Проверяем входные параметры
    if (typeof page !== 'number' || page < 0 || typeof itemsPerPage !== 'number' || itemsPerPage <= 0) {
      throw new Error('Invalid pagination parameters: page and itemsPerPage must be positive numbers');
    }
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('getCategories: userId is missing or invalid, using default', { userId });
      userId = 'unauthenticated';
    }

    // Проверяем, есть ли данные в кэше и не истек ли TTL
    if (categoryCache.data && (Date.now() - categoryCache.lastUpdated) < categoryCache.ttl) {
      console.log('getCategories: Returning categories from cache');
      const start = page * itemsPerPage;
      const end = start + itemsPerPage;
      functions.logger.info('Categories fetched from cache', {
        page,
        itemsPerPage,
        cacheSize: categoryCache.data.length,
        duration: `${Date.now() - startTime}ms`,
        userId
      });
      return { success: true, categories: categoryCache.data.slice(start, end) };
    }

    // Если кэш пуст или устарел, запрашиваем данные из Firestore
    const materialsSnapshot = await db.collection('materials').select('categories').get();
    const categoriesSet = new Set();

    materialsSnapshot.forEach(doc => {
      const data = doc.data();
      if (Array.isArray(data.categories)) {
        data.categories.forEach(cat => categoriesSet.add(cat));
      }
    });

    const categories = Array.from(categoriesSet).sort();

    // Обновляем кэш
    categoryCache.data = categories;
    categoryCache.lastUpdated = Date.now();
    console.log('getCategories: Categories cache updated');

    const start = page * itemsPerPage;
    const end = start + itemsPerPage;
    functions.logger.info('Categories fetched from Firestore', {
      page,
      itemsPerPage,
      totalCategories: categories.length,
      duration: `${Date.now() - startTime}ms`,
      userId
    });

    // Логируем событие в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'categories_fetched',
      userId: userId,
      page: page,
      itemsPerPage: itemsPerPage,
      totalCategories: categories.length,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, categories: categories.slice(start, end), total: categories.length };
  } catch (error) {
    console.error('getCategories: Error fetching categories:', error);
    functions.logger.error('Error fetching categories', {
      error: error.message,
      stack: error.stack,
      page,
      itemsPerPage,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]'
    });

    // Логируем ошибку в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'categories_fetch_failed',
      userId: userId,
      error: error.message,
      page: page,
      itemsPerPage: itemsPerPage,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: false, error: error.message };
  }
}

/**
 * Получает список материалов с пагинацией на уровне Firestore.
 * @param {string} category - Категория материалов (опционально).
 * @param {number} page - Номер страницы.
 * @param {number} itemsPerPage - Количество элементов на страницу.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Объект с результатом: { success, materials, total } или { success, error }.
 */
async function getMaterials(category, page, itemsPerPage, authToken, userId) {
  const startTime = Date.now();
  console.log('getMaterials: Fetching materials', { category, page, itemsPerPage, userId, authToken: authToken ? '[provided]' : '[missing]' });

  try {
    // Проверяем входные параметры
    if (typeof page !== 'number' || page < 0 || typeof itemsPerPage !== 'number' || itemsPerPage <= 0) {
      throw new Error('Invalid pagination parameters: page and itemsPerPage must be positive numbers');
    }
    if (category && typeof category !== 'string') {
      throw new Error('Category must be a string');
    }
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('getMaterials: userId is missing or invalid, using default', { userId });
      userId = 'unauthenticated';
    }

    const materialsRef = db.collection('materials');
    let query = materialsRef;

    // Если category передан, добавляем фильтр
    if (category) {
      query = query.where('categories', 'array-contains', category);
    }

    // Подсчитываем общее количество материалов
    const totalSnapshot = await query.get();
    const total = totalSnapshot.size;

    // Применяем пагинацию
    const start = page * itemsPerPage;
    query = query.offset(start).limit(itemsPerPage);

    const snapshot = await query.get();
    const materials = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      materials.push({ id: doc.id, ...data });
    });

    functions.logger.info('Materials fetched', {
      category,
      page,
      itemsPerPage,
      total,
      fetchedCount: materials.length,
      userId,
      duration: `${Date.now() - startTime}ms`
    });

    // Логируем событие в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'materials_fetched',
      userId: userId,
      category: category || 'all',
      page: page,
      itemsPerPage: itemsPerPage,
      total: total,
      fetchedCount: materials.length,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, materials, total };
  } catch (error) {
    console.error('getMaterials: Error fetching materials:', error);
    functions.logger.error('Error fetching materials', {
      error: error.message,
      stack: error.stack,
      category,
      page,
      itemsPerPage,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]'
    });

    // Логируем ошибку в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'materials_fetch_failed',
      userId: userId,
      error: error.message,
      category: category || 'all',
      page: page,
      itemsPerPage: itemsPerPage,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: false, error: error.message };
  }
}

/**
 * Получает материал по ключу.
 * @param {string} key - ID материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Объект с результатом: { success, material } или { success, error }.
 */
async function getMaterial(key, authToken, userId) {
  const startTime = Date.now();
  console.log('getMaterial: Fetching material', { key, userId, authToken: authToken ? '[provided]' : '[missing]' });

  try {
    if (!key || typeof key !== 'string') {
      throw new Error('Key must be a non-empty string');
    }
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('getMaterial: userId is missing or invalid, using default', { userId });
      userId = 'unauthenticated';
    }

    const docRef = db.collection('materials').doc(key);
    const doc = await docRef.get();
    if (!doc.exists) {
      functions.logger.warn('Material not found', {
        key,
        userId,
        duration: `${Date.now() - startTime}ms`
      });
      return { success: false, error: 'Material not found' };
    }

    const material = { id: doc.id, ...doc.data() };

    functions.logger.info('Material fetched', {
      key,
      materialName: material.name,
      userId,
      duration: `${Date.now() - startTime}ms`
    });

    // Логируем событие в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'material_fetched',
      userId: userId,
      materialId: key,
      materialName: material.name,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, material };
  } catch (error) {
    console.error('getMaterial: Error fetching material:', error);
    functions.logger.error('Error fetching material', {
      error: error.message,
      stack: error.stack,
      key,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]'
    });

    // Логируем ошибку в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'material_fetch_failed',
      userId: userId,
      error: error.message,
      materialId: key,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: false, error: error.message };
  }
}

/**
 * Добавляет новый материал в Firestore.
 * @param {Object} data - Данные материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Объект с результатом: { success } или { success, error }.
 */
async function addMaterial(data, authToken, userId) {
  const startTime = Date.now();
  console.log('addMaterial: Adding new material', { name: data.name, userId, authToken: authToken ? '[provided]' : '[missing]' });

  try {
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('addMaterial: userId is missing or invalid, using default', { userId });
      userId = 'unauthenticated';
    }

    // Валидация данных
    const validation = validateMaterialData(data);
    if (!validation.success) {
      functions.logger.error('addMaterial: Invalid material data', {
        error: validation.error,
        data,
        userId,
        duration: `${Date.now() - startTime}ms`
      });
      return { success: false, error: validation.error };
    }

    const docRef = db.collection('materials').doc();
    await docRef.set({ id: docRef.id, ...data });

    // Инвалидируем кэш категорий
    categoryCache.data = null;
    categoryCache.lastUpdated = 0;
    console.log('addMaterial: Categories cache invalidated');

    functions.logger.info('Material added', {
      materialId: docRef.id,
      materialName: data.name,
      userId,
      duration: `${Date.now() - startTime}ms`
    });

    // Логируем событие в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'material_added',
      userId: userId,
      materialId: docRef.id,
      materialName: data.name,
      categories: data.categories,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, materialId: docRef.id };
  } catch (error) {
    console.error('addMaterial: Error adding material:', error);
    functions.logger.error('Error adding material', {
      error: error.message,
      stack: error.stack,
      materialName: data.name,
      data,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]'
    });

    // Логируем ошибку в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'material_add_failed',
      userId: userId,
      error: error.message,
      materialName: data.name,
      data,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: false, error: error.message };
  }
}

/**
 * Удаляет материал из Firestore.
 * @param {string} key - ID материала.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Объект с результатом: { success } или { success, error }.
 */
async function deleteMaterial(key, authToken, userId) {
  const startTime = Date.now();
  console.log('deleteMaterial: Deleting material', { key, userId, authToken: authToken ? '[provided]' : '[missing]' });

  try {
    if (!key || typeof key !== 'string') {
      throw new Error('Key must be a non-empty string');
    }
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('deleteMaterial: userId is missing or invalid, using default', { userId });
      userId = 'unauthenticated';
    }

    const docRef = db.collection('materials').doc(key);
    const doc = await docRef.get();
    if (!doc.exists) {
      console.warn('deleteMaterial: Material not found', { key });
      functions.logger.warn('Material not found for deletion', {
        key,
        userId,
        duration: `${Date.now() - startTime}ms`
      });
      return { success: false, error: 'Material not found' };
    }

    const materialData = doc.data();

    await docRef.delete();

    // Инвалидируем кэш категорий
    categoryCache.data = null;
    categoryCache.lastUpdated = 0;
    console.log('deleteMaterial: Categories cache invalidated');

    functions.logger.info('Material deleted', {
      materialId: key,
      materialName: materialData.name,
      userId,
      duration: `${Date.now() - startTime}ms`
    });

    // Логируем событие в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'material_deleted',
      userId: userId,
      materialId: key,
      materialName: materialData.name,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true };
  } catch (error) {
    console.error('deleteMaterial: Error deleting material:', error);
    functions.logger.error('Error deleting material', {
      error: error.message,
      stack: error.stack,
      key,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]'
    });

    // Логируем ошибку в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'material_delete_failed',
      userId: userId,
      error: error.message,
      materialId: key,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: false, error: error.message };
  }
}

/**
 * Обновляет материал в Firestore.
 * @param {Object} data - Данные материала (включая id).
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя (для логирования).
 * @returns {Promise<Object>} Объект с результатом: { success } или { success, error }.
 */
async function editMaterial(data, authToken, userId) {
  const startTime = Date.now();
  console.log('editMaterial: Updating material', { id: data.id, userId, authToken: authToken ? '[provided]' : '[missing]' });

  try {
    const { id, ...updateData } = data;
    if (!id || typeof id !== 'string') {
      throw new Error('ID must be a non-empty string');
    }
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('editMaterial: userId is missing or invalid, using default', { userId });
      userId = 'unauthenticated';
    }

    // Валидация данных
    const validation = validateMaterialData(updateData);
    if (!validation.success) {
      functions.logger.error('editMaterial: Invalid material data', {
        error: validation.error,
        data,
        userId,
        duration: `${Date.now() - startTime}ms`
      });
      return { success: false, error: validation.error };
    }

    const docRef = db.collection('materials').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      console.warn('editMaterial: Material not found', { id });
      functions.logger.warn('Material not found for editing', {
        id,
        userId,
        duration: `${Date.now() - startTime}ms`
      });
      return { success: false, error: 'Material not found' };
    }

    await docRef.set(updateData, { merge: true });

    // Инвалидируем кэш категорий
    categoryCache.data = null;
    categoryCache.lastUpdated = 0;
    console.log('editMaterial: Categories cache invalidated');

    functions.logger.info('Material updated', {
      materialId: id,
      materialName: updateData.name,
      userId,
      duration: `${Date.now() - startTime}ms`
    });

    // Логируем событие в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'material_updated',
      userId: userId,
      materialId: id,
      materialName: updateData.name,
      categories: updateData.categories,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true };
  } catch (error) {
    console.error('editMaterial: Error updating material:', error);
    functions.logger.error('Error updating material', {
      error: error.message,
      stack: error.stack,
      id: data.id,
      data,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]'
    });

    // Логируем ошибку в Firestore для аналитики
    await db.collection('analytics').add({
      event: 'material_update_failed',
      userId: userId,
      error: error.message,
      materialId: data.id,
      data,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
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