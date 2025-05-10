import js from "@eslint/js";
import prettier from "eslint-plugin-prettier";
import importPlugin from "eslint-plugin-import";

export default [
  // Конфигурация для клиентских файлов (src/)
  {
    files: ["src/**/*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2022,
      globals: {
        console: "readonly",
        document: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        Blob: "readonly",
        URL: "readonly",
        FileReader: "readonly",
        confirm: "readonly",
        setTimeout: "readonly",
      },
    },
    plugins: {
      prettier,
      import: importPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      "prettier/prettier": "error",
      "import/no-unresolved": "error",
      "no-unused-vars": [
        "error",
        { vars: "all", args: "after-used", ignoreRestSiblings: true },
      ],
      "no-console": "warn",
    },
  },
  // Конфигурация для серверных файлов (functions/)
  {
    files: ["functions/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      ecmaVersion: 2022,
      globals: {
        console: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        process: "readonly",
      },
    },
    plugins: {
      prettier,
      import: importPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      "prettier/prettier": "error",
      "import/no-unresolved": "error",
      "no-unused-vars": [
        "error",
        { vars: "all", args: "after-used", ignoreRestSiblings: true },
      ],
      "no-console": "warn",
    },
  },
];
