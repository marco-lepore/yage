import { defineConfig } from "tsup";
export default defineConfig([
  {
    entry: ["src/index.ts", "src/server.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    target: "es2022",
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    clean: false,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
