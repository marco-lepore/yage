import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  entry: ["src/index.ts", "src/input.ts"],
  format: ["esm", "cjs"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  target: "es2022",
});
