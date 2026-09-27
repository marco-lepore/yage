import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  // Single entry: quests has no presenters, so there is no "./presenters"
  // export split — everything lives on the root, pixi-free.
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  keepNames: true,
  target: "es2022",
});
