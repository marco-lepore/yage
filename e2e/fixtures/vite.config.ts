import { defineConfig } from "vite";
import { resolve } from "path";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  root: __dirname,
  plugins: [wasm()],
  server: {
    port: 5200,
  },
  oxc: {
    // Transform TypeScript legacy (stage-2) decorators. See examples/vite.config.ts.
    decorator: {
      legacy: true,
    },
  },
  build: {
    rollupOptions: {
      // Preserve class/function names through the oxc minifier so that
      // @yagejs/save's class-name-based snapshot restoration still works in
      // production builds. Vite 8 switched from esbuild to oxc; the old
      // `esbuild: { keepNames: true }` option is silently dropped by the
      // oxc converter.
      output: {
        keepNames: true,
      },
      input: {
        input: resolve(__dirname, "input.html"),
        "inspector-scene": resolve(__dirname, "inspector-scene.html"),
        "physics-bounce": resolve(__dirname, "physics-bounce.html"),
        "scene-stack": resolve(__dirname, "scene-stack.html"),
        "save-load": resolve(__dirname, "save-load.html"),
        "ui-button": resolve(__dirname, "ui-button.html"),
        "camera-parallax": resolve(__dirname, "camera-parallax.html"),
        "camera-lifecycle": resolve(__dirname, "camera-lifecycle.html"),
        "loading-scene": resolve(__dirname, "loading-scene.html"),
      },
    },
  },
});
