import { defineConfig } from "vite";
import { resolve } from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  root: __dirname,
  plugins: [wasm(), topLevelAwait()],
  server: {
    port: 5200,
  },
  esbuild: {
    keepNames: true,
  },
  build: {
    rollupOptions: {
      input: {
        input: resolve(__dirname, "input.html"),
        "inspector-scene": resolve(__dirname, "inspector-scene.html"),
        "physics-bounce": resolve(__dirname, "physics-bounce.html"),
        "scene-stack": resolve(__dirname, "scene-stack.html"),
        "save-load": resolve(__dirname, "save-load.html"),
        "ui-button": resolve(__dirname, "ui-button.html"),
      },
    },
  },
});
