/**
 * Валидирует форму, проверяя обязательные поля и их формат.
 * @param {boolean} isCalculation - Указывает, выполняется ли валидация при расчёте (проверка полей "Номер заказа", "Адрес", "Телефон").
 * @returns {boolean} Возвращает true, если форма валидна, иначе false.
 */
function validateForm(isCalculation = false) {
  let isValid = true;

  // Сбрасываем ошибки перед валидацией
  const inputs = document.querySelectorAll('.input-field');
  inputs.forEach(input => {
    input.classList.remove('invalid');
    const errorElement = document.getElementById(`${input.id}-error`);
    if (errorElement) {
      errorElement.textContent = '';
      errorElement.classList.remove('show');
    }
  });

  // Сбрасываем ошибку для категорий
  const categoriesError = document.getElementById('categories-error');
  if (categoriesError) {
    categoriesError.textContent = '';
    categoriesError.classList.remove('show');
  }

  // Валидация полей "Номер заказа", "Адрес", "Телефон" при расчёте
  if (isCalculation) {
    const orderNumberInput = document.getElementById('orderNumberInput');
    const addressInput = document.getElementById('addressInput');
    const phoneInput = document.getElementById('phoneInput');
    const phonePattern = /^\+?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,4}$/;

    if (orderNumberInput && !orderNumberInput.value.trim()) {
      orderNumberInput.classList.add('invalid');
      const errorElement = document.getElementById('orderNumberInput-error');
      errorElement.textContent = 'Пожалуйста, введите номер заказа';
      errorElement.classList.add('show');
      isValid = false;
    }

    if (addressInput && !addressInput.value.trim()) {
      addressInput.classList.add('invalid');
      const errorElement = document.getElementById('addressInput-error');
      errorElement.textContent = 'Пожалуйста, введите адрес';
      errorElement.classList.add('show');
      isValid = false;
    }

    if (phoneInput && (!phoneInput.value.trim() || !phonePattern.test(phoneInput.value))) {
      phoneInput.classList.add('invalid');
      const errorElement = document.getElementById('phoneInput-error');
      errorElement.textContent = 'Пожалуйста, введите корректный номер телефона';
      errorElement.classList.add('show');
      isValid = false;
    }
  }

  // Валидация числовых полей (проверка на положительные числа)
  const numericInputs = [
    'extraQuantityTab1',
    'windowQuantityInputTab2', 'extraQuantityTab2',
    'lengthTab3', 'widthTab3', 'extraQuantityTab3',
    'lengthTab4', 'widthTab4', 'extraQuantityTab4',
    'lengthTab5', 'widthTab5', 'extraQuantityTab5',
    'lengthTab6', 'widthTab6', 'extraQuantityTab6',
    'lengthTab7', 'widthTab7', 'extraQuantityTab7',
    'lengthTab8', 'widthTab8', 'extraQuantityTab8',
    'cableQuantityInputTab9', 'switchQuantityInputTab9', 'socketQuantityInputTab9', 'spotQuantityInputTab9', 'extraQuantityTab9',
    'shelfTopQuantityInputTab10', 'shelfBottomQuantityInputTab10', 'extraQuantityTab10',
    'extraQuantityTab11',
    'priceInput', 'quantityInput'
  ];

  numericInputs.forEach(id => {
    const input = document.getElementById(id);
    if (input && input.value.trim()) { // Проверяем только заполненные поля
      const value = parseFloat(input.value);
      if (isNaN(value) || value < 0) {
        input.classList.add('invalid');
        const errorElement = document.getElementById(`${id}-error`);
        errorElement.textContent = 'Пожалуйста, введите положительное число';
        errorElement.classList.add('show');
        isValid = false;
      }
    }
  });

  // Валидация поля "Название материала" (обязательное поле)
  const newMaterialInput = document.getElementById('newMaterialInput');
  if (newMaterialInput && !newMaterialInput.value.trim()) {
    newMaterialInput.classList.add('invalid');
    const errorElement = document.getElementById('newMaterialInput-error');
    errorElement.textContent = 'Пожалуйста, введите название материала';
    errorElement.classList.add('show');
    isValid = false;
  }

  // Валидация категорий (обязательное поле)
  const selectedCategories = document.querySelectorAll('input[name="category"]:checked');
  if (selectedCategories.length === 0) {
    const errorElement = document.getElementById('categories-error');
    if (errorElement) {
      errorElement.textContent = 'Пожалуйста, выберите хотя бы одну категорию';
      errorElement.classList.add('show');
    }
    isValid = false;
  }

  // Валидация поля "Размеры" (необязательное поле, но если заполнено, должно быть корректным)
  const dimensionsInput = document.getElementById('dimensionsInput');
  if (dimensionsInput && dimensionsInput.value.trim()) {
    const dimensionsValue = dimensionsInput.value.trim().replace(/\*/g, 'x');
    const dimensionsPattern = /^\d*\.?\d+x\d*\.?\d+(x\d*\.?\d+)?$/;
    if (!dimensionsPattern.test(dimensionsValue)) {
      dimensionsInput.classList.add('invalid');
      const errorElement = document.getElementById('dimensionsInput-error');
      errorElement.textContent = 'Введите размеры в формате Д*Ш или Д*Ш*В (например, 60*2.5 или 60*2.5*10)';
      errorElement.classList.add('show');
      isValid = false;
    } else {
      // Проверяем, что length и width положительные, а height неотрицательный
      const [length, width, height] = dimensionsValue.split('x').map(val => parseFloat(val));
      if (length <= 0 || width <= 0) {
        dimensionsInput.classList.add('invalid');
        const errorElement = document.getElementById('dimensionsInput-error');
        errorElement.textContent = 'Длина и ширина должны быть положительными числами';
        errorElement.classList.add('show');
        isValid = false;
      }
      if (height !== undefined && height < 0) {
        dimensionsInput.classList.add('invalid');
        const errorElement = document.getElementById('dimensionsInput-error');
        errorElement.textContent = 'Высота не может быть отрицательной';
        errorElement.classList.add('show');
        isValid = false;
      }
    }
  }

  return isValid;
}

export { validateForm };