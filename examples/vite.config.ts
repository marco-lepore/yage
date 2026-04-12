import { defineConfig } from "vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), wasm()],
  server: {
    port: 5199,
  },
  oxc: {
    // Transform TypeScript's legacy (stage-2) decorators. oxc only supports
    // the legacy transform — stage-3 decorators would be passed through to
    // the browser, which can't parse them yet. @yagejs/save's @serializable
    // decorator works under either transform, so legacy mode is the safe pick.
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
        main: resolve(__dirname, "index.html"),
        debug: resolve(__dirname, "debug.html"),
        "hello-world": resolve(__dirname, "hello-world.html"),
        camera: resolve(__dirname, "camera.html"),
        "physics-basics": resolve(__dirname, "physics-basics.html"),
        "physics-collisions": resolve(__dirname, "physics-collisions.html"),
        platformer: resolve(__dirname, "platformer.html"),
        shooter: resolve(__dirname, "shooter.html"),
        particles: resolve(__dirname, "particles.html"),
        audio: resolve(__dirname, "audio.html"),
        ui: resolve(__dirname, "ui.html"),
        "ui-react": resolve(__dirname, "ui-react.html"),
        "pixi-ui-kitchen-sink": resolve(__dirname, "pixi-ui-kitchen-sink.html"),
        tilemap: resolve(__dirname, "tilemap.html"),
        "input-remapping": resolve(__dirname, "input-remapping.html"),
        "scene-pause": resolve(__dirname, "scene-pause.html"),
        "save-load": resolve(__dirname, "save-load.html"),
        "ui-layers": resolve(__dirname, "ui-layers.html"),
      },
    },
  },
});
