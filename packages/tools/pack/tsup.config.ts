import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

/** Loaded only by the Forge configuration, or for types. */
const optional = [
  "@capacitor/cli",
  "@electron-forge/plugin-fuses",
  "@electron-forge/shared-types",
  "@electron/fuses",
];

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      forge: "src/forge/index.ts",
      capacitor: "src/capacitor/index.ts",
    },
    format: ["esm", "cjs"],
    dts: !isWatch,
    clean: !isWatch,
    sourcemap: true,
    keepNames: true,
    target: "node22",
    platform: "node",
    external: optional,
  },
  {
    // Separate because the shebang belongs to the executable alone.
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    keepNames: true,
    target: "node22",
    platform: "node",
    external: optional,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
