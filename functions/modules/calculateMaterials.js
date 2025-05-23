const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();
const { getMaterial, getMaterials } = require('./materialsManager');

// Конфигурационные параметры
const CONFIG = {
  WASTE_FACTOR: 1.1, // 10% на отходы
  RAIL_WASTE_FACTOR: 1.05, // 5% на отходы
  RAIL_STEP: 0.5, // Шаг реек 0.5 м
  RAIL_DEFAULT_LENGTH: 3000, // Длина рейки по умолчанию (мм)
  PAINT_COVERAGE: 10, // 10 м² на литр краски
  ITEMS_PER_PAGE: 100, // Количество материалов на страницу
};

/**
 * Логирует ошибки в Firestore для аналитики.
 * @param {string} endpoint - Эндпоинт (например, calculateMaterials).
 * @param {string} action - Действие (например, computeMaterials).
 * @param {string} userId - ID пользователя.
 * @param {string} ip - IP-адрес клиента.
 * @param {Error} error - Объект ошибки.
 */
async function logErrorToFirestore(endpoint, action, userId, ip, error) {
  await db.collection('analytics').add({
    event: 'request_failed',
    endpoint,
    action: action || 'unknown',
    userId: userId || 'unauthenticated',
    error: error.message,
    ip,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Получает все материалы для категории, учитывая постраничную загрузку.
 * @param {string} category - Категория материалов.
 * @param {number} itemsPerPage - Количество материалов на страницу.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<Array>} Список материалов.
 */
async function fetchAllMaterials(category, itemsPerPage, authToken, userId) {
  functions.logger.info(`Fetching all materials for category "${category}"`, { userId });
  let page = 0;
  let allMaterials = [];
  let hasMore = true;

  while (hasMore) {
    const result = await getMaterials(category, page, itemsPerPage, authToken, userId);
    if (!result.success) {
      functions.logger.error('Error fetching materials', {
        error: result.error,
        category,
        page,
        itemsPerPage,
        userId,
        authToken: authToken ? '[provided]' : '[missing]',
      });
      await logErrorToFirestore(
        'calculateMaterials',
        'fetchAllMaterials',
        userId,
        null,
        new Error(result.error)
      );
      throw new Error(result.error || `Failed to load materials for category "${category}"`);
    }
    const materials = result.materials || [];
    allMaterials = allMaterials.concat(materials);
    hasMore = materials.length === itemsPerPage;
    page++;
  }

  functions.logger.info(`Loaded ${allMaterials.length} materials for category "${category}"`, {
    userId,
  });
  return allMaterials;
}

/**
 * Проверяет и нормализует поле dimensions материала.
 * @param {Object|null} dimensions - Поле dimensions материала.
 * @param {string} materialName - Название материала.
 * @returns {Object} Нормализованный объект dimensions.
 */
function normalizeDimensions(dimensions, materialName) {
  if (!dimensions || dimensions === null) {
    functions.logger.warn(`Dimensions missing for material "${materialName}"`);
    return { length: 0, width: 0, height: 0 };
  }

  if (typeof dimensions !== 'object' || !dimensions.length || !dimensions.width) {
    functions.logger.warn(`Invalid dimensions format for material "${materialName}"`, {
      dimensions,
    });
    return { length: 0, width: 0, height: 0 };
  }

  return {
    length: parseFloat(dimensions.length) || 0,
    width: parseFloat(dimensions.width) || 0,
    height: parseFloat(dimensions.height) || 0,
  };
}

/**
 * Обрабатывает дополнительные материалы (extraMaterials).
 * @param {Array} extraMaterials - Список дополнительных материалов.
 * @param {Array} results - Массив результатов расчёта.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<{ totalCost: number, results: Array }>} Обновлённые результаты.
 */
async function processExtraMaterials(extraMaterials, results, authToken, userId) {
  let totalCost = 0;
  const extraResults = [];

  if (!Array.isArray(extraMaterials)) {
    functions.logger.warn('extraMaterials is not an array, skipping', { extraMaterials, userId });
    return { totalCost, results: extraResults };
  }

  for (const extra of extraMaterials) {
    const { materialKey, quantity } = extra;
    if (
      !materialKey ||
      typeof materialKey !== 'string' ||
      materialKey.trim() === '' ||
      typeof quantity !== 'number' ||
      isNaN(quantity) ||
      quantity <= 0
    ) {
      functions.logger.warn('Invalid extra material data', { materialKey, quantity, userId });
      continue;
    }

    const materialId = materialKey.split(':')[0];
    const materialResult = await getMaterial(materialId, authToken, userId);
    if (!materialResult.success) {
      functions.logger.warn('Failed to load material', {
        materialKey: materialId,
        error: materialResult.error,
        userId,
        authToken: authToken ? '[provided]' : '[missing]',
      });
      continue;
    }

    const material = materialResult.material;
    if (!material.price || !material.unit) {
      functions.logger.warn('Material missing price or unit', {
        materialName: material.name,
        price: material.price,
        unit: material.unit,
        userId,
      });
      continue;
    }

    const extraCost = quantity * material.price;
    const resultEntry = {
      material: material.name,
      quantity: quantity.toFixed(2),
      unit: material.unit,
      cost: extraCost.toFixed(2),
      hidden: material.isHidden || false,
    };
    extraResults.push(resultEntry);
    if (!material.isHidden) {
      results.push(resultEntry);
    }
    totalCost += extraCost;
  }

  functions.logger.info('Processed extra materials', {
    count: extraMaterials.length,
    totalCost: totalCost.toFixed(2),
    userId,
  });
  return { totalCost, results: extraResults };
}

/**
 * Вычисляет материалы и стоимость для указанной вкладки.
 * @param {Object} req - HTTP-запрос.
 * @returns {Promise<Object>} Результат расчёта.
 */
async function calculateMaterials(req) {
  const startTime = Date.now();
  let userId = req.body.userId || req.user?.uid || 'unauthenticated';
  const authToken = req.headers.authorization || '';
  const { tabName, data } = req.body;

  functions.logger.info(`Processing request for tab "${tabName}"`, {
    userId,
    timestamp: new Date().toISOString(),
    authToken: authToken ? '[provided]' : '[missing]',
  });

  try {
    // Валидация authToken
    if (!authToken || typeof authToken !== 'string') {
      functions.logger.error('Missing or invalid authToken', { userId });
      await logErrorToFirestore(
        'calculateMaterials',
        'computeMaterials',
        userId,
        req.ip,
        new Error('Missing authToken')
      );
      return { success: false, error: 'authToken is required and must be a string' };
    }

    // Валидация userId
    if (!userId || typeof userId !== 'string') {
      functions.logger.warn('userId is missing or invalid, using default', { userId });
      userId = 'unauthenticated';
    }

    // Валидация базовых входных данных
    if (!tabName || !data || typeof tabName !== 'string' || typeof data !== 'object') {
      functions.logger.error('Missing or invalid tabName or data', { tabName, data, userId });
      await logErrorToFirestore(
        'calculateMaterials',
        'computeMaterials',
        userId,
        req.ip,
        new Error('Invalid tabName or data')
      );
      return {
        success: false,
        error: 'tabName и data обязательны и должны быть строкой и объектом соответственно',
      };
    }

    let results = [];
    let totalCost = 0;

    // Обработчики для вкладок
    const tabHandlers = {
      'Главная стена': async () => {
        const {
          length,
          width: height,
          finishType,
          insulationType,
          wallPainting,
          extraMaterials,
        } = data;

        if (
          typeof length !== 'number' ||
          isNaN(length) ||
          length <= 0 ||
          typeof height !== 'number' ||
          isNaN(height) ||
          height <= 0 ||
          !finishType ||
          typeof finishType !== 'string'
        ) {
          functions.logger.error('Invalid dimensions or finishType', {
            tabName,
            length,
            height,
            finishType,
            userId,
            data,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid dimensions or finishType')
          );
          return { success: false, error: 'Некорректные размеры или тип отделки' };
        }

        const materialId = finishType.split(':')[0];
        const visibleMaterialResult = await getMaterial(materialId, authToken, userId);
        if (!visibleMaterialResult.success) {
          functions.logger.error('Failed to get visible material', {
            tabName,
            materialId,
            error: visibleMaterialResult.error,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error(visibleMaterialResult.error)
          );
          return visibleMaterialResult;
        }
        const visibleMaterial = visibleMaterialResult.material;

        if (!visibleMaterial.price || !visibleMaterial.unit) {
          functions.logger.error('Material missing price or unit', {
            tabName,
            materialName: visibleMaterial.name,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Material missing price or unit')
          );
          return { success: false, error: 'У материала отсутствует цена или единица измерения' };
        }

        const dimensions = normalizeDimensions(visibleMaterial.dimensions, visibleMaterial.name);
        const matLength = dimensions.length;
        const matWidth = dimensions.width;

        if (matLength <= 0 || matWidth <= 0) {
          functions.logger.error('Invalid material dimensions', {
            tabName,
            materialName: visibleMaterial.name,
            matLength,
            matWidth,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid material dimensions')
          );
          return {
            success: false,
            error: `Недопустимые размеры материала "${visibleMaterial.name}"`,
          };
        }

        const area = (length * height) / 1_000_000;
        const materialArea = (matLength * matWidth) / 1_000_000;
        const visibleQuantity = Math.ceil((area / materialArea) * CONFIG.WASTE_FACTOR);
        const visibleCost = visibleQuantity * visibleMaterial.price;

        results.push({
          material: visibleMaterial.name,
          quantity: visibleQuantity,
          unit: visibleMaterial.unit,
          cost: visibleCost.toFixed(2),
          hidden: false,
        });
        totalCost += visibleCost;

        const hiddenMaterials = await fetchAllMaterials(
          `${tabName}:Скрытые`,
          CONFIG.ITEMS_PER_PAGE,
          authToken,
          userId
        );
        if (hiddenMaterials.length === 0) {
          functions.logger.warn(`No hidden materials found for "${tabName}:Скрытые"`, { userId });
        }
        for (const hiddenMaterial of hiddenMaterials) {
          if (!hiddenMaterial.price) {
            functions.logger.warn('Hidden material missing price', {
              tabName,
              materialName: hiddenMaterial.name,
              userId,
            });
            continue;
          }

          const hiddenDimensions = normalizeDimensions(
            hiddenMaterial.dimensions,
            hiddenMaterial.name
          );
          const railLength = (hiddenDimensions.length || CONFIG.RAIL_DEFAULT_LENGTH) / 1000;
          if (!hiddenDimensions.length) {
            functions.logger.info('Using default rail length', {
              tabName,
              materialName: hiddenMaterial.name,
              defaultLength: CONFIG.RAIL_DEFAULT_LENGTH,
              userId,
            });
          }

          const horizontalCount = Math.ceil(length / CONFIG.RAIL_STEP);
          const verticalCount = Math.ceil(height / railLength);
          const railQuantity = horizontalCount * verticalCount * CONFIG.RAIL_WASTE_FACTOR;
          const railCost = railQuantity * hiddenMaterial.price;

          results.push({
            material: hiddenMaterial.name,
            quantity: railQuantity.toFixed(2),
            unit: hiddenMaterial.unit || 'шт.',
            cost: railCost.toFixed(2),
            hidden: true,
          });
          totalCost += railCost;
        }

        if (insulationType && typeof insulationType === 'string') {
          const insulationMaterialId = insulationType.split(':')[0];
          const insulationMaterialResult = await getMaterial(
            insulationMaterialId,
            authToken,
            userId
          );
          if (insulationMaterialResult.success) {
            const insulationMaterial = insulationMaterialResult.material;
            if (!insulationMaterial.price || !insulationMaterial.unit) {
              functions.logger.warn('Insulation material missing price or unit', {
                tabName,
                materialName: insulationMaterial.name,
                userId,
              });
            } else {
              const insulationDimensions = normalizeDimensions(
                insulationMaterial.dimensions,
                insulationMaterial.name
              );
              const insulationArea = (length * height) / 1_000_000;
              const insulationMatArea =
                (insulationDimensions.length * insulationDimensions.width) / 1_000_000 || 1;
              const insulationQuantity = Math.ceil(
                (insulationArea / insulationMatArea) * CONFIG.WASTE_FACTOR
              );
              const insulationCost = insulationQuantity * insulationMaterial.price;

              results.push({
                material: insulationMaterial.name,
                quantity: insulationQuantity,
                unit: insulationMaterial.unit,
                cost: insulationCost.toFixed(2),
                hidden: false,
              });
              totalCost += insulationCost;
            }
          } else {
            functions.logger.warn('Failed to load insulation material', {
              tabName,
              insulationMaterialId,
              error: insulationMaterialResult.error,
              userId,
            });
          }
        }

        if (wallPainting === 'yes') {
          const paintMaterials = await fetchAllMaterials(
            `${tabName}:Покраска стен`,
            CONFIG.ITEMS_PER_PAGE,
            authToken,
            userId
          );
          for (const paintMaterial of paintMaterials) {
            if (!paintMaterial.price) {
              functions.logger.warn('Paint material missing price', {
                tabName,
                materialName: paintMaterial.name,
                userId,
              });
              continue;
            }
            const paintArea = (length * height) / 1_000_000;
            const paintQuantity = Math.ceil(paintArea / CONFIG.PAINT_COVERAGE);
            const paintCost = paintQuantity * paintMaterial.price;

            results.push({
              material: paintMaterial.name,
              quantity: paintQuantity,
              unit: paintMaterial.unit || 'л.',
              cost: paintCost.toFixed(2),
              hidden: false,
            });
            totalCost += paintCost;
          }
        }

        if (extraMaterials) {
          const extraResult = await processExtraMaterials(
            extraMaterials,
            results,
            authToken,
            userId
          );
          totalCost += extraResult.totalCost;
          results.push(...extraResult.results.filter(r => r.hidden));
        }
      },
      'Фасадная стена': async () => {
        const {
          length,
          width: height,
          finishType,
          insulationType,
          wallPainting,
          extraMaterials,
        } = data;

        if (
          typeof length !== 'number' ||
          isNaN(length) ||
          length <= 0 ||
          typeof height !== 'number' ||
          isNaN(height) ||
          height <= 0 ||
          !finishType ||
          typeof finishType !== 'string'
        ) {
          functions.logger.error('Invalid dimensions or finishType', {
            tabName,
            length,
            height,
            finishType,
            userId,
            data,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid dimensions or finishType')
          );
          return { success: false, error: 'Некорректные размеры или тип отделки' };
        }

        const materialId = finishType.split(':')[0];
        const visibleMaterialResult = await getMaterial(materialId, authToken, userId);
        if (!visibleMaterialResult.success) {
          functions.logger.error('Failed to get visible material', {
            tabName,
            materialId,
            error: visibleMaterialResult.error,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error(visibleMaterialResult.error)
          );
          return visibleMaterialResult;
        }
        const visibleMaterial = visibleMaterialResult.material;

        if (!visibleMaterial.price || !visibleMaterial.unit) {
          functions.logger.error('Material missing price or unit', {
            tabName,
            materialName: visibleMaterial.name,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Material missing price or unit')
          );
          return { success: false, error: 'У материала отсутствует цена или единица измерения' };
        }

        const dimensions = normalizeDimensions(visibleMaterial.dimensions, visibleMaterial.name);
        const matLength = dimensions.length;
        const matWidth = dimensions.width;

        if (matLength <= 0 || matWidth <= 0) {
          functions.logger.error('Invalid material dimensions', {
            tabName,
            materialName: visibleMaterial.name,
            matLength,
            matWidth,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid material dimensions')
          );
          return {
            success: false,
            error: `Недопустимые размеры материала "${visibleMaterial.name}"`,
          };
        }

        const area = (length * height) / 1_000_000;
        const materialArea = (matLength * matWidth) / 1_000_000;
        const visibleQuantity = Math.ceil((area / materialArea) * CONFIG.WASTE_FACTOR);
        const visibleCost = visibleQuantity * visibleMaterial.price;

        results.push({
          material: visibleMaterial.name,
          quantity: visibleQuantity,
          unit: visibleMaterial.unit,
          cost: visibleCost.toFixed(2),
          hidden: false,
        });
        totalCost += visibleCost;

        const hiddenMaterials = await fetchAllMaterials(
          `${tabName}:Скрытые`,
          CONFIG.ITEMS_PER_PAGE,
          authToken,
          userId
        );
        if (hiddenMaterials.length === 0) {
          functions.logger.warn(`No hidden materials found for "${tabName}:Скрытые"`, { userId });
        }
        for (const hiddenMaterial of hiddenMaterials) {
          if (!hiddenMaterial.price) {
            functions.logger.warn('Hidden material missing price', {
              tabName,
              materialName: hiddenMaterial.name,
              userId,
            });
            continue;
          }

          const hiddenDimensions = normalizeDimensions(
            hiddenMaterial.dimensions,
            hiddenMaterial.name
          );
          const railLength = (hiddenDimensions.length || CONFIG.RAIL_DEFAULT_LENGTH) / 1000;
          if (!hiddenDimensions.length) {
            functions.logger.info('Using default rail length', {
              tabName,
              materialName: hiddenMaterial.name,
              defaultLength: CONFIG.RAIL_DEFAULT_LENGTH,
              userId,
            });
          }

          const horizontalCount = Math.ceil(length / CONFIG.RAIL_STEP);
          const verticalCount = Math.ceil(height / railLength);
          const railQuantity = horizontalCount * verticalCount * CONFIG.RAIL_WASTE_FACTOR;
          const railCost = railQuantity * hiddenMaterial.price;

          results.push({
            material: hiddenMaterial.name,
            quantity: railQuantity.toFixed(2),
            unit: hiddenMaterial.unit || 'шт.',
            cost: railCost.toFixed(2),
            hidden: true,
          });
          totalCost += railCost;
        }

        if (insulationType && typeof insulationType === 'string') {
          const insulationMaterialId = insulationType.split(':')[0];
          const insulationMaterialResult = await getMaterial(
            insulationMaterialId,
            authToken,
            userId
          );
          if (insulationMaterialResult.success) {
            const insulationMaterial = insulationMaterialResult.material;
            if (!insulationMaterial.price || !insulationMaterial.unit) {
              functions.logger.warn('Insulation material missing price or unit', {
                tabName,
                materialName: insulationMaterial.name,
                userId,
              });
            } else {
              const insulationDimensions = normalizeDimensions(
                insulationMaterial.dimensions,
                insulationMaterial.name
              );
              const insulationArea = (length * height) / 1_000_000;
              const insulationMatArea =
                (insulationDimensions.length * insulationDimensions.width) / 1_000_000 || 1;
              const insulationQuantity = Math.ceil(
                (insulationArea / insulationMatArea) * CONFIG.WASTE_FACTOR
              );
              const insulationCost = insulationQuantity * insulationMaterial.price;

              results.push({
                material: insulationMaterial.name,
                quantity: insulationQuantity,
                unit: insulationMaterial.unit,
                cost: insulationCost.toFixed(2),
                hidden: false,
              });
              totalCost += insulationCost;
            }
          } else {
            functions.logger.warn('Failed to load insulation material', {
              tabName,
              insulationMaterialId,
              error: insulationMaterialResult.error,
              userId,
            });
          }
        }

        if (wallPainting === 'yes') {
          const paintMaterials = await fetchAllMaterials(
            `${tabName}:Покраска стен`,
            CONFIG.ITEMS_PER_PAGE,
            authToken,
            userId
          );
          for (const paintMaterial of paintMaterials) {
            if (!paintMaterial.price) {
              functions.logger.warn('Paint material missing price', {
                tabName,
                materialName: paintMaterial.name,
                userId,
              });
              continue;
            }
            const paintArea = (length * height) / 1_000_000;
            const paintQuantity = Math.ceil(paintArea / CONFIG.PAINT_COVERAGE);
            const paintCost = paintQuantity * paintMaterial.price;

            results.push({
              material: paintMaterial.name,
              quantity: paintQuantity,
              unit: paintMaterial.unit || 'л.',
              cost: paintCost.toFixed(2),
              hidden: false,
            });
            totalCost += paintCost;
          }
        }

        if (extraMaterials) {
          const extraResult = await processExtraMaterials(
            extraMaterials,
            results,
            authToken,
            userId
          );
          totalCost += extraResult.totalCost;
          results.push(...extraResult.results.filter(r => r.hidden));
        }
      },
      'БЛ стена': async () => {
        const {
          length,
          width: height,
          finishType,
          insulationType,
          wallPainting,
          extraMaterials,
        } = data;

        if (
          typeof length !== 'number' ||
          isNaN(length) ||
          length <= 0 ||
          typeof height !== 'number' ||
          isNaN(height) ||
          height <= 0 ||
          !finishType ||
          typeof finishType !== 'string'
        ) {
          functions.logger.error('Invalid dimensions or finishType', {
            tabName,
            length,
            height,
            finishType,
            userId,
            data,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid dimensions or finishType')
          );
          return { success: false, error: 'Некорректные размеры или тип отделки' };
        }

        const materialId = finishType.split(':')[0];
        const visibleMaterialResult = await getMaterial(materialId, authToken, userId);
        if (!visibleMaterialResult.success) {
          functions.logger.error('Failed to get visible material', {
            tabName,
            materialId,
            error: visibleMaterialResult.error,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error(visibleMaterialResult.error)
          );
          return visibleMaterialResult;
        }
        const visibleMaterial = visibleMaterialResult.material;

        if (!visibleMaterial.price || !visibleMaterial.unit) {
          functions.logger.error('Material missing price or unit', {
            tabName,
            materialName: visibleMaterial.name,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Material missing price or unit')
          );
          return { success: false, error: 'У материала отсутствует цена или единица измерения' };
        }

        const dimensions = normalizeDimensions(visibleMaterial.dimensions, visibleMaterial.name);
        const matLength = dimensions.length;
        const matWidth = dimensions.width;

        if (matLength <= 0 || matWidth <= 0) {
          functions.logger.error('Invalid material dimensions', {
            tabName,
            materialName: visibleMaterial.name,
            matLength,
            matWidth,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid material dimensions')
          );
          return {
            success: false,
            error: `Недопустимые размеры материала "${visibleMaterial.name}"`,
          };
        }

        const area = (length * height) / 1_000_000;
        const materialArea = (matLength * matWidth) / 1_000_000;
        const visibleQuantity = Math.ceil((area / materialArea) * CONFIG.WASTE_FACTOR);
        const visibleCost = visibleQuantity * visibleMaterial.price;

        results.push({
          material: visibleMaterial.name,
          quantity: visibleQuantity,
          unit: visibleMaterial.unit,
          cost: visibleCost.toFixed(2),
          hidden: false,
        });
        totalCost += visibleCost;

        const hiddenMaterials = await fetchAllMaterials(
          `${tabName}:Скрытые`,
          CONFIG.ITEMS_PER_PAGE,
          authToken,
          userId
        );
        if (hiddenMaterials.length === 0) {
          functions.logger.warn(`No hidden materials found for "${tabName}:Скрытые"`, { userId });
        }
        for (const hiddenMaterial of hiddenMaterials) {
          if (!hiddenMaterial.price) {
            functions.logger.warn('Hidden material missing price', {
              tabName,
              materialName: hiddenMaterial.name,
              userId,
            });
            continue;
          }

          const hiddenDimensions = normalizeDimensions(
            hiddenMaterial.dimensions,
            hiddenMaterial.name
          );
          const railLength = (hiddenDimensions.length || CONFIG.RAIL_DEFAULT_LENGTH) / 1000;
          if (!hiddenDimensions.length) {
            functions.logger.info('Using default rail length', {
              tabName,
              materialName: hiddenMaterial.name,
              defaultLength: CONFIG.RAIL_DEFAULT_LENGTH,
              userId,
            });
          }

          const horizontalCount = Math.ceil(length / CONFIG.RAIL_STEP);
          const verticalCount = Math.ceil(height / railLength);
          const railQuantity = horizontalCount * verticalCount * CONFIG.RAIL_WASTE_FACTOR;
          const railCost = railQuantity * hiddenMaterial.price;

          results.push({
            material: hiddenMaterial.name,
            quantity: railQuantity.toFixed(2),
            unit: hiddenMaterial.unit || 'шт.',
            cost: railCost.toFixed(2),
            hidden: true,
          });
          totalCost += railCost;
        }

        if (insulationType && typeof insulationType === 'string') {
          const insulationMaterialId = insulationType.split(':')[0];
          const insulationMaterialResult = await getMaterial(
            insulationMaterialId,
            authToken,
            userId
          );
          if (insulationMaterialResult.success) {
            const insulationMaterial = insulationMaterialResult.material;
            if (!insulationMaterial.price || !insulationMaterial.unit) {
              functions.logger.warn('Insulation material missing price or unit', {
                tabName,
                materialName: insulationMaterial.name,
                userId,
              });
            } else {
              const insulationDimensions = normalizeDimensions(
                insulationMaterial.dimensions,
                insulationMaterial.name
              );
              const insulationArea = (length * height) / 1_000_000;
              const insulationMatArea =
                (insulationDimensions.length * insulationDimensions.width) / 1_000_000 || 1;
              const insulationQuantity = Math.ceil(
                (insulationArea / insulationMatArea) * CONFIG.WASTE_FACTOR
              );
              const insulationCost = insulationQuantity * insulationMaterial.price;

              results.push({
                material: insulationMaterial.name,
                quantity: insulationQuantity,
                unit: insulationMaterial.unit,
                cost: insulationCost.toFixed(2),
                hidden: false,
              });
              totalCost += insulationCost;
            }
          } else {
            functions.logger.warn('Failed to load insulation material', {
              tabName,
              insulationMaterialId,
              error: insulationMaterialResult.error,
              userId,
            });
          }
        }

        if (wallPainting === 'yes') {
          const paintMaterials = await fetchAllMaterials(
            `${tabName}:Покраска стен`,
            CONFIG.ITEMS_PER_PAGE,
            authToken,
            userId
          );
          for (const paintMaterial of paintMaterials) {
            if (!paintMaterial.price) {
              functions.logger.warn('Paint material missing price', {
                tabName,
                materialName: paintMaterial.name,
                userId,
              });
              continue;
            }
            const paintArea = (length * height) / 1_000_000;
            const paintQuantity = Math.ceil(paintArea / CONFIG.PAINT_COVERAGE);
            const paintCost = paintQuantity * paintMaterial.price;

            results.push({
              material: paintMaterial.name,
              quantity: paintQuantity,
              unit: paintMaterial.unit || 'л.',
              cost: paintCost.toFixed(2),
              hidden: false,
            });
            totalCost += paintCost;
          }
        }

        if (extraMaterials) {
          const extraResult = await processExtraMaterials(
            extraMaterials,
            results,
            authToken,
            userId
          );
          totalCost += extraResult.totalCost;
          results.push(...extraResult.results.filter(r => r.hidden));
        }
      },
      'БП стена': async () => {
        const {
          length,
          width: height,
          finishType,
          insulationType,
          wallPainting,
          extraMaterials,
        } = data;

        if (
          typeof length !== 'number' ||
          isNaN(length) ||
          length <= 0 ||
          typeof height !== 'number' ||
          isNaN(height) ||
          height <= 0 ||
          !finishType ||
          typeof finishType !== 'string'
        ) {
          functions.logger.error('Invalid dimensions or finishType', {
            tabName,
            length,
            height,
            finishType,
            userId,
            data,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid dimensions or finishType')
          );
          return { success: false, error: 'Некорректные размеры или тип отделки' };
        }

        const materialId = finishType.split(':')[0];
        const visibleMaterialResult = await getMaterial(materialId, authToken, userId);
        if (!visibleMaterialResult.success) {
          functions.logger.error('Failed to get visible material', {
            tabName,
            materialId,
            error: visibleMaterialResult.error,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error(visibleMaterialResult.error)
          );
          return visibleMaterialResult;
        }
        const visibleMaterial = visibleMaterialResult.material;

        if (!visibleMaterial.price || !visibleMaterial.unit) {
          functions.logger.error('Material missing price or unit', {
            tabName,
            materialName: visibleMaterial.name,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Material missing price or unit')
          );
          return { success: false, error: 'У материала отсутствует цена или единица измерения' };
        }

        const dimensions = normalizeDimensions(visibleMaterial.dimensions, visibleMaterial.name);
        const matLength = dimensions.length;
        const matWidth = dimensions.width;

        if (matLength <= 0 || matWidth <= 0) {
          functions.logger.error('Invalid material dimensions', {
            tabName,
            materialName: visibleMaterial.name,
            matLength,
            matWidth,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid material dimensions')
          );
          return {
            success: false,
            error: `Недопустимые размеры материала "${visibleMaterial.name}"`,
          };
        }

        const area = (length * height) / 1_000_000;
        const materialArea = (matLength * matWidth) / 1_000_000;
        const visibleQuantity = Math.ceil((area / materialArea) * CONFIG.WASTE_FACTOR);
        const visibleCost = visibleQuantity * visibleMaterial.price;

        results.push({
          material: visibleMaterial.name,
          quantity: visibleQuantity,
          unit: visibleMaterial.unit,
          cost: visibleCost.toFixed(2),
          hidden: false,
        });
        totalCost += visibleCost;

        const hiddenMaterials = await fetchAllMaterials(
          `${tabName}:Скрытые`,
          CONFIG.ITEMS_PER_PAGE,
          authToken,
          userId
        );
        if (hiddenMaterials.length === 0) {
          functions.logger.warn(`No hidden materials found for "${tabName}:Скрытые"`, { userId });
        }
        for (const hiddenMaterial of hiddenMaterials) {
          if (!hiddenMaterial.price) {
            functions.logger.warn('Hidden material missing price', {
              tabName,
              materialName: hiddenMaterial.name,
              userId,
            });
            continue;
          }

          const hiddenDimensions = normalizeDimensions(
            hiddenMaterial.dimensions,
            hiddenMaterial.name
          );
          const railLength = (hiddenDimensions.length || CONFIG.RAIL_DEFAULT_LENGTH) / 1000;
          if (!hiddenDimensions.length) {
            functions.logger.info('Using default rail length', {
              tabName,
              materialName: hiddenMaterial.name,
              defaultLength: CONFIG.RAIL_DEFAULT_LENGTH,
              userId,
            });
          }

          const horizontalCount = Math.ceil(length / CONFIG.RAIL_STEP);
          const verticalCount = Math.ceil(height / railLength);
          const railQuantity = horizontalCount * verticalCount * CONFIG.RAIL_WASTE_FACTOR;
          const railCost = railQuantity * hiddenMaterial.price;

          results.push({
            material: hiddenMaterial.name,
            quantity: railQuantity.toFixed(2),
            unit: hiddenMaterial.unit || 'шт.',
            cost: railCost.toFixed(2),
            hidden: true,
          });
          totalCost += railCost;
        }

        if (insulationType && typeof insulationType === 'string') {
          const insulationMaterialId = insulationType.split(':')[0];
          const insulationMaterialResult = await getMaterial(
            insulationMaterialId,
            authToken,
            userId
          );
          if (insulationMaterialResult.success) {
            const insulationMaterial = insulationMaterialResult.material;
            if (!insulationMaterial.price || !insulationMaterial.unit) {
              functions.logger.warn('Insulation material missing price or unit', {
                tabName,
                materialName: insulationMaterial.name,
                userId,
              });
            } else {
              const insulationDimensions = normalizeDimensions(
                insulationMaterial.dimensions,
                insulationMaterial.name
              );
              const insulationArea = (length * height) / 1_000_000;
              const insulationMatArea =
                (insulationDimensions.length * insulationDimensions.width) / 1_000_000 || 1;
              const insulationQuantity = Math.ceil(
                (insulationArea / insulationMatArea) * CONFIG.WASTE_FACTOR
              );
              const insulationCost = insulationQuantity * insulationMaterial.price;

              results.push({
                material: insulationMaterial.name,
                quantity: insulationQuantity,
                unit: insulationMaterial.unit,
                cost: insulationCost.toFixed(2),
                hidden: false,
              });
              totalCost += insulationCost;
            }
          } else {
            functions.logger.warn('Failed to load insulation material', {
              tabName,
              insulationMaterialId,
              error: insulationMaterialResult.error,
              userId,
            });
          }
        }

        if (wallPainting === 'yes') {
          const paintMaterials = await fetchAllMaterials(
            `${tabName}:Покраска стен`,
            CONFIG.ITEMS_PER_PAGE,
            authToken,
            userId
          );
          for (const paintMaterial of paintMaterials) {
            if (!paintMaterial.price) {
              functions.logger.warn('Paint material missing price', {
                tabName,
                materialName: paintMaterial.name,
                userId,
              });
              continue;
            }
            const paintArea = (length * height) / 1_000_000;
            const paintQuantity = Math.ceil(paintArea / CONFIG.PAINT_COVERAGE);
            const paintCost = paintQuantity * paintMaterial.price;

            results.push({
              material: paintMaterial.name,
              quantity: paintQuantity,
              unit: paintMaterial.unit || 'л.',
              cost: paintCost.toFixed(2),
              hidden: false,
            });
            totalCost += paintCost;
          }
        }

        if (extraMaterials) {
          const extraResult = await processExtraMaterials(
            extraMaterials,
            results,
            authToken,
            userId
          );
          totalCost += extraResult.totalCost;
          results.push(...extraResult.results.filter(r => r.hidden));
        }
      },
      Потолок: async () => {
        const {
          length,
          width: height,
          finishType,
          insulationType,
          ceilingPainting,
          extraMaterials,
        } = data;

        if (
          typeof length !== 'number' ||
          isNaN(length) ||
          length <= 0 ||
          typeof height !== 'number' ||
          isNaN(height) ||
          height <= 0 ||
          !finishType ||
          typeof finishType !== 'string'
        ) {
          functions.logger.error('Invalid dimensions or finishType', {
            tabName,
            length,
            height,
            finishType,
            userId,
            data,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid dimensions or finishType')
          );
          return { success: false, error: 'Некорректные размеры или тип отделки' };
        }

        const materialId = finishType.split(':')[0];
        const visibleMaterialResult = await getMaterial(materialId, authToken, userId);
        if (!visibleMaterialResult.success) {
          functions.logger.error('Failed to get visible material', {
            tabName,
            materialId,
            error: visibleMaterialResult.error,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error(visibleMaterialResult.error)
          );
          return visibleMaterialResult;
        }
        const visibleMaterial = visibleMaterialResult.material;

        if (!visibleMaterial.price || !visibleMaterial.unit) {
          functions.logger.error('Material missing price or unit', {
            tabName,
            materialName: visibleMaterial.name,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Material missing price or unit')
          );
          return { success: false, error: 'У материала отсутствует цена или единица измерения' };
        }

        const dimensions = normalizeDimensions(visibleMaterial.dimensions, visibleMaterial.name);
        const matLength = dimensions.length;
        const matWidth = dimensions.width;

        if (matLength <= 0 || matWidth <= 0) {
          functions.logger.error('Invalid material dimensions', {
            tabName,
            materialName: visibleMaterial.name,
            matLength,
            matWidth,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid material dimensions')
          );
          return {
            success: false,
            error: `Недопустимые размеры материала "${visibleMaterial.name}"`,
          };
        }

        const area = (length * height) / 1_000_000;
        const materialArea = (matLength * matWidth) / 1_000_000;
        const visibleQuantity = Math.ceil((area / materialArea) * CONFIG.WASTE_FACTOR);
        const visibleCost = visibleQuantity * visibleMaterial.price;

        results.push({
          material: visibleMaterial.name,
          quantity: visibleQuantity,
          unit: visibleMaterial.unit,
          cost: visibleCost.toFixed(2),
          hidden: false,
        });
        totalCost += visibleCost;

        const hiddenMaterials = await fetchAllMaterials(
          `${tabName}:Скрытые`,
          CONFIG.ITEMS_PER_PAGE,
          authToken,
          userId
        );
        if (hiddenMaterials.length === 0) {
          functions.logger.warn(`No hidden materials found for "${tabName}:Скрытые"`, { userId });
        }
        for (const hiddenMaterial of hiddenMaterials) {
          if (!hiddenMaterial.price) {
            functions.logger.warn('Hidden material missing price', {
              tabName,
              materialName: hiddenMaterial.name,
              userId,
            });
            continue;
          }

          const hiddenDimensions = normalizeDimensions(
            hiddenMaterial.dimensions,
            hiddenMaterial.name
          );
          const railLength = (hiddenDimensions.length || CONFIG.RAIL_DEFAULT_LENGTH) / 1000;
          if (!hiddenDimensions.length) {
            functions.logger.info('Using default rail length', {
              tabName,
              materialName: hiddenMaterial.name,
              defaultLength: CONFIG.RAIL_DEFAULT_LENGTH,
              userId,
            });
          }

          const horizontalCount = Math.ceil(length / CONFIG.RAIL_STEP);
          const verticalCount = Math.ceil(height / railLength);
          const railQuantity = horizontalCount * verticalCount * CONFIG.RAIL_WASTE_FACTOR;
          const railCost = railQuantity * hiddenMaterial.price;

          results.push({
            material: hiddenMaterial.name,
            quantity: railQuantity.toFixed(2),
            unit: hiddenMaterial.unit || 'шт.',
            cost: railCost.toFixed(2),
            hidden: true,
          });
          totalCost += railCost;
        }

        if (insulationType && typeof insulationType === 'string') {
          const insulationMaterialId = insulationType.split(':')[0];
          const insulationMaterialResult = await getMaterial(
            insulationMaterialId,
            authToken,
            userId
          );
          if (insulationMaterialResult.success) {
            const insulationMaterial = insulationMaterialResult.material;
            if (!insulationMaterial.price || !insulationMaterial.unit) {
              functions.logger.warn('Insulation material missing price or unit', {
                tabName,
                materialName: insulationMaterial.name,
                userId,
              });
            } else {
              const insulationDimensions = normalizeDimensions(
                insulationMaterial.dimensions,
                insulationMaterial.name
              );
              const insulationArea = (length * height) / 1_000_000;
              const insulationMatArea =
                (insulationDimensions.length * insulationDimensions.width) / 1_000_000 || 1;
              const insulationQuantity = Math.ceil(
                (insulationArea / insulationMatArea) * CONFIG.WASTE_FACTOR
              );
              const insulationCost = insulationQuantity * insulationMaterial.price;

              results.push({
                material: insulationMaterial.name,
                quantity: insulationQuantity,
                unit: insulationMaterial.unit,
                cost: insulationCost.toFixed(2),
                hidden: false,
              });
              totalCost += insulationCost;
            }
          } else {
            functions.logger.warn('Failed to load insulation material', {
              tabName,
              insulationMaterialId,
              error: insulationMaterialResult.error,
              userId,
            });
          }
        }

        if (ceilingPainting === 'yes') {
          const paintMaterials = await fetchAllMaterials(
            `${tabName}:Покраска потолка`,
            CONFIG.ITEMS_PER_PAGE,
            authToken,
            userId
          );
          for (const paintMaterial of paintMaterials) {
            if (!paintMaterial.price) {
              functions.logger.warn('Paint material missing price', {
                tabName,
                materialName: paintMaterial.name,
                userId,
              });
              continue;
            }
            const paintArea = (length * height) / 1_000_000;
            const paintQuantity = Math.ceil(paintArea / CONFIG.PAINT_COVERAGE);
            const paintCost = paintQuantity * paintMaterial.price;

            results.push({
              material: paintMaterial.name,
              quantity: paintQuantity,
              unit: paintMaterial.unit || 'л.',
              cost: paintCost.toFixed(2),
              hidden: false,
            });
            totalCost += paintCost;
          }
        }

        if (extraMaterials) {
          const extraResult = await processExtraMaterials(
            extraMaterials,
            results,
            authToken,
            userId
          );
          totalCost += extraResult.totalCost;
          results.push(...extraResult.results.filter(r => r.hidden));
        }
      },
      Полы: async () => {
        const { length, width: height, finishType, insulationType, extraMaterials } = data;

        if (
          typeof length !== 'number' ||
          isNaN(length) ||
          length <= 0 ||
          typeof height !== 'number' ||
          isNaN(height) ||
          height <= 0 ||
          !finishType ||
          typeof finishType !== 'string'
        ) {
          functions.logger.error('Invalid dimensions or finishType', {
            tabName,
            length,
            height,
            finishType,
            userId,
            data,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid dimensions or finishType')
          );
          return { success: false, error: 'Некорректные размеры или тип отделки' };
        }

        const materialId = finishType.split(':')[0];
        const visibleMaterialResult = await getMaterial(materialId, authToken, userId);
        if (!visibleMaterialResult.success) {
          functions.logger.error('Failed to get visible material', {
            tabName,
            materialId,
            error: visibleMaterialResult.error,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error(visibleMaterialResult.error)
          );
          return visibleMaterialResult;
        }
        const visibleMaterial = visibleMaterialResult.material;

        if (!visibleMaterial.price || !visibleMaterial.unit) {
          functions.logger.error('Material missing price or unit', {
            tabName,
            materialName: visibleMaterial.name,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Material missing price or unit')
          );
          return { success: false, error: 'У материала отсутствует цена или единица измерения' };
        }

        const dimensions = normalizeDimensions(visibleMaterial.dimensions, visibleMaterial.name);
        const matLength = dimensions.length;
        const matWidth = dimensions.width;

        if (matLength <= 0 || matWidth <= 0) {
          functions.logger.error('Invalid material dimensions', {
            tabName,
            materialName: visibleMaterial.name,
            matLength,
            matWidth,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid material dimensions')
          );
          return {
            success: false,
            error: `Недопустимые размеры материала "${visibleMaterial.name}"`,
          };
        }

        const area = (length * height) / 1_000_000;
        const materialArea = (matLength * matWidth) / 1_000_000;
        const visibleQuantity = Math.ceil((area / materialArea) * CONFIG.WASTE_FACTOR);
        const visibleCost = visibleQuantity * visibleMaterial.price;

        results.push({
          material: visibleMaterial.name,
          quantity: visibleQuantity,
          unit: visibleMaterial.unit,
          cost: visibleCost.toFixed(2),
          hidden: false,
        });
        totalCost += visibleCost;

        const hiddenMaterials = await fetchAllMaterials(
          `${tabName}:Скрытые`,
          CONFIG.ITEMS_PER_PAGE,
          authToken,
          userId
        );
        if (hiddenMaterials.length === 0) {
          functions.logger.warn(`No hidden materials found for "${tabName}:Скрытые"`, { userId });
        }
        for (const hiddenMaterial of hiddenMaterials) {
          if (!hiddenMaterial.price) {
            functions.logger.warn('Hidden material missing price', {
              tabName,
              materialName: hiddenMaterial.name,
              userId,
            });
            continue;
          }

          const hiddenDimensions = normalizeDimensions(
            hiddenMaterial.dimensions,
            hiddenMaterial.name
          );
          const railLength = (hiddenDimensions.length || CONFIG.RAIL_DEFAULT_LENGTH) / 1000;
          if (!hiddenDimensions.length) {
            functions.logger.info('Using default rail length', {
              tabName,
              materialName: hiddenMaterial.name,
              defaultLength: CONFIG.RAIL_DEFAULT_LENGTH,
              userId,
            });
          }

          const horizontalCount = Math.ceil(length / CONFIG.RAIL_STEP);
          const verticalCount = Math.ceil(height / railLength);
          const railQuantity = horizontalCount * verticalCount * CONFIG.RAIL_WASTE_FACTOR;
          const railCost = railQuantity * hiddenMaterial.price;

          results.push({
            material: hiddenMaterial.name,
            quantity: railQuantity.toFixed(2),
            unit: hiddenMaterial.unit || 'шт.',
            cost: railCost.toFixed(2),
            hidden: true,
          });
          totalCost += railCost;
        }

        if (insulationType && typeof insulationType === 'string') {
          const insulationMaterialId = insulationType.split(':')[0];
          const insulationMaterialResult = await getMaterial(
            insulationMaterialId,
            authToken,
            userId
          );
          if (insulationMaterialResult.success) {
            const insulationMaterial = insulationMaterialResult.material;
            if (!insulationMaterial.price || !insulationMaterial.unit) {
              functions.logger.warn('Insulation material missing price or unit', {
                tabName,
                materialName: insulationMaterial.name,
                userId,
              });
            } else {
              const insulationDimensions = normalizeDimensions(
                insulationMaterial.dimensions,
                insulationMaterial.name
              );
              const insulationArea = (length * height) / 1_000_000;
              const insulationMatArea =
                (insulationDimensions.length * insulationDimensions.width) / 1_000_000 || 1;
              const insulationQuantity = Math.ceil(
                (insulationArea / insulationMatArea) * CONFIG.WASTE_FACTOR
              );
              const insulationCost = insulationQuantity * insulationMaterial.price;

              results.push({
                material: insulationMaterial.name,
                quantity: insulationQuantity,
                unit: insulationMaterial.unit,
                cost: insulationCost.toFixed(2),
                hidden: false,
              });
              totalCost += insulationCost;
            }
          } else {
            functions.logger.warn('Failed to load insulation material', {
              tabName,
              insulationMaterialId,
              error: insulationMaterialResult.error,
              userId,
            });
          }
        }

        if (extraMaterials) {
          const extraResult = await processExtraMaterials(
            extraMaterials,
            results,
            authToken,
            userId
          );
          totalCost += extraResult.totalCost;
          results.push(...extraResult.results.filter(r => r.hidden));
        }
      },
      'На заезд': async () => {
        const { entryListToggle, entryFastenersToggle, entryTilingToggle, extraMaterials } = data;

        if (
          typeof entryListToggle !== 'string' ||
          typeof entryFastenersToggle !== 'string' ||
          typeof entryTilingToggle !== 'string'
        ) {
          functions.logger.error('Invalid data for tab "На заезд"', { tabName, data, userId });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid data for На заезд')
          );
          return { success: false, error: 'Некорректные данные для вкладки "На заезд"' };
        }

        const categoriesToCheck = [
          { toggle: entryListToggle, category: 'На заезд:Список на заезд' },
          { toggle: entryFastenersToggle, category: 'На заезд:Крепеж' },
          { toggle: entryTilingToggle, category: 'На заезд:Плиточные работы' },
        ];

        for (const { toggle, category } of categoriesToCheck) {
          if (toggle === 'yes') {
            const materials = await fetchAllMaterials(
              category,
              CONFIG.ITEMS_PER_PAGE,
              authToken,
              userId
            );
            if (materials.length === 0) {
              functions.logger.warn(`No materials found for "${category}"`, { userId });
              continue;
            }
            for (const material of materials) {
              if (!material.price) {
                functions.logger.warn('Material missing price', {
                  tabName,
                  materialName: material.name,
                  category,
                  userId,
                });
                continue;
              }
              const quantity = material.quantity || 1;
              const materialCost = quantity * material.price;
              const resultEntry = {
                material: material.name,
                quantity: quantity.toFixed(2),
                unit: material.unit || 'шт.',
                cost: materialCost.toFixed(2),
                hidden: material.isHidden || false,
              };
              if (!material.isHidden) {
                results.push(resultEntry);
              }
              totalCost += materialCost;
            }
          }
        }

        if (extraMaterials) {
          const extraResult = await processExtraMaterials(
            extraMaterials,
            results,
            authToken,
            userId
          );
          totalCost += extraResult.totalCost;
          results.push(...extraResult.results.filter(r => r.hidden));
        }
      },
      Остекление: async () => {
        functions.logger.info(`Processing glazing for tab "${tabName}"`, { userId });
        const {
          glazingType,
          frameType,
          exteriorFinish,
          balconyBlock,
          windowType,
          windowSlopes,
          sillType,
          roofType,
          windowQuantity,
          extraMaterials,
        } = data;

        if (
          !windowType ||
          typeof windowQuantity !== 'number' ||
          isNaN(windowQuantity) ||
          windowQuantity <= 0
        ) {
          functions.logger.error('Invalid data for tab "Остекление"', {
            tabName,
            windowType,
            windowQuantity,
            userId,
            data,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid data for Остекление')
          );
          return {
            success: false,
            error:
              'Некорректные данные для вкладки "Остекление": требуется windowType и windowQuantity',
          };
        }

        const validVariants = [
          'Балкон 3м.',
          'Балкон 6м.',
          'Лоджия 3м.',
          'Лоджия 6м.',
          'Окно 1.5м. кирпич',
        ];
        if (!validVariants.includes(windowType)) {
          functions.logger.error('Invalid windowType', { tabName, windowType, userId });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error(`Invalid windowType: ${windowType}`)
          );
          return { success: false, error: `Недопустимый вариант окна: ${windowType}` };
        }

        const glazingCategories = [
          { value: glazingType, category: 'Остекление:Что делаем' },
          { value: frameType, category: 'Остекление:Основная рама' },
          { value: exteriorFinish, category: 'Остекление:Наружная отделка' },
          { value: balconyBlock, category: 'Остекление:Замена балконного блока' },
          { value: windowType, category: 'Остекление:Окно' },
          { value: windowSlopes, category: 'Остекление:Откосы для окон' },
          { value: sillType, category: 'Остекление:Подоконники' },
          { value: roofType, category: 'Остекление:Крыша' },
        ];

        for (const { value, category } of glazingCategories) {
          if (value && value !== 'no') {
            let materialId;
            if (category === 'Остекление:Окно') {
              const materials = await fetchAllMaterials(
                category,
                CONFIG.ITEMS_PER_PAGE,
                authToken,
                userId
              );
              const windowMaterial = materials.find(mat => mat.name === value);
              if (!windowMaterial) {
                functions.logger.warn('Material not found for windowType', {
                  tabName,
                  windowType: value,
                  category,
                  userId,
                });
                continue;
              }
              materialId = windowMaterial.id;
            } else {
              materialId = value.split(':')[0];
            }

            const materialResult = await getMaterial(materialId, authToken, userId);
            if (!materialResult.success) {
              functions.logger.warn('Failed to get material', {
                tabName,
                materialId,
                category,
                error: materialResult.error,
                userId,
              });
              continue;
            }

            const material = materialResult.material;
            if (!material.price || !material.unit) {
              functions.logger.warn('Material missing price or unit', {
                tabName,
                materialName: material.name,
                category,
                userId,
              });
              continue;
            }

            const quantity = category === 'Остекление:Окно' ? windowQuantity : 1;
            const cost = quantity * material.price;

            const resultEntry = {
              material: material.name,
              quantity: quantity.toFixed(2),
              unit: material.unit,
              cost: cost.toFixed(2),
              hidden: material.isHidden || false,
            };
            if (!material.isHidden) {
              results.push(resultEntry);
            }
            totalCost += cost;

            if (category === 'Остекление:Окно') {
              const hiddenCategory = `${category}:${value}:Скрытые`;
              const hiddenMaterials = await fetchAllMaterials(
                hiddenCategory,
                CONFIG.ITEMS_PER_PAGE,
                authToken,
                userId
              );
              for (const hiddenMaterial of hiddenMaterials) {
                if (!hiddenMaterial.price) {
                  functions.logger.warn('Hidden material missing price', {
                    tabName,
                    materialName: hiddenMaterial.name,
                    category: hiddenCategory,
                    userId,
                  });
                  continue;
                }
                const hiddenQuantity = windowQuantity;
                const hiddenCost = hiddenQuantity * hiddenMaterial.price;

                results.push({
                  material: hiddenMaterial.name,
                  quantity: hiddenQuantity.toFixed(2),
                  unit: hiddenMaterial.unit || 'шт.',
                  cost: hiddenCost.toFixed(2),
                  hidden: true,
                });
                totalCost += hiddenCost;
              }
            }
          }
        }

        if (extraMaterials) {
          const extraResult = await processExtraMaterials(
            extraMaterials,
            results,
            authToken,
            userId
          );
          totalCost += extraResult.totalCost;
          results.push(...extraResult.results.filter(r => r.hidden));
        }
      },
      Электрика: async () => {
        const {
          cableType,
          cableQuantity,
          switchType,
          switchQuantity,
          socketType,
          socketQuantity,
          spotType,
          spotQuantity,
          extraMaterials,
        } = data;

        const electricItems = [
          { type: cableType, quantity: cableQuantity, category: 'Электрика:Кабель' },
          { type: switchType, quantity: switchQuantity, category: 'Электрика:Выключатель' },
          { type: socketType, quantity: socketQuantity, category: 'Электрика:Розетка' },
          { type: spotType, quantity: spotQuantity, category: 'Электрика:Спот' },
        ];

        for (const item of electricItems) {
          if (
            item.type &&
            typeof item.quantity === 'number' &&
            !isNaN(item.quantity) &&
            item.quantity > 0
          ) {
            const materialId = item.type.split(':')[0];
            const materialResult = await getMaterial(materialId, authToken, userId);
            if (materialResult.success) {
              const material = materialResult.material;
              if (!material.price || !material.unit) {
                functions.logger.warn('Material missing price or unit', {
                  tabName,
                  materialName: material.name,
                  category: item.category,
                  userId,
                });
                continue;
              }
              const cost = item.quantity * material.price;
              const resultEntry = {
                material: material.name,
                quantity: item.quantity.toFixed(2),
                unit: material.unit,
                cost: cost.toFixed(2),
                hidden: material.isHidden || false,
              };
              if (!material.isHidden) {
                results.push(resultEntry);
              }
              totalCost += cost;
            } else {
              functions.logger.warn('Failed to load material', {
                tabName,
                materialId,
                category: item.category,
                error: materialResult.error,
                userId,
              });
            }
          }
        }

        if (extraMaterials) {
          const extraResult = await processExtraMaterials(
            extraMaterials,
            results,
            authToken,
            userId
          );
          totalCost += extraResult.totalCost;
          results.push(...extraResult.results.filter(r => r.hidden));
        }
      },
      Мебель: async () => {
        const {
          furnitureMaterial,
          furniturePainting,
          shelfTopMaterial,
          shelfTopQuantity,
          shelfBottomMaterial,
          shelfBottomQuantity,
          stoveSide,
          countertop,
          extraMaterials,
        } = data;

        const furnitureItems = [
          { type: furnitureMaterial, quantity: 1, category: 'Мебель:Материал мебели' },
          { type: shelfTopMaterial, quantity: shelfTopQuantity, category: 'Мебель:Полки Верх' },
          {
            type: shelfBottomMaterial,
            quantity: shelfBottomQuantity,
            category: 'Мебель:Полки Низ',
          },
        ];

        for (const item of furnitureItems) {
          if (
            item.type &&
            typeof item.quantity === 'number' &&
            !isNaN(item.quantity) &&
            item.quantity > 0
          ) {
            const materialId = item.type.split(':')[0];
            const materialResult = await getMaterial(materialId, authToken, userId);
            if (materialResult.success) {
              const material = materialResult.material;
              if (!material.price || !material.unit) {
                functions.logger.warn('Material missing price or unit', {
                  tabName,
                  materialName: material.name,
                  category: item.category,
                  userId,
                });
                continue;
              }
              const cost = item.quantity * material.price;
              const resultEntry = {
                material: material.name,
                quantity: item.quantity.toFixed(2),
                unit: material.unit,
                cost: cost.toFixed(2),
                hidden: material.isHidden || false,
              };
              if (!material.isHidden) {
                results.push(resultEntry);
              }
              totalCost += cost;
            } else {
              functions.logger.warn('Failed to load material', {
                tabName,
                materialId,
                category: item.category,
                error: materialResult.error,
                userId,
              });
            }
          }
        }

        if (furniturePainting === 'yes') {
          const paintMaterials = await fetchAllMaterials(
            'Мебель:Покраска мебели',
            CONFIG.ITEMS_PER_PAGE,
            authToken,
            userId
          );
          for (const paintMaterial of paintMaterials) {
            if (!paintMaterial.price) {
              functions.logger.warn('Paint material missing price', {
                tabName,
                materialName: paintMaterial.name,
                userId,
              });
              continue;
            }
            const paintQuantity = 1;
            const paintCost = paintQuantity * paintMaterial.price;

            results.push({
              material: paintMaterial.name,
              quantity: paintQuantity,
              unit: paintMaterial.unit || 'л.',
              cost: paintCost.toFixed(2),
              hidden: false,
            });
            totalCost += paintCost;
          }
        }

        const additionalItems = [
          { toggle: stoveSide, category: 'Мебель:Бок у печки' },
          { toggle: countertop, category: 'Мебель:Столешница' },
        ];

        for (const { toggle, category } of additionalItems) {
          if (toggle === 'yes') {
            const materials = await fetchAllMaterials(
              category,
              CONFIG.ITEMS_PER_PAGE,
              authToken,
              userId
            );
            for (const material of materials) {
              if (!material.price) {
                functions.logger.warn('Material missing price', {
                  tabName,
                  materialName: material.name,
                  category,
                  userId,
                });
                continue;
              }
              const quantity = material.quantity || 1;
              const materialCost = quantity * material.price;
              const resultEntry = {
                material: material.name,
                quantity: quantity.toFixed(2),
                unit: material.unit || 'шт.',
                cost: materialCost.toFixed(2),
                hidden: material.isHidden || false,
              };
              if (!material.isHidden) {
                results.push(resultEntry);
              }
              totalCost += materialCost;
            }
          }
        }

        if (extraMaterials) {
          const extraResult = await processExtraMaterials(
            extraMaterials,
            results,
            authToken,
            userId
          );
          totalCost += extraResult.totalCost;
          results.push(...extraResult.results.filter(r => r.hidden));
        }
      },
      'Доп. параметр': async () => {
        const { extraMaterials } = data;
        if (!extraMaterials || !Array.isArray(extraMaterials) || extraMaterials.length === 0) {
          functions.logger.error('Invalid or empty extraMaterials for tab "Доп. параметр"', {
            tabName,
            data,
            userId,
          });
          await logErrorToFirestore(
            'calculateMaterials',
            'computeMaterials',
            userId,
            req.ip,
            new Error('Invalid extraMaterials')
          );
          return {
            success: false,
            error:
              'Некорректные данные для вкладки "Доп. параметр": требуется непустой массив extraMaterials',
          };
        }

        const extraResult = await processExtraMaterials(extraMaterials, results, authToken, userId);
        totalCost += extraResult.totalCost;
        results.push(...extraResult.results.filter(r => r.hidden));
      },
    };

    if (tabHandlers[tabName]) {
      const result = await tabHandlers[tabName]();
      if (!result.success) {
        return result;
      }
    } else {
      functions.logger.error('Unsupported tab', { tabName, userId });
      await logErrorToFirestore(
        'calculateMaterials',
        'computeMaterials',
        userId,
        req.ip,
        new Error(`Unsupported tab: ${tabName}`)
      );
      return { success: false, error: `Расчет для вкладки "${tabName}" пока не реализован` };
    }

    functions.logger.info('Calculation completed', {
      tabName,
      resultsCount: results.length,
      totalCost: totalCost.toFixed(2),
      userId,
      duration: `${Date.now() - startTime}ms`,
    });

    await db.collection('analytics').add({
      event: 'action_processed',
      endpoint: 'calculateMaterials',
      action: 'computeMaterials',
      userId,
      tabName,
      success: true,
      totalCost: totalCost.toFixed(2),
      resultsCount: results.length,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      results,
      totalCost: totalCost.toFixed(2),
    };
  } catch (error) {
    functions.logger.error('Error in calculation', {
      tabName,
      message: error.message,
      stack: error.stack,
      userId,
      duration: `${Date.now() - startTime}ms`,
      authToken: authToken ? '[provided]' : '[missing]',
    });
    await logErrorToFirestore('calculateMaterials', 'computeMaterials', userId, req.ip, error);
    return { success: false, error: error.message || String(error) };
  }
}

module.exports = calculateMaterials;
