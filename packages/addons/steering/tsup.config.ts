import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  // Two entries enforce the export split:
  //   "."         -> src/index.ts   (headless: @yagejs/core only)
  //   "./physics" -> src/physics.ts (value-imports @yagejs/physics)
  entry: ["src/index.ts", "src/physics.ts"],
  format: ["esm", "cjs"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  keepNames: true,
  target: "es2022",
});
