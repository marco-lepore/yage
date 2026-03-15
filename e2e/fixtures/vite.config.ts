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
  build: {
    rollupOptions: {
      input: {
        "inspector-scene": resolve(__dirname, "inspector-scene.html"),
        "physics-bounce": resolve(__dirname, "physics-bounce.html"),
      },
    },
  },
});
