import { defineConfig } from "vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), wasm(), topLevelAwait()],
  server: {
    port: 5199,
  },
  esbuild: {
    keepNames: true,
  },
  build: {
    rollupOptions: {
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
        "ui-layers": resolve(__dirname, "ui-layers.html"),
      },
    },
  },
});
