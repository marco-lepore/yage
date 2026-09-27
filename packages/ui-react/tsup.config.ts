import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: !isWatch,
  clean: !isWatch,
  sourcemap: true,
  target: "es2022",
  external: ["react", "react-reconciler"],
});
