import { analytics, logEvent } from './firebase.js'; // Импортируем аналитику для логирования событий

// Пароль для доступа к вкладке "Управление материалами" (должен быть задан через переменную окружения)
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('tabs.js: ADMIN_PASSWORD not set in environment variables (VITE_ADMIN_PASSWORD)');
  throw new Error('ADMIN_PASSWORD must be set in environment variables');
}

/**
 * Инициализирует переключение вкладок и доступ к вкладке "Управление материалами".
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя (для логирования и аналитики).
 * @returns {Promise<void>} Возвращает Promise для поддержки асинхронности.
 */
export async function initializeTabs(showNotification, userId) {
  console.log('initializeTabs: Starting initialization', { userId });

  // Проверяем наличие функции showNotification
  if (typeof showNotification !== 'function') {
    console.error('initializeTabs: showNotification function is not provided or is not a function', { userId });
    throw new Error('showNotification function is required');
  }

  const tabs = document.querySelectorAll('.tab__button');
  const contents = document.querySelectorAll('.tab-content');
  const results = document.getElementById('results');

  if (!tabs.length || !contents.length || !results) {
    console.error('initializeTabs: Required elements not found in DOM', { tabs: tabs.length, contents: contents.length, results, userId });
    showNotification('Ошибка: Не удалось найти элементы вкладок или результатов', true);
    throw new Error('Required DOM elements not found');
  }

  // Инициализируем модальное окно
  const modal = document.getElementById('passwordModal');
  const passwordForm = document.getElementById('passwordForm');
  const passwordInput = document.getElementById('passwordInput');
  const submitBtn = document.getElementById('submitPasswordBtn');
  const cancelBtn = document.getElementById('cancelPasswordBtn');
  const errorMsg = document.getElementById('passwordError');
  const resetAdminAccessBtn = document.getElementById('resetAdminAccessBtn');
  const mainContainer = document.querySelector('.container');

  if (!modal || !passwordForm || !passwordInput || !submitBtn || !cancelBtn || !errorMsg || !mainContainer) {
    console.error('initializeTabs: Required modal elements not found in DOM', { userId });
    showNotification('Ошибка: Не удалось найти элементы модального окна', true);
    throw new Error('Required modal DOM elements not found');
  }

  // Проверяем, был ли уже введён пароль (сохраняем в localStorage)
  let isAdminUnlocked = localStorage.getItem('adminUnlocked') === 'true';
  let activeTabId = 'tab1'; // Храним ID текущей активной вкладки
  let triggeringElement = null; // Элемент, вызвавший открытие модального окна

  // Функция переключения вкладок
  const switchTab = (tabId) => {
    tabs.forEach(t => {
      t.classList.remove('tab__button--active');
      t.setAttribute('aria-selected', 'false');
    });
    contents.forEach(c => c.classList.remove('tab-content--active'));
    results.classList.remove('tab-content--active');

    const tab = document.querySelector(`.tab__button[data-tab="${tabId}"]`);
    const content = document.getElementById(tabId);
    if (tab && content) {
      tab.classList.add('tab__button--active');
      tab.setAttribute('aria-selected', 'true');
      content.classList.add('tab-content--active');
      activeTabId = tabId; // Сохраняем текущую вкладку

      // Логируем переключение вкладки для аналитики
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'tab_switch', {
          tab_id: tabId,
          tab_name: tab.textContent,
          page_title: 'Balcony Calculator',
          user_id: userId
        });
      }

      console.log(`initializeTabs: Switched to tab ${tabId}`, { userId });
    } else {
      console.error(`initializeTabs: Content for tab ${tabId} not found`, { userId });
      showNotification(`Ошибка: Контент для вкладки ${tabId} не найден`, true);
      throw new Error(`Content for tab ${tabId} not found`);
    }
  };

  // Функция открытия модального окна
  const openModal = (triggerElement) => {
    triggeringElement = triggerElement;
    modal.style.display = 'block';
    passwordInput.value = ''; // Очищаем поле ввода
    errorMsg.style.display = 'none';
    passwordInput.focus();
    // Скрываем фоновое содержимое для экранных читалок
    mainContainer.setAttribute('aria-hidden', 'true');
    // Добавляем обработчик для закрытия по Esc
    document.addEventListener('keydown', handleModalKeydown);

    // Логируем открытие модального окна
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'modal_open', {
        modal_type: 'admin_access',
        page_title: 'Balcony Calculator',
        user_id: userId
      });
    }
  };

  // Функция закрытия модального окна
  const closeModal = () => {
    modal.style.display = 'none';
    mainContainer.removeAttribute('aria-hidden');
    // Возвращаем фокус на элемент, вызвавший открытие
    if (triggeringElement) {
      triggeringElement.focus();
      triggeringElement = null;
    }
    // Удаляем обработчик для Esc
    document.removeEventListener('keydown', handleModalKeydown);

    // Логируем закрытие модального окна
    if (analytics && typeof logEvent === 'function') {
      logEvent(analytics, 'modal_close', {
        modal_type: 'admin_access',
        page_title: 'Balcony Calculator',
        user_id: userId
      });
    }
  };

  // Обработчик для закрытия модального окна по Esc
  const handleModalKeydown = (event) => {
    if (event.key === 'Escape') {
      closeModal();
      switchTab('tab1'); // Переключаемся на первую вкладку
    }
  };

  // Обработчик клика по вкладкам
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');

      // Проверяем, является ли вкладка "Управление материалами" (tab12)
      if (tabId === 'tab12' && !isAdminUnlocked) {
        openModal(tab);
        return;
      }

      // Переключаем вкладку
      switchTab(tabId);
    });
  });

  // Обработчики для модального окна
  submitBtn.addEventListener('click', (event) => {
    event.preventDefault(); // Предотвращаем стандартную отправку формы
    const password = passwordInput.value.trim();
    if (password === ADMIN_PASSWORD) {
      localStorage.setItem('adminUnlocked', 'true');
      isAdminUnlocked = true;
      closeModal();
      switchTab('tab12'); // Переключаемся на вкладку "Управление материалами"

      // Логируем успешный вход администратора
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'admin_access_granted', {
          page_title: 'Balcony Calculator - Admin Mode',
          user_id: userId
        });
      }
      showNotification('Доступ администратора разблокирован', false);
    } else {
      errorMsg.style.display = 'block';
      errorMsg.textContent = 'Неверный пароль';
      passwordInput.focus();

      // Логируем неудачную попытку входа
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'admin_access_failed', {
          page_title: 'Balcony Calculator',
          user_id: userId
        });
      }
    }
  });

  cancelBtn.addEventListener('click', (event) => {
    event.preventDefault(); // Предотвращаем стандартную отправку формы
    closeModal();
    switchTab('tab1'); // Переключаемся на первую вкладку
  });

  // Предотвращаем отправку формы при нажатии Enter
  passwordForm.addEventListener('submit', (event) => {
    event.preventDefault();
    submitBtn.click(); // Имитируем клик по кнопке "Подтвердить"
  });

  // Обработчик для кнопки сброса доступа
  if (resetAdminAccessBtn) {
    resetAdminAccessBtn.addEventListener('click', () => {
      localStorage.removeItem('adminUnlocked');
      isAdminUnlocked = false;
      showNotification('Доступ администратора сброшен', false);
      switchTab('tab1'); // Переключаемся на первую вкладку

      // Логируем сброс доступа
      if (analytics && typeof logEvent === 'function') {
        logEvent(analytics, 'admin_access_reset', {
          page_title: 'Balcony Calculator',
          user_id: userId
        });
      }
    });
  } else {
    console.warn('initializeTabs: Reset admin access button not found in DOM', { userId });
  }

  // Показываем первую вкладку по умолчанию
  if (tabs.length > 0) {
    switchTab('tab1');
  } else {
    console.warn('initializeTabs: No tabs found to initialize', { userId });
    throw new Error('No tabs found to initialize');
  }

  console.log('initializeTabs: Initialization completed', { userId });
  return Promise.resolve();
}