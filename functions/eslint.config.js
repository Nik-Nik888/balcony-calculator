const prettier = require('eslint-config-prettier');
const eslintPluginPrettier = require('eslint-plugin-prettier');
const eslintPluginImport = require('eslint-plugin-import');

module.exports = [
  // Конфигурация для клиентских файлов (папка /src)
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        browser: true,
        node: false,
      },
    },
    plugins: {
      prettier: eslintPluginPrettier,
      import: eslintPluginImport,
    },
    rules: {
      ...require('eslint:recommended').rules,
      ...prettier.rules,
      // Стилистические правила
      'indent': ['error', 2],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'max-len': ['error', { code: 100 }],
      'object-curly-spacing': ['error', 'always'],
      // Разрешаем console.warn и console.error
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Интеграция с Prettier
      'prettier/prettier': 'error',
      // Правила для импортов
      'import/no-unresolved': ['error', { commonjs: false, amd: false }],
      // Отключаем избыточные правила
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Конфигурация для серверных файлов (папка /functions)
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        node: true,
        browser: false,
      },
    },
    plugins: {
      prettier: eslintPluginPrettier,
      import: eslintPluginImport,
    },
    rules: {
      ...require('eslint:recommended').rules,
      ...prettier.rules,
      // Стилистические правила
      'indent': ['error', 2],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'max-len': ['error', { code: 100 }],
      'object-curly-spacing': ['error', 'always'],
      // Разрешаем все методы console для серверных файлов
      'no-console': 'off',
      // Интеграция с Prettier
      'prettier/prettier': 'error',
      // Правила для импортов
      'import/no-unresolved': ['error', { commonjs: true, amd: false }],
      // Отключаем избыточные правила
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];