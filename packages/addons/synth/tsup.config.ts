import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  // One entry: the addon has no view layer, so there is no "./presenters"
  // split to make. `src/core/` is plain math and imports nothing.
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  keepNames: true,
  target: "es2022",
});
