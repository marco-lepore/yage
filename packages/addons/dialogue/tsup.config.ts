import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  // Two entries enforce the export split:
  //   "."           -> src/index.ts      (headless: no pixi / @yagejs/renderer)
  //   "./presenters" -> src/presenters.ts (pixi: chrome/render/composite/avatar)
  entry: ["src/index.ts", "src/presenters.ts"],
  format: ["esm", "cjs"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  keepNames: true,
  target: "es2022",
});
