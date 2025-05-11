import { defineConfig, loadEnv } from "vite";
  import { resolve } from "path";

  export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    return {
      root: ".", // Корень проекта
      publicDir: "public", // Папка с публичными файлами
      build: {
        outDir: "dist",
        emptyOutDir: true,
        rollupOptions: {
          input: resolve(__dirname, "public/index.html"), // Явно указываем входной файл
        },
      },
      resolve: {
        alias: {
          "@": resolve(__dirname, "src"), // Стандартный алиас для src/
        },
      },
      define: {
        "import.meta.env.VITE_FIREBASE_API_KEY": JSON.stringify(
          env.VITE_FIREBASE_API_KEY,
        ),
        "import.meta.env.VITE_FIREBASE_AUTH_DOMAIN": JSON.stringify(
          env.VITE_FIREBASE_AUTH_DOMAIN,
        ),
        "import.meta.env.VITE_FIREBASE_PROJECT_ID": JSON.stringify(
          env.VITE_FIREBASE_PROJECT_ID,
        ),
        "import.meta.env.VITE_FIREBASE_STORAGE_BUCKET": JSON.stringify(
          env.VITE_FIREBASE_STORAGE_BUCKET,
        ),
        "import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID": JSON.stringify(
          env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        ),
        "import.meta.env.VITE_FIREBASE_APP_ID": JSON.stringify(
          env.VITE_FIREBASE_APP_ID,
        ),
        "import.meta.env.VITE_FIREBASE_MEASUREMENT_ID": JSON.stringify(
          env.VITE_FIREBASE_MEASUREMENT_ID,
        ),
      },
    };
  });