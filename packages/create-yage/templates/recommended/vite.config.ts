import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  // vite-plugin-wasm is required by @yagejs/physics, which depends on
  // @dimforge/rapier2d — a WebAssembly module that needs proper ESM loading.
  plugins: [wasm()],
  oxc: {
    // YAGE's @trait decorator uses TypeScript's legacy decorator transform.
    decorator: {
      legacy: true,
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Preserve readable class and function names in diagnostics.
        keepNames: true,
      },
    },
  },
});
