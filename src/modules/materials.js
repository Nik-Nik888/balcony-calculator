import { analytics, logEvent, db } from "./firebase.js";
import {
  getMaterials,
  getCategories,
  addMaterial,
  updateMaterial,
  deleteMaterial,
} from "./api.js";
import { isValidCategory } from "./categories.js";

// Переменные для пагинации
let currentPage = 1;
const ITEMS_PER_PAGE = 10;

// Хранилище userId (будет установлено в initializeMaterialActions)
let userId = null;

/**
 * Логирует ошибки в Firestore для аналитики.
 * @param {string} action - Действие (например, loadCategories, addMaterial).
 * @param {string} userId - ID пользователя.
 * @param {Error} error - Объект ошибки.
 * @param {Object} [extra] - Дополнительные данные для лога.
 * @returns {Promise<void>}
 */
async function logErrorToFirestore(action, userId, error, extra = {}) {
  try {
    await db.collection("analytics").add({
      event: `${action}_failed`,
      userId: userId || "unknown",
      page_title: "Balcony Calculator",
      message: error.message,
      timestamp: new Date().toISOString(),
      ...extra,
    });
  } catch (logError) {
    await logEvent(analytics, "firestore_log_failed", {
      action,
      message: logError.message,
      userId: userId || "unknown",
      page_title: "Balcony Calculator",
    });
  }
}

/**
 * Загружает категории через manageMaterials и отображает их в виде дерева.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} authToken - Токен аутентификации.
 * @returns {Promise<void>}
 * @throws {Error} Если загрузка категорий не удалась.
 */
async function loadCategories(showNotification, authToken) {
  logEvent(analytics, "categories_load_initiated", {
    page_title: "Balcony Calculator - Manage Materials",
    user_id: userId || "unknown",
  });

  try {
    const container = document.getElementById("categoriesContainer");
    if (!container) {
      throw new Error("Контейнер категорий не найден");
    }

    container.innerHTML = "<div>Загрузка категорий...</div>";

    let page = 0;
    const itemsPerPage = 200;
    let allCategories = [];
    let hasMore = true;

    while (hasMore) {
      const result = await getCategories(page, itemsPerPage, authToken, userId);
      if (!result.success) {
        throw new Error(result.error || "Не удалось загрузить категории");
      }

      const categories = result.categories || [];
      allCategories = allCategories.concat(categories);
      hasMore = categories.length === itemsPerPage;
      page++;
    }

    allCategories.sort();
    if (allCategories.length === 0) {
      container.innerHTML = "<div>Категории отсутствуют.</div>";
      showNotification(
        'Категории отсутствуют. Добавьте материалы в "Управление материалами".',
        true,
      );
      logEvent(analytics, "categories_load_failed", {
        reason: "no_categories",
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
      });
      return;
    }

    renderCategories(allCategories, container);
    initializeCategoryControls(allCategories, container);

    logEvent(analytics, "categories_loaded", {
      categories_count: allCategories.length,
      page_title: "Balcony Calculator - Manage Materials",
      user_id: userId || "unknown",
    });
  } catch (error) {
    showNotification(`Ошибка при загрузке категорий: ${error.message}`, true);
    const container = document.getElementById("categoriesContainer");
    if (container) {
      container.innerHTML = "<div>Ошибка загрузки категорий.</div>";
    }
    await logErrorToFirestore("loadCategories", userId, error);
    throw error;
  }
}

/**
 * Рендерит категории в виде дерева.
 * @param {Array<string>} categories - Список категорий.
 * @param {HTMLElement} container - Контейнер для рендеринга.
 */
function renderCategories(categories, container) {
  container.innerHTML = "";

  const categoryTree = buildCategoryTree(categories);
  renderCategoryTree(categoryTree, container, 0);
  updateSelectedCategoriesCount();
}

/**
 * Строит дерево категорий для рендеринга.
 * @param {Array<string>} categories - Массив категорий.
 * @returns {Object} Дерево категорий.
 */
function buildCategoryTree(categories) {
  const tree = {};
  categories.forEach((category) => {
    const parts = category.split(":");
    let currentLevel = tree;

    parts.forEach((part, index) => {
      const path = parts.slice(0, index + 1).join(":");
      if (!currentLevel[part]) {
        currentLevel[part] = { path, children: {} };
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
  Object.entries(tree).forEach(([name, node]) => {
    const details = document.createElement("details");
    details.className = "category-item";
    details.style.paddingLeft = `${level * 15}px`;

    const summary = document.createElement("summary");
    summary.className = "category-summary";

    const span = document.createElement("span");
    span.textContent = name;
    summary.appendChild(span);

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "category";
    checkbox.value = node.path;
    checkbox.addEventListener("change", updateSelectedCategoriesCount);
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
  const selectedCount = document.querySelectorAll(
    'input[name="category"]:checked',
  ).length;
  const countElement = document.getElementById("selectedCategoriesCount");
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
  const searchInput = document.getElementById("categorySearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const searchText = searchInput.value.toLowerCase();
      const filteredCategories = allCategories.filter((category) =>
        category.toLowerCase().includes(searchText),
      );
      renderCategories(filteredCategories, container);
    });
  }

  const tabFilterSelect = document.getElementById("categoryFilterTabSelect");
  if (tabFilterSelect) {
    tabFilterSelect.addEventListener("change", () => {
      const selectedTab = tabFilterSelect.value;
      let filteredCategories = allCategories;
      if (selectedTab) {
        filteredCategories = allCategories.filter((category) =>
          category.startsWith(selectedTab),
        );
      }
      const searchText = searchInput ? searchInput.value.toLowerCase() : "";
      if (searchText) {
        filteredCategories = filteredCategories.filter((category) =>
          category.toLowerCase().includes(searchText),
        );
      }
      renderCategories(filteredCategories, container);
    });
  }

  const toggleAllBtn = document.getElementById("toggleAllCategoriesBtn");
  let allExpanded = false;
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener("click", () => {
      allExpanded = !allExpanded;
      const detailsElements = container.querySelectorAll("details");
      detailsElements.forEach((details) => {
        details.open = allExpanded;
      });
      toggleAllBtn.textContent = allExpanded
        ? "Свернуть все"
        : "Развернуть все";
    });
  }

  const clearBtn = document.getElementById("clearCategoriesBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const checkboxes = container.querySelectorAll('input[name="category"]');
      checkboxes.forEach((checkbox) => {
        checkbox.checked = false;
      });
      updateSelectedCategoriesCount();
    });
  }
}

/**
 * Загружает варианты окон через manageMaterials (для вкладки "Остекление").
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} authToken - Токен аутентификации.
 * @returns {Promise<Array>} Список вариантов окон.
 * @throws {Error} Если загрузка вариантов окон не удалась.
 */
async function loadWindowVariants(showNotification, authToken) {
  logEvent(analytics, "window_variants_load_initiated", {
    page_title: "Balcony Calculator - Glazing Tab",
    user_id: userId || "unknown",
  });

  try {
    const select = document.getElementById("windowTypeSelectTab2");
    if (!select) {
      throw new Error("Элемент windowTypeSelectTab2 не найден");
    }

    const response = await getMaterials(
      "Остекление:Окно",
      0,
      100,
      authToken,
      userId,
    );
    if (!response.success) {
      throw new Error(response.error || "Не удалось загрузить варианты окон");
    }

    select.innerHTML = '<option value="">Выберите вариант окна</option>';

    if (!response.materials || response.materials.length === 0) {
      showNotification(
        'Варианты окон отсутствуют. Добавьте материалы с категорией "Остекление:Окно" в "Управление материалами".',
        true,
      );
      logEvent(analytics, "window_variants_load_failed", {
        reason: "no_materials",
        page_title: "Balcony Calculator - Glazing Tab",
        user_id: userId || "unknown",
      });
      return [];
    }

    const validVariants = [
      "Балкон 3м.",
      "Балкон 6м.",
      "Лоджия 3м.",
      "Лоджия 6м.",
      "Окно 1.5м. кирпич",
    ];
    const windowVariants = [];
    response.materials.forEach((material) => {
      if (!material.isHidden && validVariants.includes(material.name)) {
        const option = document.createElement("option");
        option.value = material.name;
        option.textContent = material.name;
        select.appendChild(option);
        windowVariants.push({ id: material.id, name: material.name });
      }
    });

    if (select.options.length === 1) {
      showNotification(
        'Допустимые варианты окон отсутствуют. Проверьте материалы в "Управление материалами".',
        true,
      );
      logEvent(analytics, "window_variants_load_failed", {
        reason: "no_valid_variants",
        page_title: "Balcony Calculator - Glazing Tab",
        user_id: userId || "unknown",
      });
      return windowVariants;
    }

    logEvent(analytics, "window_variants_loaded", {
      variants_count: windowVariants.length,
      page_title: "Balcony Calculator - Glazing Tab",
      user_id: userId || "unknown",
    });
    return windowVariants;
  } catch (error) {
    showNotification(
      `Ошибка при загрузке вариантов окон: ${error.message}`,
      true,
    );
    await logErrorToFirestore("loadWindowVariants", userId, error);
    return [];
  }
}

/**
 * Заполняет выпадающие списки материалами через manageMaterials.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<void>}
 * @throws {Error} Если загрузка материалов или категорий не удалась.
 */
async function populateSelects(showNotification, authToken, userId) {
  logEvent(analytics, "selects_populate_initiated", {
    page_title: "Balcony Calculator",
    user_id: userId || "unknown",
  });

  try {
    let page = 0;
    const itemsPerPage = 50;
    let allCategories = [];
    let hasMore = true;

    while (hasMore) {
      const categoriesResponse = await getCategories(
        page,
        itemsPerPage,
        authToken,
        userId,
      );
      if (!categoriesResponse.success) {
        throw new Error("Не удалось загрузить категории");
      }
      const categories = categoriesResponse.categories || [];
      allCategories = allCategories.concat(categories);
      hasMore = categories.length === itemsPerPage;
      page++;
    }

    const categoryClassMap = {};
    allCategories.forEach((category) => {
      const parts = category.split(":");
      const subCategory = parts.slice(1).join(":");
      if (subCategory === "Список на заезд")
        categoryClassMap[category] = "arrival-list";
      if (subCategory === "Крепеж") categoryClassMap[category] = "fasteners";
      if (subCategory === "Плиточные работы")
        categoryClassMap[category] = "tile-work";
      if (subCategory === "Доп. параметр")
        categoryClassMap[category] = "extra-material";
      if (subCategory === "Что делаем")
        categoryClassMap[category] = "glazing-type";
      if (subCategory === "Основная рама")
        categoryClassMap[category] = "frame-type";
      if (subCategory === "Наружная отделка")
        categoryClassMap[category] = "exterior-finish";
      if (subCategory === "Замена балконного блока")
        categoryClassMap[category] = "balcony-block";
      if (subCategory === "Окно") categoryClassMap[category] = "window-type";
      if (subCategory.includes("Скрытые"))
        categoryClassMap[category] = "hidden-material";
      if (subCategory === "Откосы для окон")
        categoryClassMap[category] = "window-slopes";
      if (subCategory === "Подоконники")
        categoryClassMap[category] = "sill-type";
      if (subCategory === "Крыша") categoryClassMap[category] = "roof-type";
      if (subCategory === "Вид отделки")
        categoryClassMap[category] = "finish-type";
      if (subCategory === "Покраска стен")
        categoryClassMap[category] = "wall-painting";
      if (subCategory === "Покраска потолка")
        categoryClassMap[category] = "ceiling-painting";
      if (subCategory === "Вид утепления")
        categoryClassMap[category] = "insulation-type";
      if (subCategory === "Направление отделки")
        categoryClassMap[category] = "finish-direction";
      if (subCategory === "Кабель") categoryClassMap[category] = "cable-type";
      if (subCategory === "Выключатель")
        categoryClassMap[category] = "switch-type";
      if (subCategory === "Розетка") categoryClassMap[category] = "socket-type";
      if (subCategory === "Спот") categoryClassMap[category] = "spot-type";
      if (subCategory === "Название мебели")
        categoryClassMap[category] = "furniture-name";
      if (subCategory === "Материал мебели")
        categoryClassMap[category] = "furniture-material";
      if (subCategory === "Покраска мебели")
        categoryClassMap[category] = "furniture-painting";
      if (subCategory === "Полки Верх")
        categoryClassMap[category] = "shelf-top-material";
      if (subCategory === "Полки Низ")
        categoryClassMap[category] = "shelf-bottom-material";
      if (subCategory === "Бок у печки")
        categoryClassMap[category] = "stove-side";
      if (subCategory === "Столешница")
        categoryClassMap[category] = "countertop";
    });

    const materialsResponse = await getMaterials(
      null,
      0,
      100,
      authToken,
      userId,
    );
    if (!materialsResponse.success) {
      throw new Error("Не удалось загрузить материалы");
    }
    const materials = materialsResponse.materials;

    if (!materials || materials.length === 0) {
      showNotification(
        'Материалы отсутствуют. Добавьте материалы в "Управление материалами".',
        true,
      );
      logEvent(analytics, "selects_populate_failed", {
        reason: "no_materials",
        page_title: "Balcony Calculator",
        user_id: userId || "unknown",
      });
      return;
    }

    const tabs = [
      "tab1",
      "tab2",
      "tab3",
      "tab4",
      "tab5",
      "tab6",
      "tab7",
      "tab7",
      "tab8",
      "tab9",
      "tab10",
      "tab11",
    ];
    tabs.forEach((tabId) => {
      const extraSelects = document.querySelectorAll(
        `#${tabId} select.extra-material`,
      );
      extraSelects.forEach((select) => {
        populateSelectElement(
          select,
          "Доп. параметр:Доп. параметр",
          materials,
          showNotification,
        );
      });
    });

    allCategories.forEach((category) => {
      const parts = category.split(":");
      const tabName = parts[0];
      const tabId = getTabId(tabName);
      if (!tabId) {
        logEvent(analytics, "selects_populate_warning", {
          reason: `No tab ID mapped for tab "${tabName}"`,
          category,
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
        return;
      }

      const className = categoryClassMap[category];
      if (!className) {
        logEvent(analytics, "selects_populate_warning", {
          reason: `No class mapped for category "${category}"`,
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
        return;
      }

      const selectElement = document.querySelector(
        `#${tabId} select.${className}`,
      );
      if (!selectElement) {
        logEvent(analytics, "selects_populate_warning", {
          reason: `No <select> found with class "${className}" for category "${category}"`,
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
        return;
      }

      populateSelectElement(
        selectElement,
        category,
        materials,
        showNotification,
      );
    });

    const toggles = [
      { id: "entryListToggle", class: "arrival-list" },
      { id: "entryFastenersToggle", class: "fasteners" },
      { id: "entryTilingToggle", class: "tile-work" },
    ];
    toggles.forEach(({ id, class: className }) => {
      const toggle = document.querySelector(`#tab1 #${id}.${className}`);
      if (toggle) {
        toggle.innerHTML = `
          <option value="no">НЕТ</option>
          <option value="yes">ДА</option>
        `;
      }
    });

    await loadWindowVariants(showNotification, authToken);

    logEvent(analytics, "selects_populated", {
      materials_count: materials.length,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  } catch (error) {
    showNotification(
      `Ошибка при заполнении выпадающих списков: ${error.message}`,
      true,
    );
    await logErrorToFirestore("populateSelects", userId, error);
    throw error;
  }
}

/**
 * Возвращает ID вкладки на основе имени.
 * @param {string} tabName - Имя вкладки.
 * @returns {string|null} ID вкладки или null, если вкладка не найдена.
 */
function getTabId(tabName) {
  const tabMap = {
    "На заезд": "tab1",
    Остекление: "tab2",
    "Главная стена": "tab3",
    "Фасадная стена": "tab4",
    "БЛ стена": "tab5",
    "БП стена": "tab6",
    Потолок: "tab7",
    Полы: "tab8",
    Электрика: "tab9",
    Мебель: "tab10",
    "Доп. параметр": "tab11",
  };
  return tabMap[tabName] || null;
}

/**
 * Заполняет выпадающий список материалами.
 * @param {HTMLElement} selectElement - Элемент <select>.
 * @param {string} category - Категория материалов.
 * @param {Array} materials - Список материалов.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 */
function populateSelectElement(
  selectElement,
  category,
  materials,
  showNotification,
) {
  const relevantMaterials = materials.filter((material) => {
    if (!Array.isArray(material.categories)) {
      logEvent(analytics, "selects_populate_warning", {
        reason: "Material has invalid categories format",
        material_id: material.id,
        material_name: material.name,
        page_title: "Balcony Calculator",
        user_id: userId || "unknown",
      });
      return false;
    }
    return material.categories.includes(category) && !material.isHidden;
  });

  if (relevantMaterials.length === 0) {
    showNotification(
      `Нет доступных материалов для категории "${category}". Добавьте материалы в "Управление материалами".`,
      true,
    );
    selectElement.innerHTML =
      '<option value="">Нет доступных материалов</option>';
    logEvent(analytics, "selects_populate_warning", {
      reason: `No available materials for category "${category}"`,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
    return;
  }

  const options = relevantMaterials.map((material) => {
    const dimensionsDisplay =
      material.dimensions && typeof material.dimensions === "object"
        ? ` (${material.dimensions.length}x${material.dimensions.width}${material.dimensions.height ? `x${material.dimensions.height}` : ""})`
        : "";
    const displayText = `${material.name}${material.color ? ` ${material.color}` : ""}${dimensionsDisplay}`;
    return `<option value="${material.id}:${category}:${material.name}">${displayText}</option>`;
  });

  selectElement.innerHTML = `<option value="">Выберите материал</option>${options.join("")}`;
}

/**
 * Загружает материалы через manageMaterials (для вкладки "Управление материалами").
 * @param {number} page - Номер страницы для пагинации.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<void>}
 * @throws {Error} Если загрузка материалов не удалась.
 */
async function loadMaterialsTable(
  page = 1,
  showNotification,
  authToken,
  userId,
) {
  logEvent(analytics, "materials_table_load_initiated", {
    page,
    page_title: "Balcony Calculator - Manage Materials",
    user_id: userId || "unknown",
  });

  try {
    const container = document.getElementById("materialList");
    if (!container) {
      throw new Error("Элемент materialList не найден");
    }

    container.innerHTML = "<p>Загрузка...</p>";
    currentPage = page;

    const response = await getMaterials(
      null,
      page - 1,
      ITEMS_PER_PAGE,
      authToken,
      userId,
    );
    if (!response.success) {
      throw new Error(response.error || "Не удалось загрузить материалы");
    }

    const materials = response.materials || [];
    if (!materials.length) {
      container.innerHTML = "<p>Материалы отсутствуют.</p>";
      showNotification(
        'Материалы отсутствуют. Добавьте материалы в "Управление материалами".',
        true,
      );
      logEvent(analytics, "materials_table_load_failed", {
        reason: "no_materials",
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
      });
      return;
    }

    const tbody = document.createElement("tbody");
    materials.forEach((material) => {
      const dimensionsStr =
        material.dimensions && typeof material.dimensions === "object"
          ? `${material.dimensions.length}x${material.dimensions.width}${material.dimensions.height ? `x${material.dimensions.height}` : ""}`
          : "N/A";
      const categories = Array.isArray(material.categories)
        ? material.categories
        : [];
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${material.name}</td>
        <td>${material.color || "Не указан"}</td>
        <td>${dimensionsStr}</td>
        <td>${material.price}</td>
        <td>${material.quantity}</td>
        <td>${material.unit}</td>
        <td>${material.isHidden ? "Да" : "Нет"}</td>
        <td>${categories.join(", ") || "Без категории"}</td>
        <td>
          <button class="edit-btn" data-id="${material.id}">Редактировать</button>
          <button class="delete-btn" data-id="${material.id}">Удалить</button>
        </td>
      `;
      row.setAttribute(
        "data-id",
        `${material.id}:${categories.join(",")}:${material.name}`,
      );
      tbody.appendChild(row);
    });

    const table = document.createElement("table");
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

    const tableWrapper = document.createElement("div");
    tableWrapper.className = "table-wrapper";
    tableWrapper.appendChild(table);

    const mobileList = document.createElement("div");
    mobileList.className = "material-list-mobile";
    materials.forEach((material) => {
      const dimensionsStr =
        material.dimensions && typeof material.dimensions === "object"
          ? `${material.dimensions.length}x${material.dimensions.width}${material.dimensions.height ? `x${material.dimensions.height}` : ""}`
          : "N/A";
      const categories = Array.isArray(material.categories)
        ? material.categories
        : [];
      const item = document.createElement("details");
      item.className = "material-item";
      item.setAttribute(
        "data-id",
        `${material.id}:${categories.join(",")}:${material.name}`,
      );
      item.innerHTML = `
        <summary>${material.name}</summary>
        <div>
          <p><strong>Цвет:</strong> ${material.color || "Не указан"}</p>
          <p><strong>Размеры:</strong> ${dimensionsStr}</p>
          <p><strong>Цена:</strong> ${material.price}</p>
          <p><strong>Количество:</strong> ${material.quantity}</p>
          <p><strong>Ед. изм.:</strong> ${material.unit}</p>
          <p><strong>Скрытый:</strong> ${material.isHidden ? "Да" : "Нет"}</p>
          <p><strong>Категории:</strong> ${categories.join(", ") || "Без категории"}</p>
          <button class="edit-btn" data-id="${material.id}">Редактировать</button>
          <button class="delete-btn" data-id="${material.id}">Удалить</button>
        </div>
      `;
      mobileList.appendChild(item);
    });

    container.innerHTML = "";
    container.appendChild(tableWrapper);
    container.appendChild(mobileList);

    const prevBtn = document.getElementById("prevPageBtn");
    const nextBtn = document.getElementById("nextPageBtn");
    if (!prevBtn || !nextBtn) {
      throw new Error("Кнопки пагинации не найдены");
    }
    prevBtn.disabled = page === 1;
    nextBtn.disabled = materials.length < ITEMS_PER_PAGE;

    prevBtn.onclick = () =>
      page > 1 &&
      loadMaterialsTable(page - 1, showNotification, authToken, userId);
    nextBtn.onclick = () =>
      loadMaterialsTable(page + 1, showNotification, authToken, userId);

    document.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const materialId = btn.dataset.id;
        const material = materials.find((m) => m.id === materialId);
        if (material) {
          document.getElementById("newMaterialInput").value = material.name;
          document.getElementById("colorInput").value = material.color || "";
          const dimensionsStr =
            material.dimensions && typeof material.dimensions === "object"
              ? `${material.dimensions.length}x${material.dimensions.width}${material.dimensions.height ? `x${material.dimensions.height}` : ""}`
              : "";
          document.getElementById("dimensionsInput").value = dimensionsStr;
          document.getElementById("priceInput").value = material.price;
          document.getElementById("quantityInput").value = material.quantity;
          document.getElementById("unitSelect").value = material.unit;
          document.getElementById("isHiddenInput").checked = material.isHidden;
          document
            .querySelectorAll("#categoriesContainer input")
            .forEach((input) => {
              input.checked = material.categories.includes(input.value);
            });
          document.getElementById("materialSelect").value =
            `${material.id}:${material.categories.join(",")}:${material.name}`;
        }
      });
    });

    document.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const materialId = btn.dataset.id;
        await deleteMaterialWrapper(
          materialId,
          showNotification,
          loadMaterialsTable,
          populateSelects,
          authToken,
        );
      });
    });

    logEvent(analytics, "materials_table_loaded", {
      materials_count: materials.length,
      page,
      page_title: "Balcony Calculator - Manage Materials",
      user_id: userId || "unknown",
    });
  } catch (error) {
    showNotification(`Ошибка загрузки материалов: ${error.message}`, true);
    const container = document.getElementById("materialList");
    if (container) {
      container.innerHTML = "<p>Ошибка загрузки материалов</p>";
    }
    await logErrorToFirestore("loadMaterialsTable", userId, error);
    throw error;
  }
}

/**
 * Загружает список материалов в <select id="materialSelect">.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} authToken - Токен аутентификации.
 * @returns {Promise<void>}
 * @throws {Error} Если загрузка материалов не удалась.
 */
async function loadMaterialSelectOptions(showNotification, authToken) {
  logEvent(analytics, "material_select_load_initiated", {
    page_title: "Balcony Calculator - Manage Materials",
    user_id: userId || "unknown",
  });

  try {
    const materialSelect = document.getElementById("materialSelect");
    if (!materialSelect) {
      throw new Error("Элемент materialSelect не найден");
    }

    materialSelect.innerHTML = '<option value="">Выберите материал</option>';

    const response = await getMaterials(
      null,
      0,
      ITEMS_PER_PAGE,
      authToken,
      userId,
    );
    if (!response.success) {
      throw new Error(response.error || "Не удалось загрузить материалы");
    }

    const materials = response.materials || [];
    if (!materials.length) {
      showNotification(
        'Материалы отсутствуют. Добавьте материалы в "Управление материалами".',
        true,
      );
      logEvent(analytics, "material_select_load_failed", {
        reason: "no_materials",
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
      });
      return;
    }

    materials.sort((a, b) => a.name.localeCompare(b.name));
    materials.forEach((material) => {
      const materialId = material.id;
      const name = material.name || "Без названия";
      const categories = Array.isArray(material.categories)
        ? material.categories
        : [];
      const value = `${materialId}:${categories.join(",")}:${name}`;
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${name} (${categories.join(", ") || "Без категории"})`;
      materialSelect.appendChild(option);
    });

    logEvent(analytics, "material_select_loaded", {
      materials_count: materials.length,
      page_title: "Balcony Calculator - Manage Materials",
      user_id: userId || "unknown",
    });
  } catch (error) {
    showNotification(
      `Ошибка при загрузке списка материалов: ${error.message}`,
      true,
    );
    await logErrorToFirestore("loadMaterialSelectOptions", userId, error);
    throw error;
  }
}

/**
 * Получает данные материала из формы.
 * @returns {Object} Данные материала.
 * @throws {Error} Если обязательные поля отсутствуют или некорректны.
 */
function getMaterialDataFromForm() {
  const nameInput = document.getElementById("newMaterialInput");
  const priceInput = document.getElementById("priceInput");
  const unitSelect = document.getElementById("unitSelect");
  const dimensionsInput = document.getElementById("dimensionsInput");
  const colorInput = document.getElementById("colorInput");
  const quantityInput = document.getElementById("quantityInput");
  const isHiddenInput = document.getElementById("isHiddenInput");

  if (
    !nameInput ||
    !priceInput ||
    !unitSelect ||
    !dimensionsInput ||
    !colorInput ||
    !quantityInput ||
    !isHiddenInput
  ) {
    throw new Error("Не удалось найти обязательные поля формы");
  }

  const name = nameInput.value?.trim();
  const price = parseFloat(priceInput.value);
  const unit = unitSelect.value?.trim();

  if (!name || isNaN(price) || price < 0 || !unit) {
    const missingFields = [];
    if (!name) missingFields.push("название");
    if (isNaN(price) || price < 0) missingFields.push("цена");
    if (!unit) missingFields.push("единица измерения");
    throw new Error(
      `Пожалуйста, заполните обязательные поля: ${missingFields.join(", ")}.`,
    );
  }

  const categories = Array.from(
    document.querySelectorAll('input[name="category"]:checked'),
  ).map((input) => input.value);
  if (!categories || categories.length === 0) {
    throw new Error(
      "Пожалуйста, выберите хотя бы одну категорию для материала.",
    );
  }

  let dimensions = null;
  if (dimensionsInput.value) {
    const dimensionsArray = dimensionsInput.value
      .split("x")
      .map((val) => parseFloat(val) || 0);
    const length = dimensionsArray[0] || 0;
    const width = dimensionsArray[1] || 0;
    const height = dimensionsArray[2] || 0;

    if (length > 0 || width > 0 || height > 0) {
      if (length <= 0 || width <= 0) {
        throw new Error("Длина и ширина должны быть положительными числами");
      }
      dimensions = { length, width, height: height >= 0 ? height : 0 };
    }
  }

  return {
    name,
    categories,
    color: colorInput.value || "",
    dimensions,
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
 * @param {string} authToken - Токен аутентификации.
 * @returns {Promise<void>}
 * @throws {Error} Если добавление материала не удалось.
 */
async function addMaterialWrapper(showNotification, validateForm, authToken) {
  logEvent(analytics, "material_add_initiated", {
    page_title: "Balcony Calculator - Manage Materials",
    user_id: userId || "unknown",
  });

  let materialData;
  try {
    if (!validateForm(false)) {
      showNotification("Пожалуйста, исправьте ошибки в форме", true);
      logEvent(analytics, "material_add_failed", {
        reason: "form_validation",
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
      });
      return;
    }

    materialData = getMaterialDataFromForm();
    if (!materialData.categories.every(isValidCategory)) {
      showNotification("Выбраны недопустимые категории", true);
      logEvent(analytics, "material_add_failed", {
        reason: "invalid_categories",
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
        categories: materialData.categories,
      });
      return;
    }

    const response = await addMaterial(materialData, authToken, userId);
    if (response.success) {
      showNotification("Материал успешно добавлен");
      logEvent(analytics, "material_added", {
        material_id: response.materialId,
        material_name: materialData.name,
        categories: materialData.categories,
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
      });

      // Очистка формы
      const nameInput = document.getElementById("newMaterialInput");
      const priceInput = document.getElementById("priceInput");
      const unitSelect = document.getElementById("unitSelect");
      const dimensionsInput = document.getElementById("dimensionsInput");
      const colorInput = document.getElementById("colorInput");
      const quantityInput = document.getElementById("quantityInput");
      const isHiddenInput = document.getElementById("isHiddenInput");

      nameInput.value = "";
      priceInput.value = "";
      unitSelect.value = "шт.";
      dimensionsInput.value = "";
      colorInput.value = "";
      quantityInput.value = "";
      isHiddenInput.checked = false;
      document
        .querySelectorAll('input[name="category"]')
        .forEach((input) => (input.checked = false));
      updateSelectedCategoriesCount();
    } else {
      throw new Error(response.error || "Не удалось добавить материал");
    }
  } catch (error) {
    showNotification(`Ошибка добавления материала: ${error.message}`, true);
    await logErrorToFirestore("addMaterialWrapper", userId, error, {
      material_data: materialData,
      categories: materialData?.categories || [],
    });
  }
}

/**
 * Редактирует существующий материал.
 * @param {string} materialId - ID материала.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} validateForm - Функция для валидации формы.
 * @param {string} authToken - Токен аутентификации.
 * @returns {Promise<void>}
 * @throws {Error} Если редактирование материала не удалось.
 */
async function editMaterialWrapper(
  materialId,
  showNotification,
  validateForm,
  authToken,
) {
  logEvent(analytics, "material_update_initiated", {
    material_id: materialId,
    page_title: "Balcony Calculator - Manage Materials",
    user_id: userId || "unknown",
  });

  let materialData;
  try {
    if (
      !materialId ||
      typeof materialId !== "string" ||
      materialId.trim() === ""
    ) {
      showNotification(
        "Ошибка: Неверный ID материала. Пожалуйста, выберите материал из списка.",
        true,
      );
      throw new Error("Invalid materialId");
    }

    if (!validateForm(false)) {
      showNotification("Пожалуйста, исправьте ошибки в форме", true);
      logEvent(analytics, "material_update_failed", {
        reason: "form_validation",
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
        material_id: materialId,
      });
      return;
    }

    materialData = getMaterialDataFromForm();
    if (!materialData.categories.every(isValidCategory)) {
      showNotification("Выбраны недопустимые категории", true);
      logEvent(analytics, "material_update_failed", {
        reason: "invalid_categories",
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
        material_id: materialId,
        categories: materialData.categories,
      });
      return;
    }

    const response = await updateMaterial(
      materialId,
      materialData,
      authToken,
      userId,
    );
    if (response.success) {
      showNotification("Материал успешно обновлён");
      logEvent(analytics, "material_updated", {
        material_id: materialId,
        material_name: materialData.name,
        categories: materialData.categories,
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
      });
    } else {
      throw new Error(response.error || "Не удалось обновить материал");
    }
  } catch (error) {
    showNotification(`Ошибка редактирования материала: ${error.message}`, true);
    await logErrorToFirestore("editMaterialWrapper", userId, error, {
      material_id: materialId,
      material_data: materialData,
      categories: materialData?.categories || [],
    });
  }
}

/**
 * Удаляет материал.
 * @param {string} materialId - ID материала.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} loadMaterialsTable - Функция для загрузки таблицы материалов.
 * @param {Function} populateSelects - Функция для заполнения выпадающих списков.
 * @param {string} authToken - Токен аутентификации.
 * @returns {Promise<void>}
 * @throws {Error} Если удаление материала не удалось.
 */
async function deleteMaterialWrapper(
  materialId,
  showNotification,
  loadMaterialsTable,
  populateSelects,
  authToken,
) {
  logEvent(analytics, "material_delete_initiated", {
    material_id: materialId,
    page_title: "Balcony Calculator - Manage Materials",
    user_id: userId || "unknown",
  });

  try {
    if (
      !confirm(`Вы уверены, что хотите удалить материал с ID "${materialId}"?`)
    ) {
      logEvent(analytics, "material_delete_cancelled", {
        material_id: materialId,
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
      });
      return;
    }

    const response = await deleteMaterial(materialId, authToken, userId);
    if (response.success) {
      showNotification("Материал успешно удалён");
      logEvent(analytics, "material_deleted", {
        material_id: materialId,
        page_title: "Balcony Calculator - Manage Materials",
        user_id: userId || "unknown",
      });
      await loadMaterialsTable(
        currentPage,
        showNotification,
        authToken,
        userId,
      );
      await populateSelects(showNotification, authToken, userId);
      await loadMaterialSelectOptions(showNotification, authToken);
    } else {
      throw new Error(response.error || "Не удалось удалить материал");
    }
  } catch (error) {
    showNotification(`Ошибка удаления материала: ${error.message}`, true);
    await logErrorToFirestore("deleteMaterialWrapper", userId, error, {
      material_id: materialId,
    });
  }
}

/**
 * Инициализирует действия с материалами (добавление, редактирование, удаление).
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} validateForm - Функция для валидации формы.
 * @param {Function} loadMaterialsTable - Функция для загрузки таблицы материалов.
 * @param {Function} populateSelects - Функция для заполнения выпадающих списков.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userIdParam - ID пользователя.
 * @returns {Promise<void>}
 * @throws {Error} Если инициализация не удалась.
 */
async function initializeMaterialActions(
  showNotification,
  validateForm,
  loadMaterialsTable,
  populateSelects,
  authToken,
  userIdParam,
) {
  logEvent(analytics, "material_actions_initialize_initiated", {
    page_title: "Balcony Calculator - Manage Materials",
    user_id: userIdParam || "unknown",
  });

  try {
    userId = userIdParam || "unknown";

    const requiredFunctions = {
      showNotification,
      validateForm,
      loadMaterialsTable,
      populateSelects,
    };
    for (const [funcName, func] of Object.entries(requiredFunctions)) {
      if (typeof func !== "function") {
        throw new Error(`${funcName} не является функцией`);
      }
    }

    if (!authToken || typeof authToken !== "string") {
      throw new Error("Токен аутентификации отсутствует или недействителен");
    }

    await loadCategories(showNotification, authToken);

    const editBtn = document.getElementById("editSelectedMaterialBtn");
    const deleteBtn = document.getElementById("deleteSelectedMaterialBtn");
    const addBtn = document.getElementById("addMaterialBtn");

    if (!editBtn || !deleteBtn || !addBtn) {
      throw new Error("Кнопки управления материалами не найдены");
    }

    const newEditBtn = editBtn.cloneNode(true);
    const newDeleteBtn = deleteBtn.cloneNode(true);
    const newAddBtn = addBtn.cloneNode(true);
    editBtn.replaceWith(newEditBtn);
    deleteBtn.replaceWith(newDeleteBtn);
    addBtn.replaceWith(newAddBtn);

    newEditBtn.addEventListener("click", async () => {
      const materialSelect = document.getElementById("materialSelect");
      if (!materialSelect) {
        showNotification("Ошибка: Элемент materialSelect не найден", true);
        logEvent(analytics, "material_update_failed", {
          reason: "material_select_missing",
          page_title: "Balcony Calculator - Manage Materials",
          user_id: userId || "unknown",
        });
        return;
      }
      const selectedValue = materialSelect.value;
      if (!selectedValue || selectedValue.trim() === "") {
        showNotification(
          "Пожалуйста, выберите материал для редактирования",
          true,
        );
        logEvent(analytics, "material_update_failed", {
          reason: "no_material_selected",
          page_title: "Balcony Calculator - Manage Materials",
          user_id: userId || "unknown",
        });
        return;
      }

      const [materialId] = selectedValue.split(":");
      await editMaterialWrapper(
        materialId,
        showNotification,
        validateForm,
        authToken,
      );
      await loadMaterialsTable(
        currentPage,
        showNotification,
        authToken,
        userId,
      );
      await populateSelects(showNotification, authToken, userId);
      await loadMaterialSelectOptions(showNotification, authToken);
    });

    newDeleteBtn.addEventListener("click", async () => {
      const materialSelect = document.getElementById("materialSelect");
      if (!materialSelect) {
        showNotification("Ошибка: Элемент materialSelect не найден", true);
        logEvent(analytics, "material_delete_failed", {
          reason: "material_select_missing",
          page_title: "Balcony Calculator - Manage Materials",
          user_id: userId || "unknown",
        });
        return;
      }
      const selectedValue = materialSelect.value;
      if (!selectedValue || selectedValue.trim() === "") {
        showNotification("Пожалуйста, выберите материал для удаления", true);
        logEvent(analytics, "material_delete_failed", {
          reason: "no_material_selected",
          page_title: "Balcony Calculator - Manage Materials",
          user_id: userId || "unknown",
        });
        return;
      }

      const materialId = selectedValue.split(":")[0];
      await deleteMaterialWrapper(
        materialId,
        showNotification,
        loadMaterialsTable,
        populateSelects,
        authToken,
      );
    });

    newAddBtn.addEventListener("click", async () => {
      await addMaterialWrapper(showNotification, validateForm, authToken);
      await loadMaterialsTable(
        currentPage,
        showNotification,
        authToken,
        userId,
      );
      await populateSelects(showNotification, authToken, userId);
      await loadMaterialSelectOptions(showNotification, authToken);
    });

    document.querySelectorAll(".add-button").forEach((button) => {
      button.addEventListener("click", () => {
        const tabId = button.getAttribute("data-tab-id") || "tab1";
        const row = document.querySelector(
          `.extra-material-row[data-tab-id="${tabId}"]`,
        );
        if (!row) {
          showNotification(
            "Ошибка: Элемент для добавления материалов не найден",
            true,
          );
          logEvent(analytics, "extra_material_add_failed", {
            reason: `Element .extra-material-row for tabId ${tabId} not found`,
            page_title: "Balcony Calculator",
            user_id: userId || "unknown",
          });
          return;
        }
        const newRow = row.cloneNode(true);
        newRow.querySelectorAll("select, input, button").forEach((element) => {
          const newId = element.id ? `${element.id}_${Date.now()}` : null;
          if (newId) element.id = newId;
          element.value = "";
        });
        row.parentNode.insertBefore(newRow, row.nextSibling);
        logEvent(analytics, "extra_material_added", {
          tab_id: tabId,
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
      });
    });

    await loadMaterialsTable(currentPage, showNotification, authToken, userId);
    await loadMaterialSelectOptions(showNotification, authToken);

    logEvent(analytics, "material_actions_initialized", {
      page_title: "Balcony Calculator - Manage Materials",
      user_id: userId || "unknown",
    });
  } catch (error) {
    showNotification(
      `Ошибка инициализации действий с материалами: ${error.message}`,
      true,
    );
    await logErrorToFirestore("initializeMaterialActions", userId, error);
    throw error;
  }
}

export {
  populateSelects,
  loadCategories,
  loadWindowVariants,
  initializeMaterialActions,
  loadMaterialsTable,
};
