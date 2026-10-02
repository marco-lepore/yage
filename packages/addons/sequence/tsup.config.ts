import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/index.ts", "src/document.ts", "src/renderer.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  keepNames: true,
  target: "es2022",
  clean: true,
});
