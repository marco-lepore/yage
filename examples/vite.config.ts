import { defineConfig } from "vite";
import { resolve } from "path";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  server: {
    port: 5199,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "hello-world": resolve(__dirname, "hello-world.html"),
        camera: resolve(__dirname, "camera.html"),
        "physics-basics": resolve(__dirname, "physics-basics.html"),
        "physics-collisions": resolve(__dirname, "physics-collisions.html"),
        platformer: resolve(__dirname, "platformer.html"),
        shooter: resolve(__dirname, "shooter.html"),
        particles: resolve(__dirname, "particles.html"),
      },
    },
  },
});
