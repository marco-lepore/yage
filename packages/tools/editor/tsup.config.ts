import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      browser: "src/browser.ts",
      sequenceEntities: "src/entities/SequencePlaceholder.ts",
    },
    format: ["esm"],
    dts: !isWatch,
    clean: !isWatch,
    sourcemap: true,
    keepNames: true,
    target: "es2022",
  },
  {
    // Separate because the shebang belongs to the executable alone — the other
    // entries are imported, and a browser cannot parse one.
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
