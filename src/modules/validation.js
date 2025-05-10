import { analytics, logEvent, db } from "./firebase.js";

/**
 * Логирует событие в Firestore.
 * @param {string} event - Название события.
 * @param {Object} params - Параметры события.
 */
async function logToFirestore(event, params) {
  try {
    await db.collection("analytics").add({
      event,
      userId: params.userId || "unknown",
      page_title: "Balcony Calculator",
      timestamp: new Date().toISOString(),
      ...params,
    });
  } catch (error) {
    logEvent(analytics, "firestore_log_failed", {
      event,
      message: error.message,
      page_title: "Balcony Calculator",
      user_id: params.userId || "unknown",
    });
  }
}

/**
 * Валидирует числовое поле.
 * @param {HTMLElement} input - Элемент ввода.
 * @param {string} id - ID элемента.
 * @returns {boolean} True, если поле валидно, иначе false.
 */
function validateNumericInput(input, id) {
  if (!input || !input.value.trim()) return true;
  const value = parseFloat(input.value);
  if (isNaN(value) || value < 0) {
    input.classList.add("invalid");
    const errorElement = document.getElementById(`${id}-error`);
    if (errorElement) {
      errorElement.textContent = "Пожалуйста, введите положительное число";
      errorElement.classList.add("show");
    }
    return false;
  }
  return true;
}

/**
 * Валидирует форму, проверяя обязательные поля и их формат.
 * @param {boolean} [isCalculation=false] - Указывает, выполняется ли валидация при расчёте (проверка полей "Номер заказа", "Адрес", "Телефон").
 * @returns {boolean} True, если форма валидна, иначе false.
 */
function validateForm(isCalculation = false) {
  let isValid = true;
  const invalidFields = [];

  // Сбрасываем ошибки
  const inputs = document.querySelectorAll(".input-field");
  inputs.forEach((input) => {
    input.classList.remove("invalid");
    const errorElement = document.getElementById(`${input.id}-error`);
    if (errorElement) {
      errorElement.textContent = "";
      errorElement.classList.remove("show");
    }
  });

  const categoriesError = document.getElementById("categories-error");
  if (categoriesError) {
    categoriesError.textContent = "";
    categoriesError.classList.remove("show");
  }

  // Валидация полей при расчёте
  if (isCalculation) {
    const orderNumberInput = document.getElementById("orderNumberInput");
    const addressInput = document.getElementById("addressInput");
    const phoneInput = document.getElementById("phoneInput");
    const phonePattern =
      /^\+?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,4}$/;

    if (!orderNumberInput) {
      logEvent(analytics, "form_validation_dom_error", {
        inputId: "orderNumberInput",
        reason: "Input element not found",
        page_title: "Balcony Calculator",
        user_id: "unknown",
      });
      return false;
    }
    if (!orderNumberInput.value.trim()) {
      orderNumberInput.classList.add("invalid");
      const errorElement = document.getElementById("orderNumberInput-error");
      if (errorElement) {
        errorElement.textContent = "Пожалуйста, введите номер заказа";
        errorElement.classList.add("show");
      }
      invalidFields.push("orderNumberInput");
      isValid = false;
    }

    if (!addressInput) {
      logEvent(analytics, "form_validation_dom_error", {
        inputId: "addressInput",
        reason: "Input element not found",
        page_title: "Balcony Calculator",
        user_id: "unknown",
      });
      return false;
    }
    if (!addressInput.value.trim()) {
      addressInput.classList.add("invalid");
      const errorElement = document.getElementById("addressInput-error");
      if (errorElement) {
        errorElement.textContent = "Пожалуйста, введите адрес";
        errorElement.classList.add("show");
      }
      invalidFields.push("addressInput");
      isValid = false;
    }

    if (!phoneInput) {
      logEvent(analytics, "form_validation_dom_error", {
        inputId: "phoneInput",
        reason: "Input element not found",
        page_title: "Balcony Calculator",
        user_id: "unknown",
      });
      return false;
    }
    if (!phoneInput.value.trim() || !phonePattern.test(phoneInput.value)) {
      phoneInput.classList.add("invalid");
      const errorElement = document.getElementById("phoneInput-error");
      if (errorElement) {
        errorElement.textContent =
          "Пожалуйста, введите корректный номер телефона";
        errorElement.classList.add("show");
      }
      invalidFields.push("phoneInput");
      isValid = false;
    }
  }

  // Валидация числовых полей
  const numericInputs = [
    "extraQuantityTab1",
    "windowQuantityInputTab2",
    "extraQuantityTab2",
    "lengthTab3",
    "widthTab3",
    "extraQuantityTab3",
    "lengthTab4",
    "widthTab4",
    "extraQuantityTab4",
    "lengthTab5",
    "widthTab5",
    "extraQuantityTab5",
    "lengthTab6",
    "widthTab6",
    "extraQuantityTab6",
    "lengthTab7",
    "widthTab7",
    "extraQuantityTab7",
    "lengthTab8",
    "widthTab8",
    "extraQuantityTab8",
    "cableQuantityInputTab9",
    "switchQuantityInputTab9",
    "socketQuantityInputTab9",
    "spotQuantityInputTab9",
    "extraQuantityTab9",
    "shelfTopQuantityInputTab10",
    "shelfBottomQuantityInputTab10",
    "extraQuantityTab10",
    "extraQuantityTab11",
    "priceInput",
    "quantityInput",
  ];

  numericInputs.forEach((id) => {
    const input = document.getElementById(id);
    if (!input) {
      logEvent(analytics, "form_validation_dom_error", {
        inputId: id,
        reason: "Input element not found",
        page_title: "Balcony Calculator",
        user_id: "unknown",
      });
      isValid = false;
      invalidFields.push(id);
      return;
    }
    if (!validateNumericInput(input, id)) {
      invalidFields.push(id);
      isValid = false;
    }
  });

  // Валидация поля "Название материала"
  const newMaterialInput = document.getElementById("newMaterialInput");
  if (newMaterialInput && !newMaterialInput.value.trim()) {
    newMaterialInput.classList.add("invalid");
    const errorElement = document.getElementById("newMaterialInput-error");
    if (errorElement) {
      errorElement.textContent = "Пожалуйста, введите название материала";
      errorElement.classList.add("show");
    }
    invalidFields.push("newMaterialInput");
    isValid = false;
  }

  // Валидация категорий
  const selectedCategories = document.querySelectorAll(
    'input[name="category"]:checked',
  );
  if (selectedCategories.length === 0) {
    const errorElement = document.getElementById("categories-error");
    if (errorElement) {
      errorElement.textContent = "Пожалуйста, выберите хотя бы одну категорию";
      errorElement.classList.add("show");
    }
    invalidFields.push("categories");
    isValid = false;
  }

  // Валидация поля "Размеры"
  const dimensionsInput = document.getElementById("dimensionsInput");
  if (dimensionsInput && dimensionsInput.value.trim()) {
    const dimensionsValue = dimensionsInput.value.trim().replace(/\*/g, "x");
    const dimensionsPattern = /^\d*\.?\d+x\d*\.?\d+(x\d*\.?\d+)?$/;
    if (!dimensionsPattern.test(dimensionsValue)) {
      dimensionsInput.classList.add("invalid");
      const errorElement = document.getElementById("dimensionsInput-error");
      if (errorElement) {
        errorElement.textContent =
          "Введите размеры в формате Д*Ш или Д*Ш*В (например, 60*2.5 или 60*2.5*10)";
        errorElement.classList.add("show");
      }
      invalidFields.push("dimensionsInput");
      isValid = false;
    } else {
      const [length, width, height] = dimensionsValue
        .split("x")
        .map((val) => parseFloat(val));
      if (length <= 0 || width <= 0) {
        dimensionsInput.classList.add("invalid");
        const errorElement = document.getElementById("dimensionsInput-error");
        if (errorElement) {
          errorElement.textContent =
            "Длина и ширина должны быть положительными числами";
          errorElement.classList.add("show");
        }
        invalidFields.push("dimensionsInput");
        isValid = false;
      }
      if (height !== undefined && height < 0) {
        dimensionsInput.classList.add("invalid");
        const errorElement = document.getElementById("dimensionsInput-error");
        if (errorElement) {
          errorElement.textContent = "Высота не может быть отрицательной";
          errorElement.classList.add("show");
        }
        invalidFields.push("dimensionsInput");
        isValid = false;
      }
    }
  }

  // Логирование результата валидации
  if (isValid) {
    logEvent(analytics, "form_validation_success", {
      isCalculation,
      page_title: "Balcony Calculator",
      user_id: "unknown",
    });
    logToFirestore("form_validation_success", {
      isCalculation,
    });
  } else {
    logEvent(analytics, "form_validation_failed", {
      isCalculation,
      invalidFields,
      page_title: "Balcony Calculator",
      user_id: "unknown",
    });
    logToFirestore("form_validation_failed", {
      isCalculation,
      invalidFields,
    });
  }

  return isValid;
}

export { validateForm };
