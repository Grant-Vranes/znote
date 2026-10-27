import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "./",
  build: {
    outDir: path.resolve(root, "../../build/desktop-resources/excalidraw"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
