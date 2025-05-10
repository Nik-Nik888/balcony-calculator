import { validateForm } from './validation.js';
import { analytics, logEvent } from './firebase.js'; // Импортируем аналитику для логирования событий

const CALCULATE_URL = 'https://us-central1-balconycalculator-15c42.cloudfunctions.net/calculateMaterials';

/**
 * Собирает данные с указанной вкладки.
 * @param {string} tabId - ID вкладки (например, 'tab1', 'tab2').
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @returns {Object} Объект с данными вкладки.
 */
function getTabData(tabId, showNotification) {
  console.log(`getTabData: Collecting data for tab ${tabId}`);
  const tab = document.getElementById(tabId);
  if (!tab) {
    console.error(`getTabData: Tab with ID ${tabId} not found in DOM`);
    showNotification(`Ошибка: Вкладка с ID ${tabId} не найдена`, true);
    return {};
  }

  const data = {};

  // Определяем селекторы для каждого типа данных на вкладке
  const selectors = {
    'tab1': {
      selects: ['#entryListToggle', '#entryFastenersToggle', '#entryTilingToggle'],
      extraMaterials: '.extra-material'
    },
    'tab2': {
      selects: ['.glazing-type', '.frame-type', '.exterior-finish', '.balcony-block', '.window-type', '.window-slopes', '.sill-type', '.roof-type'],
      extraMaterials: '.extra-material'
    },
    'tab3': {
      inputs: ['#lengthTab3', '#widthTab3'],
      selects: ['.finish-type', '.wall-painting', '.insulation-type', '.finish-direction'],
      extraMaterials: '.extra-material'
    },
    'tab4': {
      inputs: ['#lengthTab4', '#widthTab4'],
      selects: ['.finish-type', '.wall-painting', '.insulation-type', '.finish-direction'],
      extraMaterials: '.extra-material'
    },
    'tab5': {
      inputs: ['#lengthTab5', '#widthTab5'],
      selects: ['.finish-type', '.wall-painting', '.insulation-type', '.finish-direction'],
      extraMaterials: '.extra-material'
    },
    'tab6': {
      inputs: ['#lengthTab6', '#widthTab6'],
      selects: ['.finish-type', '.wall-painting', '.insulation-type', '.finish-direction'],
      extraMaterials: '.extra-material'
    },
    'tab7': {
      inputs: ['#lengthTab7', '#widthTab7'],
      selects: ['.finish-type', '.ceiling-painting', '.insulation-type', '.finish-direction'],
      extraMaterials: '.extra-material'
    },
    'tab8': {
      inputs: ['#lengthTab8', '#widthTab8'],
      selects: ['.finish-type', '.insulation-type'],
      extraMaterials: '.extra-material'
    },
    'tab9': {
      selects: ['.cable-type', '.switch-type', '.socket-type', '.spot-type'],
      extraMaterials: '.extra-material'
    },
    'tab10': {
      selects: ['.furniture-name', '.furniture-material', '.furniture-painting', '.shelf-top-material', '.shelf-bottom-material', '.stove-side', '.countertop'],
      extraMaterials: '.extra-material'
    },
    'tab11': {
      extraMaterials: '.extra-material'
    }
  };

  const tabConfig = selectors[tabId];
  if (!tabConfig) {
    console.warn(`getTabData: No selectors defined for tab ${tabId}`);
    return data;
  }

  // Сбор данных из select элементов
  if (tabConfig.selects) {
    tabConfig.selects.forEach(selector => {
      const element = tab.querySelector(selector);
      if (!element) {
        console.warn(`getTabData: Element ${selector} not found in tab ${tabId}`);
        return;
      }
      const fieldName = selector.startsWith('#') ? selector.replace('#', '') : selector.replace(/\./g, '');
      data[fieldName] = element.value || '';
      console.log(`getTabData: ${fieldName} = ${data[fieldName]}`);
    });
  }

  // Сбор данных из input элементов (числовые поля)
  if (tabConfig.inputs) {
    tabConfig.inputs.forEach(selector => {
      const input = tab.querySelector(selector);
      if (!input) {
        console.warn(`getTabData: Input ${selector} not found in tab ${tabId}`);
        data[selector.replace('#', '')] = 0;
        return;
      }
      data[selector.replace('#', '')] = parseFloat(input.value) || 0;
      console.log(`getTabData: ${selector.replace('#', '')} = ${data[selector.replace('#', '')]}`);
    });
  }

  // Сбор данных из .extra-material (дополнительные материалы)
  if (tabConfig.extraMaterials) {
    const elements = tab.querySelectorAll(tabConfig.extraMaterials);
    data['extraMaterials'] = Array.from(elements).map(el => {
      // Находим ближайший input с количеством
      const quantityInput = el.parentElement.querySelector('input[type="number"]');
      if (!quantityInput) {
        console.warn(`getTabData: Quantity input not found for extra-material in tab ${tabId}`);
        return null;
      }
      const quantity = parseFloat(quantityInput.value) || 0;
      if (quantity <= 0 && el.value) {
        quantityInput.classList.add('invalid');
        const errorElement = quantityInput.nextElementSibling;
        if (errorElement) {
          errorElement.textContent = 'Введите количество больше 0';
          errorElement.classList.add('show'); // Добавляем анимацию
        }
      }
      const [materialKey] = (el.value || '').split(':'); // Извлекаем materialKey из формата "materialId:category:materialName"
      const item = { materialKey, quantity };
      console.log(`getTabData: extraMaterials item - materialKey: ${item.materialKey}, quantity: ${item.quantity}`);
      return item;
    }).filter(item => item && item.materialKey && item.quantity > 0); // Фильтруем пустые записи
    console.log(`getTabData: Collected extraMaterials for tab ${tabId}:`, data['extraMaterials']);
  }

  return data;
}

/**
 * Выполняет расчёт для всех вкладок и отображает результаты.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} validateForm - Функция для валидации формы.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {string} userId - ID пользователя (для логирования и аналитики).
 * @returns {Promise<void>}
 */
async function calculateAll(showNotification, validateForm, authToken, userId) {
  console.log('calculateAll: Starting calculation for all tabs', { userId });
  try {
    // Проверяем наличие токена
    if (!authToken || typeof authToken !== 'string') {
      throw new Error('Токен аутентификации отсутствует или недействителен');
    }

    // Проверяем форму с учётом того, что это расчёт
    if (!validateForm(true)) {
      showNotification('Пожалуйста, заполните данные о расчёте: номер заказа, адрес и телефон.', true);
      console.warn('calculateAll: Form validation failed');

      // Логируем неудачный расчёт
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'calculation_failed', {
          reason: 'form_validation',
          page_title: 'Balcony Calculator',
          user_id: userId || 'unknown'
        });
      }
      return;
    }

    const resultsContainer = document.getElementById('results');
    if (!resultsContainer) {
      console.error('calculateAll: Results container not found in DOM');
      showNotification('Ошибка: Контейнер результатов не найден.', true);
      throw new Error('Results container not found');
    }

    resultsContainer.innerHTML = '<h2>Результаты расчёта</h2><p>Выполняется расчёт...</p>';

    const tabs = ['tab1', 'tab2', 'tab3', 'tab4', 'tab5', 'tab6', 'tab7', 'tab8', 'tab9', 'tab10', 'tab11'];
    const allResults = [];
    let totalCost = 0;

    for (const tabId of tabs) {
      const tabData = getTabData(tabId, showNotification);
      const tabButton = document.querySelector(`.tab__button[data-tab="${tabId}"]`);
      if (!tabButton) {
        console.warn(`calculateAll: Tab button for ${tabId} not found`);
        continue;
      }
      const tabName = tabButton.textContent;

      // Проверка, есть ли в tabData валидные данные
      let hasValidData = false;
      for (const key in tabData) {
        if (Array.isArray(tabData[key])) {
          if (tabData[key].some(item => item.materialKey && item.quantity > 0)) {
            hasValidData = true;
            break;
          }
        } else if (tabData[key] && tabData[key] !== '' && tabData[key] !== 'no') {
          hasValidData = true;
          break;
        }
      }

      if (!hasValidData) {
        console.warn(`calculateAll: No valid data for tab ${tabName} (${tabId}), skipping calculation.`);
        continue;
      }

      console.log(`calculateAll: Sending request for tab ${tabName} (${tabId}) with data:`, tabData);
      const response = await fetch(CALCULATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ tabName, data: tabData, userId: userId || 'unknown' }) // Добавляем userId в тело запроса
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ошибка: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Ошибка расчёта');
      }

      allResults.push({ tabName, results: result.results, totalCost: result.totalCost });
      totalCost += parseFloat(result.totalCost) || 0;
      console.log(`calculateAll: Received result for ${tabName}:`, result);
    }

    if (allResults.length === 0) {
      showNotification('Нет данных для расчёта. Убедитесь, что выбраны материалы и указаны количества.', true);
      resultsContainer.innerHTML = '<h2>Результаты расчёта</h2><p>Нет данных для расчёта</p>';
      console.warn('calculateAll: No tabs had valid data for calculation');

      // Логируем неудачный расчёт
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'calculation_failed', {
          reason: 'no_valid_data',
          page_title: 'Balcony Calculator',
          user_id: userId || 'unknown'
        });
      }
      return;
    }

    // Отображаем результаты
    resultsContainer.innerHTML = '<h2>Результаты расчёта</h2>';
    const headerInfo = document.createElement('div');
    headerInfo.className = 'header-info';
    const orderNumber = document.getElementById('orderNumberInput')?.value || 'Не указан';
    const address = document.getElementById('addressInput')?.value || 'Не указан';
    const phone = document.getElementById('phoneInput')?.value || 'Не указан';
    headerInfo.innerHTML = `
      <p>Номер заказа: ${orderNumber}</p>
      <p>Адрес: ${address}</p>
      <p>Телефон: ${phone}</p>
    `;
    resultsContainer.appendChild(headerInfo);

    allResults.forEach(({ tabName, results, totalCost: tabTotal }) => {
      if (results.length === 0) return;
      const section = document.createElement('div');
      section.innerHTML = `<h3>${tabName} (Итого: ${parseFloat(tabTotal).toFixed(2)} руб.)</h3>`;
      const ul = document.createElement('ul');
      results.forEach(item => {
        const li = document.createElement('li');
        li.textContent = `${item.material}: ${item.quantity} ${item.unit} - ${parseFloat(item.cost).toFixed(2)} руб.`;
        ul.appendChild(li);
      });
      section.appendChild(ul);
      resultsContainer.appendChild(section);
    });

    const totalDiv = document.createElement('div');
    totalDiv.innerHTML = `<h3>Общая стоимость: ${totalCost.toFixed(2)} руб.</h3>`;
    resultsContainer.appendChild(totalDiv);

    showNotification('Расчёт успешно выполнен', false);
    console.log('calculateAll: Calculation completed successfully');

    // Логируем успешный расчёт
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'calculation_success', {
        total_cost: totalCost,
        tabs_processed: allResults.length,
        page_title: 'Balcony Calculator',
        user_id: userId || 'unknown'
      });
    }
  } catch (error) {
    console.error('calculateAll: Error during calculation:', {
      message: error.message,
      stack: error.stack,
      authToken: authToken ? '[provided]' : '[missing]',
      userId
    });
    const message = error.message.includes('HTTP ошибка')
      ? 'Ошибка сервера при выполнении расчёта. Проверьте подключение или попробуйте позже.'
      : `Ошибка расчёта: ${error.message}`;
    showNotification(message, true);
    const resultsContainer = document.getElementById('results');
    if (resultsContainer) {
      resultsContainer.innerHTML = '<h2>Результаты расчёта</h2><p>Ошибка при выполнении расчёта</p>';
    }

    // Логируем ошибку расчёта
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'calculation_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator',
        user_id: userId || 'unknown'
      });
    }
  }
}

/**
 * Сохраняет результаты расчёта в формате JSON.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя (для аналитики).
 */
function saveCalculation(showNotification, userId) {
  console.log('saveCalculation: Starting to save calculation', { userId });
  try {
    const resultsContainer = document.getElementById('results');
    if (!resultsContainer) {
      console.error('saveCalculation: Results container not found in DOM');
      showNotification('Ошибка: Контейнер результатов не найден.', true);
      throw new Error('Results container not found');
    }

    const resultsData = {
      header: {
        orderNumber: document.getElementById('orderNumberInput')?.value || 'Не указан',
        address: document.getElementById('addressInput')?.value || 'Не указан',
        phone: document.getElementById('phoneInput')?.value || 'Не указан'
      },
      tabs: [],
      totalCost: 0
    };

    const sections = resultsContainer.querySelectorAll('div:not(.header-info)');
    sections.forEach(section => {
      const tabName = section.querySelector('h3')?.textContent?.split(' (')[0];
      if (!tabName) return;

      const totalCostMatch = section.querySelector('h3')?.textContent?.match(/Итого: ([\d.]+) руб./);
      const tabTotal = totalCostMatch ? parseFloat(totalCostMatch[1]) : 0;

      const items = Array.from(section.querySelectorAll('li')).map(li => {
        const [materialPart, costPart] = li.textContent.split(' - ');
        const [material, quantity, unit] = materialPart.split(': ')[1].split(' ');
        const cost = parseFloat(costPart.split(' ')[0]) || 0;
        return { material, quantity: parseFloat(quantity) || 0, unit, cost };
      });

      resultsData.tabs.push({ tabName, results: items, totalCost: tabTotal });
      resultsData.totalCost += tabTotal;
    });

    if (resultsData.tabs.length === 0) {
      showNotification('Нет результатов для сохранения.', true);
      console.warn('saveCalculation: No results to save');
      return;
    }

    const blob = new Blob([JSON.stringify(resultsData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `calculation_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Расчёт сохранён', false);
    console.log('saveCalculation: Calculation saved successfully');

    // Логируем сохранение расчёта
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'calculation_saved', {
        tabs_count: resultsData.tabs.length,
        page_title: 'Balcony Calculator',
        user_id: userId || 'unknown'
      });
    }
  } catch (error) {
    console.error('saveCalculation: Error saving calculation:', {
      message: error.message,
      stack: error.stack,
      userId
    });
    showNotification('Ошибка при сохранении расчёта: ' + error.message, true);

    // Логируем ошибку сохранения
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'calculation_save_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator',
        user_id: userId || 'unknown'
      });
    }
  }
}

/**
 * Загружает результаты расчёта из JSON-файла.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя (для аналитики).
 */
function loadCalculation(showNotification, userId) {
  console.log('loadCalculation: Starting to load calculation', { userId });
  try {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) {
        console.warn('loadCalculation: No file selected for loading');
        showNotification('Файл не выбран.', true);
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const resultsData = JSON.parse(event.target.result);
          const resultsContainer = document.getElementById('results');
          if (!resultsContainer) {
            console.error('loadCalculation: Results container not found in DOM');
            showNotification('Ошибка: Контейнер результатов не найден.', true);
            throw new Error('Results container not found');
          }

          // Проверяем структуру данных
          if (!resultsData.header || !resultsData.tabs || !Array.isArray(resultsData.tabs)) {
            throw new Error('Некорректный формат загруженных данных');
          }

          // Отображаем результаты
          resultsContainer.innerHTML = '<h2>Результаты расчёта</h2>';
          const headerInfo = document.createElement('div');
          headerInfo.className = 'header-info';
          headerInfo.innerHTML = `
            <p>Номер заказа: ${resultsData.header.orderNumber}</p>
            <p>Адрес: ${resultsData.header.address}</p>
            <p>Телефон: ${resultsData.header.phone}</p>
          `;
          resultsContainer.appendChild(headerInfo);

          resultsData.tabs.forEach(({ tabName, results, totalCost }) => {
            if (!results || results.length === 0) return;
            const section = document.createElement('div');
            section.innerHTML = `<h3>${tabName} (Итого: ${parseFloat(totalCost).toFixed(2)} руб.)</h3>`;
            const ul = document.createElement('ul');
            results.forEach(item => {
              const li = document.createElement('li');
              li.textContent = `${item.material}: ${item.quantity} ${item.unit} - ${parseFloat(item.cost).toFixed(2)} руб.`;
              ul.appendChild(li);
            });
            section.appendChild(ul);
            resultsContainer.appendChild(section);
          });

          const totalDiv = document.createElement('div');
          totalDiv.innerHTML = `<h3>Общая стоимость: ${parseFloat(resultsData.totalCost).toFixed(2)} руб.</h3>`;
          resultsContainer.appendChild(totalDiv);

          showNotification('Расчёт загружен', false);
          console.log('loadCalculation: Calculation loaded successfully');

          // Логируем загрузку расчёта
          if (analytics && typeof logEvent === 'function') {
            logEvent(analytics, 'calculation_loaded', {
              tabs_count: resultsData.tabs.length,
              page_title: 'Balcony Calculator',
              user_id: userId || 'unknown'
            });
          }
        } catch (error) {
          console.error('loadCalculation: Error loading calculation:', {
            message: error.message,
            stack: error.stack,
            userId
          });
          showNotification('Ошибка при загрузке расчёта: ' + error.message, true);

          // Логируем ошибку загрузки
          if (analytics && typeof logEvent === 'function') {
            logEvent(analytics, 'calculation_load_failed', {
              reason: error.message,
              page_title: 'Balcony Calculator',
              user_id: userId || 'unknown'
            });
          }
        }
      };
      reader.onerror = () => {
        console.error('loadCalculation: Error reading file', { userId });
        showNotification('Ошибка при чтении файла.', true);

        // Логируем ошибку чтения файла
        if (analytics && typeof logEvent === 'function') {
          logEvent(analytics, 'calculation_load_failed', {
            reason: 'file_read_error',
            page_title: 'Balcony Calculator',
            user_id: userId || 'unknown'
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  } catch (error) {
    console.error('loadCalculation: Error initiating file load:', {
      message: error.message,
      stack: error.stack,
      userId
    });
    showNotification('Ошибка при запуске загрузки расчёта: ' + error.message, true);

    // Логируем ошибку
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'calculation_load_failed', {
        reason: error.message,
        page_title: 'Balcony Calculator',
        user_id: userId || 'unknown'
      });
    }
  }
}

/**
 * Инициализирует обработчики событий для кнопок расчёта, сохранения и загрузки.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} validateForm - Функция для валидации формы.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {string} userId - ID пользователя (для логирования и аналитики).
 * @returns {Promise<void>} Возвращает Promise для поддержки асинхронности.
 */
async function initializeCalculation(showNotification, validateForm, authToken, userId) {
  console.log('initializeCalculation: Setting up event listeners', { userId });

  const calculateBtn = document.getElementById('calculateBtn');
  const saveCalculationBtn = document.getElementById('saveCalculationBtn');
  const loadCalculationBtn = document.getElementById('loadCalculationBtn');

  if (!calculateBtn || !saveCalculationBtn || !loadCalculationBtn) {
    console.error('initializeCalculation: One or more required buttons not found in DOM', {
      calculateBtn: !!calculateBtn,
      saveCalculationBtn: !!saveCalculationBtn,
      loadCalculationBtn: !!loadCalculationBtn,
      userId
    });
    showNotification('Ошибка: Кнопки управления расчётом не найдены', true);
    throw new Error('Required buttons not found');
  }

  if (typeof showNotification !== 'function' || typeof validateForm !== 'function') {
    console.error('initializeCalculation: Invalid arguments', {
      showNotification: typeof showNotification,
      validateForm: typeof validateForm,
      userId
    });
    throw new Error('showNotification and validateForm must be functions');
  }

  calculateBtn.addEventListener('click', async () => {
    console.log('initializeCalculation: Calculate button clicked', { userId });
    await calculateAll(showNotification, validateForm, authToken, userId);
  });

  saveCalculationBtn.addEventListener('click', () => {
    console.log('initializeCalculation: Save calculation button clicked', { userId });
    saveCalculation(showNotification, userId);
  });

  loadCalculationBtn.addEventListener('click', () => {
    console.log('initializeCalculation: Load calculation button clicked', { userId });
    loadCalculation(showNotification, userId);
  });

  console.log('initializeCalculation: Event listeners set up successfully', { userId });
  return Promise.resolve();
}

export { getTabData, calculateAll, initializeCalculation };