import { analytics, logEvent } from './firebase.js';

/**
 * Объект категорий, структурированный по вкладкам.
 * Ключи - названия вкладок (например, "На заезд", "Остекление").
 * Значения - массивы подкатегорий, доступных для данной вкладки.
 * @type {Object.<string, string[]>}
 */
const categories = {
  'На заезд': ['Список на заезд', 'Крепеж', 'Плиточные работы', 'Доп. параметр'],
  Остекление: [
    'Что делаем',
    'Основная рама',
    'Наружная отделка',
    'Замена балконного блока',
    'Окно',
    'Откосы для окон',
    'Подоконники',
    'Крыша',
    'Доп. параметр',
  ],
  'Главная стена': ['Вид отделки', 'Покраска стен', 'Вид утепления', 'Направление отделки', 'Доп. параметр'],
  'Фасадная стена': ['Вид отделки', 'Покраска стен', 'Вид утепления', 'Направление отделки', 'Доп. параметр'],
  'БЛ стена': ['Вид отделки', 'Покраска стен', 'Вид утепления', 'Направление отделки', 'Доп. параметр'],
  'БП стена': ['Вид отделки', 'Покраска стен', 'Вид утепления', 'Направление отделки', 'Доп. параметр'],
  Потолок: ['Вид отделки', 'Покраска потолка', 'Вид утепления', 'Направление отделки', 'Доп. параметр'],
  Полы: ['Вид отделки', 'Вид утепления', 'Доп. параметр'],
  Электрика: ['Кабель', 'Выключатель', 'Розетка', 'Спот', 'Доп. параметр'],
  Мебель: [
    'Материал мебели',
    'Покраска мебели',
    'Полки Верх',
    'Полки Низ',
    'Бок у печки',
    'Столешница',
    'Доп. параметр',
  ],
  'Доп. параметр': ['Доп. параметр'],
};

/**
 * Массив допустимых категорий в формате "TabName:SubCategory".
 * Используется для валидации и совместимости с Firestore.
 * @type {string[]}
 */
const validCategories = Object.entries(categories).reduce((acc, [tab, subCategories]) => {
  const tabCategories = subCategories.map((subCategory) => `${tab}:${subCategory}`);
  return acc.concat(tabCategories);
}, []);

/**
 * Проверяет, является ли указанная категория допустимой.
 * @param {string} category - Категория в формате "TabName:SubCategory".
 * @returns {boolean} True, если категория допустима, иначе false.
 */
function isValidCategory(category) {
  const isValid = typeof category === 'string' && validCategories.includes(category);
  logEvent(analytics, 'category_validation', {
    category,
    is_valid: isValid,
    page_title: 'Balcony Calculator',
    user_id: 'unknown',
  });
  if (typeof category !== 'string') {
    logEvent(analytics, 'category_validation_failed', {
      category,
      reason: 'Category must be a string',
      page_title: 'Balcony Calculator',
      user_id: 'unknown',
    });
  }
  return isValid;
}

/**
 * Возвращает список всех вкладок.
 * @returns {string[]} Массив названий вкладок.
 */
function getTabs() {
  return Object.keys(categories);
}

/**
 * Возвращает список подкатегорий для указанной вкладки.
 * @param {string} tabName - Название вкладки (например, "Остекление").
 * @returns {string[]} Массив подкатегорий или пустой массив, если вкладка не найдена.
 */
function getSubCategories(tabName) {
  if (typeof tabName !== 'string') {
    logEvent(analytics, 'get_subcategories_failed', {
      tabName,
      reason: 'TabName must be a string',
      page_title: 'Balcony Calculator',
      user_id: 'unknown',
    });
    return [];
  }

  const subCategories = categories[tabName] || [];
  logEvent(analytics, 'get_subcategories', {
    tab_name: tabName,
    subcategories_count: subCategories.length,
    page_title: 'Balcony Calculator',
    user_id: 'unknown',
  });

  if (!subCategories.length) {
    logEvent(analytics, 'get_subcategories_failed', {
      tabName,
      reason: 'Tab not found',
      page_title: 'Balcony Calculator',
      user_id: 'unknown',
    });
  }

  return subCategories;
}

export { categories, validCategories, isValidCategory, getTabs, getSubCategories };