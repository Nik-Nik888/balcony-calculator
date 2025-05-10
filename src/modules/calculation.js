import { analytics, logEvent } from "./firebase.js";

const CALCULATE_URL =
  "https://us-central1-balconycalculator-15c42.cloudfunctions.net/calculateMaterials";

/**
 * Собирает данные с указанной вкладки.
 * @param {string} tabId - ID вкладки (например, 'tab1', 'tab2').
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @returns {Object} Объект с данными вкладки.
 */
function getTabData(tabId, showNotification) {
  const tab = document.getElementById(tabId);
  if (!tab) {
    showNotification(`Ошибка: Вкладка с ID ${tabId} не найдена`, true);
    logEvent(analytics, "calculation_error", {
      reason: `Tab ${tabId} not found`,
      page_title: "Balcony Calculator",
    });
    return {};
  }

  const data = {};

  // Определяем селекторы для каждого типа данных на вкладке
  const selectors = {
    tab1: {
      selects: [
        "#entryListToggle",
        "#entryFastenersToggle",
        "#entryTilingToggle",
      ],
      extraMaterials: ".extra-material",
    },
    tab2: {
      selects: [
        ".glazing-type",
        ".frame-type",
        ".exterior-finish",
        ".balcony-block",
        ".window-type",
        ".window-slopes",
        ".sill-type",
        ".roof-type",
      ],
      inputs: ["#windowQuantityTab2"],
      extraMaterials: ".extra-material",
    },
    tab3: {
      inputs: ["#lengthTab3", "#widthTab3"],
      selects: [
        ".finish-type",
        ".wall-painting",
        ".insulation-type",
        ".finish-direction",
      ],
      extraMaterials: ".extra-material",
    },
    tab4: {
      inputs: ["#lengthTab4", "#widthTab4"],
      selects: [
        ".finish-type",
        ".wall-painting",
        ".insulation-type",
        ".finish-direction",
      ],
      extraMaterials: ".extra-material",
    },
    tab5: {
      inputs: ["#lengthTab5", "#widthTab5"],
      selects: [
        ".finish-type",
        ".wall-painting",
        ".insulation-type",
        ".finish-direction",
      ],
      extraMaterials: ".extra-material",
    },
    tab6: {
      inputs: ["#lengthTab6", "#widthTab6"],
      selects: [
        ".finish-type",
        ".wall-painting",
        ".insulation-type",
        ".finish-direction",
      ],
      extraMaterials: ".extra-material",
    },
    tab7: {
      inputs: ["#lengthTab7", "#widthTab7"],
      selects: [
        ".finish-type",
        ".ceiling-painting",
        ".insulation-type",
        ".finish-direction",
      ],
      extraMaterials: ".extra-material",
    },
    tab8: {
      inputs: ["#lengthTab8", "#widthTab8"],
      selects: [".finish-type", ".insulation-type"],
      extraMaterials: ".extra-material",
    },
    tab9: {
      selects: [".cable-type", ".switch-type", ".socket-type", ".spot-type"],
      inputs: [
        "#cableQuantityTab9",
        "#switchQuantityTab9",
        "#socketQuantityTab9",
        "#spotQuantityTab9",
      ],
      extraMaterials: ".extra-material",
    },
    tab10: {
      selects: [
        ".furniture-material",
        ".furniture-painting",
        ".shelf-top-material",
        ".shelf-bottom-material",
        ".stove-side",
        ".countertop",
      ],
      inputs: ["#shelfTopQuantityTab10", "#shelfBottomQuantityTab10"],
      extraMaterials: ".extra-material",
    },
    tab11: {
      extraMaterials: ".extra-material",
    },
  };

  const tabConfig = selectors[tabId];
  if (!tabConfig) {
    showNotification(
      `Ошибка: Конфигурация для вкладки ${tabId} не определена`,
      true,
    );
    logEvent(analytics, "calculation_error", {
      reason: `No selectors for tab ${tabId}`,
      page_title: "Balcony Calculator",
    });
    return data;
  }

  // Сбор данных из select элементов
  if (tabConfig.selects) {
    tabConfig.selects.forEach((selector) => {
      const element = tab.querySelector(selector);
      if (!element) {
        logEvent(analytics, "calculation_warning", {
          reason: `Element ${selector} not found in tab ${tabId}`,
          page_title: "Balcony Calculator",
        });
        return;
      }
      const fieldName = selector.startsWith("#")
        ? selector.replace("#", "")
        : selector.replace(/\./g, "");
      data[fieldName] = element.value || "";
    });
  }

  // Сбор данных из input элементов (числовые поля)
  if (tabConfig.inputs) {
    tabConfig.inputs.forEach((selector) => {
      const input = tab.querySelector(selector);
      if (!input) {
        logEvent(analytics, "calculation_warning", {
          reason: `Input ${selector} not found in tab ${tabId}`,
          page_title: "Balcony Calculator",
        });
        data[selector.replace("#", "")] = 0;
        return;
      }
      data[selector.replace("#", "")] = parseFloat(input.value) || 0;
    });
  }

  // Сбор данных из .extra-material
  if (tabConfig.extraMaterials) {
    const elements = tab.querySelectorAll(tabConfig.extraMaterials);
    data.extraMaterials = Array.from(elements)
      .map((el) => {
        const quantityInput = el.parentElement.querySelector(
          'input[type="number"]',
        );
        if (!quantityInput) {
          logEvent(analytics, "calculation_warning", {
            reason: `Quantity input not found for extra-material in tab ${tabId}`,
            page_title: "Balcony Calculator",
          });
          return null;
        }
        const quantity = parseFloat(quantityInput.value) || 0;
        if (quantity <= 0 && el.value) {
          quantityInput.classList.add("invalid");
          const errorElement = quantityInput.nextElementSibling;
          if (errorElement) {
            errorElement.textContent = "Введите количество больше 0";
            errorElement.classList.add("show");
          }
          return null;
        }
        const [materialKey] = (el.value || "").split(":");
        return { materialKey, quantity };
      })
      .filter((item) => item && item.materialKey && item.quantity > 0);
  }

  logEvent(analytics, "tab_data_collected", {
    tab_id: tabId,
    data_keys: Object.keys(data),
    extra_materials_count: data.extraMaterials ? data.extraMaterials.length : 0,
    page_title: "Balcony Calculator",
  });

  return data;
}

/**
 * Выполняет расчёт для всех вкладок и отображает результаты.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} validateForm - Функция для валидации формы.
 * @param {string} authToken - Токен аутентификации для запросов.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<void>}
 */
async function calculateAll(showNotification, validateForm, authToken, userId) {
  try {
    if (!authToken || typeof authToken !== "string") {
      throw new Error("Токен аутентификации отсутствует или недействителен");
    }

    if (!validateForm(true)) {
      showNotification(
        "Пожалуйста, заполните данные о расчёте: номер заказа, адрес и телефон.",
        true,
      );
      logEvent(analytics, "calculation_failed", {
        reason: "form_validation",
        page_title: "Balcony Calculator",
        user_id: userId || "unknown",
      });
      return;
    }

    const resultsContainer = document.getElementById("results");
    if (!resultsContainer) {
      showNotification("Ошибка: Контейнер результатов не найден.", true);
      throw new Error("Results container not found");
    }

    resultsContainer.innerHTML =
      "<h2>Результаты расчёта</h2><p>Выполняется расчёт...</p>";

    const tabs = [
      "tab1",
      "tab2",
      "tab3",
      "tab4",
      "tab5",
      "tab6",
      "tab7",
      "tab8",
      "tab9",
      "tab10",
      "tab11",
    ];
    const allResults = [];
    let totalCost = 0;

    for (const tabId of tabs) {
      const tabData = getTabData(tabId, showNotification);
      const tabButton = document.querySelector(
        `.tab__button[data-tab="${tabId}"]`,
      );
      if (!tabButton) {
        logEvent(analytics, "calculation_warning", {
          reason: `Tab button for ${tabId} not found`,
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
        continue;
      }
      const tabName = tabButton.textContent;

      let hasValidData = false;
      for (const key in tabData) {
        if (Array.isArray(tabData[key])) {
          if (
            tabData[key].some((item) => item.materialKey && item.quantity > 0)
          ) {
            hasValidData = true;
            break;
          }
        } else if (
          tabData[key] &&
          tabData[key] !== "" &&
          tabData[key] !== "no"
        ) {
          hasValidData = true;
          break;
        }
      }

      if (!hasValidData) {
        logEvent(analytics, "calculation_skipped", {
          tab_id: tabId,
          reason: "no_valid_data",
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
        continue;
      }

      const response = await fetch(CALCULATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          tabName,
          data: tabData,
          userId: userId || "unknown",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP ошибка: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || "Ошибка расчёта");
      }

      allResults.push({
        tabName,
        results: result.results,
        totalCost: result.totalCost,
      });
      totalCost += parseFloat(result.totalCost) || 0;

      logEvent(analytics, "tab_calculated", {
        tab_id: tabId,
        tab_name: tabName,
        total_cost: parseFloat(result.totalCost) || 0,
        results_count: result.results.length,
        page_title: "Balcony Calculator",
        user_id: userId || "unknown",
      });
    }

    if (allResults.length === 0) {
      showNotification(
        "Нет данных для расчёта. Убедитесь, что выбраны материалы и указаны количества.",
        true,
      );
      resultsContainer.innerHTML =
        "<h2>Результаты расчёта</h2><p>Нет данных для расчёта</p>";
      logEvent(analytics, "calculation_failed", {
        reason: "no_valid_data",
        page_title: "Balcony Calculator",
        user_id: userId || "unknown",
      });
      return;
    }

    resultsContainer.innerHTML = "<h2>Результаты расчёта</h2>";
    const headerInfo = document.createElement("div");
    headerInfo.className = "header-info";
    const orderNumber =
      document.getElementById("orderNumberInput")?.value || "Не указан";
    const address =
      document.getElementById("addressInput")?.value || "Не указан";
    const phone = document.getElementById("phoneInput")?.value || "Не указан";
    headerInfo.innerHTML = `
      <p>Номер заказа: ${orderNumber}</p>
      <p>Адрес: ${address}</p>
      <p>Телефон: ${phone}</p>
    `;
    resultsContainer.appendChild(headerInfo);

    allResults.forEach(({ tabName, results, totalCost: tabTotal }) => {
      if (results.length === 0) return;
      const section = document.createElement("div");
      section.innerHTML = `<h3>${tabName} (Итого: ${parseFloat(tabTotal).toFixed(2)} руб.)</h3>`;
      const ul = document.createElement("ul");
      results.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = `${item.material}: ${item.quantity} ${item.unit} - ${parseFloat(item.cost).toFixed(2)} руб.`;
        ul.appendChild(li);
      });
      section.appendChild(ul);
      resultsContainer.appendChild(section);
    });

    const totalDiv = document.createElement("div");
    totalDiv.innerHTML = `<h3>Общая стоимость: ${totalCost.toFixed(2)} руб.</h3>`;
    resultsContainer.appendChild(totalDiv);

    showNotification("Расчёт успешно выполнен", false);
    logEvent(analytics, "calculation_success", {
      total_cost: totalCost,
      tabs_processed: allResults.length,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  } catch (error) {
    const message = error.message.includes("HTTP ошибка")
      ? "Ошибка сервера при выполнении расчёта. Проверьте подключение или попробуйте позже."
      : `Ошибка расчёта: ${error.message}`;
    showNotification(message, true);
    const resultsContainer = document.getElementById("results");
    if (resultsContainer) {
      resultsContainer.innerHTML =
        "<h2>Результаты расчёта</h2><p>Ошибка при выполнении расчёта</p>";
    }
    logEvent(analytics, "calculation_failed", {
      reason: error.message,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  }
}

/**
 * Сохраняет результаты расчёта в формате JSON.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя.
 */
function saveCalculation(showNotification, userId) {
  try {
    const resultsContainer = document.getElementById("results");
    if (!resultsContainer) {
      showNotification("Ошибка: Контейнер результатов не найден.", true);
      throw new Error("Results container not found");
    }

    const resultsData = {
      header: {
        orderNumber:
          document.getElementById("orderNumberInput")?.value || "Не указан",
        address: document.getElementById("addressInput")?.value || "Не указан",
        phone: document.getElementById("phoneInput")?.value || "Не указан",
      },
      tabs: [],
      totalCost: 0,
    };

    const sections = resultsContainer.querySelectorAll("div:not(.header-info)");
    sections.forEach((section) => {
      const tabName = section.querySelector("h3")?.textContent?.split(" (")[0];
      if (!tabName) return;

      const totalCostMatch = section
        .querySelector("h3")
        ?.textContent?.match(/Итого: ([\d.]+) руб./);
      const tabTotal = totalCostMatch ? parseFloat(totalCostMatch[1]) : 0;

      const items = Array.from(section.querySelectorAll("li")).map((li) => {
        const [materialPart, costPart] = li.textContent.split(" - ");
        const [material, quantity, unit] = materialPart
          .split(": ")[1]
          .split(" ");
        const cost = parseFloat(costPart.split(" ")[0]) || 0;
        return { material, quantity: parseFloat(quantity) || 0, unit, cost };
      });

      resultsData.tabs.push({ tabName, results: items, totalCost: tabTotal });
      resultsData.totalCost += tabTotal;
    });

    if (resultsData.tabs.length === 0) {
      showNotification("Нет результатов для сохранения.", true);
      logEvent(analytics, "calculation_save_failed", {
        reason: "no_results",
        page_title: "Balcony Calculator",
        user_id: userId || "unknown",
      });
      return;
    }

    const blob = new Blob([JSON.stringify(resultsData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `calculation_${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification("Расчёт сохранён", false);
    logEvent(analytics, "calculation_saved", {
      tabs_count: resultsData.tabs.length,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  } catch (error) {
    showNotification(`Ошибка при сохранении расчёта: ${error.message}`, true);
    logEvent(analytics, "calculation_save_failed", {
      reason: error.message,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  }
}

/**
 * Загружает результаты расчёта из JSON-файла.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {string} userId - ID пользователя.
 */
function loadCalculation(showNotification, userId) {
  try {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) {
        showNotification("Файл не выбран.", true);
        logEvent(analytics, "calculation_load_failed", {
          reason: "no_file_selected",
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const resultsData = JSON.parse(event.target.result);
          const resultsContainer = document.getElementById("results");
          if (!resultsContainer) {
            showNotification("Ошибка: Контейнер результатов не найден.", true);
            throw new Error("Results container not found");
          }

          if (
            !resultsData.header ||
            !resultsData.tabs ||
            !Array.isArray(resultsData.tabs)
          ) {
            throw new Error("Некорректный формат загруженных данных");
          }

          resultsContainer.innerHTML = "<h2>Результаты расчёта</h2>";
          const headerInfo = document.createElement("div");
          headerInfo.className = "header-info";
          headerInfo.innerHTML = `
            <p>Номер заказа: ${resultsData.header.orderNumber}</p>
            <p>Адрес: ${resultsData.header.address}</p>
            <p>Телефон: ${resultsData.header.phone}</p>
          `;
          resultsContainer.appendChild(headerInfo);

          resultsData.tabs.forEach(({ tabName, results, totalCost }) => {
            if (!results || results.length === 0) return;
            const section = document.createElement("div");
            section.innerHTML = `<h3>${tabName} (Итого: ${parseFloat(totalCost).toFixed(2)} руб.)</h3>`;
            const ul = document.createElement("ul");
            results.forEach((item) => {
              const li = document.createElement("li");
              li.textContent = `${item.material}: ${item.quantity} ${item.unit} - ${parseFloat(item.cost).toFixed(2)} руб.`;
              ul.appendChild(li);
            });
            section.appendChild(ul);
            resultsContainer.appendChild(section);
          });

          const totalDiv = document.createElement("div");
          totalDiv.innerHTML = `<h3>Общая стоимость: ${parseFloat(resultsData.totalCost).toFixed(2)} руб.</h3>`;
          resultsContainer.appendChild(totalDiv);

          showNotification("Расчёт загружен", false);
          logEvent(analytics, "calculation_loaded", {
            tabs_count: resultsData.tabs.length,
            page_title: "Balcony Calculator",
            user_id: userId || "unknown",
          });
        } catch (error) {
          showNotification(
            `Ошибка при загрузке расчёта: ${error.message}`,
            true,
          );
          logEvent(analytics, "calculation_load_failed", {
            reason: error.message,
            page_title: "Balcony Calculator",
            user_id: userId || "unknown",
          });
        }
      };
      reader.onerror = () => {
        showNotification("Ошибка при чтении файла.", true);
        logEvent(analytics, "calculation_load_failed", {
          reason: "file_read_error",
          page_title: "Balcony Calculator",
          user_id: userId || "unknown",
        });
      };
      reader.readAsText(file);
    };
    input.click();
  } catch (error) {
    showNotification(
      `Ошибка при запуске загрузки расчёта: ${error.message}`,
      true,
    );
    logEvent(analytics, "calculation_load_failed", {
      reason: error.message,
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  }
}

/**
 * Инициализирует обработчики событий для кнопок расчёта, сохранения и загрузки.
 * @param {Function} showNotification - Функция для отображения уведомлений.
 * @param {Function} validateForm - Функция для валидации формы.
 * @param {string} authToken - Токен аутентификации.
 * @param {string} userId - ID пользователя.
 * @returns {Promise<void>}
 */
async function initializeCalculation(
  showNotification,
  validateForm,
  authToken,
  userId,
) {
  const calculateBtn = document.getElementById("calculateBtn");
  const saveCalculationBtn = document.getElementById("saveCalculationBtn");
  const loadCalculationBtn = document.getElementById("loadCalculationBtn");

  if (!calculateBtn || !saveCalculationBtn || !loadCalculationBtn) {
    showNotification("Ошибка: Кнопки управления расчётом не найдены", true);
    throw new Error("Required buttons not found");
  }

  if (
    typeof showNotification !== "function" ||
    typeof validateForm !== "function"
  ) {
    showNotification(
      "Ошибка: Неверные аргументы для инициализации расчёта",
      true,
    );
    throw new Error("showNotification and validateForm must be functions");
  }

  calculateBtn.addEventListener("click", async () => {
    await calculateAll(showNotification, validateForm, authToken, userId);
    logEvent(analytics, "calculation_initiated", {
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  });

  saveCalculationBtn.addEventListener("click", () => {
    saveCalculation(showNotification, userId);
    logEvent(analytics, "calculation_save_initiated", {
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  });

  loadCalculationBtn.addEventListener("click", () => {
    loadCalculation(showNotification, userId);
    logEvent(analytics, "calculation_load_initiated", {
      page_title: "Balcony Calculator",
      user_id: userId || "unknown",
    });
  });

  logEvent(analytics, "calculation_initialized", {
    page_title: "Balcony Calculator",
    user_id: userId || "unknown",
  });
}

export { getTabData, calculateAll, initializeCalculation };
