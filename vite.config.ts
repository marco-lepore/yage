import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import packageJson from "./package.json";

const globals = {
  "pixi.js": "PIXI",
  "@pixi/core": "PIXI",
  "@pixi/assets": "PIXI",
  "@dimforge/rapier2d": "RAPIER",
};

export default defineConfig({
  build: {
    sourcemap: true,
    lib: {
      formats: ["es", "cjs", "umd"],
      entry: resolve(__dirname, "src/index.ts"),
      name: "pixi-engine",
      fileName: (format) => {
        switch (format) {
          case "cjs":
            return "pixi-engine.js";
          case "es":
            return "pixi-engine.es.js";
          case "umd":
            return "pixi-engine.umd.js";
        }

        return `pixi-tilemap.${format}.js`;
      },
    },
    rollupOptions: {},
  },
  optimizeDeps: {
    exclude: Object.keys(packageJson.peerDependencies),
  },
  plugins: [
    dts({
      rollupTypes: true,
    }),
  ],
});
