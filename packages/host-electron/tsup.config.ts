import { defineConfig } from "tsup";

const isWatch = process.argv.includes("--watch");

// The build script empties `dist` before tsup runs: three configurations
// share the directory, and a `clean` in one of them removes what another
// already wrote.

export default defineConfig([
  {
    entry: { index: "src/index.ts", detect: "src/detect.ts" },
    format: ["esm", "cjs"],
    dts: !isWatch,
    sourcemap: true,
    keepNames: true,
    target: "es2022",
    external: ["electron"],
  },
  {
    entry: { main: "src/main/index.ts" },
    format: ["esm", "cjs"],
    dts: !isWatch,
    sourcemap: true,
    keepNames: true,
    target: "es2022",
    platform: "node",
    // The main entry reads the preload script from the directory it was
    // loaded from, which the CommonJS build takes from `__dirname` and the
    // ESM build from this shim. Only this entry runs in the main process.
    shims: true,
    external: ["electron"],
  },
  {
    entry: { preload: "src/preload/index.ts" },
    format: ["cjs"],
    // A sandboxed preload script can load nothing but `electron`, so every
    // other module this package wrote is bundled into the one file.
    external: ["electron"],
    splitting: false,
    dts: false,
    sourcemap: true,
    keepNames: true,
    target: "es2022",
    platform: "node",
    outExtension: () => ({ js: ".cjs" }),
  },
]);
