import { defineConfig } from "tsup";
const watch = process.argv.includes("--watch");
export default defineConfig([
  {
    entry: ["src/index.ts", "src/node.ts"],
    format: ["esm"],
    dts: !watch,
    clean: !watch,
    sourcemap: true,
    keepNames: true,
    target: "es2022",
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    keepNames: true,
    target: "node22",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
