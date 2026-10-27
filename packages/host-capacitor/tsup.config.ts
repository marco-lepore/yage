import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  entry: { index: "src/index.ts", detect: "src/detect.ts" },
  format: ["esm", "cjs"],
  dts: !isWatch,
  sourcemap: true,
  keepNames: true,
  target: "es2022",
  clean: true,
});
