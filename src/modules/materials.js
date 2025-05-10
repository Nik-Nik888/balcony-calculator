import { getMaterials, getCategories, addMaterial, updateMaterial, deleteMaterial } from './api.js';
import { validCategories } from './categories.js';
import { analytics, logEvent } from './firebase.js'; // Импортируем аналитику для логирования событий

// Переменные для пагинации
let currentPage = 1;
const ITEMS_PER_PAGE = 10;

// Хранилище всех категорий для фильтрации
let allCategoriesData = [];

// Хранилище userId (будет установлено в initializeMaterialActions)
let userId = null;

/**
 * Загружает категории через manageMaterials и отображает их в виде дерева (для вкладки "Управление материалами").
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @returns {Promise<void>}
 */
async function loadCategories(showNotification, authToken) {
  console.log('loadCategories: Starting to load categories', { userId });
  try {
    const container = document.getElementById('categoriesContainer');
    if (!container) {
      console.error('loadCategories: Container categoriesContainer not found in DOM', { userId });
      throw new Error('Контейнер категорий не найден');
    }

    container.innerHTML = '<div>Загрузка категорий...</div>';

    let page = 0;
    const itemsPerPage = 200;
    let allCategories = [];
    let hasMore = true;

    while (hasMore) {
      console.log(`loadCategories: Fetching categories, page ${page}`, { userId });
      const result = await getCategories(page, itemsPerPage, authToken, userId);
      if (!result.success) {
        throw new Error(result.error || 'Не удалось загрузить категории');
      }

      console.log(`loadCategories: Response for page ${page}:`, result);

      const categories = result.categories || [];
      allCategories = allCategories.concat(categories);

      hasMore = categories.length === itemsPerPage;
      page++;
    }

    console.log('loadCategories: All loaded categories from Firestore:', allCategories);

    // Сортируем категории
    allCategories.sort();
    console.log('loadCategories: Final categories:', allCategories);

    if (allCategories.length === 0) {
      console.warn('loadCategories: No categories available to display', { userId });
      container.innerHTML = '<div>Категории отсутствуют.</div>';
      showNotification('Категории отсутствуют. Добавьте материалы в "Управление материалами".', true);
      return;
    }

    // Сохраняем все категории для фильтрации
    allCategoriesData = allCategories;

    renderCategories(allCategories, container);

    // Инициализация управления категориями
    initializeCategoryControls(allCategories, container);
    console.log('loadCategories: Categories successfully rendered', { userId });

    // Логируем успешную загрузку категорий
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'categories_loaded', {
        categories_count: allCategories.length,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }
  } catch (error) {
    console.error('loadCategories: Error loading categories:', {
      message: error.message,
      stack: error.stack,
      userId
    });
    showNotification('Ошибка при загрузке категорий: ' + error.message, true);
    const container = document.getElementById('categoriesContainer');
    if (container) {
      container.innerHTML = '<div>Ошибка загрузки категорий.</div>';
    }

    // Логируем ошибку загрузки категорий
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'categories_load_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }

    throw error; // Перебрасываем ошибку для обработки в вызывающем коде
  }
}

/**
 * Рендерит категории в виде дерева.
 * @param {Array<string>} categories - Список категорий.
 * @param {HTMLElement} container - Контейнер для рендеринга.
 */
function renderCategories(categories, container) {
  container.innerHTML = '';

  const categoryTree = buildCategoryTree(categories);
  renderCategoryTree(categoryTree, container, 0);

  // Обновляем счетчик выбранных категорий
  updateSelectedCategoriesCount();
}

/**
 * Строит дерево категорий для рендеринга.
 * @param {Array<string>} categories - Массив категорий.
 * @returns {Object} Дерево категорий.
 */
function buildCategoryTree(categories) {
  console.log('buildCategoryTree: Building category tree', { userId });
  const tree = {};
  categories.forEach(category => {
    const parts = category.split(':');
    let currentLevel = tree;

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join(':');
      if (!currentLevel[part]) {
        currentLevel[part] = {
          path: path,
          children: {}
        };
      }
      currentLevel = currentLevel[part].children;
    });
  });
  return tree;
}

/**
 * Рендерит дерево категорий с раскрывающимся списком.
 * @param {Object} tree - Дерево категорий.
 * @param {HTMLElement} container - Контейнер для рендеринга.
 * @param {number} level - Уровень вложенности.
 */
function renderCategoryTree(tree, container, level) {
  console.log(`renderCategoryTree: Rendering tree at level ${level}`, { userId });
  Object.entries(tree).forEach(([name, node]) => {
    const details = document.createElement('details');
    details.className = 'category-item';
    details.style.paddingLeft = `${level * 15}px`;

    const summary = document.createElement('summary');
    summary.className = 'category-summary';

    const span = document.createElement('span');
    span.textContent = name;
    summary.appendChild(span);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'category';
    checkbox.value = node.path;
    checkbox.addEventListener('change', updateSelectedCategoriesCount);
    summary.appendChild(checkbox);

    details.appendChild(summary);
    container.appendChild(details);

    renderCategoryTree(node.children, details, level + 1);
  });
}

/**
 * Обновляет счетчик выбранных категорий.
 */
function updateSelectedCategoriesCount() {
  const selectedCount = document.querySelectorAll('input[name="category"]:checked').length;
  const countElement = document.getElementById('selectedCategoriesCount');
  if (countElement) {
    countElement.textContent = `Выбрано: ${selectedCount}`;
  }
}

/**
 * Инициализирует элементы управления категориями (поиск, фильтр, сворачивание/разворачивание).
 * @param {Array<string>} allCategories - Полный список категорий.
 * @param {HTMLElement} container - Контейнер для категорий.
 */
function initializeCategoryControls(allCategories, container) {
  // Поиск категорий
  const searchInput = document.getElementById('categorySearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const searchText = searchInput.value.toLowerCase();
      const filteredCategories = allCategories.filter(category => category.toLowerCase().includes(searchText));
      renderCategories(filteredCategories, container);
    });
  }

  // Фильтр по вкладкам
  const tabFilterSelect = document.getElementById('categoryFilterTabSelect');
  if (tabFilterSelect) {
    tabFilterSelect.addEventListener('change', () => {
      const selectedTab = tabFilterSelect.value;
      let filteredCategories = allCategories;
      if (selectedTab) {
        filteredCategories = allCategories.filter(category => category.startsWith(selectedTab));
      }
      // Применяем фильтр поиска, если он активен
      const searchText = searchInput ? searchInput.value.toLowerCase() : '';
      if (searchText) {
        filteredCategories = filteredCategories.filter(category => category.toLowerCase().includes(searchText));
      }
      renderCategories(filteredCategories, container);
    });
  }

  // Развернуть/свернуть все категории
  const toggleAllBtn = document.getElementById('toggleAllCategoriesBtn');
  let allExpanded = false;
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click', () => {
      allExpanded = !allExpanded;
      const detailsElements = container.querySelectorAll('details');
      detailsElements.forEach(details => {
        details.open = allExpanded;
      });
      toggleAllBtn.textContent = allExpanded ? 'Свернуть все' : 'Развернуть все';
    });
  }

  // Сбросить выбор категорий
  const clearBtn = document.getElementById('clearCategoriesBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const checkboxes = container.querySelectorAll('input[name="category"]');
      checkboxes.forEach(checkbox => {
        checkbox.checked = false;
      });
      updateSelectedCategoriesCount();
    });
  }
}

/**
 * Загружает варианты окон через manageMaterials (для вкладки "Остекление").
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @returns {Promise<Array>} Список вариантов окон.
 */
async function loadWindowVariants(showNotification, authToken) {
  console.log('loadWindowVariants: Starting to load window variants', { userId });
  try {
    const select = document.getElementById('windowTypeSelectTab2');
    if (!select) {
      console.error('loadWindowVariants: Element windowTypeSelectTab2 not found in DOM', { userId });
      throw new Error('Элемент windowTypeSelectTab2 не найден');
    }

    const response = await getMaterials('Остекление:Окно', 0, 100, authToken, userId);
    if (!response.success) {
      throw new Error(response.error || 'Не удалось загрузить варианты окон');
    }

    console.log('loadWindowVariants: Response:', response);

    select.innerHTML = '<option value="">Выберите вариант окна</option>';

    if (!response.materials || response.materials.length === 0) {
      console.warn('loadWindowVariants: No materials found for category "Остекление:Окно"', { userId });
      showNotification('Варианты окон отсутствуют. Добавьте материалы с категорией "Остекление:Окно" в "Управление материалами".', true);
      return [];
    }

    // Фильтруем только допустимые варианты окон
    const validVariants = ['Балкон 3м.', 'Балкон 6м.', 'Лоджия 3м.', 'Лоджия 6м.', 'Окно 1.5м. кирпич'];
    const windowVariants = [];
    response.materials.forEach(material => {
      if (!material.isHidden && validVariants.includes(material.name)) {
        const option = document.createElement('option');
        option.value = material.name;
        option.textContent = material.name;
        select.appendChild(option);
        windowVariants.push({ id: material.id, name: material.name });
        console.log('loadWindowVariants: Added window variant:', material.name, { userId });
      }
    });

    if (select.options.length === 1) { // Только пустая опция
      console.warn('loadWindowVariants: No valid window variants available', { userId });
      showNotification('Допустимые варианты окон отсутствуют. Проверьте материалы в "Управление материалами".', true);
      return windowVariants;
    }

    console.log('loadWindowVariants: Window variants successfully rendered', { userId });

    // Логируем успешную загрузку вариантов окон
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'window_variants_loaded', {
        variants_count: windowVariants.length,
        page_title: 'Balcony Calculator - Glazing Tab',
        user_id: userId
      });
    }

    return windowVariants;
  } catch (error) {
    console.error('loadWindowVariants: Error loading window variants:', {
      message: error.message,
      stack: error.stack,
      userId
    });
    showNotification('Ошибка при загрузке вариантов окон: ' + error.message, true);

    // Логируем ошибку загрузки вариантов окон
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'window_variants_load_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator - Glazing Tab',
        user_id: userId
      });
    }

    return [];
  }
}

/**
 * Заполняет выпадающие списки материалами через manageMaterials (для вкладок "На заезд", "Главная стена", "Остекление").
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {string} userId - ID пользователя (для логирования и аналитики).
 * @returns {Promise<void>}
 */
async function populateSelects(showNotification, authToken, userId) {
  console.log('populateSelects: Starting to populate selects', { userId });
  try {
    // Загружаем категории из Firestore
    let page = 0;
    const itemsPerPage = 50;
    let allCategories = [];
    let hasMore = true;

    while (hasMore) {
      const categoriesResponse = await getCategories(page, itemsPerPage, authToken, userId);
      if (!categoriesResponse.success) {
        showNotification('Ошибка загрузки категорий', true);
        throw new Error('Failed to fetch categories');
      }
      const categories = categoriesResponse.categories || [];
      allCategories = allCategories.concat(categories);
      hasMore = categories.length === itemsPerPage;
      page++;
    }

    console.log('populateSelects: Loaded categories:', allCategories, { userId });

    // Создаём маппинг категорий к классам <select> на основе загруженных категорий
    const categoryClassMap = {};
    allCategories.forEach(category => {
      const parts = category.split(':');
      const subCategory = parts.slice(1).join(':');
      if (subCategory === 'Список на заезд') categoryClassMap[category] = 'arrival-list';
      if (subCategory === 'Крепеж') categoryClassMap[category] = 'fasteners';
      if (subCategory === 'Плиточные работы') categoryClassMap[category] = 'tile-work';
      if (subCategory === 'Доп. параметр') categoryClassMap[category] = 'extra-material';
      if (subCategory === 'Что делаем') categoryClassMap[category] = 'glazing-type';
      if (subCategory === 'Основная рама') categoryClassMap[category] = 'frame-type';
      if (subCategory === 'Наружная отделка') categoryClassMap[category] = 'exterior-finish';
      if (subCategory === 'Замена балконного блока') categoryClassMap[category] = 'balcony-block';
      if (subCategory === 'Окно') categoryClassMap[category] = 'window-type';
      if (subCategory.includes('Скрытые')) categoryClassMap[category] = 'hidden-material'; // Для всех скрытых материалов
      if (subCategory === 'Откосы для окон') categoryClassMap[category] = 'window-slopes';
      if (subCategory === 'Подоконники') categoryClassMap[category] = 'sill-type';
      if (subCategory === 'Крыша') categoryClassMap[category] = 'roof-type';
      if (subCategory === 'Вид отделки') categoryClassMap[category] = 'finish-type';
      if (subCategory === 'Покраска стен') categoryClassMap[category] = 'wall-painting';
      if (subCategory === 'Покраска потолка') categoryClassMap[category] = 'ceiling-painting';
      if (subCategory === 'Вид утепления') categoryClassMap[category] = 'insulation-type';
      if (subCategory === 'Направление отделки') categoryClassMap[category] = 'finish-direction';
      if (subCategory === 'Кабель') categoryClassMap[category] = 'cable-type';
      if (subCategory === 'Выключатель') categoryClassMap[category] = 'switch-type';
      if (subCategory === 'Розетка') categoryClassMap[category] = 'socket-type';
      if (subCategory === 'Спот') categoryClassMap[category] = 'spot-type';
      if (subCategory === 'Название мебели') categoryClassMap[category] = 'furniture-name';
      if (subCategory === 'Материал мебели') categoryClassMap[category] = 'furniture-material';
      if (subCategory === 'Покраска мебели') categoryClassMap[category] = 'furniture-painting';
      if (subCategory === 'Полки Верх') categoryClassMap[category] = 'shelf-top-material';
      if (subCategory === 'Полки Низ') categoryClassMap[category] = 'shelf-bottom-material';
      if (subCategory === 'Бок у печки') categoryClassMap[category] = 'stove-side';
      if (subCategory === 'Столешница') categoryClassMap[category] = 'countertop';
    });

    const materialsResponse = await getMaterials(null, 0, 100, authToken, userId);
    if (!materialsResponse.success) {
      showNotification('Ошибка загрузки материалов', true);
      throw new Error('Failed to fetch materials');
    }
    const materials = materialsResponse.materials;
    console.log('populateSelects: Loaded materials:', materials);
    console.log('populateSelects: Material categories:', materials.map(material => material.categories));

    // Проверка на пустой массив материалов
    if (!materials || materials.length === 0) {
      console.warn('populateSelects: No materials available to populate selects', { userId });
      showNotification('Материалы отсутствуют. Добавьте материалы в "Управление материалами".', true);

      // Логируем отсутствие материалов
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'materials_load_failed', {
          reason: 'no_materials',
          page_title: 'Balcony Calculator',
          user_id: userId
        });
      }
      return;
    }

    const tabs = ['tab1', 'tab2', 'tab3', 'tab4', 'tab5', 'tab6', 'tab7', 'tab8', 'tab9', 'tab10', 'tab11'];
    tabs.forEach(tabId => {
      const extraSelects = document.querySelectorAll(`#${tabId} select.extra-material`);
      extraSelects.forEach(select => {
        populateSelectElement(select, 'Доп. параметр:Доп. параметр', materials, showNotification);
      });
    });

    allCategories.forEach(category => {
      const parts = category.split(':');
      const tabName = parts[0];
      const subcategory = parts.slice(1).join(':');

      const tabId = getTabId(tabName);
      if (!tabId) {
        console.warn(`populateSelects: No tab ID mapped for tab "${tabName}"`, { category, userId });
        return;
      }

      const className = categoryClassMap[category];
      if (!className) {
        console.warn(`populateSelects: No class mapped for subcategory "${subcategory}" in category "${category}"`, { userId });
        return;
      }

      const selectElement = document.querySelector(`#${tabId} select.${className}`);
      if (!selectElement) {
        console.warn(`populateSelects: No <select> found with class "${className}" for category "${category}"`, { userId });
        return;
      }

      populateSelectElement(selectElement, category, materials, showNotification);
    });

    // Настройка переключателей для вкладки "На заезд"
    const entryListToggle = document.querySelector('#tab1 #entryListToggle.arrival-list');
    if (entryListToggle) {
      console.log('populateSelects: Set values for entryListToggle in "На заезд" tab', { userId });
      entryListToggle.innerHTML = `
        <option value="no">НЕТ</option>
        <option value="yes">ДА</option>
      `;
    }

    const entryFastenersToggle = document.querySelector('#tab1 #entryFastenersToggle.fasteners');
    if (entryFastenersToggle) {
      console.log('populateSelects: Set values for entryFastenersToggle in "На заезд" tab', { userId });
      entryFastenersToggle.innerHTML = `
        <option value="no">НЕТ</option>
        <option value="yes">ДА</option>
      `;
    }

    const entryTilingToggle = document.querySelector('#tab1 #entryTilingToggle');
    if (entryTilingToggle) {
      console.log('populateSelects: Set values for entryTilingToggle in "На заезд" tab', { userId });
      entryTilingToggle.innerHTML = `
        <option value="no">НЕТ</option>
        <option value="yes">ДА</option>
      `;
    }

    // Загружаем варианты окон
    await loadWindowVariants(showNotification, authToken);

    console.log('populateSelects: All selects populated successfully', { userId });

    // Логируем успешное заполнение выпадающих списков
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'selects_populated', {
        materials_count: materials.length,
        page_title: 'Balcony Calculator',
        user_id: userId
      });
    }
  } catch (error) {
    console.error('populateSelects: Error populating selects:', {
      message: error.message,
      stack: error.stack,
      userId
    });
    showNotification('Ошибка при заполнении выпадающих списков: ' + error.message, true);

    // Логируем ошибку заполнения выпадающих списков
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'selects_populate_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator',
        user_id: userId
      });
    }

    throw error;
  }
}

function getTabId(tabName) {
  const tabMap = {
    'На заезд': 'tab1',
    'Остекление': 'tab2',
    'Главная стена': 'tab3',
    'Фасадная стена': 'tab4',
    'БЛ стена': 'tab5',
    'БП стена': 'tab6',
    'Потолок': 'tab7',
    'Полы': 'tab8',
    'Электрика': 'tab9',
    'Мебель': 'tab10',
    'Доп. параметр': 'tab11',
  };
  return tabMap[tabName];
}

function populateSelectElement(selectElement, category, materials, showNotification) {
  // Используем categories, так как данные из Firestore содержат массив categories
  const relevantMaterials = materials.filter(material => {
    if (!Array.isArray(material.categories)) {
      console.warn(`populateSelectElement: Material has invalid categories format`, {
        materialId: material.id,
        materialName: material.name,
        categories: material.categories,
        userId
      });
      return false;
    }
    return material.categories.includes(category) && !material.isHidden;
  });

  if (relevantMaterials.length === 0) {
    console.warn(`populateSelectElement: No available materials for category "${category}"`, { userId });
    showNotification(`Нет доступных материалов для категории "${category}". Добавьте материалы в "Управление материалами".`, true);
    selectElement.innerHTML = '<option value="">Нет доступных материалов</option>';
    return;
  }

  const options = relevantMaterials.map(material => {
    const dimensionsDisplay = material.dimensions && typeof material.dimensions === 'object'
      ? ` (${material.dimensions.length}x${material.dimensions.width}${material.dimensions.height ? `x${material.dimensions.height}` : ''})`
      : '';
    const displayText = `${material.name}${material.color ? ` ${material.color}` : ''}${dimensionsDisplay}`;
    return `<option value="${material.id}:${category}:${material.name}">${displayText}</option>`;
  });

  selectElement.innerHTML = `<option value="">Выберите материал</option>${options.join('')}`;
}

/**
 * Загружает материалы через manageMaterials (для вкладки "Управление материалами").
 * @param {number} page - Номер страницы для пагинации.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {string} userId - ID пользователя (для логирования и аналитики).
 * @returns {Promise<void>}
 */
async function loadMaterialsTable(page = 1, showNotification, authToken, userId) {
  console.log(`loadMaterialsTable: Loading materials table for page ${page}`, { userId });
  const container = document.getElementById('materialList');
  if (!container) {
    console.error('loadMaterialsTable: Container materialList not found in DOM', { userId });
    showNotification('Ошибка: Элемент materialList не найден', true);
    throw new Error('Элемент materialList не найден');
  }

  container.innerHTML = '<p>Загрузка...</p>';

  try {
    currentPage = page;

    const response = await getMaterials(null, page - 1, ITEMS_PER_PAGE, authToken, userId);
    if (!response.success) {
      throw new Error(response.error || 'Не удалось загрузить материалы');
    }

    const materials = response.materials || [];
    console.log('loadMaterialsTable: Loaded materials:', materials);

    // Проверка на пустой массив материалов
    if (!materials.length) {
      console.warn('loadMaterialsTable: No materials available to display', { userId });
      container.innerHTML = '<p>Материалы отсутствуют.</p>';
      showNotification('Материалы отсутствуют. Добавьте материалы в "Управление материалами".', true);

      // Логируем отсутствие материалов
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'materials_table_load_failed', {
          reason: 'no_materials',
          page_title: 'Balcony Calculator - Manage Materials',
          user_id: userId
        });
      }
      return;
    }

    const tbody = document.createElement('tbody');
    materials.forEach(material => {
      const dimensionsStr = material.dimensions && typeof material.dimensions === 'object'
        ? `${material.dimensions.length}x${material.dimensions.width}${material.dimensions.height ? `x${material.dimensions.height}` : ''}`
        : 'N/A';
      // Предполагаем, что categories всегда массив
      const categories = Array.isArray(material.categories) ? material.categories : [];
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${material.name}</td>
        <td>${material.color || 'Не указан'}</td>
        <td>${dimensionsStr}</td>
        <td>${material.price}</td>
        <td>${material.quantity}</td>
        <td>${material.unit}</td>
        <td>${material.isHidden ? 'Да' : 'Нет'}</td>
        <td>${categories.join(', ') || 'Без категории'}</td>
        <td>
          <button class="edit-btn" data-id="${material.id}">Редактировать</button>
          <button class="delete-btn" data-id="${material.id}">Удалить</button>
        </td>
      `;
      row.setAttribute('data-id', `${material.id}:${categories.join(',')}:${material.name}`);
      tbody.appendChild(row);
    });

    const table = document.createElement('table');
    table.innerHTML = `
      <thead>
        <tr>
          <th>Название</th>
          <th>Цвет</th>
          <th>Размеры</th>
          <th>Цена</th>
          <th>Количество</th>
          <th>Ед. изм.</th>
          <th>Скрытый</th>
          <th>Категории</th>
          <th>Действия</th>
        </tr>
      </thead>
    `;
    table.appendChild(tbody);

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-wrapper';
    tableWrapper.appendChild(table);

    const mobileList = document.createElement('div');
    mobileList.className = 'material-list-mobile';
    materials.forEach(material => {
      const dimensionsStr = material.dimensions && typeof material.dimensions === 'object'
        ? `${material.dimensions.length}x${material.dimensions.width}${material.dimensions.height ? `x${material.dimensions.height}` : ''}`
        : 'N/A';
      // Предполагаем, что categories всегда массив
      const categories = Array.isArray(material.categories) ? material.categories : [];
      const item = document.createElement('details');
      item.className = 'material-item';
      item.setAttribute('data-id', `${material.id}:${categories.join(',')}:${material.name}`);
      item.innerHTML = `
        <summary>${material.name}</summary>
        <div>
          <p><strong>Цвет:</strong> ${material.color || 'Не указан'}</p>
          <p><strong>Размеры:</strong> ${dimensionsStr}</p>
          <p><strong>Цена:</strong> ${material.price}</p>
          <p><strong>Количество:</strong> ${material.quantity}</p>
          <p><strong>Ед. изм.:</strong> ${material.unit}</p>
          <p><strong>Скрытый:</strong> ${material.isHidden ? 'Да' : 'Нет'}</p>
          <p><strong>Категории:</strong> ${categories.join(', ') || 'Без категории'}</p>
          <button class="edit-btn" data-id="${material.id}">Редактировать</button>
          <button class="delete-btn" data-id="${material.id}">Удалить</button>
        </div>
      `;
      mobileList.appendChild(item);
    });

    container.innerHTML = '';
    container.appendChild(tableWrapper);
    container.appendChild(mobileList);

    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (!prevBtn || !nextBtn) {
      console.error('loadMaterialsTable: Buttons prevPageBtn or nextPageBtn not found in DOM', { userId });
      showNotification('Ошибка: Кнопки пагинации не найдены', true);
      throw new Error('Кнопки пагинации не найдены');
    }
    prevBtn.disabled = page === 1;
    nextBtn.disabled = materials.length < ITEMS_PER_PAGE;

    prevBtn.onclick = () => page > 1 && loadMaterialsTable(page - 1, showNotification, authToken, userId);
    nextBtn.onclick = () => loadMaterialsTable(page + 1, showNotification, authToken, userId);

    // Добавляем обработчики для кнопок редактирования и удаления
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const materialId = btn.dataset.id;
        const material = materials.find(m => m.id === materialId);
        if (material) {
          document.getElementById('newMaterialInput').value = material.name;
          document.getElementById('colorInput').value = material.color || '';
          const dimensionsStr = material.dimensions && typeof material.dimensions === 'object'
            ? `${material.dimensions.length}x${material.dimensions.width}${material.dimensions.height ? `x${material.dimensions.height}` : ''}`
            : '';
          document.getElementById('dimensionsInput').value = dimensionsStr;
          document.getElementById('priceInput').value = material.price;
          document.getElementById('quantityInput').value = material.quantity;
          document.getElementById('unitSelect').value = material.unit;
          document.getElementById('isHiddenInput').checked = material.isHidden;
          document.querySelectorAll('#categoriesContainer input').forEach(input => {
            input.checked = material.categories.includes(input.value);
          });
          document.getElementById('materialSelect').value = `${material.id}:${material.categories.join(',')}:${material.name}`;
        }
      });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const materialId = btn.dataset.id;
        await deleteMaterialWrapper(materialId, showNotification, loadMaterialsTable, populateSelects, authToken);
      });
    });

    console.log('loadMaterialsTable: Materials table successfully rendered', { userId });

    // Логируем успешную загрузку таблицы материалов
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'materials_table_loaded', {
        materials_count: materials.length,
        page: page,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }
  } catch (error) {
    console.error('loadMaterialsTable: Error loading materials:', {
      message: error.message,
      stack: error.stack,
      userId
    });
    showNotification(`Ошибка загрузки материалов: ${error.message}`, true);
    container.innerHTML = '<p>Ошибка загрузки материалов</p>';

    // Логируем ошибку загрузки таблицы материалов
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'materials_table_load_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }

    throw error;
  }
}

/**
 * Загружает список материалов в <select id="materialSelect">.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @returns {Promise<void>}
 */
async function loadMaterialSelectOptions(showNotification, authToken) {
  console.log('loadMaterialSelectOptions: Starting to load material select options', { userId });
  const materialSelect = document.getElementById('materialSelect');
  if (!materialSelect) {
    console.error('loadMaterialSelectOptions: Element materialSelect not found in DOM', { userId });
    showNotification('Ошибка: Элемент materialSelect не найден', true);
    throw new Error('Элемент materialSelect не найден');
  }

  materialSelect.innerHTML = '<option value="">Выберите материал</option>';

  try {
    const response = await getMaterials(null, 0, ITEMS_PER_PAGE, authToken, userId);
    if (!response.success) {
      throw new Error(response.error || 'Не удалось загрузить материалы');
    }

    const materials = response.materials || [];
    console.log('loadMaterialSelectOptions: Loaded materials:', materials);

    if (!materials.length) {
      console.warn('loadMaterialSelectOptions: No materials available to populate select', { userId });
      showNotification('Материалы отсутствуют. Добавьте материалы в "Управление материалами".', true);

      // Логируем отсутствие материалов
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'material_select_load_failed', {
          reason: 'no_materials',
          page_title: 'Balcony Calculator - Manage Materials',
          user_id: userId
        });
      }
      return;
    }

    materials.sort((a, b) => a.name.localeCompare(b.name));

    materials.forEach(material => {
      const materialId = material.id;
      const name = material.name || 'Без названия';
      const categories = Array.isArray(material.categories) ? material.categories : [];

      const value = `${materialId}:${categories.join(',')}:${name}`;
      const option = document.createElement('option');
      option.value = value;
      option.textContent = `${name} (${categories.join(', ') || 'Без категории'})`;
      materialSelect.appendChild(option);
      console.log(`loadMaterialSelectOptions: Added material to materialSelect: ${value}`, { userId });
    });

    console.log('loadMaterialSelectOptions: Material select options successfully rendered', { userId });

    // Логируем успешную загрузку списка материалов
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'material_select_loaded', {
        materials_count: materials.length,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }
  } catch (error) {
    console.error('loadMaterialSelectOptions: Error loading materials:', {
      message: error.message,
      stack: error.stack,
      userId
    });
    showNotification('Ошибка при загрузке списка материалов: ' + error.message, true);

    // Логируем ошибку загрузки списка материалов
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'material_select_load_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }

    throw error;
  }
}

/**
 * Вспомогательная функция для получения данных материала из формы.
 * @returns {Object} Данные материала.
 * @throws {Error} Если обязательные поля отсутствуют.
 */
function getMaterialDataFromForm() {
  const nameInput = document.getElementById('newMaterialInput');
  const priceInput = document.getElementById('priceInput');
  const unitSelect = document.getElementById('unitSelect');
  const dimensionsInput = document.getElementById('dimensionsInput');
  const colorInput = document.getElementById('colorInput');
  const quantityInput = document.getElementById('quantityInput');
  const isHiddenInput = document.getElementById('isHiddenInput');

  if (!nameInput || !priceInput || !unitSelect || !dimensionsInput || !colorInput || !quantityInput || !isHiddenInput) {
    console.error('getMaterialDataFromForm: One or more required fields not found in DOM', { userId });
    throw new Error('Не удалось найти обязательные поля формы');
  }

  const name = nameInput.value?.trim();
  const price = parseFloat(priceInput.value);
  const unit = unitSelect.value?.trim();

  // Проверка обязательных полей
  if (!name || isNaN(price) || price < 0 || !unit) {
    const missingFields = [];
    if (!name) missingFields.push('название');
    if (isNaN(price) || price < 0) missingFields.push('цена');
    if (!unit) missingFields.push('единица измерения');
    console.error('getMaterialDataFromForm: Required fields missing:', missingFields, { userId });
    throw new Error(`Пожалуйста, заполните обязательные поля: ${missingFields.join(', ')}.`);
  }

  // Получаем категории
  const categories = Array.from(document.querySelectorAll('input[name="category"]:checked')).map(input => input.value);
  if (!categories || categories.length === 0) {
    console.error('getMaterialDataFromForm: No categories selected', { userId });
    throw new Error('Пожалуйста, выберите хотя бы одну категорию для материала.');
  }

  // Парсим размеры в объект { length, width, height }
  let dimensions = null; // По умолчанию dimensions не отправляем
  if (dimensionsInput.value) {
    const dimensionsArray = dimensionsInput.value.split('x').map(val => parseFloat(val) || 0);
    const length = dimensionsArray[0] || 0;
    const width = dimensionsArray[1] || 0;
    const height = dimensionsArray[2] || 0;

    // Проверяем, что хотя бы одно измерение указано и оно положительное
    if (length > 0 || width > 0 || height > 0) {
      if (length <= 0 || width <= 0) {
        throw new Error('Длина и ширина должны быть положительными числами');
      }
      dimensions = {
        length,
        width,
        height: height >= 0 ? height : 0, // height может быть 0
      };
    }
  }

  return {
    name,
    categories,
    color: colorInput.value || '',
    dimensions, // dimensions будет null, если поле пустое
    price,
    quantity: parseInt(quantityInput.value) || 0,
    unit,
    isHidden: isHiddenInput.checked || false,
  };
}

/**
 * Добавляет новый материал.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} validateForm - Функция для валидации формы.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @returns {Promise<void>}
 */
async function addMaterialWrapper(showNotification, validateForm, authToken) {
  console.log('addMaterialWrapper: Starting to add material', { userId });
  try {
    if (!validateForm(false)) { // Передаём isCalculation: false
      showNotification('Пожалуйста, исправьте ошибки в форме', true);
      console.warn('addMaterialWrapper: Form validation failed', { userId });

      // Логируем ошибку валидации
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'material_add_failed', {
          reason: 'form_validation',
          page_title: 'Balcony Calculator - Manage Materials',
          user_id: userId
        });
      }
      return;
    }

    const materialData = getMaterialDataFromForm();
    console.log('addMaterialWrapper: Material data to add:', materialData);

    // Дополнительная клиентская валидация размеров
    if (materialData.dimensions) {
      const { length, width, height } = materialData.dimensions;
      if (length <= 0 || width <= 0) {
        showNotification('Длина и ширина должны быть положительными числами', true);
        return;
      }
      if (height < 0) {
        showNotification('Высота не может быть отрицательной', true);
        return;
      }
    }

    const result = await addMaterial(materialData, authToken, userId);
    if (!result.success) {
      throw new Error(result.error || 'Не удалось добавить материал');
    }

    showNotification('Материал успешно добавлен', false);

    // Очищаем форму
    const nameInput = document.getElementById('newMaterialInput');
    const priceInput = document.getElementById('priceInput');
    const unitSelect = document.getElementById('unitSelect');
    const dimensionsInput = document.getElementById('dimensionsInput');
    const colorInput = document.getElementById('colorInput');
    const quantityInput = document.getElementById('quantityInput');
    const isHiddenInput = document.getElementById('isHiddenInput');

    nameInput.value = '';
    priceInput.value = '';
    unitSelect.value = 'шт.';
    dimensionsInput.value = '';
    colorInput.value = '';
    quantityInput.value = '';
    isHiddenInput.checked = false;
    document.querySelectorAll('input[name="category"]').forEach(input => (input.checked = false));
    updateSelectedCategoriesCount();

    // Логируем успешное добавление материала
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'material_added', {
        material_name: materialData.name,
        categories_count: materialData.categories.length,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }
  } catch (error) {
    console.error('addMaterialWrapper: Error adding material:', {
      message: error.message,
      stack: error.stack,
      userId
    });
    showNotification(`Ошибка добавления материала: ${error.message}`, true);

    // Логируем ошибку добавления материала
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'material_add_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }
  }
}

/**
 * Редактирует существующий материал.
 * @param {string} materialId - ID материала для редактирования.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} validateForm - Функция для валидации формы.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @returns {Promise<void>}
 */
async function editMaterialWrapper(materialId, showNotification, validateForm, authToken) {
  console.log('editMaterialWrapper: Starting to edit material', { materialId, userId });
  try {
    // Проверяем корректность materialId
    if (!materialId || typeof materialId !== 'string' || materialId.trim() === '') {
      console.error('editMaterialWrapper: Invalid materialId', { materialId, userId });
      showNotification('Ошибка: Неверный ID материала. Пожалуйста, выберите материал из списка.', true);
      return;
    }

    if (!validateForm(false)) { // Передаём isCalculation: false
      showNotification('Пожалуйста, исправьте ошибки в форме', true);
      console.warn('editMaterialWrapper: Form validation failed', { userId });

      // Логируем ошибку валидации
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'material_update_failed', {
          reason: 'form_validation',
          page_title: 'Balcony Calculator - Manage Materials',
          user_id: userId
        });
      }
      return;
    }

    const materialData = getMaterialDataFromForm();
    console.log('editMaterialWrapper: Material data to update:', materialData);

    // Дополнительная клиентская валидация размеров
    if (materialData.dimensions) {
      const { length, width, height } = materialData.dimensions;
      if (length <= 0 || width <= 0) {
        showNotification('Длина и ширина должны быть положительными числами', true);
        return;
      }
      if (height < 0) {
        showNotification('Высота не может быть отрицательной', true);
        return;
      }
    }

    const result = await updateMaterial(materialId, materialData, authToken, userId);
    if (!result.success) {
      throw new Error(result.error || 'Не удалось обновить материал');
    }

    showNotification('Материал успешно отредактирован', false);

    // Логируем успешное редактирование материала
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'material_updated', {
        material_id: materialId,
        material_name: materialData.name,
        categories_count: materialData.categories.length,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }
  } catch (error) {
    console.error('editMaterialWrapper: Error updating material:', {
      message: error.message,
      stack: error.stack,
      materialId,
      userId
    });
    showNotification(`Ошибка редактирования материала: ${error.message}`, true);

    // Логируем ошибку редактирования материала
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'material_update_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }
  }
}

/**
 * Удаляет материал.
 * @param {string} materialId - ID материала для удаления.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} loadMaterialsTable - Функция для загрузки таблицы материалов.
 * @param {Function} populateSelects - Функция для заполнения выпадающих списков.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @returns {Promise<void>}
 */
async function deleteMaterialWrapper(materialId, showNotification, loadMaterialsTable, populateSelects, authToken) {
  console.log('deleteMaterialWrapper: Starting to delete material', { materialId, userId });
  try {
    if (!confirm(`Вы уверены, что хотите удалить материал с ID "${materialId}"?`)) {
      console.log('deleteMaterialWrapper: Deletion cancelled by user', { userId });
      return;
    }

    const result = await deleteMaterial(materialId, authToken, userId);
    if (!result.success) {
      throw new Error(result.error || 'Не удалось удалить материал');
    }

    showNotification('Материал успешно удалён', false);
    await loadMaterialsTable(currentPage, showNotification, authToken, userId);
    await populateSelects(showNotification, authToken, userId);
    await loadMaterialSelectOptions(showNotification, authToken);

    // Логируем успешное удаление материала
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'material_deleted', {
        material_id: materialId,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }
  } catch (error) {
    console.error('deleteMaterialWrapper: Error deleting material:', {
      message: error.message,
      stack: error.stack,
      userId
    });
    showNotification(`Ошибка удаления материала: ${error.message}`, true);

    // Логируем ошибку удаления материала
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'material_delete_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator - Manage Materials',
        user_id: userId
      });
    }
  }
}

/**
 * Инициализирует действия с материалами (добавление, редактирование, удаление).
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} validateForm - Функция для валидации формы.
 * @param {Function} loadMaterialsTable - Функция для загрузки таблицы материалов.
 * @param {Function} populateSelects - Функция для заполнения выпадающих списков.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {string} userIdParam - ID пользователя (для логирования).
 * @returns {Promise<void>}
 */
async function initializeMaterialActions(showNotification, validateForm, loadMaterialsTable, populateSelects, authToken, userIdParam) {
  console.log('initializeMaterialActions: Starting initialization', { userId: userIdParam });

  // Устанавливаем userId для использования во всех функциях
  userId = userIdParam || 'unknown';

  // Проверяем наличие всех необходимных функций
  const requiredFunctions = { showNotification, validateForm, loadMaterialsTable, populateSelects };
  for (const [funcName, func] of Object.entries(requiredFunctions)) {
    if (typeof func !== 'function') {
      console.error(`initializeMaterialActions: ${funcName} is not a function`, { userId });
      showNotification(`Ошибка: ${funcName} не является функцией`, true);
      throw new Error(`${funcName} не является функцией`);
    }
  }

  if (!authToken || typeof authToken !== 'string') {
    console.error('initializeMaterialActions: authToken is missing or invalid', { userId });
    showNotification('Ошибка: Токен аутентификации отсутствует или недействителен', true);
    throw new Error('Токен аутентификации отсутствует или недействителен');
  }

  // Загружаем категории
  await loadCategories(showNotification, authToken);

  const editBtn = document.getElementById('editSelectedMaterialBtn');
  const deleteBtn = document.getElementById('deleteSelectedMaterialBtn');
  const addBtn = document.getElementById('addMaterialBtn');

  if (!editBtn || !deleteBtn || !addBtn) {
    console.error('initializeMaterialActions: One or more buttons (editSelectedMaterialBtn, deleteSelectedMaterialBtn, addMaterialBtn) not found in DOM', { userId });
    showNotification('Ошибка: Кнопки управления материалами не найдены', true);
    throw new Error('Кнопки управления материалами не найдены');
  }

  // Очищаем старые обработчики, если они есть
  const newEditBtn = editBtn.cloneNode(true);
  const newDeleteBtn = deleteBtn.cloneNode(true);
  const newAddBtn = addBtn.cloneNode(true);
  editBtn.replaceWith(newEditBtn);
  deleteBtn.replaceWith(newDeleteBtn);
  addBtn.replaceWith(newAddBtn);

  newEditBtn.addEventListener('click', async () => {
    const materialSelect = document.getElementById('materialSelect');
    if (!materialSelect) {
      console.error('editMaterialWrapper: Element materialSelect not found in DOM', { userId });
      showNotification('Ошибка: Элемент materialSelect не найден', true);
      return;
    }
    const selectedValue = materialSelect.value;
    if (!selectedValue || selectedValue.trim() === '') {
      showNotification('Пожалуйста, выберите материал для редактирования', true);
      console.warn('editMaterialWrapper: No material selected', { selectedValue, userId });
      return;
    }

    const [materialId] = selectedValue.split(':');
    await editMaterialWrapper(materialId, showNotification, validateForm, authToken);
    await loadMaterialsTable(currentPage, showNotification, authToken, userId);
    await populateSelects(showNotification, authToken, userId);
    await loadMaterialSelectOptions(showNotification, authToken);
  });

  newDeleteBtn.addEventListener('click', async () => {
    const materialSelect = document.getElementById('materialSelect');
    if (!materialSelect) {
      console.error('deleteMaterialWrapper: Element materialSelect not found in DOM', { userId });
      showNotification('Ошибка: Элемент materialSelect не найден', true);
      return;
    }
    const selectedValue = materialSelect.value;
    if (!selectedValue || selectedValue.trim() === '') {
      showNotification('Пожалуйста, выберите материал для удаления', true);
      console.warn('deleteMaterialWrapper: No material selected', { selectedValue, userId });
      return;
    }

    const materialId = selectedValue.split(':')[0];
    await deleteMaterialWrapper(materialId, showNotification, loadMaterialsTable, populateSelects, authToken);
  });

  newAddBtn.addEventListener('click', async () => {
    await addMaterialWrapper(showNotification, validateForm, authToken);
    await loadMaterialsTable(currentPage, showNotification, authToken, userId);
    await populateSelects(showNotification, authToken, userId);
    await loadMaterialSelectOptions(showNotification, authToken);
  });

  document.querySelectorAll('.add-button').forEach(button => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab-id') || 'tab1';
      const row = document.querySelector(`.extra-material-row[data-tab-id="${tabId}"]`);
      if (!row) {
        console.error(`initializeMaterialActions: Element .extra-material-row for tabId ${tabId} not found in DOM`, { userId });
        showNotification('Ошибка: Элемент для добавления материалов не найден', true);
        return;
      }
      const newRow = row.cloneNode(true);
      newRow.querySelectorAll('select, input, button').forEach(element => {
        const newId = element.id ? `${element.id}_${Date.now()}` : null;
        if (newId) element.id = newId;
        element.value = '';
      });
      row.parentNode.insertBefore(newRow, row.nextSibling);
      console.log(`initializeMaterialActions: Added new row for extra materials in tabId ${tabId}`, { userId });
    });
  });

  await loadMaterialsTable(currentPage, showNotification, authToken, userId);
  await loadMaterialSelectOptions(showNotification, authToken);
  console.log('initializeMaterialActions: Initialization completed', { userId });
}

// Экспортируем функции
export { populateSelects, loadCategories, loadWindowVariants, initializeMaterialActions, loadMaterialsTable };