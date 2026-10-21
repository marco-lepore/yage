import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");
const shared = {
  entry: [
    "src/index.ts",
    "src/plugin.ts",
    "src/worker.ts",
    "src/render.ts",
    "src/instruments.ts",
    "src/instruments/*.ts",
  ],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  // Retaining DSP function names keeps unused renderers alive in shared chunks.
  // The plugin uses an explicit name field; there are no reflected components.
  keepNames: false,
  target: "es2022",
};

export default defineConfig([
  { ...shared, format: ["esm"], splitting: true, outDir: "dist/esm" },
  // CommonJS consumers cannot discard unused exports from shared require calls.
  { ...shared, format: ["cjs"], splitting: false, outDir: "dist/cjs" },
]);
