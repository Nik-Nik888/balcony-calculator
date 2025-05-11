import { defineConfig } from "vite";

  export default defineConfig({
    root: ".", // Корень проекта
    publicDir: "public", // Папка с index.html
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  });