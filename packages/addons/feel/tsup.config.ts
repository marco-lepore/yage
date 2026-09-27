import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/renderer.ts",
    "src/audio.ts",
    "src/particles.ts",
    "src/recipes.ts",
  ],
  format: ["esm", "cjs"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  keepNames: true,
  target: "es2022",
});
